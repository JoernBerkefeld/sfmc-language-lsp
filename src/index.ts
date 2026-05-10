/**
 * sfmc-language-lsp — SFMC Language Service
 *
 * Protocol-agnostic, browser-compatible language intelligence for
 * AMPscript, SSJS, and GTL. Used by the VS Code extension server and
 * the mcp-server-sfmc MCP server.
 */

import type {
    Diagnostic,
    CompletionItem,
    Hover,
    SignatureHelp,
    Location,
    CodeAction,
    Position,
} from './types.js';
import type { SfmcSettings } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';

import { validateAmpscript } from './validators/ampscript.js';
import { validateSsjs } from './validators/ssjs.js';

import {
    getAmpscriptCompletions,
    resolveAmpscriptCompletion,
    functionCompletionItems,
} from './completions/ampscript.js';
import { ssjsCompletionItems, buildLocalFunctionCompletionItems } from './completions/ssjs.js';

import { getAmpscriptHover } from './hover/ampscript.js';
import { getSsjsHover } from './hover/ssjs.js';

import { getAmpscriptSignatureHelp } from './signature/ampscript.js';
import { getSsjsSignatureHelp } from './signature/ssjs.js';

import { extractLocalSsjsFunctions, getSsjsDefinition } from './definitions/ssjs.js';

import { getAmpscriptCodeActions } from './codeActions/ampscript.js';

import { ampscriptFunctions, functionLookup, ampscriptKeywords } from './data/ampscript.js';
import {
    platformFunctions,
    platformMethods,
    ssjsGlobals,
    platformVariableMethods,
    platformResponseMethods,
    platformRequestMethods,
    platformRecipientMethods,
    wsproxyMethods,
    httpMethods,
    httpHeaderMethods,
    dateTimeTimezoneMethods,
    errorUtilMethods,
} from './data/ssjs.js';
import type { SsjsFunction } from './data/ssjs.js';
import { findFunctionContext } from './utils/text.js';

export type { DocumentContext, SfmcSettings } from './types.js';
export { DEFAULT_SETTINGS } from './types.js';
export type { AmpscriptFunction, AmpscriptFunctionParam } from './data/ampscript.js';
export type {
    SsjsFunction,
    SsjsFunctionParam,
    EcmascriptBuiltin,
    SsjsObject,
} from './data/ssjs.js';
export type { LocalSsjsFunction } from './utils/markdown.js';

/** Import DocumentContext type locally for use in this file */
import type { DocumentContext } from './types.js';

/**
 * The main entry point for SFMC language intelligence.
 * Instantiate once; all methods are stateless and re-entrant.
 */
export class SfmcLanguageService {
    // ── Validation ────────────────────────────────────────────────────────────

    /**
     * Validate an AMPscript or SSJS document. Returns LSP Diagnostics.
     * @param doc
     * @param settings
     */
    validate(doc: DocumentContext, settings: SfmcSettings = DEFAULT_SETTINGS): Diagnostic[] {
        if (doc.languageId === 'ssjs') {
            return validateSsjs(doc.text, settings);
        }
        return validateAmpscript(doc.text, settings);
    }

    // ── Completions ───────────────────────────────────────────────────────────

    /**
     * Return completion items at the given cursor position.
     * @param doc
     * @param position
     */
    getCompletions(doc: DocumentContext, position: Position): CompletionItem[] {
        if (doc.languageId === 'ssjs') {
            const localFns = extractLocalSsjsFunctions(doc.text);
            const localItems = buildLocalFunctionCompletionItems(localFns);
            return [...ssjsCompletionItems, ...localItems];
        }
        return getAmpscriptCompletions(doc.text, position);
    }

    /**
     * Resolve documentation for a completion item (lazy-loaded).
     * @param item
     */
    resolveCompletion(item: CompletionItem): CompletionItem {
        return resolveAmpscriptCompletion(item);
    }

    // ── Hover ─────────────────────────────────────────────────────────────────

    /**
     * Return hover documentation at the given line/position.
     * @param doc
     * @param line
     * @param position
     */
    getHover(doc: DocumentContext, line: string, position: Position): Hover | null {
        if (doc.languageId === 'ssjs') {
            const localFns = extractLocalSsjsFunctions(doc.text);
            return getSsjsHover(line, position, localFns);
        }
        return getAmpscriptHover(line, position);
    }

    // ── Signature Help ────────────────────────────────────────────────────────

