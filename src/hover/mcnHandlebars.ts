/**
 * Hover documentation for Handlebars for Marketing Cloud Next (MCN).
 *
 * Active only when a document targets Marketing Cloud Next
 * (`targetPlatform: 'next'`). Two hover surfaces are provided:
 *
 *   - Helper hover when the cursor sits on a known helper name inside a
 *     `{{ ... }}` mustache or `( ... )` subexpression.
 *   - Built-in `{!$...}` binding hover when the cursor sits on a binding token.
 */

import { MarkupKind } from '../types.js';
import type { Hover, Position } from '../types.js';
import { getWordRangeAtPosition } from '../utils/text.js';
import { isInsideHandlebars } from '../utils/regions.js';
import { positionToOffset } from '../utils/positions.js';
import {
    buildHandlebarsHelperMarkdown,
    buildHandlebarsBindingMarkdown,
} from '../utils/markdown.js';
import { getHelper, bindingLookup } from '../data/handlebars.js';
import { getHandlebarsLocalsAtOffset } from '../utils/handlebarsScopeTracker.js';

/** Matches a full `{!$namespace.Field}` binding token. */
const BINDING_TOKEN_PATTERN = /\{!\$([A-Za-z0-9_.]+)\}/g;

/**
 * Return a hover for a `{!$...}` binding when the cursor sits inside one on the
 * current line, or null.
 * @param line - The current document line text.
 * @param position - The cursor position.
 * @returns Hover object, or null.
 */
function getBindingHover(line: string, position: Position): Hover | null {
    BINDING_TOKEN_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BINDING_TOKEN_PATTERN.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character < start || position.character > end) continue;

        const binding = bindingLookup.get(match[1].toLowerCase());
        if (!binding) return null;
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: buildHandlebarsBindingMarkdown(binding),
            },
            range: {
                start: { line: position.line, character: start },
                end: { line: position.line, character: end },
            },
        };
    }
    return null;
}

/**
 * Return MCN Handlebars hover documentation at the given line/position.
 * @param line - The current document line text.
 * @param position - The cursor position.
 * @param fullText - Full document text, used for Handlebars region detection.
 * @returns Hover object with Markdown documentation, or null.
 */
export function getHandlebarsHover(
    line: string,
    position: Position,
    fullText: string,
): Hover | null {
    // `{!$...}` bindings are recognizable on their own — no region check needed.
    const bindingHover = getBindingHover(line, position);
    if (bindingHover) return bindingHover;

    const wordRange = getWordRangeAtPosition(line, position.character);
    if (!wordRange) return null;

    const word = line.slice(wordRange.start, wordRange.end);

    // Hover only applies inside a Handlebars expression — a bare `if` in HTML
    // text must not produce helper hover.
    const offset = positionToOffset(fullText, position);
    if (!isInsideHandlebars(fullText, offset)) return null;

    const hoverRange = {
        start: { line: position.line, character: wordRange.start },
        end: { line: position.line, character: wordRange.end },
    };

    // Block-locals (`as |item|` params, `@index`/`@key` loop vars) shadow the
    // helper catalog within their block, so they are resolved first.
    const local = getHandlebarsLocalsAtOffset(fullText, offset).find((l) => l.name === word);
    if (local) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${local.name}** — ${local.detail}`,
            },
            range: hoverRange,
        };
    }

    const helper = getHelper(word);
    if (!helper) return null;

    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: buildHandlebarsHelperMarkdown(helper),
        },
        range: hoverRange,
    };
}
