/**
 * Completions for Handlebars for Marketing Cloud Next (MCN).
 *
 * Active only when a document targets Marketing Cloud Next
 * (`targetPlatform: 'next'`). Two completion surfaces are provided:
 *
 *   - Helper completions inside a `{{ ... }}` mustache (the canonical MCN
 *     helper catalog: built-in, mcn-helper, and platform helpers).
 *   - Built-in `{!$...}` data binding completions when the cursor sits just
 *     after a `{!$` token.
 *
 * Documentation Markdown is attached lazily in {@link resolveHandlebarsCompletion}.
 */

import { CompletionItemKind, InsertTextFormat, MarkupKind } from '../types.js';
import type { CompletionItem, Position } from '../types.js';
import { isInsideHandlebars } from '../utils/regions.js';
import { positionToOffset } from '../utils/positions.js';
import {
    buildHandlebarsHelperMarkdown,
    buildHandlebarsBindingMarkdown,
    buildHandlebarsHelperSnippet,
} from '../utils/markdown.js';
import { handlebarsHelperList, handlebarsBindingList } from '../data/handlebars.js';
import { getHandlebarsLocalsAtOffset } from '../utils/handlebarsScopeTracker.js';

/**
 * Human-readable label for a helper's origin, used in completion detail text.
 */
const HBS_ORIGIN_DETAIL: Record<string, string> = {
    'handlebars-builtin': 'Handlebars built-in',
    'mcn-helper': 'MCN helper',
    'mcn-platform': 'Salesforce platform helper',
};

// Built once at module load time — helper completions inside `{{ ... }}`.
export const handlebarsHelperCompletionItems: CompletionItem[] = handlebarsHelperList.map(
    (helper, index) => ({
        label: helper.name,
        kind:
            helper.helperType === 'block'
                ? CompletionItemKind.Keyword
                : CompletionItemKind.Function,
        detail: `(${HBS_ORIGIN_DETAIL[helper.origin] ?? helper.origin}) ${helper.name}`,
        insertText: buildHandlebarsHelperSnippet(helper),
        insertTextFormat: InsertTextFormat.Snippet,
        data: { type: 'hbs-helper', index },
    }),
);

// Built once at module load time — `{!$...}` built-in binding completions.
// The insert text omits the leading `{!$` and trailing `}` because those are
// already typed when the completion is triggered.
export const handlebarsBindingCompletionItems: CompletionItem[] = handlebarsBindingList.map(
    (binding, index) => ({
        label: binding.token,
        kind: CompletionItemKind.Variable,
        detail: `(${binding.namespace} binding) ${binding.name}`,
        filterText: binding.token,
        insertText: binding.name,
        insertTextFormat: InsertTextFormat.PlainText,
        data: { type: 'hbs-binding', index },
    }),
);

/**
 * Matches an in-progress `{!$...` binding token immediately before the cursor.
 */
const BINDING_PREFIX_PATTERN = /\{!\$[A-Za-z0-9_.]*$/;

/**
 * Return MCN Handlebars completions for the given document text and cursor
 * position. Returns an empty array when the cursor is not inside a Handlebars
 * mustache or a `{!$...}` binding token.
 * @param text - Full document text.
 * @param position - Cursor position.
 * @returns Array of completion items.
 */
export function getHandlebarsCompletions(text: string, position: Position): CompletionItem[] {
    const offset = positionToOffset(text, position);
    const before = text.slice(0, offset);

    // `{!$...}` binding — takes precedence: when the cursor follows a `{!$`
    // token, only bindings are valid.
    if (BINDING_PREFIX_PATTERN.test(before)) {
        return handlebarsBindingCompletionItems;
    }

    if (isInsideHandlebars(text, offset)) {
        // Block params (`as |item index|`) and loop vars (`@index`, `@key`, …)
        // are only valid inside the block that declares them, so they are added
        // ahead of the global helper catalog when in scope.
        const localItems = buildLocalCompletionItems(text, offset);
        return localItems.length > 0
            ? [...localItems, ...handlebarsHelperCompletionItems]
            : handlebarsHelperCompletionItems;
    }

    return [];
}

/**
 * Build completion items for the Handlebars block-locals in scope at `offset`.
 * @param text - Full document text.
 * @param offset - Cursor offset.
 * @returns Completion items for in-scope block params and loop variables.
 */
function buildLocalCompletionItems(text: string, offset: number): CompletionItem[] {
    return getHandlebarsLocalsAtOffset(text, offset).map((local) => ({
        label: local.name,
        kind: CompletionItemKind.Variable,
        detail: `(${local.detail})`,
        // Loop vars start with `@`; when the user already typed `@`, the editor
        // filters on the remainder, so keep the full label as filter text.
        filterText: local.name,
        insertText: local.name,
        insertTextFormat: InsertTextFormat.PlainText,
    }));
}

/**
 * Resolve documentation for an MCN Handlebars completion item (lazy-loaded).
 * @param item - Completion item to resolve.
 * @returns The resolved completion item with documentation attached, or the
 *   item unchanged when it is not a Handlebars item.
 */
export function resolveHandlebarsCompletion(item: CompletionItem): CompletionItem {
    const data = item.data as { type?: string; index?: number } | undefined;
    if (!data || data.index === undefined) return item;

    switch (data.type) {
        case 'hbs-helper': {
            const helper = handlebarsHelperList[data.index];
            if (helper) {
                item.documentation = {
                    kind: MarkupKind.Markdown,
                    value: buildHandlebarsHelperMarkdown(helper),
                };
            }
            break;
        }
        case 'hbs-binding': {
            const binding = handlebarsBindingList[data.index];
            if (binding) {
                item.documentation = {
                    kind: MarkupKind.Markdown,
                    value: buildHandlebarsBindingMarkdown(binding),
                };
            }
            break;
        }
    }

    return item;
}
