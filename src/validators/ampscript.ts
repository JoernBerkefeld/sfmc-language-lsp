import { DiagnosticSeverity } from '../types.js';
import type { Diagnostic } from '../types.js';
import type { SfmcSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import {
    getSanitizedAmpscriptText,
    isInsideAmpscript,
} from '../utils/regions.js';
import {
    findAllOccurrences,
    countFunctionArguments,
    extractFunctionArguments,
    inferLiteralType,
} from '../utils/text.js';
import { offsetToPosition } from '../utils/positions.js';
import { functionLookup, ampscriptKeywords, ampscriptFunctions } from '../data/ampscript.js';
import { validateGtlBlocks } from './gtl.js';

// Diagnostic codes that code actions identify and act on.
export const DIAG_CODE_HTML_WRAPPED_COMMENT = 'ampscript/html-wrapped-comment';
export const DIAG_CODE_HTML_COMMENT = 'ampscript/html-comment';
export const DIAG_CODE_JS_LINE_COMMENT = 'ampscript/js-line-comment';
export const DIAG_CODE_NESTED_SCRIPT_TAG = 'ampscript/nested-script-tag';
export const DIAG_CODE_NESTED_DELIMITER_IN_SCRIPT = 'ampscript/nested-delimiter-in-script';
export const DIAG_CODE_NESTED_DELIMITER = 'ampscript/nested-delimiter';

const ampscriptKeywordSet = new Set(ampscriptKeywords.map((kw) => kw.name.toLowerCase()));
const controlFlowConstructSet = new Set([
    'if', 'elseif', 'else', 'endif', 'for', 'next', 'then',
    'do', 'to', 'downto', 'var', 'set', 'and', 'or', 'not', 'true', 'false',
]);

function isKnownAmpscriptConstruct(name: string): boolean {
    return (
        functionLookup.has(name) ||
        ampscriptKeywordSet.has(name) ||
        controlFlowConstructSet.has(name)
    );
}

const variadicFunctionNames = new Set([
    'lookup', 'lookuprows', 'lookuprowscs', 'lookuporderedrows', 'lookuporderedrowscs',
    'insertdata', 'insertde', 'updatedata', 'updatede', 'upsertdata', 'upsertde',
    'deletedata', 'deletede', 'claimrow', 'claimrowvalue', 'cloudpagesurl', 'micrositeurl',
    'concat', 'replacelist', 'regexmatch', 'createsalesforceobject',
    'updatesinglesalesforceobject', 'retrievesalesforceobjects',
    'httppost', 'httppost2', 'httppostwithretry', 'createmscrm',
    'buildoptionlist', 'wat', 'getsocialpublishurl', 'getsocialpublishurlbyname', 'upsertcontact',
]);

interface FunctionArity { minArgs: number; maxArgs: number; }
const functionArityLookup = new Map<string, FunctionArity>();
for (const fn of ampscriptFunctions) {
    const minArgs = fn.params.filter((p) => !p.optional).length;
    const maxArgs = variadicFunctionNames.has(fn.name.toLowerCase()) ? Infinity : fn.params.length;
    functionArityLookup.set(fn.name.toLowerCase(), { minArgs, maxArgs });
}

/** Validate an AMPscript document and return LSP Diagnostics. */
export function validateAmpscript(text: string, settings: SfmcSettings = DEFAULT_SETTINGS): Diagnostic[] {
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
                range: { start: offsetToPosition(text, blockOpens[i]), end: offsetToPosition(text, blockOpens[i] + 3) },
                message: 'Unclosed AMPscript block. Expected a matching ]%%.',
                source: 'ampscript',
            });
        }
    } else if (blockCloses.length > blockOpens.length) {
        for (let i = blockOpens.length; i < blockCloses.length && problems < max; i++) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: { start: offsetToPosition(text, blockCloses[i]), end: offsetToPosition(text, blockCloses[i] + 3) },
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
                range: { start: offsetToPosition(text, inlineOpens[i]), end: offsetToPosition(text, inlineOpens[i] + 3) },
                message: 'Unclosed inline AMPscript expression. Expected a matching =%%.',
                source: 'ampscript',
            });
        }
    } else if (inlineCloses.length > inlineOpens.length) {
        for (let i = inlineOpens.length; i < inlineCloses.length && problems < max; i++) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: { start: offsetToPosition(text, inlineCloses[i]), end: offsetToPosition(text, inlineCloses[i] + 3) },
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

        const ifLineCount = [...lineLower.matchAll(/\bif\b/g)].length;
        for (let i = 0; i < ifLineCount; i++) {
            ifStack.push(lineIndex);
        }
        const endifOnLine = [...lineLower.matchAll(/\bendif\b/g)];
        for (let ei = 0; ei < endifOnLine.length; ei++) {
            if (ifStack.length > 0) {
                ifStack.pop();
            } else if (problems < max) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: { start: { line: lineIndex, character: 0 }, end: { line: lineIndex, character: line.length } },
                    message: 'ENDIF without a matching IF.',
                    source: 'ampscript',
                });
            }
        }

        const forLineCount = [...lineLower.matchAll(/\bfor\b/g)].length;
        for (let j = 0; j < forLineCount; j++) {
            forStack.push(lineIndex);
        }
        const nextOnLine = [...lineLower.matchAll(/\bnext\b/g)];
        for (let ni = 0; ni < nextOnLine.length; ni++) {
            if (forStack.length > 0) {
                forStack.pop();
            } else if (problems < max) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: { start: { line: lineIndex, character: 0 }, end: { line: lineIndex, character: line.length } },
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
            range: { start: { line: lineIndex, character: 0 }, end: { line: lineIndex, character: lines[lineIndex].length } },
            message: 'IF without a matching ENDIF.',
            source: 'ampscript',
        });
    }
    for (const lineIndex of forStack) {
        if (problems >= max) break;
        problems++;
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start: { line: lineIndex, character: 0 }, end: { line: lineIndex, character: lines[lineIndex].length } },
            message: 'FOR without a matching NEXT.',
            source: 'ampscript',
        });
    }

    // 4. Unknown functions + arity validation
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
                    start: offsetToPosition(sanitizedText, functionMatch.index),
                    end: offsetToPosition(sanitizedText, functionMatch.index + functionName.length),
                },
                message: `Unknown AMPscript function '${functionName}'. AMPscript does not support custom functions.`,
                source: 'ampscript',
            });
            continue;
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
                            start: offsetToPosition(sanitizedText, functionMatch.index),
                            end: offsetToPosition(sanitizedText, functionMatch.index + functionName.length),
                        },
                        message: `'${functionName}' requires at least ${arity.minArgs} argument(s) but was called with ${argCount}.`,
                        source: 'ampscript',
                    });
                } else if (argCount > arity.maxArgs) {
                    problems++;
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: offsetToPosition(sanitizedText, functionMatch.index),
                            end: offsetToPosition(sanitizedText, functionMatch.index + functionName.length),
                        },
                        message: `'${functionName}' accepts at most ${arity.maxArgs} argument(s) but was called with ${argCount}.`,
                        source: 'ampscript',
                    });
                } else if (problems < max) {
                    const fnDef = functionLookup.get(normalizedName);
                    if (fnDef?.params && fnDef.params.length > 0) {
                        const argSpans = extractFunctionArguments(sanitizedText, openParenPos);
                        if (argSpans) {
                            for (let ai = 0; ai < argSpans.length && problems < max; ai++) {
                                const param = fnDef.params[ai];
                                if (!param?.type) continue;
                                const inferredType = inferLiteralType(argSpans[ai].value);
                                if (inferredType && inferredType !== param.type) {
                                    problems++;
                                    diagnostics.push({
                                        severity: DiagnosticSeverity.Warning,
                                        range: {
                                            start: offsetToPosition(sanitizedText, argSpans[ai].start),
                                            end: offsetToPosition(sanitizedText, argSpans[ai].end),
                                        },
                                        message: `Argument '${param.name}' of '${functionName}' expects a ${param.type} but received a ${inferredType}.`,
                                        source: 'ampscript',
                                    });
                                }
                            }
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
                start: offsetToPosition(sanitizedText, setMatch.index),
                end: offsetToPosition(sanitizedText, setMatch.index + setMatch[0].length),
            },
            message: '`set` statement is missing a target variable. Expected: `set @variable = expression`.',
            source: 'ampscript',
        });
    }

    // 6. Smart/curly quotes inside AMPscript regions
    const smartQuotePattern = /[\u2018\u2019\u201C\u201D\u201A\u201E\u2039\u203A]/g;
    let sqMatch: RegExpExecArray | null;
    while ((sqMatch = smartQuotePattern.exec(text)) !== null && problems < max) {
        if (isInsideAmpscript(text, sqMatch.index)) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, sqMatch.index),
                    end: offsetToPosition(text, sqMatch.index + 1),
                },
                message: 'Smart/curly quote character detected. AMPscript only supports straight ASCII quotes (\' or ").',
                source: 'ampscript',
            });
        }
    }

    // 7. Bare subscriber attribute access warning
    const directAttributeAccess = /\bset\s+@\w+\s*=\s*(\w+)\b/gi;
    let attributeMatch: RegExpExecArray | null;
    const commonAttributes = new Set(['firstname', 'lastname', 'emailaddress', 'email_address', 'fullname']);
    while ((attributeMatch = directAttributeAccess.exec(sanitizedText)) && problems < max) {
        const attrName = attributeMatch[1].toLowerCase();
        if (commonAttributes.has(attrName)) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Information,
                range: {
                    start: offsetToPosition(sanitizedText, attributeMatch.index),
                    end: offsetToPosition(sanitizedText, attributeMatch.index + attributeMatch[0].length),
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
                start: offsetToPosition(sanitizedText, htmlCommentMatch.index),
                end: offsetToPosition(sanitizedText, htmlCommentMatch.index + fullMatch.length),
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
                start: offsetToPosition(sanitizedText, jsCommentMatch.index),
                end: offsetToPosition(sanitizedText, jsCommentMatch.index + jsCommentMatch[0].length),
            },
            message: 'Single-line // comments are not valid AMPscript syntax. Use /* ... */ instead.',
            source: 'ampscript',
            code: DIAG_CODE_JS_LINE_COMMENT,
            data: commentText,
        });
    }

    // 10. Nested <script language="ampscript"> inside an already-open block
    const scriptOpenPattern = /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>/gi;
    const scriptClosePattern = /<\/script>/gi;
    const scriptOpens: number[] = [];
    const scriptCloses: number[] = [];
    {
        let sm: RegExpExecArray | null;
        while ((sm = scriptOpenPattern.exec(text)) !== null) { scriptOpens.push(sm.index); }
        while ((sm = scriptClosePattern.exec(text)) !== null) { scriptCloses.push(sm.index); }
    }
    for (let si = 0; si < scriptOpens.length && problems < max; si++) {
        const openStart = scriptOpens[si];
        const openTagEnd = text.indexOf('>', openStart) + 1;
        const pairedClose = scriptCloses.find((c) => c > openTagEnd);
        const searchEnd = pairedClose === undefined ? text.length : pairedClose;
        const innerOpenPattern = /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>/gi;
        innerOpenPattern.lastIndex = openTagEnd;
        let innerMatch: RegExpExecArray | null;
        while ((innerMatch = innerOpenPattern.exec(text)) !== null && innerMatch.index < searchEnd && problems < max) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, innerMatch.index),
                    end: offsetToPosition(text, innerMatch.index + innerMatch[0].length),
                },
                message: 'Nested <script language="ampscript"> inside an already-open AMPscript block. Did you forget a </script> closing tag?',
                source: 'ampscript',
                code: DIAG_CODE_NESTED_SCRIPT_TAG,
            });
        }
    }

    // 11. AMPscript delimiters inside already-open regions
    const delimiterPattern = /%%\[|%%=/g;
    {
        const scriptBodyPattern = /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>([\s\S]*?)<\/script>/gi;
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

    // 12. GTL block balance
    validateGtlBlocks(text, diagnostics, max - problems);

    return diagnostics;
}
