/**
 * Utilities for detecting AMPscript and GTL region boundaries within a document.
 */

/**
 * Returns true when the given character offset falls inside an AMPscript
 * region: a %%[...]%% block, a %%=...=%% inline expression, or a
 * <script language="ampscript"> ... </script> tag body.
 * @param text - Full document text.
 * @param offset - Character offset to test.
 * @returns True if the offset is inside an AMPscript region.
 */
export function isInsideAmpscript(text: string, offset: number): boolean {
    const before = text.slice(0, Math.max(0, offset));

    const lastBlockOpen = before.lastIndexOf('%%[');
    const lastBlockClose = before.lastIndexOf(']%%');
    if (lastBlockOpen !== -1 && lastBlockOpen > lastBlockClose) {
        return true;
    }

    const lastInlineOpen = before.lastIndexOf('%%=');
    const lastInlineClose = before.lastIndexOf('=%%');
    if (lastInlineOpen !== -1 && lastInlineOpen > lastInlineClose) {
        return true;
    }

    const scriptOpenPattern = /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>/gi;
    const scriptClosePattern = /<\/script>/gi;
    let lastScriptOpen = -1;
    let lastScriptClose = -1;
    let match: RegExpExecArray | null;

    while ((match = scriptOpenPattern.exec(before)) !== null) {
        lastScriptOpen = match.index;
    }
    while ((match = scriptClosePattern.exec(before)) !== null) {
        lastScriptClose = match.index;
    }
    return lastScriptOpen !== -1 && lastScriptOpen > lastScriptClose;
}

/**
 * Returns true when the given character offset falls inside a GTL {{...}} expression.
 * @param text - Full document text.
 * @param offset - Character offset to test.
 * @returns True if the offset is inside a GTL expression.
 */
export function isInsideGtl(text: string, offset: number): boolean {
    const before = text.slice(0, Math.max(0, offset));
    const lastGtlOpen = before.lastIndexOf('{{');
    const lastGtlClose = before.lastIndexOf('}}');
    return lastGtlOpen !== -1 && lastGtlOpen > lastGtlClose;
}

/**
 * Returns true when the given character offset falls inside a Handlebars {{...}}
 * expression (Handlebars for Marketing Cloud Next). The syntax is identical to
 * GTL, but the two are mutually exclusive: GTL is detected only in Engagement
 * mode, Handlebars only in MCN Next mode.
 * @param text - Full document text.
 * @param offset - Character offset to test.
 * @returns True if the offset is inside a Handlebars expression.
 */
export function isInsideHandlebars(text: string, offset: number): boolean {
    const before = text.slice(0, Math.max(0, offset));
    const lastOpen = before.lastIndexOf('{{');
    const lastClose = before.lastIndexOf('}}');
    return lastOpen !== -1 && lastOpen > lastClose;
}

/**
 * Returns a copy of the document where every AMPscript region (%%[...]%%,
 * %%=...=%%, and <script language="ampscript"> bodies) is replaced with spaces,
 * preserving offsets. HTML, Handlebars {{...}} expressions, and {!$...} bindings
 * are kept verbatim so the Handlebars parser can run over a mixed document
 * without choking on AMPscript syntax.
 * @param text - Full document text.
 * @returns Text with AMPscript regions blanked out.
 */
export function getSanitizedHandlebarsText(text: string): string {
    const chars = [...text];
    const blankRange = (start: number, end: number): void => {
        for (let i = start; i < end && i < chars.length; i++) {
            if (chars[i] !== '\n' && chars[i] !== '\r') {
                chars[i] = ' ';
            }
        }
    };

    const patterns = [
        /%%\[[\s\S]*?\]%%/g,
        /%%=[\s\S]*?=%%/g,
        /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>[\s\S]*?<\/script>/gi,
    ];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            blankRange(match.index, match.index + match[0].length);
        }
    }

    return chars.join('');
}

/**
 * Returns a sanitized copy of the document where only the code inside
 * AMPscript regions is preserved (strings blanked, comments blanked).
 * Everything outside AMPscript regions is replaced with spaces.
 * This lets validators run regex safely without accidentally matching
 * HTML content outside AMPscript blocks.
 * @param text - Full document text.
 * @returns Sanitized text with only AMPscript region content preserved.
 */
export function getSanitizedAmpscriptText(text: string): string {
    const sanitizedChars = Array.from(text, () => ' ');
    const blockPattern = /%%\[[\s\S]*?\]%%/g;
    const inlinePattern = /%%=[\s\S]*?=%%/g;
    const scriptPattern =
        /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>[\s\S]*?<\/script>/gi;

    copySanitizedRegions(text, sanitizedChars, blockPattern, 3, 3);
    copySanitizedRegions(text, sanitizedChars, inlinePattern, 3, 3);

    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = scriptPattern.exec(text)) !== null) {
        const matchText = scriptMatch[0];
        const openTagEnd = matchText.indexOf('>');
        const closeTagStart = matchText.toLowerCase().lastIndexOf('</script>');
        if (openTagEnd === -1 || closeTagStart === -1) {
            continue;
        }
        const codeStart = scriptMatch.index + openTagEnd + 1;
        const codeEnd = scriptMatch.index + closeTagStart;
        sanitizeRegion(text, sanitizedChars, codeStart, codeEnd);
    }

    return sanitizedChars.join('');
}

function copySanitizedRegions(
    text: string,
    sanitizedChars: string[],
    pattern: RegExp,
    openDelimiterLength: number,
    closeDelimiterLength: number,
): void {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const codeStart = match.index + openDelimiterLength;
        const codeEnd = match.index + match[0].length - closeDelimiterLength;
        sanitizeRegion(text, sanitizedChars, codeStart, codeEnd);
    }
}

function sanitizeRegion(text: string, sanitizedChars: string[], start: number, end: number): void {
    let index = start;
    while (index < end) {
        if (text.startsWith('/*', index)) {
            const commentEnd = text.indexOf('*/', index + 2);
            const safeEnd = commentEnd === -1 || commentEnd > end ? end : commentEnd + 2;
            for (let i = index; i < safeEnd; i++) {
                sanitizedChars[i] = ' ';
            }
            index = safeEnd;
            continue;
        }

        const quote = text[index];
        if (quote === '"' || quote === "'") {
            const stringEnd = findStringEnd(text, index + 1, end, quote);
            sanitizedChars[index] = quote;
            for (let i = index + 1; i < stringEnd; i++) {
                sanitizedChars[i] = ' ';
            }
            if (stringEnd > index + 1 && text[stringEnd - 1] === quote) {
                sanitizedChars[stringEnd - 1] = quote;
            }
            index = stringEnd;
            continue;
        }

        sanitizedChars[index] = text[index];
        index++;
    }
}

function findStringEnd(text: string, start: number, limit: number, quote: string): number {
    let index = start;
    while (index < limit) {
        if (text[index] === quote) {
            return index + 1;
        }
        index++;
    }
    return limit;
}
