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
    coreRequestMethods,
    platformRecipientMethods,
    coreLibraryObjects,
    httpMethods,
    httpHeaderMethods,
    dateTimeMethods,
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
    const items: CompletionItem[] = Array.from(ssjsGlobals, (fn) => ({
        label: fn.name,
        kind: CompletionItemKind.Function,
        detail: `(global) ${fn.name}`,
        documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
        insertText: buildSsjsFunctionSnippet(fn),
        insertTextFormat: InsertTextFormat.Snippet,
        data: { type: 'ssjs-global', name: fn.name },
    }));

    for (const fn of platformFunctions) {
        const doc = { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) };
        items.push({
            label: `Platform.Function.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `Platform.Function.${fn.name}`,
            documentation: doc,
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `Platform.Function.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-platform-function', name: fn.name },
        });
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

    // Platform.Request members (CLR-backed). These are a DIFFERENT set from the
    // Core `Request` object below — do NOT emit a bare `Request.` shorthand here.
    for (const fn of platformRequestMethods) {
        const doc = { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) };
        items.push({
            label: `Platform.Request.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `Platform.Request.${fn.name}`,
            documentation: doc,
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `Platform.Request.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-platform-request', name: fn.name },
        });
    }

    // Core `Request` object members (URL, PagePath, Method, GetQueryStringParameter,
    // …). This is the ONLY code path that emits bare `Request.` completions — sourced
    // from coreRequestMethods, not platformRequestMethods.
    for (const fn of coreRequestMethods) {
        items.push({
            label: `Request.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `Request.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `Request.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-core-request', name: fn.name },
        });
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

    for (const fn of dateTimeMethods) {
        items.push({
            label: `DateTime.${fn.name}`,
            kind: CompletionItemKind.Method,
            detail: `DateTime.${fn.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(fn) },
            insertText: buildSsjsFunctionSnippet(fn),
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: `DateTime.${fn.name} ${fn.name}`,
            data: { type: 'ssjs-datetime', name: fn.name },
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

    for (const c of scriptUtilConstructors) {
        items.push({
            label: `Script.Util.${c.name}`,
            kind: CompletionItemKind.Constructor,
            detail: `new Script.Util.${c.name}`,
            documentation: { kind: MarkupKind.Markdown, value: buildSsjsFunctionMarkdown(c) },
            insertText: `new ${buildSsjsFunctionSnippet(c)}`,
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

    // Static/namespace owners whose members are legitimately accessed as
    // `Owner.member` (e.g. Math.floor, Date.now, Object.defineProperty).
    const STATIC_ECMA_OWNERS = new Set(['Math', 'Date', 'Object']);

    for (const b of ecmascriptBuiltins) {
        // Skip prototype/instance members. They are accessed on a VALUE
        // (e.g. "foo".charAt, myArr.push, myRegExp.test) and are provided by
        // the TypeScript service on the instance type — never as a top-level
        // `Owner.member` identifier. Emitting them here produced misleading
        // global completions like `String.charAt`, `Array.push`, and
        // `RegExp.test` (RegExp's members live on the instance, not the
        // constructor). The owner is either `X.prototype` or, for RegExp,
        // the bare constructor name with instance-only members.
        const isPrototypeMember = b.owner.endsWith('.prototype') || b.owner === 'RegExp';
        if (isPrototypeMember) {
            continue;
        }

        // `Global` owner members are bare global identifiers (parseInt,
        // isNaN, RegExp constructor) — NOT `Global.parseInt`.
        const isStaticOwner = STATIC_ECMA_OWNERS.has(b.owner);
        const label = isStaticOwner ? `${b.owner}.${b.name}` : b.name;

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
 * @param localFunctions - Local function declarations extracted from the document.
 * @returns Array of completion items for each local function.
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
