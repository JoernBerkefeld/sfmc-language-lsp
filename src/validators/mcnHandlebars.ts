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
 *   - `handlebars/helper-name-case`    (Warning) catalogued helper written in other letter case
 *
 * The MCN templating engine is based on Handlebars.Net and is locked down: you
 * cannot register helpers, partials, or decorators. Anything outside the fixed
 * catalog is therefore flagged.
 */

import { createDiagnostic } from '../diagnostic-rules.js';
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
    getHelper,
    isBuiltinBinding,
    unsupportedByNodeType,
    helperNames,
    handlebarsBindingList,
} from '../data/handlebars.js';
import { closestMatch } from '../utils/closestMatch.js';
import {
    blankSpan,
    findUnclosedMustache,
    scanHandlebarsBlockTags,
} from '../utils/handlebarsBlocks.js';

/**
 * Proper-cased built-in binding names, used for "did you mean" suggestions.
 */
const BINDING_NAME_LIST = handlebarsBindingList.map((b) => b.name);
/**
 * Map from lowercase binding name to its `{!$...}` token, for suggestion text.
 */
const BINDING_TOKEN_BY_NAME = new Map(
    handlebarsBindingList.map((b) => [b.name.toLowerCase(), b.token]),
);

// Diagnostic codes emitted by the MCN Handlebars validator.
export const DIAG_CODE_HBS_SYNTAX = 'handlebars/syntax-error';
export const DIAG_CODE_HBS_UNSUPPORTED_CONSTRUCT = 'handlebars/unsupported-construct';
export const DIAG_CODE_HBS_UNKNOWN_HELPER = 'handlebars/unknown-helper';
export const DIAG_CODE_HBS_UNKNOWN_BINDING = 'handlebars/unknown-binding';
// Not a DIAG_CODE_ constant: those are the legacy wire codes; this newer check only
// emits its public rule ID (`sfmc/hbs-helper-name-case`).
export const HBS_HELPER_NAME_CASE_VARIANT = 'handlebars/helper-name-case';

/**
 * Payload attached to unknown-helper / unknown-binding diagnostics for quick fixes.
 */
export interface HandlebarsSuggestionData {
    /**
     * The unknown name the user typed (helper name or binding token).
     */
    typed: string;
    /**
     * The closest known name to suggest as a replacement.
     */
    suggestion: string;
}

/**
 * MCN Handlebars diagnostic codes that duplicate eslint-plugin-sfmc (`-next`
 * config) rules and can be suppressed via `disableLspDiagnosticsForEslintRules`:
 *   - unsupported-construct → `hbs-no-unsupported-construct`
 *   - unknown-helper → `hbs-no-unknown-helper`
 *   - unknown-binding → `hbs-no-unknown-binding`
 *
 * `handlebars/syntax-error` is deliberately excluded: it is a parser-level error
 * with no eslint-plugin-sfmc equivalent, so it must always surface.
 */
export const HBS_ESLINT_DUPLICATE_DIAG_CODES = new Set<string>([
    DIAG_CODE_HBS_UNSUPPORTED_CONSTRUCT,
    DIAG_CODE_HBS_UNKNOWN_HELPER,
    DIAG_CODE_HBS_UNKNOWN_BINDING,
]);

/**
 * Matches a `{!$namespace.Field}` built-in data binding token.
 */
const BINDING_PATTERN = /\{!\$([A-Za-z0-9_.]+)\}/g;

/**
 * Narrowed view of the AST nodes this validator inspects.
 */
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
    if (!path || path.type !== 'PathExpression' || path.data || (path.depth ?? 0) > 0) return null;
    const parts = path.parts ?? [];
    if (parts.length !== 1) return null;
    const name = parts[0];
    return !name || name === 'this' ? null : name;
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
        diagnostics.push(
            createDiagnostic(DIAG_CODE_HBS_UNSUPPORTED_CONSTRUCT, {
                severity: DiagnosticSeverity.Error,
                range: astLocToRange(node.loc),
                message: entry.message,
                source: 'handlebars',
            }),
        );
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
    return createDiagnostic(DIAG_CODE_HBS_UNKNOWN_HELPER, {
        severity: DiagnosticSeverity.Warning,
        range: astLocToRange(node.loc),
        message: `Unknown Handlebars ${kind} '${helperName}'. It is not part of the Marketing Cloud Next catalog, and the MCN engine cannot register custom helpers.${hint}`,
        source: 'handlebars',
        ...(suggestion && {
            data: { typed: helperName, suggestion } satisfies HandlebarsSuggestionData,
        }),
    });
}

