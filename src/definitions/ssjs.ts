import type { Location } from '../types.js';
import type { LocalSsjsFunction } from '../utils/markdown.js';
import { offsetToPosition } from '../utils/positions.js';

/**
 * Parse all `function name(...)` declarations from SSJS document text,
 * extracting preceding JSDoc blocks for documentation and parameter info.
 */
export function extractLocalSsjsFunctions(text: string): LocalSsjsFunction[] {
    const results: LocalSsjsFunction[] = [];
    const fnPattern = /function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
    let match: RegExpExecArray | null;

    while ((match = fnPattern.exec(text)) !== null) {
        const name = match[1];
        const rawParams = match[2]
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);

        const before = text.slice(0, match.index);
        const jsdocMatch = before.match(/\/\*\*[\s\S]*?\*\/\s*$/);

        let description = '';
        const paramDocs = new Map<string, { type: string; description: string }>();
        let returnType = '';

        if (jsdocMatch) {
            const jsdoc = jsdocMatch[0];

            const descMatch = jsdoc.match(/\/\*\*\s*([\s\S]*?)(?=\s*@|\s*\*\/)/);
            if (descMatch) {
                description = descMatch[1].replace(/^\s*\*\s?/gm, '').trim();
            }

            const paramPattern = /@param\s+(?:\{([^}]*)\}\s+)?(\w+)(?:\s+-\s*(.*?))?(?=\s*@|\s*\*\/)/gs;
            let pMatch: RegExpExecArray | null;
            while ((pMatch = paramPattern.exec(jsdoc)) !== null) {
                paramDocs.set(pMatch[2], {
                    type: pMatch[1] ?? '',
                    description: pMatch[3]?.trim() ?? '',
                });
            }

            const retMatch = jsdoc.match(/@returns?\s+(?:\{([^}]*)\})?/);
            if (retMatch) {
                returnType = retMatch[1] ?? 'any';
            }
        }

        results.push({ name, params: rawParams, description, paramDocs, returnType, startOffset: match.index });
    }

    return results;
}

/**
 * Return an LSP Location for a file-local SSJS function declaration,
 * or null if the name is not found.
 */
export function getSsjsDefinition(text: string, uri: string, name: string): Location | null {
    const fn = extractLocalSsjsFunctions(text).find((f) => f.name === name);
    if (!fn) return null;

    const nameOffset = fn.startOffset + 'function '.length;
    return {
        uri,
        range: {
            start: offsetToPosition(text, nameOffset),
            end: offsetToPosition(text, nameOffset + fn.name.length),
        },
    };
}
