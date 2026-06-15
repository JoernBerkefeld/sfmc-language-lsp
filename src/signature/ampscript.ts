import type { SignatureHelp, ParameterInformation } from '../types.js';
import type { AmpscriptFunction } from '../data/ampscript.js';
import { functionLookup } from '../data/ampscript.js';

/**
 * Return AMPscript signature help for the given function context.
 * @param context - Parsed function call context.
 * @param context.functionName - Name of the function being called.
 * @param context.paramIndex - Zero-based index of the active parameter.
 * @param context.argValues - Top-level argument strings typed so far (for repeat-count lookup).
 * @returns SignatureHelp object, or null if the function is unknown.
 */
export function getAmpscriptSignatureHelp(context: {
    functionName: string;
    paramIndex: number;
    argValues?: string[];
}): SignatureHelp | null {
    const fn = functionLookup.get(context.functionName.toLowerCase());
    if (!fn || !fn.params || fn.params.length === 0) return null;

    const parameterInfos: ParameterInformation[] = fn.params.map((p) => ({
        label: p.name,
        documentation: `${p.description}${p.optional ? ' *(optional)*' : ''}`,
    }));

    return {
        signatures: [
            {
                label: fn.syntax ?? `${fn.name}(${fn.params.map((p) => p.name).join(', ')})`,
                documentation: fn.description,
                parameters: parameterInfos,
            },
        ],
        activeSignature: 0,
        activeParameter: resolveActiveParameter(fn, context.paramIndex, context.argValues),
    };
}

/**
 * Map the raw zero-based argument index to the parameter slot to highlight,
 * folding indices inside a repeating group back onto that group's parameter slots.
 * @param fn - AMPscript function descriptor.
 * @param paramIndex - Zero-based index of the argument being typed.
 * @param argValues - Top-level argument strings typed so far (used to read `countParam`).
 * @returns The parameter index to mark active.
 */
function resolveActiveParameter(
    fn: AmpscriptFunction,
    paramIndex: number,
    argValues?: string[],
): number {
    const lastParam = fn.params.length - 1;
    const groups = fn.repeat;
    if (!groups || groups.length === 0) {
        return Math.min(paramIndex, lastParam);
    }

    // Single repeating group (e.g. Concat, HTTPPost2 headers).
    if (groups.length === 1) {
        const g = groups[0];
        if (paramIndex >= g.startIndex) {
            return g.startIndex + ((paramIndex - g.startIndex) % g.groupSize);
        }
        return Math.min(paramIndex, lastParam);
    }

    // Two repeating groups gated by a count param (e.g. UpdateData/UpsertData).
    const [first, second] = groups;
    let searchBlockEnd = second.startIndex; // fallback when count is unparsable
    if (first.countParam) {
        const countParamIndex = fn.params.findIndex((p) => p.name === first.countParam);
        const rawCount = countParamIndex === -1 ? undefined : argValues?.[countParamIndex];
        const count = rawCount === undefined ? Number.NaN : Number.parseInt(rawCount, 10);
        if (Number.isFinite(count) && count > 0) {
            searchBlockEnd = first.startIndex + count * first.groupSize;
        }
    }

    if (paramIndex < first.startIndex) {
        return Math.min(paramIndex, lastParam);
    }
    if (paramIndex < searchBlockEnd) {
        return first.startIndex + ((paramIndex - first.startIndex) % first.groupSize);
    }
    return second.startIndex + ((paramIndex - searchBlockEnd) % second.groupSize);
}
