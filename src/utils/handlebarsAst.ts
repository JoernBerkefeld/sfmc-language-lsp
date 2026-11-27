/**
 * Thin wrapper around the `sfmc-handlebars-parser` for Marketing Cloud Next.
 *
 * Provides a safe parse that converts parser exceptions into a structured
 * result, plus helpers to map the parser's 1-based-line / 0-based-column
 * locations onto LSP Positions and to walk every node in the AST.
 */

import { parse, type AST } from 'sfmc-handlebars-parser';
import type { Position, Range } from 'vscode-languageserver-types';
import {
    findHandlebarsBlockIssue,
    findUnclosedMustache,
    scanHandlebarsBlockTags,
} from './handlebarsBlocks.js';

/**
 * Parser messages about block structure (sfmc-handlebars-parser >= 0.2.0).
 */
const BLOCK_ERROR_PATTERN = /^Unclosed block |does not close |has no matching /;

/**
 * A node in the Handlebars AST (re-exported for validator consumers).
 */
export type HandlebarsAstNode = AST.Node;

/**
 * A Handlebars syntax error with an LSP range describing where it occurred.
 */
export interface HandlebarsSyntaxError {
    message: string;
    range: Range;
}

/**
 * Result of attempting to parse a Handlebars document.
 */
export interface HandlebarsParseResult {
    /**
     * The parsed program, or null when a syntax error prevented parsing.
     */
    ast: AST.Program | null;
    /**
     * The syntax error, when parsing failed.
     */
    error: HandlebarsSyntaxError | null;
}

/**
 * Jison-style location attached to parser exceptions.
 */
interface JisonLocation {
    first_line: number;
    first_column: number;
    last_line: number;
    last_column: number;
}

/**
 * Convert a parser AST position (1-based line, 0-based column) to an LSP
 * Position (0-based line and character).
 * @param pos - The AST position.
 * @returns The equivalent LSP Position.
 */
export function astPositionToLsp(pos: AST.Position): Position {
    return { line: Math.max(0, pos.line - 1), character: Math.max(0, pos.column) };
}

/**
 * Convert an AST node's source location to an LSP Range.
 * @param loc - The AST source location.
 * @returns The equivalent LSP Range.
 */
export function astLocToRange(loc: AST.SourceLocation): Range {
    return { start: astPositionToLsp(loc.start), end: astPositionToLsp(loc.end) };
}

/**
 * Parse Handlebars source, returning either the AST or a structured syntax error.
 * Never throws.
 * @param text - The (already sanitized) Handlebars document text.
 * @returns The parse result.
 */
export function parseHandlebars(text: string): HandlebarsParseResult {
    try {
        const ast = parse(text);
        return { ast, error: null };
    } catch (error) {
        return { ast: null, error: toSyntaxError(error, text) };
    }
}

/**
 * Convert a thrown parser exception into a structured syntax error with an LSP range.
 * @param ex - The thrown value.
 * @param text - The source text, used to derive a fallback range.
 * @returns A structured syntax error.
 */
