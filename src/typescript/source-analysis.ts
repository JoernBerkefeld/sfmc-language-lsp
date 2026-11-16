/**
 * Text-only analysis of SSJS source for the embedded TypeScript service: ESLint-style global
 * comments, prototype/static polyfills and the comment ranges used to filter diagnostics and
 * remap definitions. Nothing here depends on TypeScript or on the runtime environment.
 */

// ---------------------------------------------------------------------------
// ESLint global comment parser
// ---------------------------------------------------------------------------

/**
 * Parses ESLint-style global comments from SSJS source text and returns a
 * TypeScript ambient declaration string for all declared names.
 *
 * Supported forms:
 *   /* global DEBUG, deKey * /
 *   /* globals DEBUG, deKey * /
 *   /* global DEBUG:readonly, deKey:writable * /
 *
 * Qualifiers (`:readonly`, `:writable`) are accepted for ESLint compatibility
 * but ignored — all names are declared as `any` for the TS checker.
 *
 * Returns an empty string when no global comments are present.
 * @param text - SSJS source text to scan
 * @returns TypeScript `declare var` statements, or an empty string
 */
export function parseGlobalCommentDeclarations(text: string): string {
    // Matches: /* global[s] <body> */  — non-greedy, allows multiline bodies.
    const GLOBAL_COMMENT = /\/\*\s*globals?\s+([\s\S]*?)\*\//g;
    // Conservative ASCII JS identifier — rejects anything that looks like a
    // qualifier fragment or punctuation that slipped through the split.
    const IDENT = /^[$A-Z_a-z][\w$]*$/;

    const names = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = GLOBAL_COMMENT.exec(text)) !== null) {
        // Body may use commas and/or whitespace as separators.
        const parts = match[1].split(/[\s,]+/);
        for (const part of parts) {
            // Strip optional :readonly / :writable qualifier.
            const name = part ? part.split(':', 1)[0].trim() : '';
            if (name && IDENT.test(name)) {
                names.add(name);
            }
        }
    }

    return names.size === 0
        ? ''
        : [...names].map((n) => `declare var ${n}: any;`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Prototype polyfill parser
// ---------------------------------------------------------------------------

/**
 * Built-in constructors whose `.prototype` can be polyfilled in SSJS, mapped to
 * the TypeScript interface that `sfmc-globals.d.ts` declares for instances of
 * that type. `Array` is generic (`interface Array<T>`) so it carries its type
 * parameter; the rest are non-generic.
 */
const POLYFILL_INTERFACE_BY_CTOR: Record<string, { iface: string; typeParams: string }> = {
    Array: { iface: 'Array', typeParams: '<T>' },
    String: { iface: 'String', typeParams: '' },
    Number: { iface: 'Number', typeParams: '' },
    Boolean: { iface: 'Boolean', typeParams: '' },
    Object: { iface: 'Object', typeParams: '' },
    Date: { iface: 'Date', typeParams: '' },
    Function: { iface: 'Function', typeParams: '' },
    RegExp: { iface: 'RegExp', typeParams: '' },
};

/**
 * Scans SSJS source for prototype polyfills of the form
 * `Ctor.prototype.method = ...` and returns TypeScript interface-merge
 * declarations that add each polyfilled method to the matching built-in
 * interface from `sfmc-globals.d.ts`.
 *
 * Because the bundled `sfmc-globals.d.ts` intentionally declares only the
 * SSJS-supported subset of built-in methods (no `Array.prototype.forEach`,
 * `String.prototype.startsWith`, …), polyfilling an unsupported method would
 * otherwise raise `Property 'X' does not exist` on both the assignment and
 * every later call. Merging the polyfilled members back into the interface
 * teaches the checker that those methods now exist for this document.
 *
 * Each polyfilled member is emitted as a *method signature* (not a bare
 * `: any` property) so hover reports `(method) String.startsWith(...)` rather
 * than `(property) … : any`.  When the polyfill is assigned a function
 * expression, the function's own parameter names are reused — typed from the
 * polyfill's `@param {Type}` / `@returns {Type}` JSDoc when present, otherwise
 * `any` — and any JSDoc block immediately preceding the assignment is forwarded
 * so the checker surfaces the documented `@param` / `@returns` text on hover.
 * The polyfill's body is still type-checked normally and unrelated diagnostics
 * are preserved.
 *
 * Returns an empty string when no prototype polyfills are present.
 * @param text - SSJS source text to scan
 * @returns TypeScript interface-merge statements, or an empty string
 */
export function parsePolyfillDeclarations(text: string): string {
    // Match `Ctor.prototype.method = function (params) {` where Ctor is a known
    // built-in. Captures the constructor, the method name, and — when the value
    // is a function expression — its parameter list. The trailing function part
    // is optional so non-function polyfills still register the member.
    // The canonical polyfill form ssjs-data ships uses a self-guard —
    // `String.prototype.trim = String.prototype.trim || function (…)` — so
    // tolerate an optional `<expr> ||` prefix between `=` and `function`.
    const POLYFILL =
        /\b(Array|String|Number|Boolean|Object|Date|Function|RegExp)\s*\.\s*prototype\s*\.\s*([$A-Z_a-z][\w$]*)\s*(?:=\s*(?:[$A-Z_a-z][\w$.]*\s*\|\|\s*)?function\s*\*?\s*[$A-Z_a-z]*\s*\(([^)]*)\))?/g;

    // Group method declarations per interface so each interface is merged once.
    interface PolyMethod {
        params: string[];
        jsdoc: string;
        paramTypes: Map<string, string>;
        optionalParams: Set<string>;
        returnType: string;
    }
    const membersByIface = new Map<
        string,
        { typeParams: string; methods: Map<string, PolyMethod> }
    >();
    let match: RegExpExecArray | null;
    while ((match = POLYFILL.exec(text)) !== null) {
        const ctor = match[1];
        const method = match[2];
        const rawParameters = match[3];
        const target = POLYFILL_INTERFACE_BY_CTOR[ctor];
        if (!target) continue;

        const parameters =
            rawParameters === undefined
                ? []
                : rawParameters
                      .split(',')
                      .map((p) => p.trim())
                      // Strip default values / rest syntax — only the name matters.
                      .map((p) =>
                          p
                              .replace(/^\.\.\./, '')
                              .split('=', 1)[0]
                              .trim(),
                      )
                      .filter((p) => /^[$A-Z_a-z][\w$]*$/.test(p));

        const rawJsdoc = extractPrecedingJsdoc(text, match.index);
        const { paramTypes, optionalParams, returnType } = parseJsdocTypes(rawJsdoc);
        // Strip JSDoc type annotations before forwarding: in a `.d.ts` TypeScript
        // type-checks `@param {Type}` / `@property {Type}` / `@typedef` tags, so an
        // undeclared or duplicate type name (e.g. a user `@typedef Client`) would
        // raise spurious diagnostics and break the interface merge. The synthesized
        // signature already carries the (sanitized) types.
        const jsdoc = stripJsdocTypeAnnotations(rawJsdoc);

        let bucket = membersByIface.get(target.iface);
        if (!bucket) {
            bucket = { typeParams: target.typeParams, methods: new Map<string, PolyMethod>() };
            membersByIface.set(target.iface, bucket);
        }
        // First declaration with a function signature wins; a later bare
        // reference must not overwrite captured params/jsdoc.
        const existing = bucket.methods.get(method);
        if (!existing || (existing.params.length === 0 && parameters.length > 0)) {
            bucket.methods.set(method, {
                params: parameters,
                jsdoc,
                paramTypes,
                optionalParams,
                returnType,
            });
        }
    }

    const staticBlocks = parseStaticPolyfillDeclarations(text);

    if (membersByIface.size === 0) return staticBlocks;

    const blocks: string[] = [];
    for (const [iface, { typeParams, methods }] of membersByIface) {
        const memberLines: string[] = [];
        // The instance type of the interface being merged (e.g. `Array<T>`,
        // `String`). Emitted as an explicit `this` parameter on each method so
        // that under `noLib:true` a polyfill body reading `this.length` or doing
        // `return this` (e.g. `Array.prototype.copyWithin` / `fill`) type-checks
        // against the array/string instance rather than the function object.
        const thisType = `${iface}${typeParams}`;
        for (const [name, { params, jsdoc, paramTypes, optionalParams, returnType }] of methods) {
            if (jsdoc) memberLines.push(indentLines(jsdoc, ' '.repeat(4)));
            // Use the JSDoc `@param {Type}` / `@returns {Type}` annotations when
            // present so hover reports the documented types instead of `any`.
            // A parameter marked optional in JSDoc (`[name]`) emits `name?: type`;
            // every parameter after an optional one must also be optional in TS.
            let isSawOptional = false;
            const parameterString = params
                .map((p) => {
                    const optional = isSawOptional || optionalParams.has(p);
                    if (optional) isSawOptional = true;
                    return `${p}${optional ? '?' : ''}: ${paramTypes.get(p) ?? 'any'}`;
                })
                .join(', ');
            const signatureParameters = parameterString
                ? `this: ${thisType}, ${parameterString}`
                : `this: ${thisType}`;
            memberLines.push(`    ${name}(${signatureParameters}): ${returnType};`);
        }
        blocks.push(`interface ${iface}${typeParams} {\n${memberLines.join('\n')}\n}`);
    }
    return blocks.join('\n') + '\n' + staticBlocks;
}

