import type { SignatureHelp, ParameterInformation } from '../types.js';
import type { LocalSsjsFunction } from '../utils/markdown.js';
import {
    platformMethods,
    platformFunctions,
    ssjsGlobals,
    platformVariableMethods,
    platformResponseMethods,
    platformRequestMethods,
    platformRecipientMethods,
    wsproxyMethods,
    httpMethods,
    httpHeaderMethods,
    dateTimeTimezoneMethods,
    errorUtilMethods,
} from '../data/ssjs.js';
import type { SsjsFunction } from '../data/ssjs.js';

const ALL_SSJS_FUNCTIONS: SsjsFunction[] = [
    ...platformMethods,
    ...platformFunctions,
    ...ssjsGlobals,
    ...platformVariableMethods,
    ...platformResponseMethods,
    ...platformRequestMethods,
    ...platformRecipientMethods,
    ...wsproxyMethods,
    ...httpMethods,
    ...httpHeaderMethods,
    ...dateTimeTimezoneMethods,
    ...errorUtilMethods,
];

/**
 * Return SSJS signature help for the given function context.
 * @param context - Parsed function call context.
 * @param context.functionName - Name of the function being called.
 * @param context.paramIndex - Zero-based index of the active parameter.
 * @param localFunctions - Local function declarations from the document.
 * @returns SignatureHelp object, or null if the function is unknown.
 */
export function getSsjsSignatureHelp(
    context: { functionName: string; paramIndex: number },
    localFunctions: LocalSsjsFunction[],
): SignatureHelp | null {
    const fn = ALL_SSJS_FUNCTIONS.find(
        (f) => f.name.toLowerCase() === context.functionName.toLowerCase(),
    );

    if (fn) {
        const prefix = fn.prefix ? `${fn.prefix}.` : '';

        if (fn.params && fn.params.length > 0) {
            const parameterInfos: ParameterInformation[] = fn.params.map((p) => ({
                label: `${p.name}${p.optional ? '?' : ''}: ${p.type ?? 'any'}`,
                documentation: `${p.description}${p.optional ? ' *(optional)*' : ''}`,
            }));

            // Bug #7 fix: fn.syntax is already fully qualified (e.g. "Platform.Function.Lookup(...)"),
            // so don't prepend prefix again. Only use prefix for the fallback (no syntax defined).
            const sigLabel =
                fn.syntax ??
                `${prefix}${fn.name}(${fn.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type ?? 'any'}`).join(', ')})`;

            return {
                signatures: [
                    { label: sigLabel, documentation: fn.description, parameters: parameterInfos },
                ],
                activeSignature: 0,
                activeParameter: Math.min(context.paramIndex, parameterInfos.length - 1),
            };
        }

        const paramCount =
            fn.maxArgs === Infinity ? Math.max(fn.minArgs, context.paramIndex + 1) : fn.maxArgs;
        const paramLabels: string[] = [];
        for (let i = 0; i < paramCount; i++) {
            paramLabels.push(i < fn.minArgs ? `arg${i + 1}` : `arg${i + 1}?`);
        }
        const parameterInfos: ParameterInformation[] = paramLabels.map((label) => ({ label }));

        return {
            signatures: [
                {
                    label: `${prefix}${fn.name}(${paramLabels.join(', ')})`,
                    documentation: fn.description,
                    parameters: parameterInfos,
                },
            ],
            activeSignature: 0,
            activeParameter: Math.min(context.paramIndex, parameterInfos.length - 1),
        };
    }

    // Fall back to file-local function
    const localFn = localFunctions.find(
        (f) => f.name.toLowerCase() === context.functionName.toLowerCase(),
    );
    if (localFn && localFn.params.length > 0) {
        const parameterInfos: ParameterInformation[] = localFn.params.map((p) => {
            const pd = localFn.paramDocs.get(p);
            const typeStr = pd?.type ? ` \`${pd.type}\`` : '';
            return {
                label: p,
                documentation: pd
                    ? `${typeStr}${pd.description ? ` — ${pd.description}` : ''}`.trim()
                    : undefined,
            };
        });
        const paramList = localFn.params
            .map((p) => {
                const pd = localFn.paramDocs.get(p);
                return pd?.type ? `${p}: ${pd.type}` : p;
            })
            .join(', ');

        return {
            signatures: [
                {
                    label: `${localFn.name}(${paramList})`,
                    documentation: localFn.description || undefined,
                    parameters: parameterInfos,
                },
            ],
            activeSignature: 0,
            activeParameter: Math.min(context.paramIndex, parameterInfos.length - 1),
        };
    }

    return null;
}