/**
 * Build a Warning when a catalogued helper is written with different letter case.
 * Marketing Cloud Next matches helper names case-sensitively and rejects the email at
 * save otherwise (e.g. `properCase` instead of `propercase`).
 * @param node - The helper invocation node.
 * @param helperName - The helper name as typed.
 * @param isBlock - True when the node is a block helper (`{{#name}}`).
 * @returns The constructed diagnostic, or null when the case matches.
 */
function helperNameCaseDiagnostic(
    node: HandlebarsAstNode,
    helperName: string,
    isBlock: boolean,
): Diagnostic | null {
    const helper = getHelper(helperName);
    if (!helper || helper.name === helperName) return null;
    const kind = isBlock ? 'Block helper' : 'Helper';
    return createDiagnostic(HBS_HELPER_NAME_CASE_VARIANT, {
        severity: DiagnosticSeverity.Warning,
        range: astLocToRange(node.loc),
        message: `${kind} names are case-sensitive in Marketing Cloud Next: write '${helper.name}' instead of '${helperName}'. Next rejects the email at save otherwise.`,
        source: 'handlebars',
        data: { typed: helperName, suggestion: helper.name } satisfies HandlebarsSuggestionData,
    });
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

    // 1. Parse. On a syntax error the template is checked without its block tags.
    const { ast, error } = parseHandlebars(sanitized);
    if (error) {
        diagnostics.push(
            createDiagnostic(DIAG_CODE_HBS_SYNTAX, {
                severity: DiagnosticSeverity.Error,
                range: error.range,
                message: error.message,
                source: 'handlebars',
            }),
        );
        checkAfterSyntaxError(sanitized, diagnostics, remainingBudget - 1);
        return;
    }

    const problems = ast ? checkHelperCalls(ast, diagnostics, remainingBudget) : 0;

    // 3. Built-in `{!$...}` bindings. The Handlebars parser treats these as
    //    literal content, so they are validated with a regex pass over the
    //    sanitized text (offsets are preserved, AMPscript regions are blanked).
    checkBindings(text, sanitized, diagnostics, remainingBudget - problems);
}

/**
 * Keep checking a template the parser rejected: parse it again with every block
 * tag (and every empty `{{ }}`) blanked, check the helper calls that remain, and
 * check the block helper names from a text scan.
 * @param sanitized - Sanitized Handlebars text.
 * @param diagnostics - Diagnostics sink.
 * @param budget - Maximum number of additional problems to report.
 */
function checkAfterSyntaxError(sanitized: string, diagnostics: Diagnostic[], budget: number): void {
    if (budget <= 0) return;
    const tags = scanHandlebarsBlockTags(sanitized);
    let blanked = sanitized.replaceAll(/\{\{~?\s*~?\}\}/g, (m) => ' '.repeat(m.length));
    for (const tag of tags) blanked = blankSpan(blanked, tag.start, tag.end);
    // Expressions still being typed (`{{upp` without `}}`) are dropped as well.
    for (let open = findUnclosedMustache(blanked); open; open = findUnclosedMustache(blanked)) {
        blanked = blankSpan(blanked, open.start, open.end);
    }
    const { ast } = parseHandlebars(blanked);
    let problems = ast ? checkHelperCalls(ast, diagnostics, budget) : 0;

    for (const tag of tags) {
        if (problems >= budget) return;
        if (tag.kind !== 'open' || !/^[A-Za-z_]\w*$/.test(tag.name)) continue;
        const node = { type: 'BlockStatement', loc: offsetsToLoc(sanitized, tag.start, tag.end) };
        const diagnostic = isHelper(tag.name)
            ? helperNameCaseDiagnostic(node as HandlebarsAstNode, tag.name, true)
            : unknownHelperDiagnostic(node as HandlebarsAstNode, tag.name, true);
        if (!diagnostic) {
            continue;
        }

        problems++;
        diagnostics.push(diagnostic);
    }
    checkBindings(sanitized, sanitized, diagnostics, budget - problems);
}

