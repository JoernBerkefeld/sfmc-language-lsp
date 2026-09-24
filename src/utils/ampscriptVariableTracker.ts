/**
 * AMPscript variable type tracker.
 *
 * Performs a single-pass scan of AMPscript source text to build a map of
 * variable names → inferred types. The scan covers:
 *
 *   1. `SET \@var = FunctionName(...)` — type derived from the function's
 *      `returnType` field in the ampscript-data catalog.
 *   2. `SET \@var = "string literal"` / `'string'` → `'string'`
 *   3. `SET \@var = 42` / `-3.14` → `'number'`
 *   4. `SET \@var = true` / `false` → `'boolean'`
 *   5. `FOR \@i = <expr> TO <expr>` / `FOR \@i = <expr> DOWNTO <expr>` — index
 *      variable is always `'number'`.
 *
 * Only the **first** assignment to each variable is recorded; later
 * reassignments are ignored (conservative single-type inference).
 *
 * All matching is case-insensitive for keywords (`SET`, `FOR`, `TO`, `DOWNTO`)
 * and function names, matching AMPscript's own case-insensitivity rules.
 */

import { functionLookup } from '../data/ampscript.js';

/**
 * The resolved AMPscript type of a variable.
 */
export type AmpscriptVarType =
    'string' | 'number' | 'boolean' | 'rowset' | 'row' | 'object' | 'string|number';

/**
 * Returns a map from lowercase variable name (without the `@`) to its
 * inferred type, derived from the first assignment found in `text`.
 * @param text - Full AMPscript document text.
 * @returns Map of `varname` → `AmpscriptVarType`.
 */
export function buildVariableTypeMap(text: string): Map<string, AmpscriptVarType> {
    const map = new Map<string, AmpscriptVarType>();

    // --- FOR loop index variables (always number) ---
    // Matches: FOR @varName = <any> TO|DOWNTO <any> (DO is optional)
    const forPattern = /\bfor\s+(@[a-zA-Z_][a-zA-Z0-9_]*)\s*=/gi;
    for (const match of text.matchAll(forPattern)) {
        const varName = match[1].toLowerCase().slice(1); // strip '@'
        if (!map.has(varName)) {
            map.set(varName, 'number');
        }
    }

    // --- SET assignments ---
    // Matches: SET @varName = <rhs>
    // The RHS is captured up to (but not including) a closing %% or end-of-line / block end.
    const setPattern = /\bset\s+(@[a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/gi;
    for (const match of text.matchAll(setPattern)) {
        const varName = match[1].toLowerCase().slice(1); // strip '@'
        if (map.has(varName)) {
            continue; // first assignment wins
        }

        const rhs = match[2].trimStart();
        const type = inferRhsType(rhs);
        if (type !== null) {
            map.set(varName, type);
        }
    }

    return map;
}

/**
 * Infers the AMPscript type for the right-hand side of a `SET \@var = <rhs>`
 * assignment. Returns null when the type cannot be statically determined
 * (e.g. bare variable reference, complex expression).
 * @param rhs - The RHS text after the `=`, left-trimmed.
 * @returns The inferred type, or null.
 */
function inferRhsType(rhs: string): AmpscriptVarType | null {
    // String literal: "..." or '...'
    if (rhs.startsWith('"') || rhs.startsWith("'")) {
        return 'string';
    }

    // Numeric literal (optional leading minus)
    if (/^-?\d+(\.\d+)?/.test(rhs)) {
        return 'number';
    }

    // Boolean literal (case-insensitive)
    if (/^true\b/i.test(rhs) || /^false\b/i.test(rhs)) {
        return 'boolean';
    }

    // Function call: FunctionName(...)
    const functionMatch = rhs.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (functionMatch) {
        const entry = functionLookup.get(functionMatch[1].toLowerCase());
        if (entry?.returnType) {
            return entry.returnType as AmpscriptVarType;
        }
    }

    // @variable reference or unresolvable expression — skip
    return null;
}
