/**
 * Protocol-agnostic types for sfmc-language-lsp.
 *
 * We re-use the standard LSP type definitions from vscode-languageserver-types.
 * These are plain TypeScript interfaces/enums with no runtime VS Code dependency,
 * so they work equally in Node (LSP server, MCP server) and browser (Chrome extension).
 */

export type {
    Position,
    Range,
    Diagnostic,
    CompletionItem,
    Hover,
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
    CodeAction,
    TextEdit,
    Location,
    WorkspaceEdit,
} from 'vscode-languageserver-types';

// Export enum constants as values (not just types) so they can be used at runtime
export {
    DiagnosticSeverity,
    CompletionItemKind,
    InsertTextFormat,
    MarkupKind,
    CodeActionKind,
} from 'vscode-languageserver-types';

/** Input context for all language service operations. */
export interface DocumentContext {
    /** Full document text. */
    text: string;
    /** Language identifier: 'ampscript' or 'ssjs'. */
    languageId: 'ampscript' | 'ssjs';
    /** Optional document URI (used for code action edit maps). */
    uri?: string;
}

/** Service-level settings. */
export interface SfmcSettings {
    /** Maximum number of diagnostics to emit per document. Default: 100. */
    maxNumberOfProblems: number;
}

export const DEFAULT_SETTINGS: SfmcSettings = {
    maxNumberOfProblems: 100,
};
