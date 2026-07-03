/**
 * Validator for Handlebars for Marketing Cloud Next (MCN).
 *
 * Runs only when a document targets Marketing Cloud Next (`targetPlatform:
 * 'next'`). It is mutually exclusive with the GTL validator, which runs only
 * for Engagement. Diagnostics emitted here:
 *
 *   - `handlebars/syntax-error`        (Error)   malformed Handlebars syntax
 *   - `handlebars/unsupported-construct` (Error) partials, decorators, log, …
 *   - `handlebars/unknown-helper`      (Warning) helper not in the MCN catalog
 *   - `handlebars/unknown-binding`     (Warning) unknown `{!$...}` data binding
 *
 * The MCN templating engine is based on Handlebars.Net and is locked down: you
 * cannot register helpers, partials, or decorators. Anything outside the fixed
 * catalog is therefore flagged.
 */

import { DiagnosticSeverity } from '../types.js';
import type { Diagnostic } from '../types.js';
import { offsetToPosition } from '../utils/positions.js';
import { getSanitizedHandlebarsText } from '../utils/regions.js';
import {
    parseHandlebars,
    walkHandlebars,
    astLocToRange,
    type HandlebarsAstNode,
} from '../utils/handlebarsAst.js';
import {
    isHelper,
    isBuiltinBinding,
    unsupportedByNodeType,
    helperNames,
    handlebarsBindingList,
} from '../data/handlebars.js';
import { closestMatch } from '../utils/closestMatch.js';

/** Proper-cased built-in binding names, used for "did you mean" suggestions. */
const BINDING_NAME_LIST = handlebarsBindingList.map((b) => b.name);
/** Map from lowercase binding name to its `{!$...}` token, for suggestion text. */
const BINDING_TOKEN_BY_NAME = new Map(
    handlebarsBindingList.map((b) => [b.name.toLowerCase(), b.token]),
);

// Diagnostic codes emitted by the MCN Handlebars validator.
export const DIAG_CODE_HBS_SYNTAX = 'handlebars/syntax-error';
export const DIAG_CODE_HBS_UNSUPPORTED_CONSTRUCT = 'handlebars/unsupported-construct';
export const DIAG_CODE_HBS_UNKNOWN_HELPER = 'handlebars/unknown-helper';
export const DIAG_CODE_HBS_UNKNOWN_BINDING = 'handlebars/unknown-binding';

/** Payload attached to unknown-helper / unknown-binding diagnostics for quick fixes. */
export interface HandlebarsSuggestionData {
    /** The unknown name the user typed (helper name or binding token). */
    typed: string;
    /** The closest known name to suggest as a replacement. */
    suggestion: string;
}

/**
 * MCN Handlebars diagnostic codes that duplicate eslint-plugin-sfmc (`-next`
 * config) rules and can be suppressed via `disableLspDiagnosticsForEslintRules`.
 */
export const HBS_ESLINT_DUPLICATE_DIAG_CODES = new Set<string>([
    DIAG_CODE_HBS_UNSUPPORTED_CONSTRUCT,
    DIAG_CODE_HBS_UNKNOWN_HELPER,
]);

/** Matches a `{!$namespace.Field}` built-in data binding token. */
const BINDING_PATTERN = /\{!\$([A-Za-z0-9_.]+)\}/g;

/** Narrowed view of the AST nodes this validator inspects. */
interface PathLike {
    type: string;
    parts?: string[];
    depth?: number;
    data?: boolean;
    original?: string;
}
interface CallNode extends HandlebarsAstNode {
    path?: PathLike;
    params?: unknown[];
    hash?: { pairs?: unknown[] };
}

/**
 * Returns the bare helper name when a node's path is a simple, single-part
 * identifier (e.g. `add`), or null when it is a property access (`foo.bar`),
 * a data variable (`@index`), a literal, or `this`.
 * @param path - The node's path expression.
 * @returns The simple helper name, or null.
 */
function simpleHelperName(path: PathLike | undefined): string | null {
    if (!path || path.type !== 'PathExpression') return null;
    if (path.data) return null;
    if ((path.depth ?? 0) > 0) return null;
    const parts = path.parts ?? [];
    if (parts.length !== 1) return null;
    const name = parts[0];
    if (!name || name === 'this') return null;
    return name;
}

/**
 * Match a node against the unsupported-construct catalog and emit an Error
 * diagnostic when it matches. Returns true when the node was flagged.
 * @param node - The AST node under inspection.
 * @param helperName - The node's simple helper name, when any.
 * @param diagnostics - Diagnostics sink.
 * @returns True when an unsupported-construct diagnostic was pushed.
 */
function flagUnsupportedConstruct(
    node: HandlebarsAstNode,
    helperName: string | null,
    diagnostics: Diagnostic[],
): boolean {
    const candidates = unsupportedByNodeType.get(node.type);
    if (!candidates) return false;
    for (const entry of candidates) {
        if (entry.helperName !== null && entry.helperName !== helperName) {
            continue;
        }
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: astLocToRange(node.loc),
            message: entry.message,
            source: 'handlebars',
            code: DIAG_CODE_HBS_UNSUPPORTED_CONSTRUCT,
        });
        return true;
    }
    return false;
}