/**
 * Built-in constructors whose STATIC members can be polyfilled in SSJS, mapped to
 * the declaration target that the merge must re-open. `Math` is a namespace
 * (`declare namespace Math`), the others are `*Constructor` interfaces declared by
 * `sfmc-globals.d.ts` (e.g. `interface ArrayConstructor`).
 */
const STATIC_POLYFILL_TARGET_BY_CTOR: Record<
    string,
    { target: string; kind: 'interface' | 'namespace' }
> = {
    Array: { target: 'ArrayConstructor', kind: 'interface' },
    Object: { target: 'ObjectConstructor', kind: 'interface' },
    Number: { target: 'NumberConstructor', kind: 'interface' },
    String: { target: 'StringConstructor', kind: 'interface' },
    Date: { target: 'DateConstructor', kind: 'interface' },
    Math: { target: 'Math', kind: 'namespace' },
    JSON: { target: 'JSON', kind: 'namespace' },
};

/**
 * Scans SSJS source for STATIC polyfills of the form `Ctor.method = function (…)`
 * (e.g. `Array.isArray = …`, `Object.getPrototypeOf = …`, `Math.max = …`) and
 * returns TypeScript declarations that add each member to the matching
 * `*Constructor` interface (via declaration merging) or `Math`/`JSON` namespace.
 *
 * Like `parsePolyfillDeclarations` for prototype members, this is required because
 * `sfmc-globals.d.ts` intentionally omits unsupported statics. Once the
 * "Insert polyfill" quick-fix adds `Array.isArray = function () { … }`, the
 * assignment target must exist or TypeScript raises ts2339
 * ("Property 'isArray' does not exist on type 'ArrayConstructor'").
 *
 * Returns an empty string when no static polyfills are present.
 * @param text - SSJS source text to scan
 * @returns TypeScript merge statements, or an empty string
 */
