import { MarkupKind } from '../types.js';
import type { Hover, Position } from '../types.js';
import { getWordRangeAtPosition } from '../utils/text.js';
import { buildSsjsFunctionMarkdown, buildEcmascriptBuiltinMarkdown, buildLocalFunctionMarkdown } from '../utils/markdown.js';
import type { LocalSsjsFunction } from '../utils/markdown.js';
import {
    platformFunctions,
    platformMethods,
    platformVariableMethods,
    platformResponseMethods,
    platformRequestMethods,
    platformClientBrowserMethods,
    platformRecipientMethods,
    coreLibraryObjects,
    wsproxyMethods,
    httpMethods,
    scriptUtilConstructors,
    scriptUtilRequestMethods,
    ecmascriptBuiltins,
    ssjsGlobals,
    platformFunctionLookup,
} from '../data/ssjs.js';

function makeRange(position: Position, start: number, end: number) {
    return {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
    };
}

/** Return hover documentation for an SSJS document at the given line/position. */
export function getSsjsHover(
    line: string,
    position: Position,
    localFunctions: LocalSsjsFunction[],
): Hover | null {
    const wordRange = getWordRangeAtPosition(line, position.character);
    if (!wordRange) return null;

    const word = line.slice(wordRange.start, wordRange.end);

    // Platform.XXX two-part (not followed by another .word)
    const twoPartPattern = /Platform\.(\w+)(?!\.\w)/g;
    let tpMatch: RegExpExecArray | null;
    while ((tpMatch = twoPartPattern.exec(line)) !== null) {
        if (position.character >= tpMatch.index && position.character <= tpMatch.index + tpMatch[0].length) {
            const fn = platformMethods.find((m) => m.name.toLowerCase() === tpMatch![1].toLowerCase());
            if (fn) {
                return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, tpMatch.index, tpMatch.index + tpMatch[0].length) };
            }
        }
    }

    // Three-part qualified names
    const qualifiedPattern = /(\w+)\.(\w+)\.(\w+)/g;
    let qMatch: RegExpExecArray | null;
    while ((qMatch = qualifiedPattern.exec(line)) !== null) {
        if (position.character >= qMatch.index && position.character <= qMatch.index + qMatch[0].length) {
            const full = qMatch[0];
            const [, ns1, ns2, name] = qMatch;

            if (ns1 === 'Platform' && ns2 === 'Function') {
                const fn = platformFunctionLookup.get(name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
            if (ns1 === 'Platform' && (ns2 === 'DateTime')) {
                const fn = platformFunctionLookup.get(name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
            if (ns1 === 'Platform' && ns2 === 'Variable') {
                const fn = platformVariableMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
            if (ns1 === 'Platform' && ns2 === 'Response') {
                const fn = platformResponseMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
            if (ns1 === 'Platform' && ns2 === 'Request') {
                const fn = platformRequestMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
            if (ns1 === 'Platform' && ns2 === 'ClientBrowser') {
                const fn = platformClientBrowserMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
            if (ns1 === 'Platform' && ns2 === 'Recipient') {
                const fn = platformRecipientMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
            if (ns1 === 'Script' && ns2 === 'Util') {
                const c = scriptUtilConstructors.find((c) => c.name.toLowerCase() === name.toLowerCase());
                if (c) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(c) }, range: makeRange(position, qMatch.index, qMatch.index + full.length) };
            }
        }
    }

    // Two-part generic patterns
    const twoPartGenericPattern = /(\w+)\.(\w+)/g;
    let tpgMatch: RegExpExecArray | null;
    while ((tpgMatch = twoPartGenericPattern.exec(line)) !== null) {
        if (position.character >= tpgMatch.index && position.character <= tpgMatch.index + tpgMatch[0].length) {
            const full = tpgMatch[0];
            const [, obj, name] = tpgMatch;

            if (obj === 'Variable') {
                const m = platformVariableMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (m) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            if (obj === 'Function' || obj === 'DateTime') {
                const fn = platformFunctionLookup.get(name.toLowerCase());
                if (fn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            if (obj === 'Response') {
                const m = platformResponseMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (m) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            if (obj === 'Request') {
                const m = platformRequestMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (m) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            if (obj === 'ClientBrowser') {
                const m = platformClientBrowserMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (m) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            if (obj === 'Recipient') {
                const m = platformRecipientMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (m) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            if (obj === 'WSProxy' || obj === 'api' || obj === 'prox') {
                const m = wsproxyMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (m) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            if (obj === 'HTTP') {
                const m = httpMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
                if (m) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            const reqMethod = scriptUtilRequestMethods.find((m) => m.name.toLowerCase() === name.toLowerCase());
            if (reqMethod) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(reqMethod) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };

            if (obj === 'Math') {
                const b = ecmascriptBuiltins.find((b) => b.owner === 'Math' && b.name.toLowerCase() === name.toLowerCase());
                if (b) return { contents: { kind: MarkupKind.Markdown, value: buildEcmascriptBuiltinMarkdown(b) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
            }
            const protoBuiltin = ecmascriptBuiltins.find(
                (b) => (b.owner === 'Array.prototype' || b.owner === 'String.prototype') && b.name.toLowerCase() === name.toLowerCase(),
            );
            if (protoBuiltin) return { contents: { kind: MarkupKind.Markdown, value: buildEcmascriptBuiltinMarkdown(protoBuiltin) }, range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length) };
        }
    }

    // Global functions
    const globalFn = ssjsGlobals.find((g) => g.name.toLowerCase() === word.toLowerCase());
    if (globalFn) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(globalFn) }, range: makeRange(position, wordRange.start, wordRange.end) };

    // Unprefixed Platform.Function calls
    const platformFnByWord = platformFunctionLookup.get(word.toLowerCase());
    if (platformFnByWord) return { contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(platformFnByWord) }, range: makeRange(position, wordRange.start, wordRange.end) };

    // Core library objects
    const coreObj = coreLibraryObjects.find((o) => o.name.toLowerCase() === word.toLowerCase());
    if (coreObj) return { contents: { kind: MarkupKind.Markdown, value: `**${coreObj.name}** *(Core library)*\n\n${coreObj.description}\n\n**Methods:** ${coreObj.methods.join(', ')}\n\n*Requires* \`Platform.Load("core", "1.1.5")\`` }, range: makeRange(position, wordRange.start, wordRange.end) };

    if (word === 'WSProxy') {
        return { contents: { kind: MarkupKind.Markdown, value: '**WSProxy** *(SOAP API wrapper)*\n\nLightweight wrapper for the Marketing Cloud SOAP API. Faster than AMPscript API functions for bulk operations.' }, range: makeRange(position, wordRange.start, wordRange.end) };
    }

    // File-local functions
    const localFn = localFunctions.find((f) => f.name === word);
    if (localFn) return { contents: { kind: MarkupKind.Markdown, value: buildLocalFunctionMarkdown(localFn) }, range: makeRange(position, wordRange.start, wordRange.end) };

    return null;
}
