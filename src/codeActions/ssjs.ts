import { CodeActionKind } from '../types.js';
import type { CodeAction, Diagnostic } from '../types.js';
import {
    DIAG_CODE_SSJS_POLYFILL_REQUIRED,
    DIAG_CODE_SSJS_REPLACE_WITH_PLATFORM_FUNCTION,
    DIAG_CODE_SSJS_CLR_HEADER_ACCESS,
    DIAG_CODE_SSJS_CLR_CONTENT_ACCESS,
    type PolyfillDiagnosticData,
    type ReplaceDiagnosticData,
    type ClrHeaderAccessDiagnosticData,
    type ClrContentAccessDiagnosticData,
} from '../validators/ssjs.js';
import { polyfillMarker } from '../utils/polyfill.js';

/**
 * Canonical helper inserted by the CLR-header-access quick-fix. It parses the
 * for..in enumeration keys of `resp.headers` (each shaped `"[Name, Value]"`) so
 * it never touches a CLR value — avoiding the runtime CLR error. Mirrors the
 * `getHeaderMap()` snippet documented on ssjs.guide and in eslint-plugin-sfmc.
 */
const HEADER_MAP_HELPER = `/**
 * Build a plain { name: value } header map from an HttpResponse.
 * Reads only the for..in enumeration keys (shaped "[Name, Value]") so it never
 * touches a CLR value — avoiding "Use of Common Language Runtime (CLR) is not allowed".
 * @param {object} resp - the response returned by req.send()
 * @returns {object} map of lowercased header name => value string
 */
function getHeaderMap(resp) {
    var map = {};
    for (var k in resp.headers) {
        var pair = String(k);
        if (pair.charAt(0) === "[") { pair = pair.substring(1); }
        if (pair.charAt(pair.length - 1) === "]") { pair = pair.substring(0, pair.length - 1); }
        var idx = pair.indexOf(", ");
        if (idx > -1) {
            map[pair.substring(0, idx).toLowerCase()] = pair.substring(idx + 2);
        }
    }
    return map;
}`;

/**
 * Compute the insertion point for a polyfill. ESLint reads a leading
 * `global` directive comment, so the polyfill must be inserted after that
 * line (when present) to keep the directive at the very top of the file.
 * Otherwise the polyfill goes to the very top of the document.
 * @param text - Full document text.
 * @returns The zero-based line/character position to insert at.
 */
function polyfillInsertPosition(text: string): { line: number; character: number } {
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        // Insert after a leading `/* global ... */` ESLint directive comment.
        if (/^\/\*\s*global\b/.test(trimmed) && trimmed.endsWith('*/')) {
            return { line: index + 1, character: 0 };
        }
        // First meaningful line is not a global directive — insert at the top.
        return { line: 0, character: 0 };
    }
    return { line: 0, character: 0 };
}

/**
 * Type guard for the polyfill payload attached to `ssjs/polyfill-required`
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
 * Type guard for the replacement payload attached to
 * `ssjs/replace-with-platform-function` diagnostics by the SSJS validator.
 * @param data - The diagnostic's `data` field.
 * @returns True when the payload carries an owner, member, and replacement.
 */
function isReplaceData(data: unknown): data is ReplaceDiagnosticData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as ReplaceDiagnosticData).owner === 'string' &&
        typeof (data as ReplaceDiagnosticData).member === 'string' &&
        typeof (data as ReplaceDiagnosticData).replacement === 'string'
    );
}

/**
 * Type guard for the payload attached to `ssjs/clr-header-access` diagnostics
 * by the SSJS validator.
 * @param data - The diagnostic's `data` field.
 * @returns True when the payload carries a response variable name and key text.
 */
function isClrHeaderAccessData(data: unknown): data is ClrHeaderAccessDiagnosticData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as ClrHeaderAccessDiagnosticData).respName === 'string' &&
        typeof (data as ClrHeaderAccessDiagnosticData).keyText === 'string'
    );
}

/**
 * Type guard for the payload attached to `ssjs/clr-content-access` diagnostics
 * by the SSJS validator.
 * @param data - The diagnostic's `data` field.
 * @returns True when the payload carries a response variable name and content text.
 */