function parseStaticPolyfillDeclarations(text: string): string {
    // Match `Ctor.method = function (params)` where Ctor is a known built-in and
    // `method` is NOT `prototype` (those are handled by parsePolyfillDeclarations).
    // The canonical polyfill form ssjs-data ships uses a self-guard —
    // `Array.isArray = Array.isArray || function (…)` — so tolerate an optional
    // `<expr> ||` prefix between `=` and `function` (e.g. `Array.isArray ||`).
    const STATIC_POLYFILL =
        /\b(Array|Object|Number|String|Date|Math|JSON)\s*\.\s*([$A-Z_a-z][\w$]*)\s*=\s*(?:[$A-Z_a-z][\w$.]*\s*\|\|\s*)?function\s*\*?\s*[$A-Z_a-z]*\s*\(([^)]*)\)/g;

    interface StaticMethod {
        params: string[];
        jsdoc: string;
        paramTypes: Map<string, string>;
        optionalParams: Set<string>;
        returnType: string;
    }
    // target name → { kind, methods }
    const byTarget = new Map<
        string,
        { kind: 'interface' | 'namespace'; methods: Map<string, StaticMethod> }
    >();

    let match: RegExpExecArray | null;
    while ((match = STATIC_POLYFILL.exec(text)) !== null) {
        const ctor = match[1];
        const method = match[2];
        if (method === 'prototype') continue;
        const target = STATIC_POLYFILL_TARGET_BY_CTOR[ctor];
        if (!target) continue;

        const rawParameters = match[3];
        const parameters = rawParameters
            .split(',')
            .map((p) => p.trim())
            .map((p) =>
                p
                    .replace(/^\.\.\./, '')
                    .split('=', 1)[0]
                    .trim(),
            )
            .filter((p) => /^[$A-Z_a-z][\w$]*$/.test(p));

        const rawJsdoc = extractPrecedingJsdoc(text, match.index);
        const { paramTypes, optionalParams, returnType } = parseJsdocTypes(rawJsdoc);
        const jsdoc = stripJsdocTypeAnnotations(rawJsdoc);

        let bucket = byTarget.get(target.target);
        if (!bucket) {
            bucket = { kind: target.kind, methods: new Map<string, StaticMethod>() };
            byTarget.set(target.target, bucket);
        }
        if (!bucket.methods.has(method)) {
            bucket.methods.set(method, {
                params: parameters,
                jsdoc,
                paramTypes,
                optionalParams,
                returnType,
            });
        }
    }

    if (byTarget.size === 0) return '';

    const blocks: string[] = [];
    for (const [target, { kind, methods }] of byTarget) {
        const memberLines: string[] = [];
        for (const [name, { params, jsdoc, paramTypes, optionalParams, returnType }] of methods) {
            if (jsdoc) memberLines.push(indentLines(jsdoc, ' '.repeat(4)));
            let isSawOptional = false;
            const parameterString = params
                .map((p) => {
                    const optional = isSawOptional || optionalParams.has(p);
                    if (optional) isSawOptional = true;
                    return `${p}${optional ? '?' : ''}: ${paramTypes.get(p) ?? 'any'}`;
                })
                .join(', ');
            // Namespace members use `function name(...)`; interface members `name(...)`.
            memberLines.push(
                kind === 'namespace'
                    ? `    function ${name}(${parameterString}): ${returnType};`
                    : `    ${name}(${parameterString}): ${returnType};`,
            );
        }
        const header = kind === 'namespace' ? `declare namespace ${target}` : `interface ${target}`;
        blocks.push(`${header} {\n${memberLines.join('\n')}\n}`);
    }
    return blocks.join('\n') + '\n';
}

