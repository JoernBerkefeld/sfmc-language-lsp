/**
 * Quick-fix code actions for Handlebars for Marketing Cloud Next (MCN).
 *
 * Offers "Did you mean …?" replacements for unknown helpers and unknown
 * `{!$...}` bindings, driven by the suggestion payload the MCN Handlebars
 * validator attaches to those diagnostics.
 */

import { CodeActionKind } from '../types.js';
import { decodeDiagnosticData } from '../diagnostic-rules.js';
import type { CodeAction, Diagnostic, Range } from '../types.js';
import { positionToOffset, offsetToPosition, getTextInRange } from '../utils/positions.js';
import {
    DIAG_CODE_HBS_UNKNOWN_HELPER,
    DIAG_CODE_HBS_UNKNOWN_BINDING,
    HBS_HELPER_NAME_CASE_VARIANT,
    type HandlebarsSuggestionData,
} from '../validators/mcnHandlebars.js';

/**
 * Type guard for the suggestion payload attached to unknown-helper and
 * unknown-binding diagnostics.
 * @param data - The diagnostic's `data` field.
 * @returns True when the payload carries `typed` and `suggestion` strings.
 */
function isSuggestionData(data: unknown): data is HandlebarsSuggestionData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as HandlebarsSuggestionData).typed === 'string' &&
        typeof (data as HandlebarsSuggestionData).suggestion === 'string'
    );
}

/**
 * Compute the precise edit range covering the first occurrence of `typed`
 * inside the diagnostic range, so only the offending token is replaced (the
 * diagnostic range can span a whole `{{helper arg}}` node).
 * @param text - Full document text.
 * @param range - The diagnostic range.
 * @param typed - The token to locate within the range.
 * @returns The narrowed range, or the original range when `typed` is not found.
 */
function tokenRange(text: string, range: Range, typed: string): Range {
    const rangeStart = positionToOffset(text, range.start);
    const within = getTextInRange(text, range);
    const localIndex = within.indexOf(typed);
    if (localIndex === -1) return range;
    const start = rangeStart + localIndex;
    return {
        start: offsetToPosition(text, start),
        end: offsetToPosition(text, start + typed.length),
    };
}

/**
 * Find the helper name in a block's closing tag (`{{/typed}}`) inside the diagnostic range.
 * @param text - Full document text.
 * @param range - The diagnostic range (spans the whole block for block helpers).
 * @param typed - The helper name as typed.
 * @returns Range of the name in the closing tag, or undefined when there is none.
 */
function closingTagRange(text: string, range: Range, typed: string): Range | undefined {
    const within = getTextInRange(text, range);
    const match = new RegExp(String.raw`\{\{~?\s*/\s*(${escapeRegExp(typed)})\s*~?\}\}$`).exec(
        within,
    );
    if (!match) return undefined;
    const start = positionToOffset(text, range.start) + match.index + match[0].indexOf(typed);
    return {
        start: offsetToPosition(text, start),
        end: offsetToPosition(text, start + typed.length),
    };
}

/**
 * Escape a string for literal use in a regular expression.
 * @param value - The literal text.
 * @returns The escaped text.
 */
function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Return quick-fix code actions for MCN Handlebars diagnostics.
 * @param text - Full document text.
 * @param uri - Document URI.
 * @param diagnostics - Diagnostics to generate actions for.
 * @returns Array of code actions.
 */
export function getHandlebarsCodeActions(
    text: string,
    uri: string,
    diagnostics: Diagnostic[],
): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of diagnostics) {
        if (diagnostic.source !== 'handlebars') continue;
        const decoded = decodeDiagnosticData(diagnostic.code, diagnostic.data);
        if (!decoded) continue;
        const { variant, payload } = decoded;
        if (
            variant !== DIAG_CODE_HBS_UNKNOWN_HELPER &&
            variant !== DIAG_CODE_HBS_UNKNOWN_BINDING &&
            variant !== HBS_HELPER_NAME_CASE_VARIANT
        ) {
            continue;
        }
        if (!isSuggestionData(payload)) continue;

        const { typed, suggestion } = payload;
        const edits = [{ range: tokenRange(text, diagnostic.range, typed), newText: suggestion }];
        // A block helper's closing tag must carry the same corrected name.
        const closing =
            variant === HBS_HELPER_NAME_CASE_VARIANT &&
            closingTagRange(text, diagnostic.range, typed);
        if (closing) edits.push({ range: closing, newText: suggestion });

        actions.push({
            title: `Replace '${typed}' with '${suggestion}'`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: { changes: { [uri]: edits } },
        });
    }

    return actions;
}
