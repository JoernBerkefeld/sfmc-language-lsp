/**
 * Thin wrapper around the `@handlebars/parser` for Marketing Cloud Next.
 *
 * Provides a safe parse that converts parser exceptions into a structured
 * result, plus helpers to map the parser's 1-based-line / 0-based-column
 * locations onto LSP Positions and to walk every node in the AST.
 */

import { parse, type AST } from '@handlebars/parser';
import type { Position, Range } from 'vscode-languageserver-types';

/** A node in the Handlebars AST (re-exported for validator consumers). */
export type HandlebarsAstNode = AST.Node;

/** A Handlebars syntax error with an LSP range describing where it occurred. */
export interface HandlebarsSyntaxError {
    message: string;
    range: Range;
}

/** Result of attempting to parse a Handlebars document. */
export interface HandlebarsParseResult {
    /** The parsed program, or null when a syntax error prevented parsing. */
    ast: AST.Program | null;
    /** The syntax error, when parsing failed. */
    error: HandlebarsSyntaxError | null;
}

/** Jison-style location attached to parser exceptions. */
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
    } catch (ex) {
        return { ast: null, error: toSyntaxError(ex, text) };
    }
}

/**
 * Convert a thrown parser exception into a structured syntax error with an LSP range.
 * @param ex - The thrown value.
 * @param text - The source text, used to derive a fallback range.
 * @returns A structured syntax error.
 */
function toSyntaxError(ex: unknown, text: string): HandlebarsSyntaxError {
    const error = ex as { message?: string; hash?: { loc?: JisonLocation } };
    const rawMessage = error.message ?? 'Handlebars syntax error.';
    // The parser's multi-line "Parse error on line N:\n<src>\n---^" message is
    // noisy for an editor; keep only the final, human-readable explanation.
    const lines = rawMessage.split('\n').filter((l) => l.trim().length > 0);
    const message = lines.at(-1) ?? rawMessage;

    const loc = error.hash?.loc;
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

    // Fallback: point at the start of the document.
    const lastLine = text.split('\n').length - 1;
    return {
        message,
        range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: 0 } },
    };
}

/** A node visited during traversal, narrowed to the common Node shape. */
type AnyNode = AST.Node & Record<string, unknown>;

/**
 * Depth-first walk over every node in a Handlebars AST, invoking the visitor
 * for each. Traversal descends into block programs/inverses, statement params,
 * subexpressions, and hash pair values.
 * @param node - The root node (typically a Program).
 * @param visit - Callback invoked for every node.
 */
export function walkHandlebars(node: AST.Node, visit: (node: AST.Node) => void): void {
    if (!node || typeof node !== 'object') {
        return;
    }
    visit(node);

    const n = node as AnyNode;

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
    if (n.hash && typeof n.hash === 'object') {
        const hash = n.hash as AnyNode;
        if (Array.isArray(hash.pairs)) {
            for (const pair of hash.pairs as AnyNode[]) {
                if (pair.value) {
                    walkHandlebars(pair.value as AST.Node, visit);
                }
            }
        }
    }
}