/**
 * Map a single JSDoc type token to a TypeScript-safe type. Primitives and the
 * known built-in interfaces pass through (with canonical casing); `Array`
 * becomes `any[]`; anything not recognised (e.g. user types like `Client` that
 * are not declared in the virtual program) falls back to `any` so the generated
 * `.polyfills.d.ts` never references an undeclared name.
 * @param raw - a single JSDoc type token (no `{}`)
 * @returns a TypeScript-safe type string
 */
function jsdocTokenToTsType(raw: string): string {
    const t = raw.trim();
    if (!t) return 'any';
    // String literal unions like 'a'|'b' — keep as-is (valid TS literal types).
    if (/^(['"]).*\1$/.test(t)) return t;
    const lower = t.toLowerCase();
    switch (lower) {
        case 'array': {
            return 'any[]';
        }
        case 'void':
        case 'undefined':
        case 'null':
        case 'any': {
            return lower;
        }
        case 'string':
        case 'number':
        case 'boolean': {
            return lower;
        }
        case 'object': {
            return 'Object';
        }
        case 'date': {
            return 'Date';
        }
        case 'function': {
            return 'Function';
        }
        case 'regexp': {
            return 'RegExp';
        }
        default: {
            return 'any';
        }
    }
}

/**
 * Convert a JSDoc type expression (the text inside `{...}`) into a TypeScript
 * type, supporting `|` unions and `Type[]` array suffixes. Unknown tokens
 * degrade to `any`.
 * @param expression - JSDoc type expression without surrounding braces
 * @returns a TypeScript-safe type string
 */
function jsdocTypeToTs(expression: string): string {
    const trimmed = expression.trim();
    if (!trimmed) return 'any';
    if (trimmed.includes('|')) {
        return trimmed
            .split('|')
            .map((p) => jsdocTypeToTs(p))
            .join(' | ');
    }
    // `Type[]` suffix.
    const arrayMatch = trimmed.match(/^(.+?)\s*\[\s*\]$/);
    if (arrayMatch) {
        const inner = jsdocTokenToTsType(arrayMatch[1]);
        return inner === 'any' ? 'any[]' : `${inner}[]`;
    }
    return jsdocTokenToTsType(trimmed);
}

/**
 * Parse `@param {Type} name` and `@returns {Type}` annotations out of a JSDoc
 * comment block, returning a map of parameter name to TS type, the set of
 * parameters marked optional (JSDoc `[name]` / `[name=default]` syntax), and the
 * return type (defaulting to `any` when no `@returns` type is documented).
 * @param jsdoc - the raw JSDoc comment block
 * @returns parsed parameter types, optional-parameter names, and the return type
 */
function parseJsdocTypes(jsdoc: string): {
    paramTypes: Map<string, string>;
    optionalParams: Set<string>;
    returnType: string;
} {
    const parameterTypes = new Map<string, string>();
    const optionalParameters = new Set<string>();
    let returnType = 'any';
    if (!jsdoc)
        return { paramTypes: parameterTypes, optionalParams: optionalParameters, returnType };

    // Match `@param {Type} name` and the optional form `@param {Type} [name]`
    // (or `[name=default]`). The bracket and default value only mark optionality
    // — the bare identifier is captured as the parameter name.
    const parameterRe = /@param\s*\{([^}]*)\}\s*(\[)?\s*([$A-Z_a-z][\w$]*)(?:\s*=\s*[^\]]*)?(\])?/g;
    let m: RegExpExecArray | null;
    while ((m = parameterRe.exec(jsdoc)) !== null) {
        const name = m[3];
        parameterTypes.set(name, jsdocTypeToTs(m[1]));
        if (m[2] === '[' && m[4] === ']') optionalParameters.add(name);
    }

    const returnRe = /@returns?\s*\{([^}]*)\}/;
    const rm = returnRe.exec(jsdoc);
    if (rm) returnType = jsdocTypeToTs(rm[1]);

    return { paramTypes: parameterTypes, optionalParams: optionalParameters, returnType };
}