function isClrContentAccessData(data: unknown): data is ClrContentAccessDiagnosticData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as ClrContentAccessDiagnosticData).respName === 'string' &&
        typeof (data as ClrContentAccessDiagnosticData).contentText === 'string'
    );
}

/**
 * Return quick-fix code actions for SSJS diagnostics. Currently offers an
 * "insert polyfill" action for `ssjs/polyfill-required` diagnostics, inserting
 * the verified polyfill source (from ssjs-data) at the top of the document.
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

        // "Replace with Platform.Function.*" — for static members that have no
        // polyfill but a direct SFMC alternative (e.g. JSON.parse → ParseJSON).
        if (
            diagnostic.code === DIAG_CODE_SSJS_REPLACE_WITH_PLATFORM_FUNCTION &&
            isReplaceData(diagnostic.data)
        ) {
            const { owner, member, replacement } = diagnostic.data;
            actions.push({
                title: `Replace ${owner}.${member} with ${replacement}`,
                kind: CodeActionKind.QuickFix,
                isPreferred: true,
                diagnostics: [diagnostic],
                edit: {
                    changes: {
                        // The diagnostic range covers the `Owner.member` text;
                        // replace it in place with the Platform.Function call.
                        [uri]: [{ range: diagnostic.range, newText: replacement }],
                    },
                },
            });
            continue;
        }

        // "Read headers via getHeaderMap()" — rewrite a CLR-unsafe `.headers`
        // read and insert the helper (once) at the top of the document.
        if (
            diagnostic.code === DIAG_CODE_SSJS_CLR_HEADER_ACCESS &&
            isClrHeaderAccessData(diagnostic.data)
        ) {
            const { respName, keyText } = diagnostic.data;
            const edits = [
                {
                    // Replace the whole flagged expression with getHeaderMap(resp)[key].
                    range: diagnostic.range,
                    newText: `getHeaderMap(${respName})[${keyText}]`,
                },
            ];
            // Insert the helper once, unless it already exists in the document.
            if (!text.includes('function getHeaderMap(')) {
                const insertAt = polyfillInsertPosition(text);
                edits.push({
                    range: { start: insertAt, end: insertAt },
                    newText: `${HEADER_MAP_HELPER}\n\n`,
                });
            }
            actions.push({
                title: `Read header via getHeaderMap(${respName})`,
                kind: CodeActionKind.QuickFix,
                isPreferred: true,
                diagnostics: [diagnostic],
                edit: { changes: { [uri]: edits } },
            });
            continue;
        }

        // "Wrap with String()" — rewrite a raw `.content` read to String(resp.content).
        if (
            diagnostic.code === DIAG_CODE_SSJS_CLR_CONTENT_ACCESS &&
            isClrContentAccessData(diagnostic.data)
        ) {
            const { contentText } = diagnostic.data;
            actions.push({
                title: `Wrap with String(${contentText})`,
                kind: CodeActionKind.QuickFix,
                isPreferred: true,
                diagnostics: [diagnostic],
                edit: {
                    changes: {
                        [uri]: [{ range: diagnostic.range, newText: `String(${contentText})` }],
                    },
                },
            });
            continue;
        }

        if (diagnostic.code !== DIAG_CODE_SSJS_POLYFILL_REQUIRED) continue;
        if (!isPolyfillData(diagnostic.data)) continue;

        const { owner, method, polyfill } = diagnostic.data;

        // Avoid offering the fix when the polyfill is already present in the
        // document. The first non-blank line of the polyfill is a stable marker.
        const marker = polyfillMarker(polyfill);
        if (marker && text.includes(marker)) continue;

        // Insert after a leading `/* global ... */` directive (if any) so the
        // ESLint directive stays at the very top of the file.
        const insertAt = polyfillInsertPosition(text);

        actions.push({
            title: `Insert polyfill for ${owner}.${method}`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [uri]: [
                        {
                            range: { start: insertAt, end: insertAt },
                            newText: `${polyfill.trimEnd()}\n\n`,
                        },
                    ],
                },
            },
        });
    }

    return actions;
}
