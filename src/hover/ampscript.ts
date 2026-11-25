import { FUNCTIONS } from 'ampscript-data';
import { MarkupKind } from '../types.js';
import type { Hover, Position } from '../types.js';
import { getWordRangeAtPosition } from '../utils/text.js';
import { buildFunctionMarkdown } from '../utils/markdown.js';
import {
    functionLookup,
    ampscriptGlobals,
    ampscriptKeywords,
    personalizationStrings,
} from '../data/ampscript.js';
import { buildVariableTypeMap } from '../utils/ampscriptVariableTracker.js';

/**
 * Map from lowercase function name to its catalog entry (documentation URLs and MCN metadata).
 */
const ampscriptEntries = new Map(FUNCTIONS.map((f) => [f.name.toLowerCase(), f]));

/**
 * Pick the one documentation link a function hover shows: our own sfmc.guide page for the
 * platform the document targets. In Engagement mode a function without such a page falls back
 * to ampscript.guide; in Next mode only the Next page is linked (functions Next does not
 * support get no hover at all).
 * @param entry - The function's catalog entry.
 * @param targetPlatform - Platform the document targets; undefined means Engagement.
 * @returns Label and URL of the link, or undefined when there is none.
 */
function pickGuideLink(
    entry: (typeof FUNCTIONS)[number],
    targetPlatform: 'engagement' | 'next' | undefined,
): { label: string; url: string } | undefined {
    if (targetPlatform === 'next') {
        return entry.sfmcGuideNextUrl
            ? { label: 'sfmc.guide', url: entry.sfmcGuideNextUrl }
            : undefined;
    }
    if (entry.sfmcGuideUrl) return { label: 'sfmc.guide', url: entry.sfmcGuideUrl };
    return entry.guideUrl ? { label: 'ampscript.guide', url: entry.guideUrl } : undefined;
}

/**
 * Return hover documentation for an AMPscript document at the given line/position.
 * @param line - The current document line text.
 * @param position - The cursor position.
 * @param fullText - Optional full document text used for variable type inference.
 * @param targetPlatform - Platform the document targets; picks the sfmc.guide page to link, and
 * in Next mode hides functions Next does not support.
 * @returns Hover object with Markdown documentation, or null.
 */
export function getAmpscriptHover(
    line: string,
    position: Position,
    fullText?: string,
    targetPlatform?: 'engagement' | 'next',
): Hover | null {
    const wordRange = getWordRangeAtPosition(line, position.character);
    if (!wordRange) return null;

    const word = line.slice(wordRange.start, wordRange.end);

    const global = ampscriptGlobals.find(
        (entry) => entry.name.toLowerCase() === word.toLowerCase(),
    );
    if (global) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${global.name}** *(read-only global)*\n\n${global.description}`,
            },
            range: {
                start: { line: position.line, character: wordRange.start },
                end: { line: position.line, character: wordRange.end },
            },
        };
    }

    // @variable hover — show inferred type matching the SSJS TypeScript hover style
    if (fullText !== undefined && word.startsWith('@')) {
        const varName = word.slice(1).toLowerCase();
        const typeMap = buildVariableTypeMap(fullText);
        const varType = typeMap.get(varName) ?? 'any';
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `\`\`\`typescript\n// AMPscript variable\nvar ${word}: ${varType}\n\`\`\``,
            },
            range: {
                start: { line: position.line, character: wordRange.start },
                end: { line: position.line, character: wordRange.end },
            },
        };
    }

    const fn = functionLookup.get(word.toLowerCase());
    if (fn) {
        // Next cannot run it: the `sfmc/amp-no-mcn-unsupported` diagnostic says so, and no
        // documentation is shown (as in the Chrome extension).
        if (targetPlatform === 'next' && fn.mcnSince == null) return null;
        const entry = ampscriptEntries.get(word.toLowerCase());
        const links = entry && {
            guideLink: pickGuideLink(entry, targetPlatform),
            mcnSince: entry.mcnSince ?? null,
            mcnNotes: entry.mcnNotes ?? null,
            // Next renders some return values differently; show what Next produces.
            ...(targetPlatform === 'next' && {
                returnDescription: entry.mcnReturnDescription,
                example: entry.mcnExample,
            }),
        };
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
