/**
 * Signature help for Handlebars for Marketing Cloud Next (MCN) helpers.
 *
 * Active only when a document targets Marketing Cloud Next
 * (`targetPlatform: 'next'`). Unlike AMPscript/SSJS calls, Handlebars helpers
 * take whitespace-separated arguments inside a `{{ ... }}` mustache, a `{{# ...}}`
 * block, or a `( ... )` subexpression — so the active call context is resolved
 * by a small scope-aware tokenizer rather than `findFunctionContext`.
 */

import { MarkupKind } from '../types.js';
import type { SignatureHelp, ParameterInformation } from '../types.js';
import { getHelper } from '../data/handlebars.js';
import type { HandlebarsHelper } from '../data/handlebars.js';

/** Leading control sigils that may precede a helper name inside a mustache. */
const SIGIL_PATTERN = /^[#^/>~&!]+/;

/** Whitespace characters that separate Handlebars helper arguments. */
const WHITESPACE_CHARS = [' ', '\t', '\n', '\r'];

/** Resolved Handlebars helper call context at the cursor. */
interface HandlebarsCallContext {
    /** The helper name leading the innermost active expression scope. */
    helperName: string;
    /** Zero-based index of the argument currently being typed. */
    argIndex: number;
}

/**
 * One expression scope: the mustache itself or a nested `( )` subexpression.
 * `tokens` holds completed whitespace-separated tokens (the first is the helper
 * name); `current` is the in-progress token at the cursor.
 */
interface Scope {
    tokens: string[];
    current: string;
}

/**
 * Resolve the innermost Handlebars helper call context from the document text
 * up to the cursor. Returns null when the cursor is not inside an open `{{ }}`
 * expression, or when the leading helper name has not been typed yet.
 * @param textUpToCursor - Document text from start up to the cursor position.
 * @returns The active helper call context, or null.
 */
export function findHandlebarsCallContext(textUpToCursor: string): HandlebarsCallContext | null {
    // Must be inside an open `{{ ... }}` expression.
    const lastOpen = textUpToCursor.lastIndexOf('{{');
    const lastClose = textUpToCursor.lastIndexOf('}}');
    if (lastOpen === -1 || lastOpen < lastClose) return null;

    const inner = textUpToCursor.slice(lastOpen + 2);
    // A `{{!-- comment --}}` or `{{> partial}}` is not a helper call.
    if (inner.startsWith('!')) return null;

    const stack: Scope[] = [{ tokens: [], current: '' }];
    let quote: string | null = null;

    for (const c of inner) {
        const scope = stack.at(-1);
        if (!scope) break;

        if (quote) {
            scope.current += c;
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            scope.current += c;
            continue;
        }
        if (c === '(') {
            if (scope.current) {
                scope.tokens.push(scope.current);
                scope.current = '';
            }
            stack.push({ tokens: [], current: '' });
            continue;
        }
        if (c === ')') {
            if (stack.length > 1) {
                const finished = stack.pop() as Scope;
                if (finished.current) finished.tokens.push(finished.current);
                const parent = stack.at(-1);
                if (parent) {
                    // The subexpression result becomes one argument of the parent.
                    parent.tokens.push('()');
                    parent.current = '';
                }
            }
            continue;
        }
        if (WHITESPACE_CHARS.includes(c)) {
            if (scope.current) {
                scope.tokens.push(scope.current);
                scope.current = '';
            }
            continue;
        }
        scope.current += c;
    }

    const active = stack.at(-1);
    if (!active) return null;

    // The helper name must already be a completed token (a space or `(` followed
    // it). If only an in-progress token exists, the user is still typing the
    // helper name — no signature yet.
    if (active.tokens.length === 0) return null;

    let helperName = active.tokens[0];
    // Block/partial sigils only attach to the first token of the outer scope.
    if (stack.length === 1) {
        helperName = helperName.replace(SIGIL_PATTERN, '');
    }
    if (!helperName) return null;

    // Completed args = tokens after the helper name; the in-progress `current`
    // token (if any) is the argument now being typed.
    const argIndex = active.tokens.length - 1;
    return { helperName, argIndex };
}

/**
 * Build a TypeScript-style signature label and per-parameter offset ranges for
 * an MCN Handlebars helper.
 * @param helper - Handlebars helper descriptor.
 * @returns The label and the `[start, end)` offsets of each parameter token.
 */
function buildSignatureLabel(helper: HandlebarsHelper): {
    label: string;
    paramRanges: [number, number][];
} {
    const paramTokens = helper.params.map((p) => {
        const rest = p.variadic ? '...' : '';
        const opt = p.optional ? '?' : '';
        return `${rest}${p.name}${opt}: ${p.type}`;
    });

    const prefix = `(helper) ${helper.name}(`;
    let cursor = prefix.length;
    const paramRanges: [number, number][] = [];
    for (const [i, token] of paramTokens.entries()) {
        if (i > 0) cursor += 2; // ', '
        paramRanges.push([cursor, cursor + token.length]);
        cursor += token.length;
    }

    const label = `${prefix}${paramTokens.join(', ')}): ${helper.returnType}`;
    return { label, paramRanges };
}

/**
 * Return signature help for the Handlebars helper at the given call context.
 * @param context - The resolved helper call context.
 * @param context.helperName - Name of the helper being invoked.
 * @param context.argIndex - Zero-based index of the active argument.
 * @returns SignatureHelp object, or null when the helper is unknown or takes no
 *   parameters.
 */
export function getHandlebarsSignatureHelp(context: {
    helperName: string;
    argIndex: number;
}): SignatureHelp | null {
    const helper = getHelper(context.helperName);
    if (!helper || helper.params.length === 0) return null;

    const { label, paramRanges } = buildSignatureLabel(helper);

    const parameterInfos: ParameterInformation[] = helper.params.map((p, i) => ({
        label: paramRanges[i],
        documentation: {
            kind: MarkupKind.Markdown,
            value: p.description,
        },
    }));

    // The final parameter may be variadic — clamp the active index onto it so
    // every additional argument keeps the last slot highlighted.
    const lastParam = helper.params.length - 1;
    const activeParameter = Math.min(Math.max(context.argIndex, 0), lastParam);

    return {
        signatures: [
            {
                label,
                documentation: helper.description,
                parameters: parameterInfos,
            },
        ],
        activeSignature: 0,
        activeParameter,
    };
}