function toSyntaxError(ex: unknown, text: string): HandlebarsSyntaxError {
    const error = ex as {
        message?: string;
        hash?: { loc?: JisonLocation };
        lineNumber?: number;
        column?: number;
    };
    const rawMessage = error.message ?? 'Handlebars syntax error.';
    // The parser's multi-line "Parse error on line N:\n<src>\n---^" message is
    // noisy for an editor; keep only the final, human-readable explanation.
    const lines = rawMessage.split('\n').filter((l) => l.trim().length > 0);
    const message = lines.at(-1) ?? rawMessage;
    const loc = error.hash?.loc;

    // Block-structure errors (unclosed, mismatched or stray tags): the parser
    // reports them where upstream does (the opener, or the end of the document);
    // the editor marks the tag that causes them and names the line it opened on.
    if (BLOCK_ERROR_PATTERN.test(message)) {
        const issue = findHandlebarsBlockIssue(scanHandlebarsBlockTags(text), (offset) =>
            lineAt(text, offset),
        );
        if (issue) {
            const { tag } = issue;
            const nameEnd = tag.name ? tag.nameStart + tag.name.length : tag.end;
            return { message: issue.message, range: rangeOf(text, tag.nameStart, nameEnd) };
        }
        // Balanced tags, yet the parser lost a closing tag: an expression without
        // `}}` swallowed it (`{{#if a}}{{upp{{/if}}`). Point at that expression.
        const unclosed = findUnclosedMustache(text);
        if (unclosed) {
            const typed = /^\{\{\{?[^\s{}]*/.exec(text.slice(unclosed.start))?.[0] ?? '{{';
            return {
                message: `Unclosed expression ${typed}: expected '}}'.`,
                range: rangeOf(text, unclosed.start, unclosed.start + 2),
            };
        }
    }

    // Exception-class parser errors carry a 1-based line and 0-based column.
    if (!loc && typeof error.lineNumber === 'number' && typeof error.column === 'number') {
        const offset = offsetAt(text, error.lineNumber - 1, error.column);
        const word = /^[^\s{}()~]+/.exec(text.slice(offset))?.[0] ?? '';
        return { message, range: rangeOf(text, offset, offset + Math.max(1, word.length)) };
    }

    if (loc) {
        const start: Position = {
            line: Math.max(0, loc.first_line - 1),
            character: Math.max(0, loc.first_column),
        };
        const end: Position = {
            line: Math.max(0, loc.last_line - 1),
            character: Math.max(0, loc.last_column),
        };
        return { message, range: { start, end } };
    }

    // Fallback without a location: mark the last Handlebars expression rather
    // than the whole document.
    const last = Math.max(0, text.lastIndexOf('{{'));
    const lastEnd = text.indexOf('}}', last);
    return { message, range: rangeOf(text, last, lastEnd === -1 ? text.length : lastEnd + 2) };
}

/**
 * Offset of a 0-based line and column in the text.
 * @param text - Source text.
 * @param line - 0-based line.
 * @param column - 0-based column.
 * @returns The string offset (clamped to the text length).
 */
function offsetAt(text: string, line: number, column: number): number {
    let offset = 0;
    for (let l = 0; l < line; l++) {
        const next = text.indexOf('\n', offset);
        if (next === -1) return text.length;
        offset = next + 1;
    }
    return Math.min(text.length, offset + Math.max(0, column));
}

/**
 * 1-based line number of an offset.
 * @param text - Source text.
 * @param offset - String offset.
 * @returns The 1-based line.
 */
function lineAt(text: string, offset: number): number {
    return text.slice(0, offset).split('\n').length;
}

/**
 * LSP range between two offsets.
 * @param text - Source text.
 * @param start - Start offset.
 * @param end - End offset.
 * @returns The range.
 */
function rangeOf(text: string, start: number, end: number): Range {
    const toPosition = (offset: number): Position => {
        const before = text.slice(0, offset);
        const line = before.split('\n').length - 1;
        return { line, character: offset - (before.lastIndexOf('\n') + 1) };
    };
    return { start: toPosition(start), end: toPosition(Math.max(start, end)) };
}

/**
 * A node visited during traversal, narrowed to the common Node shape.
 */
type AnyNode = AST.Node & Record<string, unknown>;

/**
 * Depth-first walk over every node in a Handlebars AST, invoking the visitor
 * for each. Traversal descends into block programs/inverses, statement params,
 * subexpressions, and hash pair values.
 * @param node - The root node (typically a Program). A `Program` is accepted
 *   as well as any `Node`; `sfmc-handlebars-parser` narrows `Program.loc` to
 *   `SourceLocation | undefined`, so `Program` is not structurally a `Node`.
 * @param visit - Callback invoked for every node.
 */
export function walkHandlebars(
    node: AST.Node | AST.Program,
    visit: (node: AST.Node) => void,
): void {
    if (!node || typeof node !== 'object') {
        return;
    }
    visit(node as AST.Node);

    const n = node as unknown as AnyNode;

    // Program / block bodies
    if (Array.isArray(n.body)) {
        for (const child of n.body as AST.Node[]) {
            walkHandlebars(child, visit);
        }
    }
    // BlockStatement program + inverse
    if (n.program) {
        walkHandlebars(n.program as AST.Node, visit);
    }
    if (n.inverse) {
        walkHandlebars(n.inverse as AST.Node, visit);
    }
    // Path / name expressions
    if (n.path) {
        walkHandlebars(n.path as AST.Node, visit);
    }
    if (n.name && typeof n.name === 'object') {
        walkHandlebars(n.name as AST.Node, visit);
    }
    // Params (may contain subexpressions)
    if (Array.isArray(n.params)) {
        for (const param of n.params as AST.Node[]) {
            walkHandlebars(param, visit);
        }
    }
    // Hash pairs
    if (!n.hash || typeof n.hash !== 'object') return;
    const hash = n.hash as AnyNode;
    if (Array.isArray(hash.pairs)) {
        for (const pair of hash.pairs as AnyNode[]) {
            if (pair.value) {
                walkHandlebars(pair.value as AST.Node, visit);
            }
        }
    }
}
