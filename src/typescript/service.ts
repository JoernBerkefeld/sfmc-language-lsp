/**
 * Embedded TypeScript language service for SSJS.
 *
 * The caller supplies the SSJS globals declarations (`sfmc-globals.d.ts` of ssjs-data) as text;
 * they are the sole built-in library (noLib:true), so the compiler only knows the SFMC-supported
 * API surface. Each SSJS document is tracked in a virtual JS file, and the service returns
 * LSP-typed results. Nothing here touches the file system or the process, so the same code runs
 * in a language server and in a browser.
 */
import * as ts from 'typescript';
import { CompletionItemKind, DiagnosticSeverity, Range } from 'vscode-languageserver-types';
import type {
    CompletionItem,
    Diagnostic,
    Hover,
    Location,
    MarkupContent,
    ParameterInformation,
    Position,
    SignatureHelp,
    SignatureInformation,
} from 'vscode-languageserver-types';
import {
    findPrototypeAssignmentSpan,
    isInsideJsdoc,
    isOffsetInsideComment,
    jsdocCommentRanges,
    parseGlobalCommentDeclarations,
    parsePolyfillDeclarations,
    prototypeMethodNameFor,
    prototypePolyfillBodyRanges,
} from './source-analysis.js';

const GLOBALS_FILENAME = '__sfmc_globals.d.ts';

/**
 * What {@link createSsjsTypeScriptService} needs from its caller.
 */
export interface SsjsTypeScriptServiceOptions {
    /**
     * Text of the SSJS globals declarations: `ssjs-data/sfmc-globals.d.ts`.
     */
    globalsDts: string;
    /**
     * Documentation link for a TypeScript diagnostic code. Diagnostics carry a
     * `codeDescription` only where this returns a URL.
     */
    diagnosticUrl?: (code: number) => string | undefined;
}

/**
 * Completion items together with whether they are the members of an expression.
 */
export interface SsjsCompletionInfo {
    items: CompletionItem[];
    isMemberCompletion: boolean;
}

/**
 * One independent TypeScript-based SSJS language service. A document must be handed to
 * `updateDocument` before it is queried; unknown documents give empty answers.
 */
export interface SsjsTypeScriptService {
    /**
     * Sets the SSJS text of a document. Text identical to the current text changes nothing.
     */
    updateDocument(uri: string, text: string): void;
    /**
     * Forgets a document and its companion declarations.
     */
    removeDocument(uri: string): void;
    getCompletions(uri: string, position: Position): CompletionItem[];
    getCompletionInfo(uri: string, position: Position): SsjsCompletionInfo;
    getDiagnostics(uri: string): Diagnostic[];
    getHover(uri: string, position: Position): Hover | undefined;
    getDefinition(uri: string, position: Position): Location[];
    getReferences(uri: string, position: Position): Location[];
    getSignatureHelp(uri: string, position: Position): SignatureHelp | undefined;
}

interface VirtualFile {
    content: string;
    version: number;
    snapshot: ts.IScriptSnapshot;
}

// ---------------------------------------------------------------------------
// Offset / position utilities
// ---------------------------------------------------------------------------

/**
 * Convert an LSP position to a zero-based character offset in the text.
 * @param text - the source text
 * @param position - the LSP line/character position
 * @returns the character offset within the text
 */
function positionToOffset(text: string, position: Position): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let index = 0; index < position.line && index < lines.length; index++) {
        offset += lines[index].length + 1; // +1 for the '\n'
    }
    return offset + position.character;
}

/**
 * Convert a zero-based character offset to an LSP position.
 * @param text - the source text
 * @param offset - the character offset within the text
 * @returns the LSP line/character position
 */
function offsetToPosition(text: string, offset: number): Position {
    const slice = text.slice(0, Math.max(0, offset));
    const lines = slice.split('\n');
    return {
        line: lines.length - 1,
        character: lines.at(-1)!.length,
    };
}

// ---------------------------------------------------------------------------
// TS kind → LSP CompletionItemKind
// ---------------------------------------------------------------------------

