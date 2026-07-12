/**
 * Block-scope tracker for Handlebars for Marketing Cloud Next (MCN).
 *
 * Walks a Handlebars AST to collect the local identifiers that block helpers
 * introduce into their inner body, together with the source range over which
 * each local is visible:
 *
 *   - `{{#each items as |item index|}}` — block params (`item`, `index`).
 *   - `{{#each ...}}` / `{{#repeat n}}` — loop data variables (`@index`,
 *     `@first`, `@last`, and `@key` for `each`).
 *   - `{{#with obj as |o|}}` — the context alias when block params are used.
 *
 * Consumers (completions, hover, signature help) call
 * {@link getHandlebarsLocalsAtOffset} to obtain only the locals that are in
 * scope at the cursor, so block params and loop vars are never offered outside
 * the block that declares them.
 *
 * Mirrors the single-pass tracker pattern used by
 * {@link ../utils/ampscriptVariableTracker.buildVariableTypeMap} for AMPscript.
 */

import type { AST } from '@handlebars/parser';
import { parseHandlebars, walkHandlebars, astLocToRange } from './handlebarsAst.js';
import { getSanitizedHandlebarsText } from './regions.js';
import { positionToOffset } from './positions.js';

/** The origin of a Handlebars block-local identifier. */
export type HandlebarsLocalKind = 'block-param' | 'loop-var';

/** A single identifier introduced by a block helper. */
export interface HandlebarsLocal {
    /** The identifier as written in source, e.g. `item` or `@index`. */
    name: string;
    /** Where the identifier originates. */
    kind: HandlebarsLocalKind;
    /** Short human-readable detail, e.g. `block param of #each`. */
    detail: string;
}

/** A lexical scope: a set of locals visible across a half-open offset range. */
export interface HandlebarsScope {
    /** Inclusive start offset of the block body. */
    start: number;
    /** Exclusive end offset of the block body. */
    end: number;
    /** Locals introduced by the block, visible within `[start, end)`. */
    locals: HandlebarsLocal[];
}

/** Helpers whose block body exposes iteration data variables. */
const LOOP_HELPERS = new Set(['each', 'repeat']);

/**
 * Returns the simple helper name for a block statement, lowercased, or null
 * when the path is not a single-part identifier.
 * @param node - The block statement node.
 * @returns The lowercase helper name, or null.
 */
function blockHelperName(node: AST.BlockStatement): string | null {
    const path = node.path;
    if (!path || path.type !== 'PathExpression') return null;
    if (path.data || (path.depth ?? 0) > 0) return null;
    const parts = path.parts ?? [];
    if (parts.length !== 1) return null;
    // @handlebars/parser v2 types `parts` as (string | SubExpression)[]; a simple
    // helper name is always a string part.
    const first = parts[0];
    return typeof first === 'string' ? first.toLowerCase() : null;
}

/**
 * Build the loop data variables (`@index`, `@first`, `@last`, `@key`) a loop
 * helper exposes inside its body.
 * @param helperName - The lowercase block helper name (`each` or `repeat`).
 * @returns The loop variable locals.
 */
function loopVariables(helperName: string): HandlebarsLocal[] {
    const detail = `loop variable of #${helperName}`;
    const vars = ['@index', '@first', '@last'];
    // `each` can iterate objects, exposing the property name as `@key`.
    if (helperName === 'each') vars.push('@key');
    return vars.map((name) => ({ name, kind: 'loop-var', detail }));
}

/**
 * Collect the locals a block statement introduces into its body.
 * @param node - The block statement node.
 * @param helperName - The lowercase block helper name.
 * @returns The block-param and loop-var locals (may be empty).
 */
function blockLocals(node: AST.BlockStatement, helperName: string): HandlebarsLocal[] {
    const locals: HandlebarsLocal[] = [];

    // `as |a b|` block params declared on the block's program.
    const params = node.program?.blockParams ?? [];
    for (const name of params) {
        if (name) {
            locals.push({ name, kind: 'block-param', detail: `block param of #${helperName}` });
        }
    }

    // Iteration data variables for loop helpers.
    if (LOOP_HELPERS.has(helperName)) {
        locals.push(...loopVariables(helperName));
    }

    return locals;
}

/**
 * Build the list of block scopes for a (possibly mixed) document. AMPscript
 * regions are blanked before parsing so the Handlebars parser does not choke on
 * `%%[...]%%` / `%%=...=%%`. Offsets in the returned scopes map onto the
 * original `text` (the sanitizer preserves offsets).
 * @param text - Full document text.
 * @returns The block scopes, outermost first in document order.
 */
export function buildHandlebarsScopes(text: string): HandlebarsScope[] {
    const sanitized = getSanitizedHandlebarsText(text);
    if (!sanitized.includes('{{')) return [];

    const { ast } = parseHandlebars(sanitized);
    if (!ast) return [];

    const scopes: HandlebarsScope[] = [];
    walkHandlebars(ast, (rawNode) => {
        if (rawNode.type !== 'BlockStatement') return;
        const node = rawNode as AST.BlockStatement;
        const helperName = blockHelperName(node);
        if (!helperName) return;

        const locals = blockLocals(node, helperName);
        if (locals.length === 0) return;

        // Scope spans the block's inner body (program), not the opening tag, so
        // `as |x|` params are not suggested inside the `{{#each ... as |x|}}`
        // tag itself.
        const program = node.program;
        if (!program?.loc) return;
        const range = astLocToRange(program.loc);
        scopes.push({
            start: positionToOffset(text, range.start),
            end: positionToOffset(text, range.end),
            locals,
        });
    });

    return scopes;
}

/**
 * Return the Handlebars block-locals in scope at the given offset. Locals from
 * nested blocks shadow outer ones by name (inner declaration wins).
 * @param text - Full document text.
 * @param offset - Character offset of the cursor.
 * @returns The in-scope locals, de-duplicated by name.
 */
export function getHandlebarsLocalsAtOffset(text: string, offset: number): HandlebarsLocal[] {
    const scopes = buildHandlebarsScopes(text);
    // Narrowest (innermost) scopes appear later in document order for the same
    // start; collect all enclosing scopes, then let later ones win by name.
    const byName = new Map<string, HandlebarsLocal>();
    for (const scope of scopes) {
        if (offset >= scope.start && offset < scope.end) {
            for (const local of scope.locals) {
                byName.set(local.name, local);
            }
        }
    }
    return [...byName.values()];
}
