import type { Position, Range } from '../types.js';

/** Convert a character offset in `text` to an LSP Position. */
export function offsetToPosition(text: string, offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const before = text.slice(0, clamped);
    const lines = before.split('\n');
    return {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
    };
}

/** Convert an LSP Position in `text` to a character offset. */
export function positionToOffset(text: string, position: Position): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for \n
    }
    return offset + Math.min(position.character, lines[position.line]?.length ?? 0);
}

/** Extract the text covered by a Range. */
export function getTextInRange(text: string, range: Range): string {
    const start = positionToOffset(text, range.start);
    const end = positionToOffset(text, range.end);
    return text.slice(start, end);
}