const TS_KIND_MAP: Partial<Record<string, CompletionItemKind>> = {
    [ts.ScriptElementKind.functionElement]: CompletionItemKind.Function,
    [ts.ScriptElementKind.memberFunctionElement]: CompletionItemKind.Method,
    [ts.ScriptElementKind.memberGetAccessorElement]: CompletionItemKind.Property,
    [ts.ScriptElementKind.memberSetAccessorElement]: CompletionItemKind.Property,
    [ts.ScriptElementKind.memberVariableElement]: CompletionItemKind.Field,
    [ts.ScriptElementKind.constructorImplementationElement]: CompletionItemKind.Constructor,
    [ts.ScriptElementKind.classElement]: CompletionItemKind.Class,
    [ts.ScriptElementKind.interfaceElement]: CompletionItemKind.Interface,
    [ts.ScriptElementKind.enumElement]: CompletionItemKind.Enum,
    [ts.ScriptElementKind.enumMemberElement]: CompletionItemKind.EnumMember,
    [ts.ScriptElementKind.moduleElement]: CompletionItemKind.Module,
    [ts.ScriptElementKind.alias]: CompletionItemKind.Reference,
    [ts.ScriptElementKind.letElement]: CompletionItemKind.Variable,
    [ts.ScriptElementKind.constElement]: CompletionItemKind.Constant,
    [ts.ScriptElementKind.variableElement]: CompletionItemKind.Variable,
    [ts.ScriptElementKind.localVariableElement]: CompletionItemKind.Variable,
    [ts.ScriptElementKind.parameterElement]: CompletionItemKind.Variable,
    [ts.ScriptElementKind.typeElement]: CompletionItemKind.TypeParameter,
    [ts.ScriptElementKind.keyword]: CompletionItemKind.Keyword,
};

/**
 * Map a TypeScript script-element kind to an LSP completion item kind.
 * @param kind - the TypeScript `ScriptElementKind` value
 * @returns the corresponding LSP `CompletionItemKind`
 */
function tsKindToLsp(kind: string): CompletionItemKind {
    return TS_KIND_MAP[kind] ?? CompletionItemKind.Text;
}

// ---------------------------------------------------------------------------
// TS diagnostic category → LSP severity
// ---------------------------------------------------------------------------

/**
 * Map a TypeScript diagnostic category to an LSP diagnostic severity.
 * @param category - the TypeScript `DiagnosticCategory` value
 * @returns the corresponding LSP `DiagnosticSeverity`
 */
function tsCategoryToSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
        case ts.DiagnosticCategory.Error: {
            return DiagnosticSeverity.Error;
        }
        case ts.DiagnosticCategory.Warning: {
            return DiagnosticSeverity.Warning;
        }
        case ts.DiagnosticCategory.Suggestion: {
            return DiagnosticSeverity.Hint;
        }
        default: {
            return DiagnosticSeverity.Information;
        }
    }
}

/**
 * Flatten a TypeScript diagnostic message chain into a single newline-joined string.
 * @param message - the TypeScript diagnostic message chain
 * @returns the flattened message text
 */
function flattenDiagnosticMessageText(message: ts.DiagnosticMessageChain): string {
    let text = message.messageText;
    if (message.next) {
        for (const next of message.next) {
            text += '\n' + flattenDiagnosticMessageText(next);
        }
    }
    return text;
}

/**
 * Create a TypeScript-based SSJS language service. All state (virtual files, document names,
 * the active document and the TypeScript language service itself) belongs to the returned
 * instance; two instances share nothing.
 * @param options - globals declarations and optional diagnostic documentation links
 * @returns the service instance
 */