/**
 * Parser-style source location (1-based line, 0-based column) between two offsets.
 * @param text - Source text.
 * @param start - Start offset.
 * @param end - End offset.
 * @returns The location.
 */
function offsetsToLoc(
    text: string,
    start: number,
    end: number,
): { start: { line: number; column: number }; end: { line: number; column: number } } {
    const at = (offset: number) => {
        const before = text.slice(0, offset);
        return {
            line: before.split('\n').length,
            column: offset - (before.lastIndexOf('\n') + 1),
        };
    };
    return { start: at(start), end: at(end) };
}

/**
 * Walk the AST: unsupported constructs (Error), unknown helpers and helper names
 * in the wrong letter case (Warning).
 * @param ast - Parsed template.
 * @param diagnostics - Diagnostics sink.
 * @param remainingBudget - Maximum number of problems to report.
 * @returns The number of problems reported.
 */
function checkHelperCalls(
    ast: NonNullable<ReturnType<typeof parseHandlebars>['ast']>,
    diagnostics: Diagnostic[],
    remainingBudget: number,
): number {
    let problems = 0;
    {
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
                } else if (isInvocation && helperName) {
                    const wrongCase = helperNameCaseDiagnostic(node, helperName, false);
                    if (wrongCase) {
                        problems++;
                        diagnostics.push(wrongCase);
                    }
                }
            } else if (helperName && node.type === 'BlockStatement') {
                // Block helpers must be known — MCN cannot register custom ones.
                if (isHelper(helperName)) {
                    const wrongCase = helperNameCaseDiagnostic(node, helperName, true);
                    if (wrongCase) {
                        problems++;
                        diagnostics.push(wrongCase);
                    }
                } else {
                    problems++;
                    diagnostics.push(unknownHelperDiagnostic(node, helperName, true));
                }
            }
        });
    }
    return problems;
}

/**
 * Check built-in `{!$...}` bindings against the catalog.
 * @param text - Full document text (for positions).
 * @param sanitized - Sanitized Handlebars text with the same offsets.
 * @param diagnostics - Diagnostics sink.
 * @param remainingBudget - Maximum number of problems to report.
 * @returns The number of problems reported.
 */
function checkBindings(
    text: string,
    sanitized: string,
    diagnostics: Diagnostic[],
    remainingBudget: number,
): number {
    let problems = 0;
    BINDING_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BINDING_PATTERN.exec(sanitized)) !== null && problems < remainingBudget) {
        const bindingName = match[1];
        if (isBuiltinBinding(bindingName)) continue;
        problems++;
        const suggestionName = closestMatch(bindingName, BINDING_NAME_LIST);
        const suggestionToken = suggestionName
            ? BINDING_TOKEN_BY_NAME.get(suggestionName.toLowerCase())
            : undefined;
        const hint = suggestionToken ? ` Did you mean '${suggestionToken}'?` : '';
        diagnostics.push(
            createDiagnostic(DIAG_CODE_HBS_UNKNOWN_BINDING, {
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, match.index),
                    end: offsetToPosition(text, match.index + match[0].length),
                },
                message: `Unknown built-in binding '${match[0]}'. It is not a recognized Marketing Cloud Next data binding.${hint}`,
                source: 'handlebars',
                ...(suggestionToken && {
                    data: {
                        typed: match[0],
                        suggestion: suggestionToken,
                    } satisfies HandlebarsSuggestionData,
                }),
            }),
        );
    }
    return problems;
}
