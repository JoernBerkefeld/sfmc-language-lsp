import { FUNCTIONS } from 'ampscript-data';
import { MarkupKind } from '../types.js';
import type { Hover, Position } from '../types.js';
import { getWordRangeAtPosition } from '../utils/text.js';
import { buildFunctionMarkdown } from '../utils/markdown.js';
import { functionLookup, ampscriptKeywords, personalizationStrings } from '../data/ampscript.js';

/** Map from lowercase function name to its documentation URLs. */
const ampscriptDocLinks = new Map(
    FUNCTIONS.map((f) => [
        f.name.toLowerCase(),
        {
            docUrl: (f as { docUrl?: string }).docUrl,
            guideUrl: (f as { guideUrl?: string }).guideUrl,
        },
    ]),
);

/**
 * Return hover documentation for an AMPscript document at the given line/position.
 * @param line - The current document line text.
 * @param position - The cursor position.
 * @returns Hover object with Markdown documentation, or null.
 */
export function getAmpscriptHover(line: string, position: Position): Hover | null {
    const wordRange = getWordRangeAtPosition(line, position.character);
    if (!wordRange) return null;

    const word = line.slice(wordRange.start, wordRange.end);

    const fn = functionLookup.get(word.toLowerCase());
    if (fn) {
        const links = ampscriptDocLinks.get(word.toLowerCase());
        return {
            contents: { kind: MarkupKind.Markdown, value: buildFunctionMarkdown(fn, links) },
            range: {
                start: { line: position.line, character: wordRange.start },
                end: { line: position.line, character: wordRange.end },
            },
        };
    }

    const kw = ampscriptKeywords.find((k) => k.name.toLowerCase() === word.toLowerCase());
    if (kw) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${kw.name}** *(keyword)*\n\n${kw.description}`,
            },
            range: {
                start: { line: position.line, character: wordRange.start },
                end: { line: position.line, character: wordRange.end },
            },
        };
    }

    const ps = personalizationStrings.find((p) => p.name.toLowerCase() === word.toLowerCase());
    if (ps) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${ps.name}** *(personalization string)*\n\n${ps.description}`,
            },
            range: {
                start: { line: position.line, character: wordRange.start },
                end: { line: position.line, character: wordRange.end },
            },
        };
    }

    return null;
}
