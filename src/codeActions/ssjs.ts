import { CodeActionKind } from '../types.js';
import type { CodeAction, Diagnostic } from '../types.js';
import { DIAG_CODE_SSJS_POLYFILLABLE, type PolyfillDiagnosticData } from '../validators/ssjs.js';

/**
 * Type guard for the polyfill payload attached to `ssjs/polyfillable`
 * diagnostics by the SSJS validator.
 * @param data - The diagnostic's `data` field.
 * @returns True when the payload carries an owner, method, and polyfill source.
 */
function isPolyfillData(data: unknown): data is PolyfillDiagnosticData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as PolyfillDiagnosticData).owner === 'string' &&
        typeof (data as PolyfillDiagnosticData).method === 'string' &&
        typeof (data as PolyfillDiagnosticData).polyfill === 'string'
    );
}

/**
 * Return quick-fix code actions for SSJS diagnostics. Currently offers an
 * "insert polyfill" action for `ssjs/polyfillable` diagnostics, inserting the
 * verified polyfill source (from ssjs-data) at the top of the document.
 * @param text - Full document text.
 * @param uri - Document URI.
 * @param diagnostics - Diagnostics to generate actions for.
 * @returns Array of code actions.
 */
export function getSsjsCodeActions(
    text: string,
    uri: string,
    diagnostics: Diagnostic[],
): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of diagnostics) {
        if (diagnostic.source !== 'ssjs') continue;
        if (diagnostic.code !== DIAG_CODE_SSJS_POLYFILLABLE) continue;
        if (!isPolyfillData(diagnostic.data)) continue;

        const { owner, method, polyfill } = diagnostic.data;

        // Avoid offering the fix when the polyfill is already present in the
        // document. The first non-blank line of the polyfill is a stable marker.
        const marker = polyfill
            .split('\n')
            .find((l) => l.trim().length > 0)
            ?.trim();
        if (marker && text.includes(marker)) continue;

        actions.push({
            title: `Insert polyfill for ${owner}.${method}`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [uri]: [
                        {
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 0 },
                            },
                            newText: `${polyfill.trimEnd()}\n\n`,
                        },
                    ],
                },
            },
        });
    }

    return actions;
}
