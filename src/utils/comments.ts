/**
 * Comment-range scanning for SSJS/JS source text.
 * String literals are skipped so their content is never misidentified as a comment opener.
 */

/**
 * Advances past a string literal starting at the opening quote.
 * @param source - Source text.
 * @param openQuotePos - Index of the opening quote character.
 * @param len - Total source length.
 * @returns Index just past the closing quote (or end of source).
 */
function skipStringLiteral(source: string, openQuotePos: number, len: number): number {
    const quote = source[openQuotePos];
    let i = openQuotePos + 1;
    while (i < len) {
        if (source[i] === '\\') {
            i += 2;
        } else if (source[i] === quote) {
            return i + 1;
        } else {
            i++;
        }
    }
    return i;
}

/**
 * Advances past a block comment starting at the `/` of the `/*` opener.
 * @param source - Source text.
 * @param openPos - Index of the opening slash.
 * @param len - Total source length.
 * @returns Index just past the block-comment terminator (or end of source).
 */
function skipBlockComment(source: string, openPos: number, len: number): number {
    let i = openPos + 2;
    while (i < len) {
        if (source[i] === '*' && i + 1 < len && source[i + 1] === '/') {
            return i + 2;
        }
        i++;
    }
    return i;
}

/**
 * Returns [start, end) character ranges of every comment in the source.
 * @param source - Source text to scan.
 * @returns Array of [start, end) offset pairs for each comment range.
 */
export function buildCommentRanges(source: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let i = 0;
    const len = source.length;

    while (i < len) {
        const ch = source[i];
        if (ch === '"' || ch === "'") {
            i = skipStringLiteral(source, i, len);
        } else if (ch === '/' && i + 1 < len) {
            if (source[i + 1] === '/') {
                const start = i;
                while (i < len && source[i] !== '\n') {
                    i++;
                }
                ranges.push([start, i]);
            } else if (source[i + 1] === '*') {
                const start = i;
                i = skipBlockComment(source, i, len);
                ranges.push([start, i]);
            } else {
                i++;
            }
        } else {
            i++;
        }
    }

    return ranges;
}

/**
 * Returns true when `index` falls within any of the given comment ranges.
 * @param index - Character offset to test.
 * @param ranges - Sorted comment ranges from `buildCommentRanges`.
 * @returns True if the offset is inside a comment.
 */
export function isInCommentRange(index: number, ranges: Array<[number, number]>): boolean {
    for (const [start, end] of ranges) {
        if (start > index) break;
        if (index < end) return true;
    }
    return false;
}
