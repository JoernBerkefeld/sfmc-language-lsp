/**
 * Utilities for detecting AMPscript and GTL region boundaries within a document.
 */

/**
Classification of a script body, separate from its surrounding HTML.
 */
export type ScriptKind = 'ampscript' | 'ssjs' | 'browser-classic' | 'browser-module' | 'non-js';

/**
All offsets are UTF-16, zero-based, and end-exclusive.
 */
export interface ScriptRegion {
    kind: ScriptKind;
    tagStart: number;
    tagEnd: number;
    bodyStart: number;
    bodyEnd: number;
    /**
    Null for an unfinished body; otherwise the complete closing tag range.
     */
    closeTagStart: number | null;
    closeTagEnd: number | null;
    /**
    Lowercase attribute names, original values; the first duplicate wins.
     */
    attributes: Readonly<Record<string, string>>;
}

/**
A full-length projection plus the selected blocks in document order.
 */
export interface ScriptExtraction {
    text: string;
    regions: ScriptRegion[];
}

const javascriptMimeTypes = new Set([
    'application/ecmascript',
    'application/javascript',
    'application/x-ecmascript',
    'application/x-javascript',
    'text/ecmascript',
    'text/javascript',
    'text/javascript1.0',
    'text/javascript1.1',
    'text/javascript1.2',
    'text/javascript1.3',
    'text/javascript1.4',
    'text/javascript1.5',
    'text/jscript',
    'text/livescript',
    'text/x-ecmascript',
    'text/x-javascript',
]);

function classifyScript(attributes: Readonly<Record<string, string>>): ScriptKind {
    const language = (attributes.language ?? '').trim().toLowerCase();
    if (language === 'ampscript') return 'ampscript';
    const type = (attributes.type ?? '').trim().toLowerCase();
    const server = (attributes.runat ?? '').trim().toLowerCase() === 'server';
    if (type === 'module') return server ? 'non-js' : 'browser-module';
    // Explicit types take precedence over the obsolete language attribute.
    const isJavascript = Object.hasOwn(attributes, 'type')
        ? !type || javascriptMimeTypes.has(type)
        : !language || javascriptMimeTypes.has(`text/${language}`);
    if (!isJavascript) return 'non-js';
    return server ? 'ssjs' : 'browser-classic';
}

function findTagEnd(text: string, start: number): number {
    let quote = '';
    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (quote) {
            if (char === quote) quote = '';
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '>') {
            return index + 1;
        }
    }
    return -1;
}

