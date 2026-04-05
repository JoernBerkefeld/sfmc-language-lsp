/**
 * Comment-range scanning for SSJS/JS source text.
 * String literals are skipped so their content is never misidentified as a comment opener.
 */

/** Returns [start, end) character ranges of every comment in the source. */
export function buildCommentRanges(source: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let i = 0;
    const len = source.length;

    while (i < len) {
        const ch = source[i];
        if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            while (i < len) {
                if (source[i] === '\\') {
                    i += 2;
                } else if (source[i] === quote) {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
        } else if (ch === '/' && i + 1 < len) {
            if (source[i + 1] === '/') {
                const start = i;
                while (i < len && source[i] !== '\n') {
                    i++;
                }
                ranges.push([start, i]);
            } else if (source[i + 1] === '*') {
                const start = i;
                i += 2;
                while (i < len) {
                    if (source[i] === '*' && i + 1 < len && source[i + 1] === '/') {
                        i += 2;
                        break;
                    }
                    i++;
                }
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

/** Returns true when `index` falls within any of the given comment ranges. */
export function isInCommentRange(index: number, ranges: Array<[number, number]>): boolean {
    for (const [start, end] of ranges) {
        if (start > index) break;
        if (index < end) return true;
    }
    return false;
}
