import { DiagnosticSeverity } from '../types.js';
import type { Diagnostic } from '../types.js';
import type { SfmcSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import { getSanitizedAmpscriptText, isInsideAmpscript } from '../utils/regions.js';
import {
    findAllOccurrences,
    countFunctionArguments,
    extractFunctionArguments,
    inferLiteralType,
} from '../utils/text.js';
import type { ArgumentSpan } from '../utils/text.js';
import { offsetToPosition } from '../utils/positions.js';
import {
    functionLookup,
    ampscriptKeywords,
    canonicalFunctions,
    isMcnSupported,
} from '../data/ampscript.js';
import type { AmpscriptDataRepeatGroup, AmpscriptFunctionParam } from '../data/ampscript.js';
import { validateGtlBlocks } from './gtl.js';
import { validateMcnHandlebars } from './mcnHandlebars.js';
import { buildVariableTypeMap } from '../utils/ampscriptVariableTracker.js';
import type { AmpscriptVarType } from '../utils/ampscriptVariableTracker.js';

// Diagnostic codes that code actions identify and act on.
export const DIAG_CODE_HTML_WRAPPED_COMMENT = 'ampscript/html-wrapped-comment';
export const DIAG_CODE_HTML_COMMENT = 'ampscript/html-comment';
export const DIAG_CODE_JS_LINE_COMMENT = 'ampscript/js-line-comment';
export const DIAG_CODE_NESTED_SCRIPT_TAG = 'ampscript/nested-script-tag';
export const DIAG_CODE_NESTED_DELIMITER_IN_SCRIPT = 'ampscript/nested-delimiter-in-script';
export const DIAG_CODE_NESTED_DELIMITER = 'ampscript/nested-delimiter';
export const DIAG_CODE_DEPRECATED_FUNCTION = 'ampscript/deprecated-function';

// Diagnostic codes for checks that overlap with eslint-plugin-sfmc rules.
// When `disableLspDiagnosticsForEslintRules` is enabled these codes are filtered out.
export const DIAG_CODE_UNKNOWN_FUNCTION = 'ampscript/unknown-function';
export const DIAG_CODE_FUNCTION_ARITY = 'ampscript/function-arity';
export const DIAG_CODE_ARG_TYPE = 'ampscript/arg-type';
export const DIAG_CODE_ENUM_VALUE = 'ampscript/enum-value';
export const DIAG_CODE_SMART_QUOTES = 'ampscript/smart-quotes';
export const DIAG_CODE_SET_NO_TARGET = 'ampscript/set-no-target';
// Emitted only for Marketing Cloud Next targets; mirrors the eslint-plugin-sfmc
// `amp-no-mcn-unsupported` rule (enabled in the `-next` configs).
export const DIAG_CODE_MCN_UNSUPPORTED_FUNCTION = 'ampscript/mcn-unsupported-function';

/**
 * Diagnostic codes that duplicate eslint-plugin-sfmc rules and can be
 * suppressed via the `disableLspDiagnosticsForEslintRules` setting.
 */
export const ESLINT_DUPLICATE_DIAG_CODES = new Set<string>([
    DIAG_CODE_UNKNOWN_FUNCTION,
    DIAG_CODE_FUNCTION_ARITY,
    DIAG_CODE_ARG_TYPE,
    DIAG_CODE_ENUM_VALUE,
    DIAG_CODE_SMART_QUOTES,
    DIAG_CODE_SET_NO_TARGET,
    DIAG_CODE_HTML_COMMENT,
    DIAG_CODE_HTML_WRAPPED_COMMENT,
    DIAG_CODE_JS_LINE_COMMENT,
    DIAG_CODE_NESTED_SCRIPT_TAG,
    DIAG_CODE_NESTED_DELIMITER,
    DIAG_CODE_NESTED_DELIMITER_IN_SCRIPT,
    DIAG_CODE_DEPRECATED_FUNCTION,
    DIAG_CODE_MCN_UNSUPPORTED_FUNCTION,
]);

const ampscriptKeywordSet = new Set(ampscriptKeywords.map((kw) => kw.name.toLowerCase()));
const controlFlowConstructSet = new Set([
    'if',
    'elseif',
    'else',
    'endif',
    'for',
    'next',
    'then',
    'do',
    'to',
    'downto',
    'var',
    'set',
    'and',
    'or',
    'not',
    'true',
    'false',
]);

function isKnownAmpscriptConstruct(name: string): boolean {
    return (
        functionLookup.has(name) ||
        ampscriptKeywordSet.has(name) ||
        controlFlowConstructSet.has(name)
    );
}

interface FunctionArity {
    minArgs: number;
    maxArgs: number;
}
// Arity and variadic repeat model come straight from the canonical ampscript-data
// package: maxArgs === Infinity marks a variadic function and `repeat[]` describes
// how its trailing arguments must group.
const functionArityLookup = new Map<string, FunctionArity>();
const repeatLookup = new Map<string, AmpscriptDataRepeatGroup[]>();
for (const fn of canonicalFunctions) {
    functionArityLookup.set(fn.name.toLowerCase(), {
        minArgs: fn.minArgs,
        maxArgs: fn.maxArgs,
    });
    if (Array.isArray(fn.repeat) && fn.repeat.length > 0) {
        repeatLookup.set(fn.name.toLowerCase(), fn.repeat);
    }
}

/**
 * Resolve the comparable value of a static AMPscript literal (string, number, or
 * boolean) for enum validation. Returns null when the argument is not a static
 * literal (e.g. a variable like `@x` or an expression) and therefore cannot be
 * statically validated against an enum.
 * @param raw - The raw argument text as written in the source.
 * @returns The literal value as a string, or null.
 */
function resolveStaticLiteral(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    // Quoted string literal — return inner content.
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if (last === first && trimmed.length >= 2 && (first === '"' || first === "'")) {
        return trimmed.slice(1, -1);
    }
    // Numeric literal (e.g. 5, 3.14, -2).
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return trimmed;
    }
    // Boolean literal (true/false, case-insensitive).
    if (/^(true|false)$/i.test(trimmed)) {
        return trimmed;
    }
    // Variable (@x) or expression — not statically resolvable.
    return null;
}

