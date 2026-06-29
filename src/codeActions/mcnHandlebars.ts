/**
 * Quick-fix code actions for Handlebars for Marketing Cloud Next (MCN).
 *
 * Offers "Did you mean …?" replacements for unknown helpers and unknown
 * `{!$...}` bindings, driven by the suggestion payload the MCN Handlebars
 * validator attaches to those diagnostics.
 */

import { CodeActionKind } from '../types.js';
import type { CodeAction, Diagnostic, Range } from '../types.js';
import { positionToOffset, offsetToPosition, getTextInRange } from '../utils/positions.js';
import {
    DIAG_CODE_HBS_UNKNOWN_HELPER,
    DIAG_CODE_HBS_UNKNOWN_BINDING,
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
        if (
            diagnostic.code !== DIAG_CODE_HBS_UNKNOWN_HELPER &&
            diagnostic.code !== DIAG_CODE_HBS_UNKNOWN_BINDING
        ) {
            continue;
        }
        if (!isSuggestionData(diagnostic.data)) continue;

        const { typed, suggestion } = diagnostic.data;
        const editRange = tokenRange(text, diagnostic.range, typed);

        actions.push({
            title: `Replace '${typed}' with '${suggestion}'`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: { changes: { [uri]: [{ range: editRange, newText: suggestion }] } },
        });
    }

    return actions;
}
