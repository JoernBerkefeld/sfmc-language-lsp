import { MarkupKind } from '../types.js';
import type { Hover, Position } from '../types.js';
import { getWordRangeAtPosition } from '../utils/text.js';
import {
    buildSsjsFunctionMarkdown,
    buildEcmascriptBuiltinMarkdown,
    buildLocalFunctionMarkdown,
} from '../utils/markdown.js';
import type { LocalSsjsFunction } from '../utils/markdown.js';
import type { SsjsFunction } from '../data/ssjs.js';
import {
    platformMethods,
    platformVariableMethods,
    platformResponseMethods,
    platformRequestMethods,
    coreRequestMethods,
    platformRecipientMethods,
    coreLibraryObjects,
    wsproxyMethods,
    httpMethods,
    httpHeaderMethods,
    dateTimeTimezoneMethods,
    errorUtilMethods,
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

/**
 * Resolve hover documentation for a two-part `obj.name` member expression whose
 * `obj` is a known SSJS prefix (Variable, DateTime, Response, HTTP, …).
 * @param obj - The object/prefix part of the member expression.
 * @param name - The member name part.
 * @param range - The hover range spanning the full `obj.name` expression.
 * @returns Hover object when a matching member is found, otherwise null.
 */
function getPrefixedMemberHover(
    obj: string,
    name: string,
    range: ReturnType<typeof makeRange>,
): Hover | null {
    const lower = name.toLowerCase();
    const byName = (methods: SsjsFunction[]) => methods.find((m) => m.name.toLowerCase() === lower);

    let method: SsjsFunction | undefined;
    switch (obj) {
        case 'Variable': {
            method = byName(platformVariableMethods);
            break;
        }
        case 'DateTime': {
            // Bug #5 fix: case-sensitive — don't show hover for wrong-case names like URLEncode
            const fn = platformFunctionLookup.get(lower);
            method = fn && fn.name === name ? fn : undefined;
            break;
        }
        case 'Response': {
            method = byName(platformResponseMethods);
            break;
        }
        case 'Request': {
            // Bare `Request.` is the Core library Request object — its own 8 members,
            // NOT Platform.Request's set. Platform.Request is handled in the three-part
            // qualified-name branch (ns1 === 'Platform' && ns2 === 'Request').
            method = byName(coreRequestMethods);
            break;
        }
        case 'HTTPHeader': {
            method = byName(httpHeaderMethods);
            break;
        }
        case 'ErrorUtil': {
            method = byName(errorUtilMethods);
            break;
        }
        case 'Recipient': {
            method = byName(platformRecipientMethods);
            break;
        }
        case 'WSProxy':
        case 'api':
        case 'prox': {
            method = byName(wsproxyMethods);
            break;
        }
        case 'HTTP': {
            method = byName(httpMethods);
            break;
        }
        default: {
            return null;
        }
    }

    if (!method) return null;
    return {
        contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(method) },
        range,
    };
}