/**
 * Returns true when a variadic call's trailing arguments do not form complete
 * repeating groups, given the function's canonical `repeat[]` model.
 * @param groups - Repeat-group descriptors from ampscript-data.
 * @param argCount - Actual number of arguments supplied to the call.
 * @param argValues - Top-level argument literals, used to read a `countParam`.
 * @returns True when at least one repeating group is incomplete.
 */
function hasIncompleteRepeatGroup(
    groups: AmpscriptDataRepeatGroup[],
    argCount: number,
    argValues?: string[],
): boolean {
    // Single repeating group: trailing args must be a whole multiple of groupSize.
    if (groups.length === 1) {
        const { startIndex, groupSize, minGroups } = groups[0];
        if (argCount <= startIndex) {
            return minGroups > 0 && argCount < startIndex + groupSize * minGroups;
        }
        const trailing = argCount - startIndex;
        return trailing % groupSize !== 0 || trailing / groupSize < minGroups;
    }

    // Two repeating groups gated by a count param (DataExtension Update/Upsert
    // family): fixed args, then `count` search pairs, then ≥1 update/upsert pairs.
    // Example UpsertData(dataExt, columnValuePairs, search×count, upsert×M).
    const [g1, g2] = groups;
    const countParam = g1.countParam;

    // Determine how many search groups the count literal promises. By the
    // catalog convention the count param sits in the fixed slot immediately
    // before the first repeat group (e.g. columnValuePairs at index 1, search
    // pairs start at index 2).
    let searchGroups = g1.minGroups;
    if (countParam) {
        const countIndex = g1.startIndex - 1;
        const rawCount = argValues?.[countIndex];
        const parsed = rawCount === undefined ? NaN : Math.trunc(Number(rawCount));
        if (Number.isFinite(parsed) && parsed > 0) {
            searchGroups = parsed;
        }
    }

    const searchArgs = searchGroups * g1.groupSize;
    const searchBlockEnd = g1.startIndex + searchArgs;

    // Not enough args to satisfy the declared search pairs.
    if (argCount < searchBlockEnd) {
        return true;
    }

    // Remaining args form the update/upsert block; require ≥1 complete group.
    const updateArgs = argCount - searchBlockEnd;
    if (updateArgs <= 0) {
        return true;
    }
    return updateArgs % g2.groupSize !== 0;
}

