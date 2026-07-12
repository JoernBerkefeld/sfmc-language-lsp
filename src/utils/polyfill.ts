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
 * Build a regular expression that matches a polyfill's marker line in a
 * document, tolerating the optional self-guard the canonical polyfills ship
 * with. The canonical form assigns via `X = X || function (…)`, but authors
 * frequently drop the `X ||` safeguard (`X = function (…)`); both must count as
 * "polyfill present". Only the assignment marker (`… = … function …`) is
 * relaxed — non-assignment markers (e.g. `function bindFn(…) {`) match verbatim.
 * @param marker - The polyfill marker line from {@link polyfillMarker}.
 * @returns A RegExp matching the marker with or without the `X ||` safeguard.
 */
function markerToRegExp(marker: string): RegExp {
    const escape = (s: string): string => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    // Split on the first `= … function` assignment so the middle (which may or
    // may not contain the `X ||` safeguard) can be made optional.
    const assignMatch = /^(.*?=\s*)(?:[$A-Za-z_][\w$.]*\s*\|\|\s*)?(function\b.*)$/s.exec(marker);
    if (!assignMatch) {
        // Non-assignment marker — match verbatim.
        return new RegExp(escape(marker));
    }
    const [, lhs, fn] = assignMatch;
    // `<lhs> [<expr> ||] <function…>` — optional whitespace between tokens and an
    // optional `X ||` safeguard, so both `X = X || function` and `X = function`
    // match the same canonical polyfill.
    return new RegExp(
        escape(lhs.trimEnd()) +
            String.raw`\s*(?:[$A-Za-z_][\w$.]*\s*\|\|\s*)?` +
            escape(fn.trimStart()),
    );
}

/**
 * Determine whether a polyfill is already present in a document.
 * @param text - Full document text.
 * @param polyfill - The polyfill source string.
 * @returns True when the polyfill's marker line is found in the document.
 */
export function isPolyfillPresent(text: string, polyfill: string): boolean {
    const marker = polyfillMarker(polyfill);
    if (marker === undefined) return false;
    // Fast path: exact substring (covers the canonical, unmodified polyfill).
    if (text.includes(marker)) return true;
    // Relaxed path: tolerate a present/absent `X ||` self-guard on assignments.
    return markerToRegExp(marker).test(text);
}