/**
 * Remove JSDoc *type* annotations from a comment block so it is safe to forward
 * into a generated `.d.ts`. TypeScript type-checks type expressions inside JSDoc
 * tags (`@param {Type}`, `@returns {Type}`, `@property {Type}`, `@typedef
 * {Type}`, …); an undeclared or duplicate type name in a forwarded comment
 * would raise spurious diagnostics and can break the surrounding interface merge.
 * Stripping the `{...}` (and dropping whole `@typedef`/`@property` lines, which
 * only exist to declare types) leaves human-readable descriptions intact while
 * removing anything TypeScript would try to resolve.
 * @param jsdoc - the raw JSDoc comment block
 * @returns the JSDoc block with type annotations removed
 */
function stripJsdocTypeAnnotations(jsdoc: string): string {
    if (!jsdoc) return '';
    const cleaned = jsdoc
        .split('\n')
        .filter((line) => !/^\s*\*?\s*@(?:typedef|property|prop)\b/.test(line))
        // Remove the `{Type}` token from any remaining tag (e.g. @param, @returns).
        .map((line) => line.replaceAll(/(@\w+)\s*\{[^}]*\}/g, '$1'))
        .join('\n');
    return cleaned;
}

/**
 * Extract the JSDoc block (`/** … *\/`) immediately preceding `index` in
 * `text`, ignoring intervening whitespace. Returns the raw comment (without
 * surrounding indentation) or an empty string when none is directly adjacent.
 * @param text - full source text
 * @param index - offset of the polyfill assignment
 * @returns the adjacent JSDoc comment, or an empty string
 */
function extractPrecedingJsdoc(text: string, index: number): string {
    const before = text.slice(0, index);
    // Only a JSDoc block separated from the assignment by whitespace counts.
    // The body must not contain a `*/`, so the match is the *closest* comment to
    // the assignment — otherwise a lazy `[\s\S]*?` would span from an earlier
    // comment across intervening source code into this one.
    const match = before.match(/\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/);
    if (!match) return '';
    // Normalize leading indentation so re-indentation is predictable.
    return match[0]
        .split('\n')
        .map((l) => l.replace(/^\s+/, () => (l.trimStart().startsWith('*') ? ' ' : '')))
        .join('\n');
}

/**
 * Re-indent a multi-line block so every line is prefixed with `indent`.
 * @param block - text block to indent
 * @param indent - indentation string to prepend to each line
 * @returns the indented block
 */
function indentLines(block: string, indent: string): string {
    return block
        .split('\n')
        .map((l) => indent + l)
        .join('\n');
}

/**
 * Compute the `[start, end)` offset ranges of every JSDoc block comment
 * (`/** … *\/`) in the given source text.
 * @param text - full document text
 * @returns an array of `[start, end)` offset tuples
 */
export function jsdocCommentRanges(text: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const re = /\/\*\*[\s\S]*?\*\//g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        ranges.push([m.index, m.index + m[0].length]);
    }
    return ranges;
}