const NON_PRIMITIVE_TYPES = new Set(['rowset', 'row', 'object']);

/**
 * Validate the arguments of a single AMPscript function call against the
 * function's parameter catalog (enum membership and literal/variable types).
 * Extracted into its own function so the per-argument loop is not nested inside
 * the document-wide function-call scan (avoids `continue` in a nested loop).
 * @param text - Full document text (for offset → position mapping).
 * @param functionName - The function name as written in the source.
 * @param params - Parameter definitions from the ampscript-data catalog.
 * @param argSpans - Extracted argument spans for this call.
 * @param variableTypeMap - Map of `varname` → inferred AMPscript type.
 * @param budget - Maximum number of diagnostics still allowed for the document.
 * @returns Diagnostics for the call's arguments (length ≤ budget).
 */
function collectArgumentDiagnostics(
    text: string,
    functionName: string,
    params: AmpscriptFunctionParam[],
    argSpans: ArgumentSpan[],
    variableTypeMap: Map<string, AmpscriptVarType>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (let ai = 0; ai < argSpans.length && diagnostics.length < budget; ai++) {
        const param = params[ai];
        if (!param) continue;

        // Enum validation — when the argument is a static literal (string,
        // number, or boolean) it must be one of the allowed enum values
        // (case-insensitive). Variables (@x) and expressions are skipped because
        // their value cannot be determined statically. Note: argSpans come from
        // sanitized text where string contents are blanked, so read the raw
        // literal from the original text by offset.
        if (param.enum && param.enum.length > 0) {
            const rawLiteral = text.slice(argSpans[ai].start, argSpans[ai].end).trim();
            const literal = resolveStaticLiteral(rawLiteral);
            if (
                literal !== null &&
                param.enum.every((v) => String(v).toLowerCase() !== literal.toLowerCase())
            ) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, argSpans[ai].start),
                        end: offsetToPosition(text, argSpans[ai].end),
                    },
                    message: `Argument '${param.name}' of '${functionName}' must be one of: ${param.enum.join(', ')}.`,
                    source: 'ampscript',
                    code: DIAG_CODE_ENUM_VALUE,
                });
            }
            continue;
        }

        if (!param.type) continue;
        const argText = argSpans[ai].value.trim();
        const allowedTypes = param.type
            .toLowerCase()
            .split('|')
            .map((t) => t.trim());

        // Check literal type mismatch
        const inferredLiteralType = inferLiteralType(argText);
        if (inferredLiteralType && !allowedTypes.includes(inferredLiteralType)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, argSpans[ai].start),
                    end: offsetToPosition(text, argSpans[ai].end),
                },
                message: `Argument '${param.name}' of '${functionName}' expects a ${param.type} but received a ${inferredLiteralType}.`,
                source: 'ampscript',
                code: DIAG_CODE_ARG_TYPE,
            });
            continue;
        }

        // Check variable type mismatch when param expects a non-primitive type
        // (rowset, row, object) — only these are unambiguously typed from
        // function return values.
        const requiresNonPrimitive = allowedTypes.some((t) => NON_PRIMITIVE_TYPES.has(t));
        if (requiresNonPrimitive && argText.startsWith('@')) {
            const varName = argText.slice(1).toLowerCase();
            const varType = variableTypeMap.get(varName);
            if (varType !== undefined && !allowedTypes.includes(varType.toLowerCase())) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, argSpans[ai].start),
                        end: offsetToPosition(text, argSpans[ai].end),
                    },
                    message: `Argument '${param.name}' of '${functionName}' expects a ${param.type} but '@${varName}' is a ${varType}.`,
                    source: 'ampscript',
                    code: DIAG_CODE_ARG_TYPE,
                });
            }
        }
    }

    return diagnostics;
}