/**
 * Build an unknown-helper Warning diagnostic, attaching a "did you mean" payload
 * when a close catalog match exists.
 * @param node - The offending AST node.
 * @param helperName - The unknown helper name the user typed.
 * @param isBlock - True when the node is a block helper (`{{#name}}`).
 * @returns The constructed diagnostic.
 */
function unknownHelperDiagnostic(
    node: HandlebarsAstNode,
    helperName: string,
    isBlock: boolean,
): Diagnostic {
    const kind = isBlock ? 'block helper' : 'helper';
    const suggestion = closestMatch(helperName, helperNames);
    const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
    return {
        severity: DiagnosticSeverity.Warning,
        range: astLocToRange(node.loc),
        message: `Unknown Handlebars ${kind} '${helperName}'. It is not part of the Marketing Cloud Next catalog, and the MCN engine cannot register custom helpers.${hint}`,
        source: 'handlebars',
        code: DIAG_CODE_HBS_UNKNOWN_HELPER,
        ...(suggestion && {
            data: { typed: helperName, suggestion } satisfies HandlebarsSuggestionData,
        }),
    };
}

/**
 * Validate Handlebars for Marketing Cloud Next within a (possibly mixed)
 * document. AMPscript regions are blanked before parsing so the Handlebars
 * parser does not choke on `%%[...]%%` / `%%=...=%%` syntax. Diagnostics are
 * pushed in place, honoring the shared problem budget.
 * @param text - Full document text.
 * @param diagnostics - Diagnostics sink (shared across validators).
 * @param remainingBudget - Maximum number of additional problems to report.
 */
export function validateMcnHandlebars(
    text: string,
    diagnostics: Diagnostic[],
    remainingBudget: number,
): void {
    if (remainingBudget <= 0) return;

    const sanitized = getSanitizedHandlebarsText(text);

    // Skip documents with no Handlebars expressions at all — avoids paying the
    // parse cost for plain HTML/AMPscript content.
    if (!sanitized.includes('{{') && !sanitized.includes('{!$')) {
        return;
    }

    // 1. Parse. A syntax error is terminal — we cannot walk a null AST.
    const { ast, error } = parseHandlebars(sanitized);
    if (error) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: error.range,
            message: error.message,
            source: 'handlebars',
            code: DIAG_CODE_HBS_SYNTAX,
        });
        return;
    }

    let problems = 0;

    // 2. Walk the AST: unsupported constructs (Error) and unknown helpers (Warning).
    if (ast) {
        walkHandlebars(ast, (rawNode) => {
            if (problems >= remainingBudget) return;
            const node = rawNode as CallNode;
            const helperName = simpleHelperName(node.path);

            if (flagUnsupportedConstruct(node, helperName, diagnostics)) {
                problems++;
                return;
            }

            if (node.type === 'MustacheStatement' || node.type === 'SubExpression') {
                // A bare `{{foo}}` mustache with no params/hash is a data
                // binding, not a helper invocation — don't flag it. A
                // subexpression `(foo ...)` is always an invocation.
                const hasArgs =
                    (node.params?.length ?? 0) > 0 || (node.hash?.pairs?.length ?? 0) > 0;
                const isInvocation = node.type === 'SubExpression' || hasArgs;
                if (isInvocation && helperName && !isHelper(helperName)) {
                    problems++;
                    diagnostics.push(unknownHelperDiagnostic(node, helperName, false));
                }
            } else if (
                node.type === 'BlockStatement' && // Block helpers must be known — MCN cannot register custom ones.
                helperName &&
                !isHelper(helperName)
            ) {
                problems++;
                diagnostics.push(unknownHelperDiagnostic(node, helperName, true));
            }
        });
    }

    // 3. Built-in `{!$...}` bindings. The Handlebars parser treats these as
    //    literal content, so they are validated with a regex pass over the
    //    sanitized text (offsets are preserved, AMPscript regions are blanked).
    BINDING_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BINDING_PATTERN.exec(sanitized)) !== null && problems < remainingBudget) {
        const bindingName = match[1];
        if (!isBuiltinBinding(bindingName)) {
            problems++;
            const suggestionName = closestMatch(bindingName, BINDING_NAME_LIST);
            const suggestionToken = suggestionName
                ? BINDING_TOKEN_BY_NAME.get(suggestionName.toLowerCase())
                : undefined;
            const hint = suggestionToken ? ` Did you mean '${suggestionToken}'?` : '';
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, match.index),
                    end: offsetToPosition(text, match.index + match[0].length),
                },
                message: `Unknown built-in binding '${match[0]}'. It is not a recognized Marketing Cloud Next data binding.${hint}`,
                source: 'handlebars',
                code: DIAG_CODE_HBS_UNKNOWN_BINDING,
                ...(suggestionToken && {
                    data: {
                        typed: match[0],
                        suggestion: suggestionToken,
                    } satisfies HandlebarsSuggestionData,
                }),
            });
        }
    }
}
