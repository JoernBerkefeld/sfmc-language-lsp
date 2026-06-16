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

    const signatureLabel = fn.syntax ?? `${fn.name}(${fn.params.map((p) => p.name).join(', ')})`;

    const parameterInfos: ParameterInformation[] = fn.params.map((p) => {
        const optional = p.optional ? ' *(optional)*' : '';
        const defaultVal =
            p.default !== undefined && p.default !== null
                ? `\n\n**Default:** \`${String(p.default)}\``
                : '';
        const allowed =
            p.enum && p.enum.length > 0 ? `\n\nAllowed values: ${p.enum.join(', ')}` : '';
        return {
            // Prefer an offset range so the client can highlight the parameter
            // even when the syntax string collapses repeating slots (e.g. Concat
            // renders `string2[, ...]` and never spells out `stringN`). Falls
            // back to the plain name when the token is not present in the label.
            label: labelRange(signatureLabel, p.name) ?? p.name,
            documentation: `${p.description}${optional}${defaultVal}${allowed}`,
        };
    });

    return {
        signatures: [
            {
                label: signatureLabel,
                documentation: fn.description,
                parameters: parameterInfos,
            },
        ],
        activeSignature: 0,
        activeParameter: resolveActiveParameter(fn, context.paramIndex, context.argValues),
    };
}

/**
 * Locate a parameter token inside the signature label and return its
 * `[start, end)` character offsets, as expected by the LSP `ParameterInformation`
 * label tuple form. Returns null when the token does not appear literally (the
 * caller then falls back to the plain string label).
 * @param signatureLabel - The full signature string shown to the user.
 * @param paramName - The parameter name to locate.
 * @returns A `[start, end]` offset tuple, or null when not found.
 */
function labelRange(signatureLabel: string, paramName: string): [number, number] | null {
    const start = signatureLabel.indexOf(paramName);
    if (start === -1) return null;
    return [start, start + paramName.length];
}

/**
 * Describe one logical repeating block in terms of its explicit `*1` / `*N`
 * parameter slots. AMPscript catalog entries model variadic arguments with a
 * fixed `*1` block (the first occurrence) immediately followed by a matching
 * `*N` block (the repeating template), e.g. `searchColumnName1, searchValue1,
 * searchColumnNameN, searchValueN`. The `repeat[].startIndex` points at the
 * `*1` block; the `*N` block starts at `startIndex + groupSize`.
 */
interface RepeatBlock {
    /** First param index of the `*1` block. */
    oneStart: number;
    /** First param index of the `*N` block (= oneStart + groupSize). */
    nStart: number;
    /** Number of params in each of the `*1` and `*N` blocks. */
    groupSize: number;
}

/**
 * Detect every `*1`/`*N` block in a function's parameter list by naming
 * convention: a run of params whose names end in `1` (the fixed first
 * occurrence) immediately followed by an equal-length run of params whose names
 * end in `N` (the repeating template). The catalog `repeat[].startIndex` data is
 * not used for slot mapping because, for count-gated two-group functions, its
 * second group's `startIndex` points inside the first block; the parameter names
 * are the reliable source of truth.
 * @param fn - AMPscript function descriptor.
 * @returns Ordered list of detected `*1`/`*N` blocks.
 */
function detectRepeatBlocks(fn: AmpscriptFunction): RepeatBlock[] {
    const params = fn.params;
    const blocks: RepeatBlock[] = [];
    let i = 0;
    while (i < params.length) {
        if (!params[i].name.endsWith('1')) {
            i++;
            continue;
        }
        // Count the run of consecutive `*1` params.
        const oneStart = i;
        let groupSize = 0;
        while (i < params.length && params[i].name.endsWith('1')) {
            groupSize++;
            i++;
        }
        // Require an equal-length run of matching `*N` params right after.
        const nStart = i;
        let nCount = 0;
        while (i < params.length && params[i].name.endsWith('N') && nCount < groupSize) {
            nCount++;
            i++;
        }
        if (nCount === groupSize && groupSize > 0) {
            blocks.push({ oneStart, nStart, groupSize });
        }
    }
    return blocks;
}

/**
 * Map an argument index that falls inside a `*1`/`*N` block onto the slot to
 * highlight: the first `groupSize` args use the `*1` slots, every later arg
 * clamps onto the corresponding `*N` slot (never folding back to `*1`).
 * @param block - Repeat block descriptor.
 * @param offset - Argument offset relative to the block's `*1` start.
 * @returns The parameter index to mark active.
 */
function slotInBlock(block: RepeatBlock, offset: number): number {
    if (offset < block.groupSize) {
        return block.oneStart + offset;
    }
    return block.nStart + (offset % block.groupSize);
}

/**
 * Map the raw zero-based argument index to the parameter slot to highlight,
 * honouring the explicit `*1` / `*N` repeat-block convention used by the
 * AMPscript catalog.
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

    const blocks = detectRepeatBlocks(fn);

    // No symmetric *1/*N blocks (e.g. Concat: string1, string2, stringN). The
    // trailing param simply repeats — clamp onto the last param.
    if (blocks.length === 0) {
        return Math.min(paramIndex, lastParam);
    }

    // Single repeating block (e.g. HTTPPost2 headers, ReplaceList,
    // UpdateSingleSalesforceObject field pairs).
    if (blocks.length === 1) {
        const block = blocks[0];
        if (paramIndex < block.oneStart) {
            return Math.min(paramIndex, lastParam);
        }
        return slotInBlock(block, paramIndex - block.oneStart);
    }

    // Two repeating blocks gated by a count param (e.g. UpdateData/UpsertData):
    // a search block then an update/upsert block. The count param (number of
    // search column/value pairs) determines how many search slots are filled and
    // therefore where the second block begins.
    const [firstBlock, secondBlock] = blocks;
    const countParam = groups[0]?.countParam;

    // Length of the entire first (search) block, derived from the count param.
    // Default to a single group (just the *1 slots) until the count is known.
    let firstBlockLength = firstBlock.groupSize;
    if (countParam) {
        const countParamIndex = fn.params.findIndex((p) => p.name === countParam);
        const rawCount = countParamIndex === -1 ? undefined : argValues?.[countParamIndex];
        const count = rawCount === undefined ? Number.NaN : Number.parseInt(rawCount, 10);
        if (Number.isFinite(count) && count > 0) {
            firstBlockLength = count * firstBlock.groupSize;
        }
    }
    const firstBlockEnd = firstBlock.oneStart + firstBlockLength;

    if (paramIndex < firstBlock.oneStart) {
        return Math.min(paramIndex, lastParam);
    }
    if (paramIndex < firstBlockEnd) {
        return slotInBlock(firstBlock, paramIndex - firstBlock.oneStart);
    }
    return slotInBlock(secondBlock, paramIndex - firstBlockEnd);
}
