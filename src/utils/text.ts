/**
 * General text-parsing utilities used across validators, completions, and hover providers.
 */

const OPEN_BRACKETS = new Set(['(', '[', '{']);
const CLOSE_BRACKETS = new Set([')', ']', '}']);

/**
 * Returns all start offsets of `search` within `text`.
 * @param text - Source text to search.
 * @param search - Substring to find.
 * @returns Array of start offsets where the substring occurs.
 */
export function findAllOccurrences(text: string, search: string): number[] {
    const indices: number[] = [];
    let index = text.indexOf(search);
    while (index !== -1) {
        indices.push(index);
        index = text.indexOf(search, index + search.length);
    }
    return indices;
}

/**
 * Counts the number of top-level arguments in a function call starting at `openParenPos`.
 * Runs on sanitized text so commas inside strings/comments don't produce false positives.
 *
 * Returns 0 for empty `()`, `commas + 1` otherwise, or -1 if no closing paren is found.
 * @param text - Sanitized source text.
 * @param openParenPos - Index of the opening parenthesis.
 * @returns Argument count, or -1 if the argument list is unclosed.
 */
export function countFunctionArguments(text: string, openParenPos: number): number {
    let depth = 1;
    let commas = 0;
    let hasContent = false;

    for (let index = openParenPos + 1; index < text.length && depth > 0; index++) {
        const ch = text[index];
        if (ch === '(') {
            depth++;
            hasContent = true;
        } else if (ch === ')') {
            depth--;
        } else if (ch === ',' && depth === 1) {
            commas++;
            hasContent = true;
        } else if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') {
            hasContent = true;
        }
    }

    if (depth !== 0) return -1;
    return hasContent ? commas + 1 : 0;
}

export interface ArgumentSpan {
    value: string;
    start: number;
    end: number;
}

/**
 * Extracts each top-level argument's text and absolute position from a function call.
 * Returns null when the argument list is not properly closed.
 * @param text - Source text.
 * @param openParenPos - Index of the opening parenthesis.
 * @returns Array of ArgumentSpan objects, or null if the list is unclosed.
 */
export function extractFunctionArguments(
    text: string,
    openParenPos: number,
): ArgumentSpan[] | null {
    let depth = 1;
    let argStart = openParenPos + 1;
    const args: ArgumentSpan[] = [];
    let hasContent = false;

    for (let index = openParenPos + 1; index < text.length; index++) {
        const ch = text[index];
        if (OPEN_BRACKETS.has(ch)) {
            depth++;
            hasContent = true;
        } else if (CLOSE_BRACKETS.has(ch)) {
            depth--;
            if (depth === 0) {
                const raw = text.slice(argStart, index);
                if (hasContent || raw.trim().length > 0) {
                    args.push({ value: raw.trim(), start: argStart, end: index });
                }
                return args;
            }
        } else if (ch === ',' && depth === 1) {
            const raw = text.slice(argStart, index);
            args.push({ value: raw.trim(), start: argStart, end: index });
            argStart = index + 1;
            hasContent = false;
        } else if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') {
            hasContent = true;
        }
    }

    return null; // unmatched paren
}

/**
 * Infers the literal type of a trimmed argument string.
 * Returns null for variables, expressions, or nested calls.
 * @param arg - Trimmed argument string.
 * @returns Literal type string, or null if not a literal.
 */
export function inferLiteralType(arg: string): 'string' | 'number' | 'boolean' | null {
    if (arg.startsWith('"') || arg.startsWith("'")) return 'string';
    if (/^-?\d+(\.\d+)?$/.test(arg)) return 'number';
    if (arg === 'true' || arg === 'false') return 'boolean';
    return null;
}

/**
 * Returns the word boundaries around a character position in a line.
 * @param line - The line text.
 * @param character - The character offset within the line.
 * @returns Start and end offsets of the word, or null if none.
 */
export function getWordRangeAtPosition(
    line: string,
    character: number,
): { start: number; end: number } | null {
    const wordPattern = /@@?[a-zA-Z_][a-zA-Z0-9_]*|[a-zA-Z_][a-zA-Z0-9_]*/g;
    let match: RegExpExecArray | null;
    while ((match = wordPattern.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (character >= start && character <= end) {
            return { start, end };
        }
    }
    return null;
}

/**
 * Walk backward from the cursor to find the enclosing function call name
 * and the current parameter index (0-based comma count).
 * @param textUpToCursor - Document text from start up to the cursor position.
 * @returns Function context object, or null if not inside a function call.
 */
export function findFunctionContext(
    textUpToCursor: string,
): { functionName: string; paramIndex: number; argValues: string[] } | null {
    let depth = 0;
    let commaCount = 0;

    for (let index = textUpToCursor.length - 1; index >= 0; index--) {
        const ch = textUpToCursor[index];
        if (ch === ')') {
            depth++;
        } else if (ch === '(') {
            if (depth === 0) {
                const before = textUpToCursor.slice(0, Math.max(0, index)).trimEnd();
                const functionMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
                if (functionMatch) {
                    const argValues = splitTopLevelArgs(textUpToCursor.slice(index + 1));
                    return { functionName: functionMatch[1], paramIndex: commaCount, argValues };
                }
                return null;
            }
            depth--;
        } else if (ch === ',' && depth === 0) {
            commaCount++;
        }
    }
    return null;
}

/**
 * Splits a partial argument list (text after the opening paren, up to the cursor)
 * into top-level argument strings, ignoring commas nested inside parens/brackets/braces.
 * The final entry is the argument currently being typed.
 * @param argsText - Text following the opening parenthesis, up to the cursor.
 * @returns Array of trimmed top-level argument strings.
 */
function splitTopLevelArgs(argsText: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < argsText.length; index++) {
        const ch = argsText[index];
        if (OPEN_BRACKETS.has(ch)) {
            depth++;
        } else if (CLOSE_BRACKETS.has(ch)) {
            depth--;
        } else if (ch === ',' && depth === 0) {
            args.push(argsText.slice(start, index).trim());
            start = index + 1;
        }
    }
    args.push(argsText.slice(start).trim());
    return args;
}
