/**
 * Extract a stable marker line from a polyfill source string. Polyfills are
 * prefixed with a JSDoc block, so the marker is the first code line — the one
 * that declares or assigns the polyfilled member (e.g.
 * `String.prototype.search = function (...) {` or `function bindFn(...) {`).
 * Its presence in a document means the polyfill has already been inserted.
 * @param polyfill - The polyfill source string.
 * @returns The trimmed first code line, or undefined when none is found.
 */
export function polyfillMarker(polyfill: string): string | undefined {
    const lines = polyfill.split('\n').map((l) => l.trim());
    // skip blank lines and the leading JSDoc block (/** ... */)
    const marker = lines.find(
        (l) => l.length > 0 && !l.startsWith('/**') && !l.startsWith('*') && !l.startsWith('*/'),
    );
    return marker;
}

/**
 * Determine whether a polyfill is already present in a document.
 * @param text - Full document text.
 * @param polyfill - The polyfill source string.
 * @returns True when the polyfill's marker line is found in the document.
 */
export function isPolyfillPresent(text: string, polyfill: string): boolean {
    const marker = polyfillMarker(polyfill);
    return marker !== undefined && text.includes(marker);
}