/**
 * Validate an AMPscript document and return LSP Diagnostics.
 * @param text - Full document text.
 * @param settings - Validation settings.
 * @returns Array of LSP Diagnostic objects.
 */
export function validateAmpscript(
    text: string,
    settings: SfmcSettings = DEFAULT_SETTINGS,
): Diagnostic[] {
    const sanitizedText = getSanitizedAmpscriptText(text);
    const diagnostics: Diagnostic[] = [];
    let problems = 0;
    const max = settings.maxNumberOfProblems;

    // 1. Unmatched %%[ ... ]%% block delimiters
    const blockOpens = findAllOccurrences(text, '%%[');
    const blockCloses = findAllOccurrences(text, ']%%');
    if (blockOpens.length > blockCloses.length) {
        for (let i = blockCloses.length; i < blockOpens.length && problems < max; i++) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, blockOpens[i]),
                    end: offsetToPosition(text, blockOpens[i] + 3),
                },
                message: 'Unclosed AMPscript block. Expected a matching ]%%.',
                source: 'ampscript',
            });
        }
    } else if (blockCloses.length > blockOpens.length) {
        for (let i = blockOpens.length; i < blockCloses.length && problems < max; i++) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, blockCloses[i]),
                    end: offsetToPosition(text, blockCloses[i] + 3),
                },
                message: 'Unexpected ]%% without a matching %%[ opener.',
                source: 'ampscript',
            });
        }
    }

    // 2. Unmatched %%= ... =%% inline delimiters
    const inlineOpens = findAllOccurrences(text, '%%=');
    const inlineCloses = findAllOccurrences(text, '=%%');
    if (inlineOpens.length > inlineCloses.length) {
        for (let i = inlineCloses.length; i < inlineOpens.length && problems < max; i++) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, inlineOpens[i]),
                    end: offsetToPosition(text, inlineOpens[i] + 3),
                },
                message: 'Unclosed inline AMPscript expression. Expected a matching =%%.',
                source: 'ampscript',
            });
        }
    } else if (inlineCloses.length > inlineOpens.length) {
        for (let i = inlineOpens.length; i < inlineCloses.length && problems < max; i++) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, inlineCloses[i]),
                    end: offsetToPosition(text, inlineCloses[i] + 3),
                },
                message: 'Unexpected =%% without a matching %%= opener.',
                source: 'ampscript',
            });
        }
    }

    // 3. IF/ENDIF and FOR/NEXT balance using a stack
    const lines = sanitizedText.split('\n');
    const ifStack: number[] = [];
    const forStack: number[] = [];

    for (const [lineIndex, line] of lines.entries()) {
        const lineLower = line.toLowerCase();

        const ifLineCount = (lineLower.match(/\bif\b/g) ?? []).length;
        for (let i = 0; i < ifLineCount; i++) {
            ifStack.push(lineIndex);
        }
        const endifLineCount = (lineLower.match(/\bendif\b/g) ?? []).length;
        for (let ei = 0; ei < endifLineCount; ei++) {
            if (ifStack.length > 0) {
                ifStack.pop();
            } else if (problems < max) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: lineIndex, character: 0 },
                        end: { line: lineIndex, character: line.length },
                    },
                    message: 'ENDIF without a matching IF.',
                    source: 'ampscript',
                });
            }
        }

        const forLineCount = (lineLower.match(/\bfor\b/g) ?? []).length;
        for (let j = 0; j < forLineCount; j++) {
            forStack.push(lineIndex);
        }
        const nextLineCount = (lineLower.match(/\bnext\b/g) ?? []).length;
        for (let ni = 0; ni < nextLineCount; ni++) {
            if (forStack.length > 0) {
                forStack.pop();
            } else if (problems < max) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: lineIndex, character: 0 },
                        end: { line: lineIndex, character: line.length },
                    },
                    message: 'NEXT without a matching FOR.',
                    source: 'ampscript',
                });
            }
        }
    }

    for (const lineIndex of ifStack) {
        if (problems >= max) break;
        problems++;
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: { line: lineIndex, character: 0 },
                end: { line: lineIndex, character: lines[lineIndex].length },
            },
            message: 'IF without a matching ENDIF.',
            source: 'ampscript',
        });
    }
    for (const lineIndex of forStack) {
        if (problems >= max) break;
        problems++;
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: { line: lineIndex, character: 0 },
                end: { line: lineIndex, character: lines[lineIndex].length },
            },
            message: 'FOR without a matching NEXT.',
            source: 'ampscript',
        });
    }

    // 4. Unknown functions + arity validation + deprecated function warnings
    const variableTypeMap = buildVariableTypeMap(text);
    const functionCallPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let functionMatch: RegExpExecArray | null;
    while ((functionMatch = functionCallPattern.exec(sanitizedText)) && problems < max) {
        const functionName = functionMatch[1];
        const normalizedName = functionName.toLowerCase();

        if (!isKnownAmpscriptConstruct(normalizedName)) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, functionMatch.index),
                    end: offsetToPosition(text, functionMatch.index + functionName.length),
                },
                message: `Unknown AMPscript function '${functionName}'. AMPscript does not support custom functions.`,
                source: 'ampscript',
                code: DIAG_CODE_UNKNOWN_FUNCTION,
            });
            continue;
        }

        // 4a. Deprecated function warning
        const fnEntry = functionLookup.get(normalizedName);
        if (fnEntry?.deprecated && problems < max) {
            problems++;
            const deprecatedData = fnEntry.deprecated as
                true | { reason?: string; replacement?: string };
            const reason = typeof deprecatedData === 'object' ? (deprecatedData.reason ?? '') : '';
            const replacement =
                typeof deprecatedData === 'object' ? (deprecatedData.replacement ?? '') : '';
            let message = `'${fnEntry.name}' is deprecated.`;
            if (reason) message += ` ${reason}`;
            if (replacement) message += ` Use '${replacement}' instead.`;
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, functionMatch.index),
                    end: offsetToPosition(text, functionMatch.index + functionName.length),
                },
                message,
                source: 'ampscript',
                code: DIAG_CODE_DEPRECATED_FUNCTION,
                data: replacement || undefined,
            });
        }

        const arity = functionArityLookup.get(normalizedName);
        if (arity) {
            const openParenPos = functionMatch.index + functionMatch[0].length - 1;
            const argCount = countFunctionArguments(sanitizedText, openParenPos);
            if (argCount >= 0) {
                if (argCount < arity.minArgs) {
                    problems++;
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: offsetToPosition(text, functionMatch.index),
                            end: offsetToPosition(text, functionMatch.index + functionName.length),
                        },
                        message: `'${functionName}' requires at least ${arity.minArgs} argument(s) but was called with ${argCount}.`,
                        source: 'ampscript',
                        code: DIAG_CODE_FUNCTION_ARITY,
                    });
                } else if (argCount > arity.maxArgs) {
                    problems++;
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: offsetToPosition(text, functionMatch.index),
                            end: offsetToPosition(text, functionMatch.index + functionName.length),
                        },
                        message: `'${functionName}' accepts at most ${arity.maxArgs} argument(s) but was called with ${argCount}.`,
                        source: 'ampscript',
                        code: DIAG_CODE_FUNCTION_ARITY,
                    });
                } else if (
                    repeatLookup.has(normalizedName) &&
                    hasIncompleteRepeatGroup(
                        repeatLookup.get(normalizedName)!,
                        argCount,
                        extractFunctionArguments(sanitizedText, openParenPos)?.map((a) => a.value),
                    )
                ) {
                    problems++;
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: offsetToPosition(text, functionMatch.index),
                            end: offsetToPosition(text, functionMatch.index + functionName.length),
                        },
                        message: `'${functionName}' expects its repeating arguments in complete groups.`,
                        source: 'ampscript',
                        code: DIAG_CODE_FUNCTION_ARITY,
                    });
                } else if (problems < max) {
                    const fnDef = functionLookup.get(normalizedName);
                    if (fnDef?.params && fnDef.params.length > 0) {
                        const argSpans = extractFunctionArguments(sanitizedText, openParenPos);
                        if (argSpans) {
                            const argDiagnostics = collectArgumentDiagnostics(
                                text,
                                functionName,
                                fnDef.params,
                                argSpans,
                                variableTypeMap,
                                max - problems,
                            );
                            problems += argDiagnostics.length;
                            diagnostics.push(...argDiagnostics);
                        }
                    }
                }
            }
        }
    }

    // 5. `set` without a target variable
    const setWithoutTargetPattern = /\bset\s*=/gi;
    let setMatch: RegExpExecArray | null;
    while ((setMatch = setWithoutTargetPattern.exec(sanitizedText)) && problems < max) {
        problems++;
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, setMatch.index),
                end: offsetToPosition(text, setMatch.index + setMatch[0].length),
            },
            message:
                '`set` statement is missing a target variable. Expected: `set @variable = expression`.',
            source: 'ampscript',
            code: DIAG_CODE_SET_NO_TARGET,
        });
    }

    // 6. Smart/curly quotes inside AMPscript regions
    const smartQuotePattern =
        /[\u{2018}\u{2019}\u{201C}\u{201D}\u{201A}\u{201E}\u{2039}\u{203A}]/gu;
    let sqMatch: RegExpExecArray | null;
    while ((sqMatch = smartQuotePattern.exec(text)) !== null && problems < max) {
        if (!isInsideAmpscript(text, sqMatch.index)) {
            continue;
        }

        problems++;
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, sqMatch.index),
                end: offsetToPosition(text, sqMatch.index + 1),
            },
            message:
                'Smart/curly quote character detected. AMPscript only supports straight ASCII quotes (\' or ").',
            source: 'ampscript',
            code: DIAG_CODE_SMART_QUOTES,
        });
    }

    // 7. Bare subscriber attribute access warning
    const directAttributeAccess = /\bset\s+@\w+\s*=\s*(\w+)\b/gi;
    let attributeMatch: RegExpExecArray | null;
    const commonAttributes = new Set([
        'firstname',
        'lastname',
        'emailaddress',
        'email_address',
        'fullname',
    ]);
    while ((attributeMatch = directAttributeAccess.exec(sanitizedText)) && problems < max) {
        const attrName = attributeMatch[1].toLowerCase();
        if (commonAttributes.has(attrName)) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Information,
                range: {
                    start: offsetToPosition(text, attributeMatch.index),
                    end: offsetToPosition(text, attributeMatch.index + attributeMatch[0].length),
                },
                message: `Consider using AttributeValue("${attributeMatch[1]}") instead of the bare attribute name for null safety.`,
                source: 'ampscript',
            });
        }
    }

    // 8. HTML comments inside AMPscript regions
    const htmlCommentPattern = /<!--[\s\S]*?-->/g;
    let htmlCommentMatch: RegExpExecArray | null;
    while ((htmlCommentMatch = htmlCommentPattern.exec(sanitizedText)) !== null && problems < max) {
        problems++;
        const fullMatch = htmlCommentMatch[0];
        const isWrappedBlockComment = /^<!--\/\*[\s\S]*?\*\/-->$/.test(fullMatch);
        const innerContent = isWrappedBlockComment ? fullMatch.slice(4, -3).trim() : undefined;
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: offsetToPosition(text, htmlCommentMatch.index),
                end: offsetToPosition(text, htmlCommentMatch.index + fullMatch.length),
            },
            message: isWrappedBlockComment
                ? 'HTML comment wrapper around an AMPscript comment is not valid. Use /* ... */ directly.'
                : 'HTML comment syntax is not valid inside AMPscript. Use /* ... */ instead.',
            source: 'ampscript',
            code: isWrappedBlockComment ? DIAG_CODE_HTML_WRAPPED_COMMENT : DIAG_CODE_HTML_COMMENT,
            data: isWrappedBlockComment ? innerContent : undefined,
        });
    }

    // 9. JavaScript // line comments inside AMPscript
    const jsLineCommentPattern = /(?<!:)\/\/.*/g;
    let jsCommentMatch: RegExpExecArray | null;
    while ((jsCommentMatch = jsLineCommentPattern.exec(sanitizedText)) !== null && problems < max) {
        problems++;
        const commentText = jsCommentMatch[0].slice(2).trim();
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: offsetToPosition(text, jsCommentMatch.index),
                end: offsetToPosition(text, jsCommentMatch.index + jsCommentMatch[0].length),
            },
            message:
                'Single-line // comments are not valid AMPscript syntax. Use /* ... */ instead.',
            source: 'ampscript',
            code: DIAG_CODE_JS_LINE_COMMENT,
            data: commentText,
        });
    }

    // 10. Nested <script language="ampscript"> inside an already-open block.
    // Scan every AMPscript <script> opener and </script> closer in document order
    // and track nesting depth. An opener is only nested when depth > 0. Sibling
    // blocks return depth to 0 between them, so they are not flagged, and each
    // genuinely nested opener is reported exactly once.
    // Mask HTML comments (with same-length whitespace) so <script> / </script>
    // occurrences quoted inside comments do not distort the nesting depth. Offsets
    // are preserved, so matches map straight back onto the original text.
    const commentMaskedText = text.replaceAll(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
    const scriptOpenPattern = /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>/gi;
    const scriptClosePattern = /<\/script>/gi;
    type ScriptToken = { index: number; length: number; isOpen: boolean };
    const scriptTokens: ScriptToken[] = [];
    {
        let sm: RegExpExecArray | null;
        while ((sm = scriptOpenPattern.exec(commentMaskedText)) !== null) {
            scriptTokens.push({ index: sm.index, length: sm[0].length, isOpen: true });
        }
        while ((sm = scriptClosePattern.exec(commentMaskedText)) !== null) {
            scriptTokens.push({ index: sm.index, length: sm[0].length, isOpen: false });
        }
    }
    scriptTokens.sort((a, b) => a.index - b.index);
    let scriptDepth = 0;
    for (const token of scriptTokens) {
        if (problems >= max) {
            break;
        }
        if (token.isOpen) {
            if (scriptDepth > 0) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, token.index),
                        end: offsetToPosition(text, token.index + token.length),
                    },
                    message:
                        'Nested <script language="ampscript"> inside an already-open AMPscript block. Did you forget a </script> closing tag?',
                    source: 'ampscript',
                    code: DIAG_CODE_NESTED_SCRIPT_TAG,
                });
            }
            scriptDepth++;
        } else {
            scriptDepth = Math.max(0, scriptDepth - 1);
        }
    }

    // 11. AMPscript delimiters inside already-open regions
    const delimiterPattern = /%%\[|%%=/g;
    {
        const scriptBodyPattern =
            /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>([\s\S]*?)<\/script>/gi;
        let sbMatch: RegExpExecArray | null;
        while ((sbMatch = scriptBodyPattern.exec(text)) !== null && problems < max) {
            const bodyStart = sbMatch.index + sbMatch[0].indexOf('>') + 1;
            const bodyEnd = bodyStart + sbMatch[1].length;
            const body = text.slice(bodyStart, bodyEnd);
            delimiterPattern.lastIndex = 0;
            let dm: RegExpExecArray | null;
            while ((dm = delimiterPattern.exec(body)) !== null && problems < max) {
                problems++;
                const delimStart = bodyStart + dm.index;
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, delimStart),
                        end: offsetToPosition(text, delimStart + dm[0].length),
                    },
                    message: `AMPscript delimiter ${dm[0]} is not needed inside a <script language="ampscript"> block.`,
                    source: 'ampscript',
                    code: DIAG_CODE_NESTED_DELIMITER_IN_SCRIPT,
                    data: dm[0],
                });
            }
        }
    }
    {
        const blockPattern = /%%\[([\s\S]*?)\]%%/g;
        let bMatch: RegExpExecArray | null;
        while ((bMatch = blockPattern.exec(text)) !== null && problems < max) {
            const innerStart = bMatch.index + 3;
            const inner = bMatch[1];
            delimiterPattern.lastIndex = 0;
            let dm: RegExpExecArray | null;
            while ((dm = delimiterPattern.exec(inner)) !== null && problems < max) {
                problems++;
                const delimStart = innerStart + dm.index;
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, delimStart),
                        end: offsetToPosition(text, delimStart + dm[0].length),
                    },
                    message: `Nested ${dm[0]} inside an already-open AMPscript block.`,
                    source: 'ampscript',
                    code: DIAG_CODE_NESTED_DELIMITER,
                    data: dm[0],
                });
            }
        }
    }
    {
        const inlinePattern = /%%=([\s\S]*?)=%%/g;
        let iMatch: RegExpExecArray | null;
        while ((iMatch = inlinePattern.exec(text)) !== null && problems < max) {
            const innerStart = iMatch.index + 3;
            const inner = iMatch[1];
            delimiterPattern.lastIndex = 0;
            let dm: RegExpExecArray | null;
            while ((dm = delimiterPattern.exec(inner)) !== null && problems < max) {
                problems++;
                const delimStart = innerStart + dm.index;
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, delimStart),
                        end: offsetToPosition(text, delimStart + dm[0].length),
                    },
                    message: `Nested ${dm[0]} inside an already-open AMPscript inline expression.`,
                    source: 'ampscript',
                    code: DIAG_CODE_NESTED_DELIMITER,
                    data: dm[0],
                });
            }
        }
    }

    // 12. Platform-specific templating validators. GTL (Guide Template Language)
    //     and MCN Handlebars are mutually exclusive: GTL exists only in
    //     Engagement, Handlebars only in Marketing Cloud Next.
    if (settings.targetPlatform === 'next') {
        // 12a. MCN compatibility — flag AMPscript functions not supported in
        //      Marketing Cloud Next.
        const callSites = extractAmpscriptFunctionCalls(text);
        for (const site of callSites) {
            if (problems >= max) break;
            if (!isMcnSupported(site.name)) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: site.line, character: site.col },
                        end: { line: site.line, character: site.col + site.name.length },
                    },
                    message: `'${site.name}' is not supported in Marketing Cloud Next.`,
                    source: 'ampscript',
                    code: DIAG_CODE_MCN_UNSUPPORTED_FUNCTION,
                });
            }
        }

        // 12b. Handlebars for Marketing Cloud Next — syntax, unsupported
        //      constructs, unknown helpers, and unknown built-in bindings.
        validateMcnHandlebars(text, diagnostics, max - problems);
    } else {
        // 12c. GTL block balance (Engagement only).
        validateGtlBlocks(text, diagnostics, max - problems);
    }

    return diagnostics;
}

