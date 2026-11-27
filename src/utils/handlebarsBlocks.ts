/**
 * Lightweight scan of Handlebars block tags (`{{#name}}`, `{{^name}}`, `{{else}}`,
 * `{{/name}}`) that works on text the parser rejects. It explains block-structure
 * errors in plain words and lets the validator keep checking the rest of a
 * template after a syntax error.
 */

/**
 * One block tag found in the text. Offsets are 0-based string offsets.
 */
export interface HandlebarsBlockTag {
    kind: 'open' | 'else' | 'close';
    /**
     * Helper name as typed (empty for `{{else}}` / `{{^}}`).
     */
    name: string;
    /**
     * Offset of the opening `{{`.
     */
    start: number;
    /**
     * Offset just past the closing `}}`.
     */
    end: number;
    /**
     * Offset of the helper name (equals `start` when there is no name).
     */
    nameStart: number;
}

/**
 * A block-structure problem, with the tag it is reported on.
 */
export interface HandlebarsBlockIssue {
    message: string;
    tag: HandlebarsBlockTag;
}

const COMMENT_PATTERN = /\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}/g;
const BLOCK_TAG_PATTERN = /\{\{~?\s*(?:([#^/])\s*([^\s}~()]*)|(else)\b)[^}]*\}\}/g;

/**
 * Replace a span with spaces, keeping line breaks so offsets and lines stay put.
 * @param text - Source text.
 * @param start - First offset to blank.
 * @param end - Offset just past the span.
 * @returns The text with the span blanked.
 */
export function blankSpan(text: string, start: number, end: number): string {
    return (
        text.slice(0, start) + text.slice(start, end).replaceAll(/[^\n]/g, ' ') + text.slice(end)
    );
}

/**
 * List the block tags in document order, ignoring Handlebars comments.
 * @param text - Sanitized Handlebars text.
 * @returns The block tags.
 */
export function scanHandlebarsBlockTags(text: string): HandlebarsBlockTag[] {
    const source = text.replaceAll(COMMENT_PATTERN, (m) => m.replaceAll(/[^\n]/g, ' '));
    const tags: HandlebarsBlockTag[] = [];
    for (const match of source.matchAll(BLOCK_TAG_PATTERN)) {
        const start = match.index;
        const end = start + match[0].length;
        const [, sigil, rawName = '', elseWord] = match;
        if (elseWord || (sigil === '^' && rawName === '')) {
            tags.push({ kind: 'else', name: '', start, end, nameStart: start });
            continue;
        }
        const name = rawName.replace(/^>/, '');
        const nameStart = start + match[0].indexOf(rawName, 2) + (rawName.length - name.length);
        tags.push({ kind: sigil === '/' ? 'close' : 'open', name, start, end, nameStart });
    }
    return tags;
}

/**
 * Find the first `{{` that has no `}}` before the next `{{` (or the end of the
 * text), e.g. an expression still being typed.
 * @param text - Sanitized Handlebars text.
 * @returns Start offset and end offset (the next `{{` or the end of the text), or null.
 */
export function findUnclosedMustache(text: string): { start: number; end: number } | null {
    let open = text.indexOf('{{');
    while (open !== -1) {
        const close = text.indexOf('}}', open + 2);
        const next = text.indexOf('{{', open + 2);
        if (close === -1 || (next !== -1 && next < close)) {
            return { start: open, end: next === -1 ? text.length : next };
        }
        open = next;
    }
    return null;
}

/**
 * What a word at a given place inside a `{{ ... }}` expression can be.
 * - `helper`: the first word after `{{`, `{{{`, `{{#`, `{{^`, `{{else ` or `(`
 *   (a helper name or a plain value).
 * - `argument`: a later word of the expression (a value, never a helper name).
 * - `none`: inside a string, a path segment after `.`, or after `{{/`, `{{>`, `{{!`.
 * @param before - Document text up to the start of the word (sanitized or not).
 * @returns The kind of position.
 */
export function handlebarsWordPosition(before: string): 'helper' | 'argument' | 'none' {
    const open = before.lastIndexOf('{{');
    if (open === -1) return 'none';
    const inner = before.slice(open + 2);
    if (/^\{?~?\s*[/>!]/.test(inner)) return 'none';
    // Inside a string literal: an odd number of unescaped quotes since the `{{`.
    for (const quote of ['"', "'"]) {
        if ((inner.split(quote).length - 1) % 2 === 1) return 'none';
    }
    if (before.endsWith('.')) return 'none';
    return /(?:^\{?~?\s*(?:[#^]\s*|else\s+)?|\(\s*)$/.test(inner) ? 'helper' : 'argument';
}

/**
 * Find the first block-structure problem: a closing tag that does not match the
 * open block, a closing tag without an open block, or a block left unclosed.
 * @param tags - Block tags from {@link scanHandlebarsBlockTags}.
 * @param lineOf - Maps an offset to its 1-based line number, for messages.
 * @returns The problem, or null when the blocks are balanced.
 */
export function findHandlebarsBlockIssue(
    tags: HandlebarsBlockTag[],
    lineOf: (offset: number) => number,
): HandlebarsBlockIssue | null {
    const stack: HandlebarsBlockTag[] = [];
    for (const tag of tags) {
        if (tag.kind === 'open') {
            stack.push(tag);
        } else if (tag.kind === 'close') {
            const open = stack.at(-1);
            if (!open) {
                return {
                    message: `{{/${tag.name}}} has no matching {{#${tag.name}}} before it.`,
                    tag,
                };
            }
            if (open.name !== tag.name) {
                return {
                    message: `{{/${tag.name}}} does not close {{#${open.name}}} (opened on line ${lineOf(open.start)}). Expected {{/${open.name}}}.`,
                    tag,
                };
            }
            stack.pop();
        }
    }
    const unclosed = stack.at(-1);
    return unclosed
        ? {
              message: `Unclosed {{#${unclosed.name}}} block. Expected a matching closing tag.`,
              tag: unclosed,
          }
        : null;
}