    /**
     * Return signature help at the given cursor position.
     * @param doc
     * @param textUpToCursor
     */
    getSignatureHelp(doc: DocumentContext, textUpToCursor: string): SignatureHelp | null {
        const context = findFunctionContext(textUpToCursor);
        if (!context) return null;

        if (doc.languageId === 'ssjs') {
            const localFns = extractLocalSsjsFunctions(doc.text);
            return getSsjsSignatureHelp(context, localFns);
        }
        return getAmpscriptSignatureHelp(context);
    }

    // ── Go to Definition ──────────────────────────────────────────────────────

    /**
     * Return the definition location for the word at the given position. Only SSJS is supported.
     * @param doc
     * @param word
     */
    getDefinition(doc: DocumentContext, word: string): Location | null {
        if (doc.languageId !== 'ssjs') return null;
        return getSsjsDefinition(doc.text, doc.uri ?? '', word);
    }

    // ── Code Actions ──────────────────────────────────────────────────────────

    /**
     * Return quick-fix code actions for the given diagnostics.
     * @param doc
     * @param diagnostics
     */
    getCodeActions(doc: DocumentContext, diagnostics: Diagnostic[]): CodeAction[] {
        if (doc.languageId === 'ssjs') return [];
        return getAmpscriptCodeActions(doc.text, doc.uri ?? '', diagnostics);
    }

    // ── Catalog / Lookup (for MCP tools and resources) ────────────────────────

    /**
     * Look up an AMPscript function by name. Case-insensitive.
     * @param name
     */
    lookupAmpscriptFunction(name: string) {
        return functionLookup.get(name.toLowerCase()) ?? null;
    }

    /**
     * Look up an SSJS function or method by name. Case-insensitive. Searches all catalogs.
     * @param name
     */
    lookupSsjsFunction(name: string): SsjsFunction | null {
        const lower = name.toLowerCase();
        const allFns: SsjsFunction[] = [
            ...platformMethods,
            ...platformFunctions,
            ...ssjsGlobals,
            ...platformVariableMethods,
            ...platformResponseMethods,
            ...platformRequestMethods,
            ...platformRecipientMethods,
            ...wsproxyMethods,
            ...httpMethods,
            ...httpHeaderMethods,
            ...dateTimeTimezoneMethods,
            ...errorUtilMethods,
        ];
        return allFns.find((f) => f.name.toLowerCase() === lower) ?? null;
    }

    /** Return all AMPscript functions in the catalog. */
    getAllAmpscriptFunctions() {
        return ampscriptFunctions;
    }

    /** Return all SSJS functions and methods in the catalog. */
    getAllSsjsFunctions(): SsjsFunction[] {
        return [
            ...platformMethods,
            ...platformFunctions,
            ...ssjsGlobals,
            ...platformVariableMethods,
            ...platformResponseMethods,
            ...platformRequestMethods,
            ...platformRecipientMethods,
            ...wsproxyMethods,
            ...httpMethods,
            ...httpHeaderMethods,
            ...dateTimeTimezoneMethods,
            ...errorUtilMethods,
        ];
    }

    /** Return all AMPscript keyword names. */
    getAmpscriptKeywords(): string[] {
        return ampscriptKeywords.map((kw) => kw.name);
    }

    /** Return the ES6+ syntax features that are unsupported in SFMC SSJS. */
    getUnsupportedSsjsSyntax(): Array<{ pattern: string; message: string }> {
        return [
            {
                pattern: 'let/const',
                message:
                    "'let'/'const' declarations are not supported in SFMC SSJS. Use 'var' instead.",
            },
            {
                pattern: '=>',
                message:
                    'Arrow functions are not supported in SFMC SSJS. Use a regular function expression.',
            },
            {
                pattern: '`template literals`',
                message:
                    'Template literals are not supported in SFMC SSJS. Use string concatenation.',
            },
            {
                pattern: 'class',
                message:
                    'Class declarations are not supported in SFMC SSJS. Use constructor functions.',
            },
            { pattern: 'async/await', message: 'Async/await is not supported in SFMC SSJS.' },
        ];
    }

    // ── Static completion catalog access ──────────────────────────────────────

    /** Return the pre-built SSJS completion item catalog. */
    getSsjsCompletionCatalog(): CompletionItem[] {
        return ssjsCompletionItems;
    }

    /** Return the pre-built AMPscript function completion items. */
    getAmpscriptFunctionCompletionItems(): CompletionItem[] {
        return functionCompletionItems;
    }
}

/** Shared singleton instance for callers that don't need separate instances. */
export const sfmcLanguageService = new SfmcLanguageService();

// Re-export validators for direct use
export { validateAmpscript } from './validators/ampscript.js';
export { validateSsjs } from './validators/ssjs.js';
export { validateGtlBlocks } from './validators/gtl.js';
export { extractLocalSsjsFunctions } from './definitions/ssjs.js';