// ── AMPscript function call extraction ────────────────────────────────────────

export interface AmpscriptCallSite {
    /**
     * Canonical-case function name as it appears in the catalog.
     */
    name: string;
    /**
     * Zero-based line number of the function name.
     */
    line: number;
    /**
     * Zero-based column of the first character of the function name.
     */
    col: number;
}

/**
 * Extract every AMPscript function call site from the given code.
 * Only calls to functions that exist in the AMPscript catalog are returned;
 * unknown identifiers and control-flow keywords are ignored.
 * @param code - Full document text (may include HTML with embedded AMPscript).
 * @returns Array of call sites in document order.
 */
export function extractAmpscriptFunctionCalls(code: string): AmpscriptCallSite[] {
    const sanitizedText = getSanitizedAmpscriptText(code);
    const results: AmpscriptCallSite[] = [];
    const functionCallPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = functionCallPattern.exec(sanitizedText)) !== null) {
        const rawName = match[1];
        const lower = rawName.toLowerCase();
        if (!functionLookup.has(lower)) {
            continue;
        }
        // Retrieve canonical casing from the catalog
        const entry = functionLookup.get(lower)!;
        const pos = offsetToPosition(code, match.index);
        results.push({ name: entry.name, line: pos.line, col: pos.character });
    }

    return results;
}
