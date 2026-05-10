import { CompletionItemKind, InsertTextFormat, MarkupKind } from '../types.js';
import type { CompletionItem } from '../types.js';
import {
    buildSsjsFunctionMarkdown,
    buildSsjsFunctionSnippet,
    buildLocalFunctionMarkdown,
    buildEcmascriptBuiltinMarkdown,
} from '../utils/markdown.js';
import type { LocalSsjsFunction } from '../utils/markdown.js';
import {
    platformFunctions,
    platformMethods,
    platformVariableMethods,
    platformResponseMethods,
    platformRequestMethods,
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
} from '../data/ssjs.js';

/** The full static SSJS catalog (built once). */
export const ssjsCompletionItems: CompletionItem[] = buildSsjsCatalog();

function buildSsjsCatalog(): CompletionItem[] {
    const items: CompletionItem[] = [];

    for (const fn of ssjsGlobals) {
        items.push({
            label: fn.name,
            kind: CompletionItemKind.Function,
            detail: `(global) ${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            data: { type: 'ssjs-global', name: fn.name },
        });
    }

    for (const fn of platformFunctions) {
        const doc = { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) };
        items.push(
            {
                label: `Platform.Function.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `Platform.Function.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet(fn),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Platform.Function.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-function', name: fn.name },
            },
            {
                label: `Function.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `(shorthand) Platform.Function.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet({ ...fn, prefix: 'Function' }),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Function.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-function', name: fn.name },
            },
            {
                label: `Platform.DateTime.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `Platform.DateTime.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet(fn),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Platform.DateTime.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-function', name: fn.name },
            },
            {
                label: `DateTime.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `(shorthand) Platform.DateTime.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet({ ...fn, prefix: 'DateTime' }),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `DateTime.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-function', name: fn.name },
            },
        );
    }

    for (const fn of platformVariableMethods) {
        const doc = { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) };
        items.push(
            {
                label: `Platform.Variable.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `Platform.Variable.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet(fn),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Platform.Variable.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-variable', name: fn.name },
            },
            {
                label: `Variable.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `(shorthand) Platform.Variable.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet({ ...fn, prefix: 'Variable' }),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Variable.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-variable', name: fn.name },
            },
        );
    }

    for (const fn of platformResponseMethods) {
        const doc = { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) };
        items.push(
            {
                label: `Platform.Response.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `Platform.Response.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet(fn),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Platform.Response.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-response', name: fn.name },
            },
            {
                label: `Response.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `(shorthand) Platform.Response.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet({ ...fn, prefix: 'Response' }),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Response.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-response', name: fn.name },
            },
        );
    }

    for (const fn of platformRequestMethods) {
        const doc = { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) };
        items.push(
            {
                label: `Platform.Request.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `Platform.Request.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet(fn),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Platform.Request.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-request', name: fn.name },
            },
            {
                label: `Request.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `(shorthand) Platform.Request.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet({ ...fn, prefix: 'Request' }),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Request.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-request', name: fn.name },
            },
        );
    }

    for (const obj of coreLibraryObjects) {
        items.push({
            label: obj.name,
            kind: CompletionItemKind.Class,
            detail: `(Core library) ${obj.name}`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: `${obj.description}\n\n**Methods:** ${obj.methods.join(', ')}\n\n*Requires* \`Platform.Load("core", "1.1.5")\``,
            },
            data: { type: 'ssjs-core-object', name: obj.name },
        });
    }

    for (const fn of wsproxyMethods) {
        items.push({
            label: `WSProxy.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `WSProxy.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            data: { type: 'ssjs-wsproxy', name: fn.name },
        });
    }

    for (const fn of httpMethods) {
        items.push({
            label: `HTTP.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `HTTP.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            data: { type: 'ssjs-http', name: fn.name },
        });
    }

    for (const fn of httpHeaderMethods) {
        items.push({
            label: `HTTPHeader.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `HTTPHeader.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `HTTPHeader.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-httpheader', name: fn.name },
        });
    }

    for (const fn of dateTimeTimezoneMethods) {
        items.push({
            label: `DateTime.TimeZone.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `DateTime.TimeZone.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `DateTime.TimeZone.${fn.name} TimeZone.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-datetime-timezone', name: fn.name },
        });
    }

    for (const fn of errorUtilMethods) {
        items.push({
            label: `ErrorUtil.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `ErrorUtil.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `ErrorUtil.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-errorutil', name: fn.name },
        });
    }

    for (const fn of platformRecipientMethods) {
        const doc = { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) };
        items.push(
            {
                label: `Platform.Recipient.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `Platform.Recipient.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet(fn),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Platform.Recipient.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-recipient', name: fn.name },
            },
            {
                label: `Recipient.${fn.name}`,
                kind: CompletionItemKind.Method,
                detail: `(shorthand) Platform.Recipient.${fn.name}`,
                documentation: doc,
                insertText: buildSsjsFunctionSnippet({ ...fn, prefix: 'Recipient' }),
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `Recipient.${fn.name} ${fn.name}`,
                data: { type: 'ssjs-platform-recipient', name: fn.name },
            },
        );
    }

    for (const fn of platformMethods) {
        items.push({
            label: `Platform.${fn.name}`,
            kind: CompletionItemKind.Function,
            detail: `Platform.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `Platform.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-platform', name: fn.name },
        });
    }

    items.push({
        label: 'WSProxy',
        kind: CompletionItemKind.Class,
        detail: '(SOAP API wrapper)',
        documentation: {
            kind: MarkupKind.Markdown,
            value: 'Lightweight wrapper for the Marketing Cloud SOAP API. Faster than AMPscript API functions for bulk operations.\n\n**Example:** `var prox = new WSProxy();`',
        },
        data: { type: 'ssjs-wsproxy-class' },
    });

    for (const c of scriptUtilConstructors) {
        items.push({
            label: `Script.Util.${c.name}`,
            kind: CompletionItemKind.Constructor,
            detail: `new Script.Util.${c.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(c) },
            insertText: buildSsjsFunctionSnippet(c),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `Script.Util.${c.name} ${c.name}`,
            data: { type: 'ssjs-script-util-constructor', name: c.name },
        });
    }

    for (const m of scriptUtilRequestMethods) {
        items.push({
            label: `req.${m.name}`,
            kind: CompletionItemKind.Method,
            detail: `req.${m.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(m) },
            insertText: buildSsjsFunctionSnippet(m),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `req.${m.name} ${m.name}`,
            data: { type: 'ssjs-script-util-request', name: m.name },
        });
    }

    for (const b of ecmascriptBuiltins) {
        const label = `${b.owner.replace('.prototype', '')}.${b.name}`;
        items.push({
            label,
            kind: CompletionItemKind.Method,
            detail: b.syntax ?? label,
            documentation: { kind: MarkupKind.Markdown, value: buildEcmascriptBuiltinMarkdown(b) },
            filterText: `${label} ${b.name}`,
            data: { type: 'ssjs-ecma-builtin', owner: b.owner, name: b.name },
        });
    }

    return items;
}

/**
 * Build completion items for file-local SSJS function declarations.
 * @param localFunctions
 */
export function buildLocalFunctionCompletionItems(
    localFunctions: LocalSsjsFunction[],
): CompletionItem[] {
    return localFunctions.map((fn) => {
        const paramList = fn.params
            .map((p) => {
                const pd = fn.paramDocs.get(p);
                return pd?.type ? `${p}: ${pd.type}` : p;
            })
            .join(', ');

        const snippetParams = fn.params.map((p, i) => `\${${i + 1}:${p}}`).join(', ');

        return {
            label: fn.name,
            kind: CompletionItemKind.Function,
            detail: `(local) ${fn.name}(${paramList})`,
            documentation: { kind: MarkupKind.Markdown, value: buildLocalFunctionMarkdown(fn) },
            insertText: `${fn.name}(${snippetParams})`,
            insertTextFormat: InsertTextFormat.Snippet,
            data: { type: 'ssjs-local-function', name: fn.name },
        } satisfies CompletionItem;
    });
}
