import { CodeActionKind } from '../types.js';
import type { CodeAction, Diagnostic, Range } from '../types.js';
import { positionToOffset, getTextInRange, offsetToPosition } from '../utils/positions.js';
import {
    DIAG_CODE_HTML_WRAPPED_COMMENT,
    DIAG_CODE_HTML_COMMENT,
    DIAG_CODE_JS_LINE_COMMENT,
    DIAG_CODE_NESTED_SCRIPT_TAG,
    DIAG_CODE_NESTED_DELIMITER_IN_SCRIPT,
    DIAG_CODE_NESTED_DELIMITER,
} from '../validators/ampscript.js';

/**
 * Return quick-fix code actions for the given diagnostics.
 * @param text
 * @param uri
 * @param diagnostics
 */
export function getAmpscriptCodeActions(
    text: string,
    uri: string,
    diagnostics: Diagnostic[],
): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of diagnostics) {
        if (diagnostic.source !== 'ampscript') continue;

        const range = diagnostic.range;
        const originalText = getTextInRange(text, range);

        switch (diagnostic.code) {
            case DIAG_CODE_HTML_WRAPPED_COMMENT: {
                const inner =
                    typeof diagnostic.data === 'string'
                        ? diagnostic.data
                        : originalText.replace(/^<!--/, '').replace(/-->$/, '').trim();
                actions.push({
                    title: 'Remove HTML comment wrapper',
                    kind: CodeActionKind.QuickFix,
                    isPreferred: true,
                    diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [{ range, newText: inner }] } },
                });
                break;
            }
            case DIAG_CODE_HTML_COMMENT: {
                const inner = originalText.replace(/^<!--/, '').replace(/-->$/, '').trim();
                actions.push({
                    title: 'Convert to AMPscript block comment',
                    kind: CodeActionKind.QuickFix,
                    isPreferred: true,
                    diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [{ range, newText: `/* ${inner} */` }] } },
                });
                break;
            }
            case DIAG_CODE_JS_LINE_COMMENT: {
                const commentText =
                    typeof diagnostic.data === 'string'
                        ? diagnostic.data
                        : originalText.replace(/^\/\/\s*/, '').trim();
                actions.push({
                    title: 'Convert to AMPscript block comment',
                    kind: CodeActionKind.QuickFix,
                    isPreferred: true,
                    diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [{ range, newText: `/* ${commentText} */` }] } },
                });
                break;
            }
            case DIAG_CODE_NESTED_SCRIPT_TAG: {
                actions.push({
                    title: 'Insert missing </script> closing tag before this block',
                    kind: CodeActionKind.QuickFix,
                    isPreferred: true,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [uri]: [
                                {
                                    range: { start: range.start, end: range.start },
                                    newText: '</script>\n',
                                },
                            ],
                        },
                    },
                });
                break;
            }
            case DIAG_CODE_NESTED_DELIMITER_IN_SCRIPT:
            case DIAG_CODE_NESTED_DELIMITER: {
                const delimiter =
                    typeof diagnostic.data === 'string' ? diagnostic.data : originalText;
                const isBlock = delimiter === '%%[';
                const actualCloseToken = isBlock ? ']%%' : '=%%';
                const actualCloseLen = actualCloseToken.length;

                actions.push({
                    title: `Remove redundant ${delimiter} delimiter`,
                    kind: CodeActionKind.QuickFix,
                    isPreferred: false,
                    diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [{ range, newText: '' }] } },
                });

                const delimStart = positionToOffset(text, range.start);
                const closeIndex = text.indexOf(actualCloseToken, delimStart + delimiter.length);
                if (closeIndex !== -1) {
                    const actualCloseEnd = closeIndex + actualCloseLen;

                    actions.push({
                        title: `Remove ${delimiter}...${actualCloseToken} delimiter pair`,
                        kind: CodeActionKind.QuickFix,
                        isPreferred: true,
                        diagnostics: [diagnostic],
                        edit: {
                            changes: {
                                [uri]: [
                                    {
                                        range: closeOffsetToRange(text, closeIndex, actualCloseEnd),
                                        newText: '',
                                    },
                                    { range, newText: '' },
                                ],
                            },
                        },
                    });
                }
                break;
            }
        }
    }

    return actions;
}

function closeOffsetToRange(text: string, start: number, end: number): Range {
    return {
        start: offsetToPosition(text, start),
        end: offsetToPosition(text, end),
    };
}