/**
 * Return hover documentation for an SSJS document at the given line/position.
 * @param line - The current document line text.
 * @param position - The cursor position.
 * @param localFunctions - Local function declarations from the document.
 * @returns Hover object with Markdown documentation, or null.
 */
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
        if (!(
            position.character >= tpMatch.index &&
            position.character <= tpMatch.index + tpMatch[0].length &&
            word === tpMatch![1]
        )) {
            continue;
        }

        const fn = platformMethods.find((m) => m.name.toLowerCase() === tpMatch![1].toLowerCase());
        if (fn) {
            return {
                contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
                range: makeRange(position, tpMatch.index, tpMatch.index + tpMatch[0].length),
            };
        }
    }

    // Three-part qualified names
    const qualifiedPattern = /(\w+)\.(\w+)\.(\w+)/g;
    let qMatch: RegExpExecArray | null;
    while ((qMatch = qualifiedPattern.exec(line)) !== null) {
        if (!(
            position.character >= qMatch.index &&
            position.character <= qMatch.index + qMatch[0].length
        )) {
            continue;
        }

        const full = qMatch[0];
        const [, ns1, ns2, name] = qMatch;

        if (ns1 === 'Platform' && ns2 === 'Function') {
            const fn = platformFunctionLookup.get(name.toLowerCase());
            // Bug #5 fix: case-sensitive — don't show hover for wrong-case names like URLEncode
            if (fn && fn.name === name)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(fn),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
        if (ns1 === 'Platform' && ns2 === 'DateTime') {
            const fn = platformFunctionLookup.get(name.toLowerCase());
            // Bug #5 fix: case-sensitive — don't show hover for wrong-case names
            if (fn && fn.name === name)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(fn),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
        if (ns1 === 'Platform' && ns2 === 'Variable') {
            const fn = platformVariableMethods.find(
                (m) => m.name.toLowerCase() === name.toLowerCase(),
            );
            if (fn)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(fn),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
        if (ns1 === 'Platform' && ns2 === 'Response') {
            const fn = platformResponseMethods.find(
                (m) => m.name.toLowerCase() === name.toLowerCase(),
            );
            if (fn)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(fn),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
        if (ns1 === 'Platform' && ns2 === 'Request') {
            const fn = platformRequestMethods.find(
                (m) => m.name.toLowerCase() === name.toLowerCase(),
            );
            if (fn)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(fn),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
        if (ns1 === 'DateTime' && ns2 === 'TimeZone') {
            const fn = dateTimeTimezoneMethods.find(
                (m) => m.name.toLowerCase() === name.toLowerCase(),
            );
            if (fn)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(fn),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
        if (ns1 === 'Platform' && ns2 === 'Recipient') {
            const fn = platformRecipientMethods.find(
                (m) => m.name.toLowerCase() === name.toLowerCase(),
            );
            if (fn)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(fn),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
        if (ns1 === 'Script' && ns2 === 'Util') {
            const c = scriptUtilConstructors.find(
                (c) => c.name.toLowerCase() === name.toLowerCase(),
            );
            if (c)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildSsjsFunctionMarkdown(c),
                    },
                    range: makeRange(position, qMatch.index, qMatch.index + full.length),
                };
        }
    }

    // Two-part generic patterns
    const twoPartGenericPattern = /(\w+)\.(\w+)/g;
    let tpgMatch: RegExpExecArray | null;
    while ((tpgMatch = twoPartGenericPattern.exec(line)) !== null) {
        if (!(
            position.character >= tpgMatch.index &&
            position.character <= tpgMatch.index + tpgMatch[0].length
        )) {
            continue;
        }

        const full = tpgMatch[0];
        const [, obj, name] = tpgMatch;

        // Bug #3 fix: only trigger hover on the member name, not the object/prefix part
        const dotPos = tpgMatch.index + obj.length;
        if (position.character <= dotPos) continue;

        const memberRange = makeRange(position, tpgMatch.index, tpgMatch.index + full.length);
        const objHover = getPrefixedMemberHover(obj, name, memberRange);
        if (objHover) return objHover;

        const reqMethod = scriptUtilRequestMethods.find(
            (m) => m.name.toLowerCase() === name.toLowerCase(),
        );
        if (reqMethod)
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: buildSsjsFunctionMarkdown(reqMethod),
                },
                range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length),
            };

        if (obj === 'Math') {
            const b = ecmascriptBuiltins.find(
                (b) => b.owner === 'Math' && b.name.toLowerCase() === name.toLowerCase(),
            );
            if (b)
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: buildEcmascriptBuiltinMarkdown(b),
                    },
                    range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length),
                };
        }
        const protoBuiltin = ecmascriptBuiltins.find(
            (b) =>
                (b.owner === 'Array.prototype' || b.owner === 'String.prototype') &&
                b.name.toLowerCase() === name.toLowerCase(),
        );
        if (protoBuiltin)
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: buildEcmascriptBuiltinMarkdown(protoBuiltin),
                },
                range: makeRange(position, tpgMatch.index, tpgMatch.index + full.length),
            };
    }

    // Global functions
    const globalFn = ssjsGlobals.find((g) => g.name.toLowerCase() === word.toLowerCase());
    if (globalFn)
        return {
            contents: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(globalFn) },
            range: makeRange(position, wordRange.start, wordRange.end),
        };

    // Unprefixed Platform.Function calls
    const platformFnByWord = platformFunctionLookup.get(word.toLowerCase());
    // Bug #5 fix: case-sensitive — don't show hover for wrong-case names
    if (platformFnByWord && platformFnByWord.name === word)
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: buildSsjsFunctionMarkdown(platformFnByWord),
            },
            range: makeRange(position, wordRange.start, wordRange.end),
        };

    // Core library objects
    const coreObj = coreLibraryObjects.find((o) => o.name.toLowerCase() === word.toLowerCase());
    if (coreObj)
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${coreObj.name}** *(Core library)*\n\n${coreObj.description}\n\n**Methods:** ${coreObj.methods.join(', ')}\n\n*Requires* \`Platform.Load("core", "1.1.5")\``,
            },
            range: makeRange(position, wordRange.start, wordRange.end),
        };

    if (word === 'WSProxy') {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: '**WSProxy** *(SOAP API wrapper)*\n\nLightweight wrapper for the Marketing Cloud SOAP API. Faster than AMPscript API functions for bulk operations.\n\n**Usage:** `var prox = new Script.Util.WSProxy();`\n\n[ssjs.guide reference](https://ssjs.guide/wsproxy/)',
            },
            range: makeRange(position, wordRange.start, wordRange.end),
        };
    }

    // File-local functions
    const localFn = localFunctions.find((f) => f.name === word);
    if (localFn)
        return {
            contents: { kind: MarkupKind.Markdown, value: buildLocalFunctionMarkdown(localFn) },
            range: makeRange(position, wordRange.start, wordRange.end),
        };

    return null;
}
