import { CompletionItemKind, CompletionItemTag, InsertTextFormat, MarkupKind } from '../types.js';
import type { CompletionItem, Position } from '../types.js';
import { isInsideAmpscript, isInsideGtl, getSanitizedAmpscriptText } from '../utils/regions.js';
import { positionToOffset } from '../utils/positions.js';
import { buildFunctionMarkdown, buildFunctionSnippet } from '../utils/markdown.js';
import {
    ampscriptFunctions,
    ampscriptKeywords,
    personalizationStrings,
} from '../data/ampscript.js';

// Built once at module load time.
export const functionCompletionItems: CompletionItem[] = ampscriptFunctions.map((fn, index) => ({
    label: fn.name,
    kind: CompletionItemKind.Function,
    detail: `(${fn.category}) ${fn.name}`,
    insertText: buildFunctionSnippet(fn),
    insertTextFormat: InsertTextFormat.Snippet,
    ...(fn.deprecated ? { tags: [CompletionItemTag.Deprecated] } : {}),
    data: { type: 'function', index },
}));

export const keywordCompletionItems: CompletionItem[] = ampscriptKeywords.map((kw, index) => ({
    label: kw.name,
    kind: CompletionItemKind.Keyword,
    detail: kw.description,
    insertText: kw.snippet ?? kw.name,
    insertTextFormat: kw.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    data: { type: 'keyword', index },
}));

export const personalizationCompletionItems: CompletionItem[] = personalizationStrings.map(
    (ps, index) => ({
        label: ps.name,
        kind: CompletionItemKind.Variable,
        detail: ps.description,
        data: { type: 'personalization', index },
    }),
);

function buildVariableCompletionItems(text: string): CompletionItem[] {
    const sanitized = getSanitizedAmpscriptText(text);
    const variablePattern = /@[a-zA-Z_][a-zA-Z0-9_]*/g;
    const seen = new Set<string>();
    const variables: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = variablePattern.exec(sanitized)) !== null) {
        if (match.index > 0 && sanitized[match.index - 1] === '@') continue;
        const varName = match[0];
        const normalized = varName.toLowerCase();
        if (!seen.has(normalized)) {
            seen.add(normalized);
            variables.push(varName);
        }
    }

    return variables.map((v) => ({
        label: v,
        kind: CompletionItemKind.Variable,
        detail: 'AMPscript variable in this file',
        insertText: v,
        insertTextFormat: InsertTextFormat.PlainText,
        data: { type: 'variable', name: v },
    }));
}

/**
 * Return AMPscript completions for the given document text and cursor position.
 * @param text - Full document text.
 * @param position - Cursor position.
 * @returns Array of completion items.
 */
export function getAmpscriptCompletions(text: string, position: Position): CompletionItem[] {
    const offset = positionToOffset(text, position);
    const variableItems = buildVariableCompletionItems(text);

    if (isInsideGtl(text, offset)) {
        return [...functionCompletionItems, ...variableItems, ...personalizationCompletionItems];
    }

    if (!isInsideAmpscript(text, offset)) {
        return [];
    }

    return [
        ...functionCompletionItems,
        ...keywordCompletionItems,
        ...variableItems,
        ...personalizationCompletionItems,
    ];
}

/**
 * Resolve documentation for an AMPscript completion item (lazy-loaded).
 * @param item - Completion item to resolve.
 * @returns The resolved completion item with documentation attached.
 */
export function resolveAmpscriptCompletion(item: CompletionItem): CompletionItem {
    const data = item.data as { type: string; index?: number } | undefined;
    if (!data) return item;

    switch (data.type) {
        case 'function': {
            if (data.index !== undefined) {
                const fn = ampscriptFunctions[data.index];
                if (fn) {
                    item.documentation = {
                        kind: MarkupKind.Markdown,
                        value: buildFunctionMarkdown(fn),
                    };
                }
            }
            break;
        }
        case 'keyword': {
            if (data.index !== undefined) {
                const kw = ampscriptKeywords[data.index];
                if (kw) {
                    item.documentation = { kind: MarkupKind.Markdown, value: kw.description };
                }
            }
            break;
        }
        case 'personalization': {
            if (data.index !== undefined) {
                const ps = personalizationStrings[data.index];
                if (ps) {
                    item.documentation = { kind: MarkupKind.Markdown, value: ps.description };
                }
            }
            break;
        }
    }

    return item;
}
