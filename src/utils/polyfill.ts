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
 * document, tolerating both the optional self-guard the canonical polyfills
 * ship with and minified reformatting.
 *
 * The canonical form assigns via `X = X || function (value) {`, but authors
 * frequently drop the `X ||` safeguard (`X = function (value) {`) and/or minify
 * the source, collapsing whitespace and renaming parameters
 * (`X=function(v){`). All of these must count as "polyfill present".
 *
 * For assignment markers (`… = [X ||] function …`) the assignment target
 * (`X =`) stays the strict anchor while the `function (params)` portion is
 * matched loosely (any whitespace, any optional function name, any parameter
 * list) and the body is ignored entirely. Non-assignment markers (e.g.
 * `function bindFn(…) {`) match verbatim.
 * @param marker - The polyfill marker line from {@link polyfillMarker}.
 * @returns A RegExp matching the marker with or without the `X ||` safeguard.
 */
function markerToRegExp(marker: string): RegExp {
    const escape = (s: string): string => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    // Split on the first `= … function` assignment so the middle (which may or
    // may not contain the `X ||` safeguard) can be made optional.
    const assignMatch = /^(.*?)=\s*(?:[$A-Za-z_][\w$.]*\s*\|\|\s*)?function\b/s.exec(marker);
    if (!assignMatch) {
        // Non-assignment marker — match verbatim.
        return new RegExp(escape(marker));
    }
    const [, lhs] = assignMatch;
    // Anchor on `<lhs> = [X ||] function <name?>(<any params>)`:
    // - whitespace is collapsed to `\s*` so minified `X=function(v){` matches
    //   canonical `X = X || function (value) {`;
    // - the optional `X ||` safeguard is tolerated;
    // - the parameter list and body are matched loosely (params renamed or
    //   dropped in minification must still count as present).
    return new RegExp(
        escape(lhs.trimEnd()) +
            String.raw`\s*=\s*(?:[$A-Za-z_][\w$.]*\s*\|\|\s*)?function\s*\*?\s*[$A-Za-z_]*\s*\(`,
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