export function createSsjsTypeScriptService(
    options: SsjsTypeScriptServiceOptions,
): SsjsTypeScriptService {
    const { globalsDts, diagnosticUrl } = options;

    // ---------------------------------------------------------------------------
    // Virtual file system
    // ---------------------------------------------------------------------------

    const virtualFiles = new Map<string, VirtualFile>([
        [
            GLOBALS_FILENAME,
            { content: globalsDts, version: 1, snapshot: ts.ScriptSnapshot.fromString(globalsDts) },
        ],
    ]);

    // One counter for all virtual files of this instance. A companion file that is deleted and
    // created again must not restart at an earlier version of the same name, or TypeScript
    // keeps what it read for that version.
    const versions = { last: 1 };

    /**
     * Create or update a virtual in-memory file, giving it a new version and snapshot.
     * Unchanged content keeps its version, so TypeScript does not check it again.
     * @param name - the virtual filename
     * @param content - the file content
     */
    function setVirtualFile(name: string, content: string): void {
        const existing = virtualFiles.get(name);
        if (existing?.content === content) return;
        versions.last += 1;
        virtualFiles.set(name, {
            content,
            version: versions.last,
            snapshot: ts.ScriptSnapshot.fromString(content),
        });
    }

    // ---------------------------------------------------------------------------
    // URI → virtual filename mapping
    // Each SSJS document gets a stable synthetic .js filename so the TS service
    // can process it (TS only handles .js/.ts/.d.ts extensions).
    // Each document may also have a companion .globals.d.ts file that holds
    // ambient declarations derived from ESLint-style /* global NAME */ comments.
    // ---------------------------------------------------------------------------

    // Holder so the counter can be bumped without reassigning a top-level variable
    // inside a function (unicorn/no-top-level-assignment-in-function).
    const counters = { document: 0 };
    // The document the language service is currently answering for. Only this
    // document's virtual files (plus the shared globals) are exposed to TypeScript
    // via getScriptFileNames, so top-level `var` declarations in *other* open SSJS
    // documents cannot collide with this one (which otherwise raises ts2403
    // "Subsequent variable declarations must have the same type").
    const activeDocument: { js: string | undefined } = { js: undefined };
    const uriToVirtualName = new Map<string, string>();
    const uriToGlobalsName = new Map<string, string>();
    const uriToPolyfillsName = new Map<string, string>();

    /**
     * Get (or lazily assign) the stable synthetic `.js` filename for a document URI.
     * @param uri - the LSP document URI
     * @returns the virtual `.js` filename for that document
     */
    function virtualNameForUri(uri: string): string {
        let name = uriToVirtualName.get(uri);
        if (!name) {
            name = `__doc_${counters.document}.js`;
            counters.document += 1;
            uriToVirtualName.set(uri, name);
        }
        return name;
    }

    /**
     * Mark a document's virtual `.js` file as the one the language service should
     * answer for. Only this document (plus the shared globals) is exposed via
     * `getScriptFileNames`, isolating its top-level declarations from other open
     * SSJS documents (prevents ts2403 cross-file `var` collisions).
     * @param name - the active document's virtual `.js` filename, or undefined
     */
    function setActiveDocument(name: string | undefined): void {
        activeDocument.js = name;
    }

    /**
     * Reverse lookup: map a virtual filename produced by `virtualNameForUri` (or its
     * `.polyfills.d.ts` / `.globals.d.ts` companions) back to the originating LSP
     * document URI. Returns undefined for the shared globals file or unknown names.
     * @param fileName - virtual filename from the TS language service
     * @returns the originating document URI, or undefined
     */
    function uriForVirtualName(fileName: string): string | undefined {
        // Companion files share the document's counter; normalize to the base .js name.
        const base = fileName
            .replace(/\.polyfills\.d\.ts$/, '.js')
            .replace(/\.globals\.d\.ts$/, '.js');
        for (const [uri, name] of uriToVirtualName) {
            if (name === base) return uri;
        }
        return undefined;
    }

    /**
     * Get (or lazily assign) the companion `.globals.d.ts` filename for a document.
     * @param uri - the LSP document URI
     * @returns the virtual globals declaration filename for that document
     */
    function globalsNameForUri(uri: string): string {
        let name = uriToGlobalsName.get(uri);
        if (!name) {
            // Derived from the JS virtual name so the two always share the same counter.
            const documentName = virtualNameForUri(uri);
            name = documentName.replace(/\.js$/, '.globals.d.ts');
            uriToGlobalsName.set(uri, name);
        }
        return name;
    }

    /**
     * Get (or lazily assign) the companion `.polyfills.d.ts` filename for a document.
     * @param uri - the LSP document URI
     * @returns the virtual polyfills declaration filename for that document
     */
    function polyfillsNameForUri(uri: string): string {
        let name = uriToPolyfillsName.get(uri);
        if (!name) {
            // Derived from the JS virtual name so the two always share the same counter.
            const documentName = virtualNameForUri(uri);
            name = documentName.replace(/\.js$/, '.polyfills.d.ts');
            uriToPolyfillsName.set(uri, name);
        }
        return name;
    }

    // ---------------------------------------------------------------------------
    // Language service host
    // ---------------------------------------------------------------------------

    const host: ts.LanguageServiceHost = {
        getCompilationSettings(): ts.CompilerOptions {
            return {
                allowJs: true,
                checkJs: true,
                noLib: true,
                target: ts.ScriptTarget.ES5,
                strict: false,
                noEmit: true,
                noResolve: true,
                skipLibCheck: false,
            };
        },

        getScriptFileNames(): string[] {
            // Expose only the shared globals plus the *active* document's own virtual
            // files. Including every open SSJS document in one program makes their
            // top-level `var` declarations collide in the shared global scope
            // (ts2403). Scoping to the active document keeps each file isolated.
            const active = activeDocument.js;
            if (!active) {
                // Spread the Map (not `.keys()`) so neither unicorn/prefer-spread nor
                // unicorn/prefer-iterator-to-array fires, then take each entry's key.
                return [...virtualFiles].map(([fileName]) => fileName);
            }
            const activeFiles = new Set([
                GLOBALS_FILENAME,
                active,
                active.replace(/\.js$/, '.globals.d.ts'),
                active.replace(/\.js$/, '.polyfills.d.ts'),
            ]);
            return [...virtualFiles]
                .map(([fileName]) => fileName)
                .filter((fileName) => activeFiles.has(fileName));
        },

        getScriptVersion(fileName: string): string {
            return String(virtualFiles.get(fileName)?.version ?? 0);
        },

        getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
            return virtualFiles.get(fileName)?.snapshot;
        },

        getCurrentDirectory(): string {
            return '/';
        },

        getDefaultLibFileName(): string {
            return GLOBALS_FILENAME;
        },

        fileExists(fileName: string): boolean {
            return virtualFiles.has(fileName);
        },

        readFile(fileName: string): string | undefined {
            return virtualFiles.get(fileName)?.content;
        },

        readDirectory(): string[] {
            return [];
        },

        directoryExists(): boolean {
            return false;
        },

        getDirectories(): string[] {
            return [];
        },
    };

    const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());

    /**
     * Notify the service that a SSJS document's content has changed.
     * Must be called before any completions / diagnostics / hover for that URI.
     *
     * Also scans the text for ESLint-style global-comment annotations
     * (the `global` and `globals` block-comment forms) and maintains a
     * per-document companion `.globals.d.ts` virtual file containing
     * the corresponding `declare var` statements so the TypeScript checker
     * does not emit "Cannot find name" errors for those identifiers.
     * @param uri - LSP document URI
     * @param text - full document text
     */
    function updateSsjsDocument(uri: string, text: string): void {
        setVirtualFile(virtualNameForUri(uri), text);

        const declarations = parseGlobalCommentDeclarations(text);
        const globalsName = globalsNameForUri(uri);
        if (declarations) {
            setVirtualFile(globalsName, declarations);
        } else {
            // No global comments — remove any stale companion file from a previous
            // document version so old names don't linger in the TS service.
            virtualFiles.delete(globalsName);
        }

        const polyfills = parsePolyfillDeclarations(text);
        const polyfillsName = polyfillsNameForUri(uri);
        if (polyfills) {
            setVirtualFile(polyfillsName, polyfills);
        } else {
            // No prototype polyfills — drop any stale companion file so members
            // from a previous document version don't linger in the TS service.
            virtualFiles.delete(polyfillsName);
        }
    }

    /**
     * Remove a SSJS document from the virtual FS (e.g. on close).
     * Also removes the companion globals declaration file if one exists.
     * @param uri - LSP document URI
     */
    function removeSsjsDocument(uri: string): void {
        const name = uriToVirtualName.get(uri);
        if (name) {
            virtualFiles.delete(name);
            uriToVirtualName.delete(uri);
            if (activeDocument.js === name) setActiveDocument(undefined);
        }
        const globalsName = uriToGlobalsName.get(uri);
        if (globalsName) {
            virtualFiles.delete(globalsName);
            uriToGlobalsName.delete(uri);
        }
        const polyfillsName = uriToPolyfillsName.get(uri);
        if (!polyfillsName) {
            return;
        }

        virtualFiles.delete(polyfillsName);
        uriToPolyfillsName.delete(uri);
    }

    /**
     * Return LSP CompletionItems from the embedded TypeScript language service
     * at the given cursor position.  Returns an empty array when the service has
     * no results or the document is not known.
     * @param uri - LSP document URI
     * @param position - cursor position in the document
     * @returns LSP completion items, or an empty array if none are available
     */
    function getSsjsCompletions(uri: string, position: Position): CompletionItem[] {
        return getSsjsCompletionInfo(uri, position).items;
    }

    /**
     * Same as getSsjsCompletions, but also returns whether the completion was
     * triggered for member access (e.g. `de.` or `Platform.Function.`).
     * Use this in server.ts to decide whether to suppress SFMC global completions
     * that would pollute member-completion lists.
     * @param uri - LSP document URI
     * @param position - cursor position in the document
     * @returns completion items and a flag indicating whether this is a member-access completion
     */
    function getSsjsCompletionInfo(
        uri: string,
        position: Position,
    ): { items: CompletionItem[]; isMemberCompletion: boolean } {
        const name = uriToVirtualName.get(uri);
        if (!name) return { items: [], isMemberCompletion: false };
        setActiveDocument(name);
        const file = virtualFiles.get(name);
        if (!file) return { items: [], isMemberCompletion: false };

        const offset = positionToOffset(file.content, position);
        let info: ts.CompletionInfo | undefined;
        try {
            info = languageService.getCompletionsAtPosition(name, offset, {
                includeCompletionsWithInsertText: true,
                includeCompletionsForModuleExports: false,
            });
        } catch {
            return { items: [], isMemberCompletion: false };
        }
        if (!info) return { items: [], isMemberCompletion: false };

        const items = info.entries.map((entry) => {
            const item: CompletionItem = {
                label: entry.name,
                kind: tsKindToLsp(entry.kind),
                sortText: entry.sortText,
            };
            if (entry.kindModifiers?.includes('deprecated')) {
                item.tags = [1 /* CompletionItemTag.Deprecated */];
            }
            return item;
        });

        return { items, isMemberCompletion: info.isMemberCompletion };
    }

    /**
     * Return LSP Diagnostics from the embedded TypeScript language service for the given SSJS document URI.
     * @param uri - LSP document URI
     * @returns LSP diagnostics, or an empty array if none are found
     */
    function getSsjsDiagnostics(uri: string): Diagnostic[] {
        const name = uriToVirtualName.get(uri);
        if (!name) return [];
        setActiveDocument(name);
        const file = virtualFiles.get(name);
        if (!file) return [];

        let tsDiags: ts.Diagnostic[];
        try {
            tsDiags = [
                ...languageService.getSyntacticDiagnostics(name),
                ...languageService.getSemanticDiagnostics(name),
            ];
        } catch {
            return [];
        }

        const jsdocRanges = jsdocCommentRanges(file.content);
        const polyfillBodyRanges = prototypePolyfillBodyRanges(file.content);

        const results: Diagnostic[] = [];
        for (const d of tsDiags) {
            if (d.start === undefined || d.length === undefined) continue;
            // Suppress "cannot find name" diagnostics that fall inside a JSDoc
            // comment. SSJS authors routinely reference SFMC types (e.g. WSProxy) or
            // user `@typedef`s in `@param`/`@property`/`@returns` tags; with
            // `checkJs` enabled TypeScript flags those undeclared names even though
            // they have no effect on the executed code.
            // 8029: "JSDoc '@param' tag has name 'X', but there is no parameter with
            // that name." Shipped polyfills document rest varargs collected via
            // `arguments` with `@param {...*} [items]` (e.g. splice/bind), which have
            // no matching named parameter — valid SSJS documentation, not an error.
            if ([2304, 2552, 2300, 8029].includes(d.code) && isInsideJsdoc(d.start, jsdocRanges)) {
                continue;
            }
            // Suppress `this`-context errors inside self-guarded prototype-polyfill
            // bodies. `X = X || function () { … this.length … return this }` loses the
            // declared `this: any[]` contextual type through the `||`, producing
            // ts2339 ("Property 'length' does not exist") and ts2322 ("Type 'this'
            // is not assignable"). The bodies are valid SSJS polyfills.
            if (
                (d.code === 2339 || d.code === 2322) &&
                isInsideJsdoc(d.start, polyfillBodyRanges)
            ) {
                const text =
                    typeof d.messageText === 'string'
                        ? d.messageText
                        : flattenDiagnosticMessageText(d.messageText);
                if (text.includes('this') || text.includes("'length'")) continue;
            }
            const start = offsetToPosition(file.content, d.start);
            const end = offsetToPosition(file.content, d.start + d.length);
            const message =
                typeof d.messageText === 'string'
                    ? d.messageText
                    : flattenDiagnosticMessageText(d.messageText);
            const href = diagnosticUrl?.(d.code);
            results.push({
                range: Range.create(start, end),
                severity: tsCategoryToSeverity(d.category),
                source: 'sfmc-ts',
                message,
                code: d.code,
                ...(href && { codeDescription: { href } }),
            });
        }
        return results;
    }

    /**
     * Return an LSP Hover from the embedded TypeScript language service at the
     * given cursor position.  Returns null when there is nothing to show.
     * @param uri - LSP document URI
     * @param position - cursor position in the document
     * @returns LSP Hover with markdown content, or undefined if nothing to show
     */
    function getSsjsHover(uri: string, position: Position): Hover | undefined {
        const name = uriToVirtualName.get(uri);
        if (!name) return undefined;
        setActiveDocument(name);
        const file = virtualFiles.get(name);
        if (!file) return undefined;

        const offset = positionToOffset(file.content, position);
        let info: ts.QuickInfo | undefined;
        try {
            info = languageService.getQuickInfoAtPosition(name, offset);
        } catch {
            return undefined;
        }
        if (!info) return undefined;

        const sig = info.displayParts?.map((p) => p.text).join('') ?? '';
        const documentation = info.documentation?.map((p) => p.text).join('') ?? '';

        const parts: string[] = [];
        if (sig) parts.push('```typescript\n' + sig + '\n```');
        if (documentation) parts.push(documentation);

        // Render JSDoc tags to match native TypeScript hover style.
        const tags = info.tags ?? [];
        const tagLines: string[] = [];
        for (const tag of tags) {
            const tagText = tag.text?.map((p) => p.text).join('') ?? '';
            if (tag.name === 'deprecated') {
                tagLines.push(tagText ? `*Deprecated:* ${tagText}` : '*Deprecated*');
            } else if (tag.name === 'remarks') {
                if (tagText) tagLines.push(tagText);
            } else if (tagText && tag.name === 'param') {
                // TS returns tag text as "paramName - description"; match native TS format:
                // @param `name` — description
                const spaceIndex = tagText.indexOf(' ');
                const pName = spaceIndex === -1 ? tagText : tagText.slice(0, spaceIndex);
                const pDesc =
                    spaceIndex === -1 ? '' : tagText.slice(spaceIndex + 1).replace(/^[-–]\s*/, '');
                tagLines.push(pDesc ? `@param \`${pName}\` — ${pDesc}` : `@param \`${pName}\``);
            } else if (tagText && (tag.name === 'returns' || tag.name === 'return')) {
                tagLines.push(`@returns ${tagText}`);
            } else if (tagText && tag.name === 'example') {
                tagLines.push(`@example\n\`\`\`javascript\n${tagText.trim()}\n\`\`\``);
            } else if (tagText) {
                tagLines.push(`*${tag.name}:* ${tagText}`);
            }
        }
        if (tagLines.length > 0) parts.push(tagLines.join('\n\n'));

        if (parts.length === 0) return undefined;

        const content: MarkupContent = { kind: 'markdown', value: parts.join('\n\n') };

        let range: Range | undefined;
        if (info.textSpan) {
            const start = offsetToPosition(file.content, info.textSpan.start);
            const end = offsetToPosition(file.content, info.textSpan.start + info.textSpan.length);
            range = Range.create(start, end);
        }

        return range ? { contents: content, range } : { contents: content };
    }

    /**
     * Return LSP definition Location(s) from the embedded TypeScript language
     * service at the given cursor position. This gives `.ssjs` files the same
     * go-to-definition quality as `.js` (top-level functions, locals, object
     * members, and prototype-polyfilled methods).
     *
     * Definitions that resolve into a synthetic companion file (the per-document
     * `.polyfills.d.ts` interface-merge) are remapped to the real
     * `Ctor.prototype.method = …` assignment in the originating document, so the
     * user navigates to their own polyfill rather than a generated declaration.
     * @param uri - LSP document URI
     * @param position - cursor position in the document
     * @returns an array of LSP Locations (possibly empty)
     */
    function getSsjsDefinition(uri: string, position: Position): Location[] {
        const name = uriToVirtualName.get(uri);
        const file = name ? virtualFiles.get(name) : undefined;
        if (!name || !file) return [];
        setActiveDocument(name);

        const offset = positionToOffset(file.content, position);
        let defs: readonly ts.DefinitionInfo[] | undefined;
        try {
            defs = languageService.getDefinitionAtPosition(name, offset);
        } catch {
            return [];
        }
        if (!defs || defs.length === 0) return [];

        const locations: Location[] = [];
        for (const definition of defs) {
            const targetUri = uriForVirtualName(definition.fileName);
            // Skip definitions in the shared globals file — those are ambient API
            // declarations with no navigable source for the user.
            if (!targetUri) continue;
            const targetFile = virtualFiles.get(virtualNameForUri(targetUri));
            if (!targetFile) continue;

            // A hit inside the synthetic polyfills file points at the generated
            // interface member; redirect to the real prototype assignment.
            const isPolyfillFile = definition.fileName.endsWith('.polyfills.d.ts');
            let span = isPolyfillFile
                ? findPrototypeAssignmentSpan(targetFile.content, definition.name)
                : { start: definition.textSpan.start, length: definition.textSpan.length };
            if (!span) continue;

            // For a `Ctor.prototype.method = function …` polyfill that carries a
            // leading JSDoc block, TypeScript resolves the method's definition into
            // the JSDoc comment (the first textual occurrence of the name inside the
            // `/** … */`) rather than the assignment identifier. Redirect any
            // same-document definition whose span lands inside a comment to the real
            // prototype assignment so go-to-definition lands on the code line.
            if (!isPolyfillFile && isOffsetInsideComment(targetFile.content, span.start)) {
                const assignmentSpan = findPrototypeAssignmentSpan(
                    targetFile.content,
                    definition.name,
                );
                if (assignmentSpan) span = assignmentSpan;
            }

            locations.push({
                uri: targetUri,
                range: Range.create(
                    offsetToPosition(targetFile.content, span.start),
                    offsetToPosition(targetFile.content, span.start + span.length),
                ),
            });
        }
        return locations;
    }

    /**
     * Return LSP reference Location(s) from the embedded TypeScript language
     * service at the given cursor position — powering Find All References for
     * `.ssjs` files (top-level functions, locals, object members, and
     * prototype-polyfilled methods).
     *
     * References that resolve into the synthetic per-document `.polyfills.d.ts`
     * companion are remapped to the real `Ctor.prototype.method = …` assignment in
     * the originating document, matching the go-to-definition remap, so the user
     * never sees a generated declaration in the results.
     * @param uri - LSP document URI
     * @param position - cursor position in the document
     * @returns an array of LSP Locations (possibly empty)
     */
    function getSsjsReferences(uri: string, position: Position): Location[] {
        const name = uriToVirtualName.get(uri);
        const file = name ? virtualFiles.get(name) : undefined;
        if (!name || !file) return [];
        setActiveDocument(name);

        const offset = positionToOffset(file.content, position);
        let references: ts.ReferenceEntry[] | undefined;
        try {
            references = languageService.getReferencesAtPosition(name, offset);
        } catch {
            return [];
        }
        if (!references || references.length === 0) return [];

        const locations: Location[] = [];
        const seen = new Set<string>();
        for (const reference of references) {
            const targetUri = uriForVirtualName(reference.fileName);
            // Skip references in the shared globals file — ambient API declarations
            // with no navigable source for the user.
            if (!targetUri) continue;
            const targetFile = virtualFiles.get(virtualNameForUri(targetUri));
            if (!targetFile) continue;

            // A hit inside the synthetic polyfills file points at the generated
            // interface member; redirect to the real prototype assignment.
            const isPolyfillFile = reference.fileName.endsWith('.polyfills.d.ts');
            const span = isPolyfillFile
                ? findPrototypeAssignmentSpan(
                      targetFile.content,
                      prototypeMethodNameFor(targetFile.content, reference.textSpan.start),
                  )
                : { start: reference.textSpan.start, length: reference.textSpan.length };
            if (!span) continue;

            const start = offsetToPosition(targetFile.content, span.start);
            const end = offsetToPosition(targetFile.content, span.start + span.length);
            // De-duplicate (the polyfill remap can collapse several synthetic hits
            // onto the same assignment span).
            const key = `${targetUri}:${start.line}:${start.character}:${end.line}:${end.character}`;
            if (seen.has(key)) continue;
            seen.add(key);

            locations.push({ uri: targetUri, range: Range.create(start, end) });
        }
        return locations;
    }

    /**
     * Return an LSP SignatureHelp from the embedded TypeScript language service at
     * the given cursor position.  Returns undefined when the cursor is not inside a
     * function call or TypeScript has no type information for it.
     *
     * Uses TypeScript's native display-part machinery to build the label and
     * numeric `[startOffset, endOffset]` parameter spans so VS Code highlights
     * the active parameter correctly.
     * @param uri - LSP document URI
     * @param position - cursor position in the document
     * @returns LSP SignatureHelp, or undefined if the cursor is not inside a function call
     */
    function getSsjsSignatureHelp(uri: string, position: Position): SignatureHelp | undefined {
        const name = uriToVirtualName.get(uri);
        const file = name ? virtualFiles.get(name) : undefined;
        if (!name || !file) return undefined;
        setActiveDocument(name);

        const offset = positionToOffset(file.content, position);
        let info: ts.SignatureHelpItems | undefined;
        try {
            info = languageService.getSignatureHelpItems(name, offset, {});
        } catch {
            return undefined;
        }
        if (!info || info.items.length === 0) return undefined;

        const signatures: SignatureInformation[] = info.items.map((item) => {
            const prefixText = item.prefixDisplayParts.map((p) => p.text).join('');
            const suffixText = item.suffixDisplayParts.map((p) => p.text).join('');
            const separatorText = item.separatorDisplayParts.map((p) => p.text).join('');

            // Build label and compute exact [start, end] byte-offsets for each parameter.
            // Note: span is computed independently from docText — changing documentation
            // to MarkupContent does not affect active-parameter highlighting.
            let cursor = prefixText.length;
            const parameters: ParameterInformation[] = item.parameters.map((p, index) => {
                if (index > 0) cursor += separatorText.length;
                const parameterText = p.displayParts.map((d) => d.text).join('');
                const span: [number, number] = [cursor, cursor + parameterText.length];
                cursor += parameterText.length;
                const rawDocument_ = p.documentation?.map((d) => d.text).join('');
                const documentation: MarkupContent | undefined = rawDocument_
                    ? { kind: 'markdown', value: rawDocument_ }
                    : undefined;
                return { label: span, documentation };
            });

            const parameterParts = item.parameters
                .map((p) => p.displayParts.map((d) => d.text).join(''))
                .join(separatorText);
            const label = prefixText + parameterParts + suffixText;

            const rawDocument = item.documentation?.map((d) => d.text).join('');
            const documentation: MarkupContent | undefined = rawDocument
                ? { kind: 'markdown', value: rawDocument }
                : undefined;
            return { label, documentation, parameters };
        });

        return {
            signatures,
            activeSignature: info.selectedItemIndex,
            activeParameter: info.argumentIndex,
        };
    }

    return {
        updateDocument: updateSsjsDocument,
        removeDocument: removeSsjsDocument,
        getCompletions: getSsjsCompletions,
        getCompletionInfo: getSsjsCompletionInfo,
        getDiagnostics: getSsjsDiagnostics,
        getHover: getSsjsHover,
        getDefinition: getSsjsDefinition,
        getReferences: getSsjsReferences,
        getSignatureHelp: getSsjsSignatureHelp,
    };
}