/**
 * Determine whether `offset` falls within any of the supplied comment ranges.
 * @param offset - character offset to test
 * @param ranges - JSDoc comment ranges from {@link jsdocCommentRanges}
 * @returns true when the offset is inside a JSDoc comment
 */
export function isInsideJsdoc(offset: number, ranges: Array<[number, number]>): boolean {
    return ranges.some(([start, end]) => offset >= start && offset < end);
}

/**
 * Compute the `[start, end)` offset ranges of every prototype-polyfill
 * assignment body — `Ctor.prototype.method = [Ctor.prototype.method ||] function (…) { … }`.
 *
 * The self-guarded form (`X = X || function () {}`) defeats TypeScript's
 * contextual `this` typing under `noLib:true`: the declared `this: any[]`
 * parameter on the merged interface member does not flow into the function
 * operand of the `||`, so a body reading `this.length` or doing `return this`
 * raises spurious ts2339 / ts2322. These are known-good SSJS polyfills, so the
 * `this`-related diagnostics inside their bodies are suppressed.
 * @param text - full document text
 * @returns an array of `[start, end)` offset tuples spanning each assignment body
 */
export function prototypePolyfillBodyRanges(text: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    // Match up to the opening `{` of the function body; then balance braces to
    // find the matching close so the whole body is covered.
    const re =
        /\b(?:Array|String|Number|Boolean|Object|Date|Function|RegExp)\s*\.\s*prototype\s*\.\s*[$A-Z_a-z][\w$]*\s*=\s*(?:[$A-Z_a-z][\w$.]*\s*\|\|\s*)?function\s*\*?\s*[$A-Z_a-z]*\s*\([^)]*\)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const bodyOpen = m.index + m[0].length - 1;
        let depth = 1;
        let index = bodyOpen + 1;
        for (; index < text.length && depth > 0; index++) {
            const ch = text[index];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
        }
        ranges.push([m.index, index]);
    }
    return ranges;
}

/**
 * Read the method identifier at `offset` inside a generated `.polyfills.d.ts`
 * interface member so the reference remap can locate the matching prototype
 * assignment in the source document.
 * @param text - the polyfills declaration file content
 * @param offset - the reference text-span start within that file
 * @returns the method name at the offset, or an empty string
 */
export function prototypeMethodNameFor(text: string, offset: number): string {
    const match = /^[$A-Z_a-z][\w$]*/.exec(text.slice(offset));
    return match ? match[0] : '';
}

/**
 * Determine whether `offset` falls inside a line (`// …`) or block (`/* … *\/`)
 * comment in the given source text. Used to detect when TypeScript resolved a
 * prototype-polyfill definition into its leading JSDoc block instead of the
 * assignment identifier, so the definition can be redirected to the code line.
 * @param text - source text to scan
 * @param offset - character offset to test
 * @returns true when the offset lies within a comment
 */
export function isOffsetInsideComment(text: string, offset: number): boolean {
    // Block comments: /* … */ (covers JSDoc /** … */).
    const block = /\/\*[\s\S]*?\*\//g;
    let m: RegExpExecArray | null;
    while ((m = block.exec(text)) !== null) {
        if (offset >= m.index && offset < m.index + m[0].length) return true;
    }
    // Line comments: // … to end of line.
    const line = /\/\/[^\n]*/g;
    while ((m = line.exec(text)) !== null) {
        if (offset >= m.index && offset < m.index + m[0].length) return true;
    }
    return false;
}

/**
 * Locate the `…prototype.<method>` assignment for a polyfilled method in the
 * document source and return the text span covering the method name, so
 * go-to-definition lands on the polyfill itself.
 * @param text - document source text
 * @param method - the polyfilled method name
 * @returns the method-name text span, or null if not found
 */
export function findPrototypeAssignmentSpan(
    text: string,
    method: string,
): { start: number; length: number } | undefined {
    const escaped = method.replaceAll('$', String.raw`\$`);
    const re = new RegExp(String.raw`\bprototype\s*\.\s*(` + escaped + String.raw`)\b`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        // Offset of the captured method name (group 1) within the full match.
        const start = match.index + match[0].indexOf(match[1]);
        // The polyfill's own JSDoc references the method as
        // `Ctor.prototype.method` in prose (e.g. "Polyfill for
        // String.prototype.search"); skip any match inside a comment so the
        // span lands on the real assignment identifier, not the doc text.
        if (isOffsetInsideComment(text, start)) continue;
        return { start, length: match[1].length };
    }
    return undefined;
}