function parseScriptAttributes(text: string): Record<string, string> {
    const attributes: Record<string, string> = Object.create(null);
    const pattern = /([^\s/=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const name = match[1].toLowerCase();
        if (!Object.hasOwn(attributes, name)) {
            attributes[name] = match[2] ?? match[3] ?? match[4] ?? '';
        }
    }
    return attributes;
}

/**
 * Classify script bodies without scanning nested script-looking text in raw bodies.
 * HTML comments and quoted attributes are skipped. Unfinished opening tags produce
 * no region; unfinished bodies extend to EOF. HTML raw-text closing tags terminate
 * bodies even when they occur inside a JavaScript string or comment.
 * @param text - Full mixed document.
 * @returns Script metadata in document order.
 */
export function getScriptRegions(text: string): ScriptRegion[] {
    const regions: ScriptRegion[] = [];
    const tagPattern = /^<\/?([a-z][\w:-]*)(?=[\t\n\f\r />])/i;
    let offset = 0;
    while (offset < text.length) {
        const tagStart = text.indexOf('<', offset);
        if (tagStart === -1) break;
        if (text.startsWith('<!--', tagStart)) {
            const commentEnd = text.indexOf('-->', tagStart + 4);
            offset = commentEnd === -1 ? text.length : commentEnd + 3;
            continue;
        }
        const match = tagPattern.exec(text.slice(tagStart));
        if (!match) {
            offset = tagStart + 1;
            continue;
        }
        const tagEnd = findTagEnd(text, tagStart + match[0].length);
        if (tagEnd === -1) break;
        offset = tagEnd;
        if (text[tagStart + 1] === '/') continue;
        const name = match[1].toLowerCase();
        if (name === 'plaintext') break;
        if (
            ![
                'script',
                'style',
                'textarea',
                'title',
                'xmp',
                'iframe',
                'noembed',
                'noframes',
            ].includes(name)
        ) {
            continue;
        }
        const closePattern = new RegExp(String.raw`</${name}(?=[\t\n\f\r />])[^>]*>`, 'gi');
        closePattern.lastIndex = tagEnd;
        const close = closePattern.exec(text);
        const bodyEnd = close?.index ?? text.length;
        offset = close ? close.index + close[0].length : text.length;
        if (name !== 'script') continue;
        const attributes = parseScriptAttributes(
            text.slice(tagStart + match[0].length, tagEnd - 1),
        );
        regions.push({
            kind: classifyScript(attributes),
            tagStart,
            tagEnd,
            bodyStart: tagEnd,
            bodyEnd,
            closeTagStart: close?.index ?? null,
            closeTagEnd: close ? offset : null,
            attributes,
        });
    }
    return regions;
}

/**
 * Keep only selected script bodies, masking everything else with spaces. Each
 * UTF-16 code unit keeps its original offset, including astral characters, and
 * CR/LF line endings are preserved throughout the document. Bodies are not
 * sanitized: consumers remain responsible for template interpolation handling.
 * @param text - Full mixed document.
 * @param kinds - Script classifications to retain.
 * @returns Offset-preserving text and retained block metadata.
 */
export function extractScriptBodies(text: string, kinds: readonly ScriptKind[]): ScriptExtraction {
    const regions = getScriptRegions(text).filter((region) => kinds.includes(region.kind));
    let offset = 0;
    const chunks: string[] = [];
    for (const region of regions) {
        chunks.push(
            text.slice(offset, region.bodyStart).replaceAll(/[^\r\n]/g, ' '),
            text.slice(region.bodyStart, region.bodyEnd),
        );
        offset = region.bodyEnd;
    }
    chunks.push(text.slice(offset).replaceAll(/[^\r\n]/g, ' '));
    return { text: chunks.join(''), regions };
}

/**
One delimiter-level item found by {@link scanAmpscriptDelimiters}. Offsets are
UTF-16, zero-based, and end-exclusive.
- `block` / `inline`: `closed` regions span opener through closing delimiter; an
  unclosed one covers only its three-character opener.
- `personalization`: a complete `%%name%%` string (plain text, never a delimiter).
- `block-close` / `inline-close`: a stray `]%%` / `=%%` outside any region.
 */
export interface AmpscriptDelimiterRegion {
    kind: 'block' | 'inline' | 'personalization' | 'block-close' | 'inline-close';
    start: number;
    end: number;
    closed: boolean;
}

const personalizationPattern = /%%\w(?:[\w .:;~()[\]/-]*[\w)\]])?%%/y;

/**
 * Scan a template left to right for AMPscript delimiters. At a `%%` outside any
 * region, `%%[` opens a block ending at the first following `]%%` and `%%=` opens
 * an inline expression ending at the first following `=%%`; otherwise a
 * personalisation string (`%%name%%` on one line) is skipped as a whole, so neither
 * of its `%%` can form a delimiter; any other `%%` is literal text. Scanning
 * resumes right after an opener that has no closing delimiter. Outside a region,
 * the body of a `<script runat="server">` that is not `language="ampscript"` is
 * skipped up to its `</script` (or the end of the text).
 * @param text - Full document text.
 * @returns Regions, personalisation strings and stray closers in document order.
 */
