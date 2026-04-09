import type { SignatureHelp, ParameterInformation } from '../types.js';
import { functionLookup } from '../data/ampscript.js';

/**
 * Return AMPscript signature help for the given function context.
 * @param context
 * @param context.functionName
 * @param context.paramIndex
 */
export function getAmpscriptSignatureHelp(context: {
    functionName: string;
    paramIndex: number;
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
                label: fn.syntax,
                documentation: fn.description,
                parameters: parameterInfos,
            },
        ],
        activeSignature: 0,
        activeParameter: Math.min(context.paramIndex, fn.params.length - 1),
    };
}