export function scanAmpscriptDelimiters(text: string): AmpscriptDelimiterRegion[] {
    const regions: AmpscriptDelimiterRegion[] = [];
    const scriptOpenPattern = /<script(?=[\s>])[^>]*>/gi;
    const scriptClosePattern = /<\/script/gi;
    let script = scriptOpenPattern.exec(text);
    // Next `%%` at or after `from` that is not inside the body of a server-side
    // JavaScript <script>: AMPscript is not evaluated there.
    const nextDelimiter = (from: number): number => {
        let index = text.indexOf('%%', from);
        while (index !== -1) {
            while (
                script &&
                (script.index < from || (script.index < index && !isServerJavascriptTag(script[0])))
            ) {
                script = scriptOpenPattern.exec(text);
            }
            if (!script || script.index >= index) break;
            scriptClosePattern.lastIndex = script.index + script[0].length;
            from = scriptClosePattern.exec(text)?.index ?? text.length;
            index = text.indexOf('%%', from);
        }
        return index;
    };
    let index = nextDelimiter(0);
    while (index !== -1) {
        const next = text[index + 2];
        let resume = index + 1;
        if (next === '[' || next === '=') {
            const kind = next === '[' ? 'block' : 'inline';
            const close = text.indexOf(next === '[' ? ']%%' : '=%%', index + 3);
            resume = (close === -1 ? index : close) + 3;
            regions.push({ kind, start: index, end: resume, closed: close !== -1 });
        } else {
            personalizationPattern.lastIndex = index;
            if (personalizationPattern.test(text)) {
                resume = personalizationPattern.lastIndex;
                regions.push({ kind: 'personalization', start: index, end: resume, closed: true });
            } else if (text[index - 1] === ']' || text[index - 1] === '=') {
                const kind = text[index - 1] === ']' ? 'block-close' : 'inline-close';
                regions.push({ kind, start: index - 1, end: index + 2, closed: false });
            }
        }
        index = nextDelimiter(resume);
    }
    return regions;
}

function isServerJavascriptTag(tag: string): boolean {
    const attributes = parseScriptAttributes(tag.slice(7, -1));
    return (
        (attributes.runat ?? '').trim().toLowerCase() === 'server' &&
        (attributes.language ?? '').trim().toLowerCase() !== 'ampscript'
    );
}

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

    // An unclosed opener (code still being typed) keeps everything after it inside;
    // a closed region covers the offset until its closing delimiter has passed.
    for (const region of scanAmpscriptDelimiters(text)) {
        if (region.start + 3 > offset) break;
        if (
            (region.kind === 'block' || region.kind === 'inline') &&
            (!region.closed || offset < region.end)
        ) {
            return true;
        }
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

    for (const region of scanAmpscriptDelimiters(text)) {
        if (region.closed && region.kind !== 'personalization') {
            blankRange(region.start, region.end);
        }
    }
    const scriptPattern =
        /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>[\s\S]*?<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptPattern.exec(text)) !== null) {
        blankRange(match.index, match.index + match[0].length);
    }

    return chars.join('');
}

/**
 * Returns a sanitized copy of the document where only the code inside
 * AMPscript regions is preserved (strings blanked, comments blanked).
 * Everything outside AMPscript regions is replaced with spaces.
 * This lets validators run regex safely without accidentally matching
 * HTML content outside AMPscript blocks. Line breaks are kept everywhere, so
 * that the result has the same lines as the document and a line number found
 * in it is a line number of the document.
 * @param text - Full document text.
 * @returns Sanitized text with only AMPscript region content preserved.
 */
export function getSanitizedAmpscriptText(text: string): string {
    // One entry per UTF-16 code unit, so that indexes are offsets of the document.
    const sanitizedChars = Array.from({ length: text.length }, (_, index) => blank(text[index]));
    const scriptPattern =
        /<script\s[^>]*language\s*=\s*["']ampscript["'][^>]*>[\s\S]*?<\/script>/gi;

    for (const region of scanAmpscriptDelimiters(text)) {
        if (region.closed && region.kind !== 'personalization') {
            sanitizeRegion(text, sanitizedChars, region.start + 3, region.end - 3);
        }
    }

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

/**
 * Blanks a character, unless it is a line break.
 * @param char - Character of the document.
 * @returns The line break itself, or a space.
 */
function blank(char: string): string {
    return char === '\n' || char === '\r' ? char : ' ';
}

function sanitizeRegion(text: string, sanitizedChars: string[], start: number, end: number): void {
    let index = start;
    while (index < end) {
        if (text.startsWith('/*', index)) {
            const commentEnd = text.indexOf('*/', index + 2);
            const safeEnd = commentEnd === -1 || commentEnd > end ? end : commentEnd + 2;
            for (let i = index; i < safeEnd; i++) {
                sanitizedChars[i] = blank(text[i]);
            }
            index = safeEnd;
            continue;
        }

        const quote = text[index];
        if (quote === '"' || quote === "'") {
            const stringEnd = findStringEnd(text, index + 1, end, quote);
            sanitizedChars[index] = quote;
            for (let i = index + 1; i < stringEnd; i++) {
                sanitizedChars[i] = blank(text[i]);
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
