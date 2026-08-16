import { DiagnosticSeverity } from '../types.js';
import type { Diagnostic } from '../types.js';
import type { SfmcSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import { buildCommentRanges, isInCommentRange } from '../utils/comments.js';
import { offsetToPosition } from '../utils/positions.js';
import { isPolyfillPresent } from '../utils/polyfill.js';
import {
    httpHeaderMethods,
    dateTimeTimezoneMethods,
    errorUtilMethods,
    requiresCoreLoadGlobals,
    nonexistentGlobals,
    deprecatedGlobals,
    polyfillableStaticLookup,
    polyfillablePrototypeLookup,
    replaceableStaticLookup,
    httpPropertyConstraintLookup,
    propertyAccessLookup,
    platformFunctionLookup,
    coreObjectNameSet,
    coreNonFunctionalMethodLookup,
    coreDeprecatedMethodLookup,
    maxCoreVersionLookup,
} from '../data/ssjs.js';
import type { HttpPropertyValueConstraint, PropertyAccess, SsjsFunction } from '../data/ssjs.js';
import { countFunctionArguments } from '../utils/text.js';

// Diagnostic codes that code actions identify and act on, and that overlap with
// eslint-plugin-sfmc rules. When `disableLspDiagnosticsForEslintRules` is enabled
// these codes are filtered out (the eslint plugin reports the same problems via AST).
//
// Methods that are simply absent in the SFMC engine and have NO polyfill are
// intentionally NOT diagnosed here — TypeScript's own diagnostics (e.g.
// `sfmc-ts(2550)` / `sfmc-ts(2304)`) already flag those. We only emit a
// diagnostic when a verified polyfill exists, so the user can act on it.
export const DIAG_CODE_SSJS_POLYFILL_REQUIRED = 'ssjs/polyfill-required';
export const DIAG_CODE_SSJS_MCN_NOT_SUPPORTED = 'ssjs/mcn-not-supported';
// Static members with no polyfill but a direct Platform.Function replacement
// (e.g. JSON.parse → Platform.Function.ParseJSON). TypeScript also flags these
// (JSON is undefined), but we additionally offer a "replace with …" quick-fix.
export const DIAG_CODE_SSJS_REPLACE_WITH_PLATFORM_FUNCTION = 'ssjs/replace-with-platform-function';
// Core library object / requiresCoreLoad global used before a Platform.Load("core")
// call. Mirrors the `ssjs-require-platform-load` rule.
export const DIAG_CODE_SSJS_REQUIRE_PLATFORM_LOAD = 'ssjs/require-platform-load';
// Platform.Load("core", <version>) using a version other than the recommended
// "1.1.5". Mirrors the `ssjs-prefer-platform-load-version` rule.
export const DIAG_CODE_SSJS_PLATFORM_LOAD_VERSION = 'ssjs/platform-load-version';
// ES6+ syntax not supported by the legacy SFMC SSJS engine (let/const, arrow
// functions, generators, spread, destructuring, for…of, async/await, class).
// Mirrors the `ssjs-no-unsupported-syntax` rule.
export const DIAG_CODE_SSJS_UNSUPPORTED_SYNTAX = 'ssjs/unsupported-syntax';
// CLR-unsafe read of an HttpResponse `.headers` object (indexing, `.Get()`, or
// `.Item()`) on a variable returned by `req.send()`. These throw "Use of Common
// Language Runtime (CLR) is not allowed" at runtime — headers are only readable
// by enumerating with for..in. Mirrors the `ssjs-no-clr-header-access` rule.
export const DIAG_CODE_SSJS_CLR_HEADER_ACCESS = 'ssjs/clr-header-access';
// Raw use of an HttpResponse `.content` CLR string without a `String()` wrap on a
// variable returned by `req.send()`. `.content` is a CLR string, not a JavaScript
// string, so passing it to ParseJSON(), a string method, or a concatenation is
// unreliable — wrap it with `String(resp.content)` first. Mirrors the
// `ssjs-require-string-clr-content` rule.
export const DIAG_CODE_SSJS_CLR_CONTENT_ACCESS = 'ssjs/clr-content-access';
// Literal assignment to an HttpRequest/HttpGet writable property whose value
// violates the property's allowed enum / integer / range constraint (e.g.
// `req.emptyContentHandling = 5`, `req.retries = -2.45`, `req.method = 'POT'`).
// Constraints live in ssjs-data. Mirrors the `ssjs-http-property-value` rule.
export const DIAG_CODE_SSJS_INVALID_HTTP_PROPERTY = 'ssjs/invalid-http-property-value';
// Property access that goes against the direction the runtime supports: reading
// a write-only property (`req.postData` — throws), reading a write-only-opaque
// one (`Platform.Response.ContentType` — returns an opaque CLR value), or
// assigning to a read-only one (`Platform.Request.Method` — no effect). Driven
// by ssjs-data's `access` field. Mirrors the `ssjs-no-invalid-property-access` rule.
export const DIAG_CODE_SSJS_INVALID_PROPERTY_ACCESS = 'ssjs/invalid-property-access';
// Bare-name global that is officially documented but does NOT exist at runtime
// (calling it throws a ReferenceError), e.g. `Redirect`. Driven by ssjs-data's
// `notDefinedAtRuntime` flag. Mirrors the `ssjs-no-nonexistent-global` rule.
export const DIAG_CODE_SSJS_NONEXISTENT_GLOBAL = 'ssjs/nonexistent-global';
// Deprecated bare-name global or `ErrorUtil.*` method still callable but retired
// (e.g. `ContentArea`, `ErrorUtil.ThrowWSProxyError`). Driven by ssjs-data's
// `deprecated` flag. Mirrors the `ssjs-no-deprecated-function` rule.
export const DIAG_CODE_SSJS_DEPRECATED = 'ssjs/deprecated';
// Platform.Function call whose argument count is within [minArgs, maxArgs] but
// not one of the exact permitted arities for a DISCONTINUOUS OVERLOAD (ssjs-data
// `validArities`). E.g. HTTPGet accepts only 1 or 6 arguments; 2-5 throw
// "Unable to retrieve security descriptor for this frame." at runtime. Mirrors
// the `ssjs-platform-function-arity` rule's `invalidArity` message.
export const DIAG_CODE_SSJS_INVALID_ARITY = 'ssjs/invalid-arity';
// Core Library method call that RESOLVES at runtime but has no known working
// invocation (ssjs-data `nonFunctionalAtRuntime`), e.g. `FilterDefinition.Update`.
// The member is KEPT in completions/hover; only the call site is flagged as an
// Error (every tested invocation fails at runtime). Mirrors the
// `ssjs-no-nonfunctional-method` rule.
export const DIAG_CODE_SSJS_NONFUNCTIONAL_METHOD = 'ssjs/nonfunctional-method';
// Reliance on switch fall-through, which the SFMC SSJS engine does not implement:
// an empty leading `case` label does not share the next label's body, and a
// break-less case body does not cascade into the following case. Each case runs
// only its own statements up to the next case/default. Mirrors the
// `ssjs-no-switch-fallthrough` rule.
export const DIAG_CODE_SSJS_SWITCH_FALLTHROUGH = 'ssjs/switch-fallthrough';
// `new X()` where X is a user-defined constructor whose body `return`s an object
// literal. The SFMC engine returns the empty `this` and silently discards the
// returned object, so the members the caller expects are `undefined`; calling
// one of them as a function then aborts the CloudPage. LSP-only (no eslint
// mirror) — the whole-document function map is needed to resolve the callee.
export const DIAG_CODE_SSJS_NEW_OBJECT_RETURN = 'ssjs/new-object-returning-constructor';
// A call in one `<script runat="server">` block to a function whose only
// declaration is in a LATER block. SSJS executes server blocks in document order
// over one shared global scope, so a forward cross-block reference throws
// "Object expected" at runtime. LSP-only — ESLint sees a single block at a time
// and cannot detect a cross-block forward reference.
export const DIAG_CODE_SSJS_CROSS_BLOCK_FORWARD_REF = 'ssjs/cross-block-forward-reference';

/**
 * SSJS diagnostic codes that duplicate eslint-plugin-sfmc rules and can be
 * suppressed via the `disableLspDiagnosticsForEslintRules` setting:
 *   - polyfill-required / replace-with-platform-function → `ssjs-no-unavailable-method`
 *   - mcn-not-supported → `ssjs-no-mcn-unsupported` (enabled in the `-next` configs)
 *   - require-platform-load → `ssjs-require-platform-load`
 *   - platform-load-version → `ssjs-prefer-platform-load-version`
 *   - unsupported-syntax → `ssjs-no-unsupported-syntax`
 *   - clr-header-access → `ssjs-no-clr-header-access`
 *   - clr-content-access → `ssjs-require-string-clr-content`
 *   - invalid-http-property-value → `ssjs-http-property-value`
 *   - invalid-property-access → `ssjs-no-invalid-property-access`
 *   - nonexistent-global → `ssjs-no-nonexistent-global`
 *   - deprecated → `ssjs-no-deprecated-function`
 *   - invalid-arity → `ssjs-platform-function-arity`
 *   - nonfunctional-method → `ssjs-no-nonfunctional-method`
 *   - switch-fallthrough → `ssjs-no-switch-fallthrough`
 */
export const SSJS_ESLINT_DUPLICATE_DIAG_CODES = new Set<string>([
    DIAG_CODE_SSJS_POLYFILL_REQUIRED,
    DIAG_CODE_SSJS_REPLACE_WITH_PLATFORM_FUNCTION,
    DIAG_CODE_SSJS_MCN_NOT_SUPPORTED,
    DIAG_CODE_SSJS_REQUIRE_PLATFORM_LOAD,
    DIAG_CODE_SSJS_PLATFORM_LOAD_VERSION,
    DIAG_CODE_SSJS_UNSUPPORTED_SYNTAX,
    DIAG_CODE_SSJS_CLR_HEADER_ACCESS,
    DIAG_CODE_SSJS_CLR_CONTENT_ACCESS,
    DIAG_CODE_SSJS_INVALID_HTTP_PROPERTY,
    DIAG_CODE_SSJS_INVALID_PROPERTY_ACCESS,
    DIAG_CODE_SSJS_NONEXISTENT_GLOBAL,
    DIAG_CODE_SSJS_DEPRECATED,
    DIAG_CODE_SSJS_INVALID_ARITY,
    DIAG_CODE_SSJS_NONFUNCTIONAL_METHOD,
    DIAG_CODE_SSJS_SWITCH_FALLTHROUGH,
]);

/**
 * Payload attached to `ssjs/polyfill-required` diagnostics so the code action
 * can insert the polyfill without re-deriving it from ssjs-data.
 */
export interface PolyfillDiagnosticData {
    owner: string;
    method: string;
    polyfill: string;
}

/**
 * Payload attached to `ssjs/replace-with-platform-function` diagnostics so the
 * code action can rewrite the call (e.g. `JSON.parse` → `Platform.Function.ParseJSON`).
 */
export interface ReplaceDiagnosticData {
    owner: string;
    member: string;
    replacement: string;
}

/**
 * Payload attached to `ssjs/clr-header-access` diagnostics so the code action
 * can rewrite the access to `getHeaderMap(<respName>)[<key>]` and insert the
 * helper. `respName` is the response variable; `keyText` is the header-key
 * expression source (e.g. `"Content-Type"`), or empty when none was found.
 */
export interface ClrHeaderAccessDiagnosticData {
    respName: string;
    keyText: string;
}

/**
 * Payload attached to `ssjs/clr-content-access` diagnostics so the code action
 * can wrap the flagged access in `String(...)`. `contentText` is the source of
 * the flagged `<respName>.content` member expression (e.g. `resp.content`).
 */
export interface ClrContentAccessDiagnosticData {
    respName: string;
    contentText: string;
}

/**
 * A single replacement offered by the `ssjs/invalid-http-property-value` quick-fix.
 * `code` is the source-ready literal to insert (already quoted for string enums,
 * e.g. `'GET'`, or a numeric literal like `0`); `label` is an optional short
 * human-readable meaning shown in the action title (e.g. `continue` for `0`).
 */
export interface InvalidHttpPropertySuggestion {
    code: string;
    label?: string;
}

/**
 * Payload attached to `ssjs/invalid-http-property-value` diagnostics so the code
 * action can offer valid replacement values. `propName` is the property (e.g.
 * `method`); `suggestions` are the replacements to offer, each with its
 * source-ready `code` and an optional descriptive `label`.
 */
export interface InvalidHttpPropertyDiagnosticData {
    propName: string;
    suggestions: InvalidHttpPropertySuggestion[];
}

/**
 * Build the `ssjs/polyfill-required` diagnostic message, tailored to whether the
 * member is absent from the SFMC engine (`category: 'unavailable'`) or present
 * but returns wrong results (`category: 'broken'`).
 * @param qualifiedName - Fully-qualified member, e.g. `Array.isArray` or `String.prototype.search`.
 * @param category - Whether the member is unavailable or merely broken in the engine.
 * @returns The diagnostic message string.
 */
function polyfillRequiredMessage(
    qualifiedName: string,
    category: 'unavailable' | 'broken',
): string {
    return category === 'broken'
        ? `${qualifiedName} is broken in the SFMC SSJS engine and returns wrong results, but a polyfill exists. Insert the polyfill to use it safely.`
        : `${qualifiedName} is not available in SFMC SSJS, but a polyfill exists. Insert the polyfill to use it safely.`;
}

/**
 * Extract a runtime-safe replacement suggestion for a phantom global from its
 * data entry. Prefers the `Platform.*` call named in the officialDocsNote or
 * description, falling back to a generic hint.
 * @param entry - The phantom global entry (may be undefined).
 * @returns A replacement suggestion (e.g. `Platform.Response.Redirect(...)`).
 */
function phantomReplacement(entry: SsjsFunction | undefined): string {
    const source = `${entry?.officialDocsNote ?? ''} ${entry?.description ?? ''}`;
    const match = source.match(/Platform\.[A-Za-z.]+\([^)]*\)/);
    return match ? match[0] : 'a supported alternative';
}

/**
 * Scan the document for calls to a single `requiresCoreLoad` method and return
 * diagnostics for each occurrence that appears before the first Platform.Load.
 * Extracted so the match loop is not nested inside the per-entry `for` loop
 * (avoids `continue` in a nested loop).
 * @param text - Full document text.
 * @param entry - The method to scan for.
 * @param entry.prefix - The owner prefix (e.g. `HTTPHeader`).
 * @param entry.name - The method name (e.g. `Add`).
 * @param commentRanges - Comment ranges to skip.
 * @param platformLoadOffset - Offset of the first real Platform.Load call.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for this method's early calls (length ≤ budget).
 */
function collectCoreLoadCallDiagnostics(
    text: string,
    entry: { prefix: string; name: string },
    commentRanges: Array<[number, number]>,
    platformLoadOffset: number,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const callPattern = new RegExp(
        String.raw`\b${entry.prefix.replaceAll('.', String.raw`\.`)}\s*\.\s*${entry.name}\s*\(`,
        'g',
    );
    let reqMatch: RegExpExecArray | null;
    while ((reqMatch = callPattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(reqMatch.index, commentRanges)) continue;
        if (reqMatch.index < platformLoadOffset) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, reqMatch.index),
                    end: offsetToPosition(text, reqMatch.index + reqMatch[0].length - 1),
                },
                message: `Platform.Load("core", "1.1.5") must be called before using ${entry.prefix}.${entry.name}(). Without it, this call will fail at runtime.`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_REQUIRE_PLATFORM_LOAD,
            });
        }
    }
    return diagnostics;
}

/**
 * Scan the document for a single unsupported ES6+ pattern and return a
 * diagnostic for each non-comment occurrence. Extracted so the match loop is
 * not nested inside the per-pattern `for` loop (avoids `continue` in a nested
 * loop).
 * @param text - Full document text.
 * @param pattern - The ES6+ detection regex (global flag).
 * @param message - The diagnostic message for this pattern.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for this pattern (length ≤ budget).
 */
function collectEs6PatternDiagnostics(
    text: string,
    pattern: RegExp,
    message: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(match.index, commentRanges)) continue;
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, match.index),
                end: offsetToPosition(text, match.index + match[0].length),
            },
            message,
            source: 'ssjs',
            code: DIAG_CODE_SSJS_UNSUPPORTED_SYNTAX,
        });
    }
    return diagnostics;
}

/**
 * Scan the document for CLR-unsafe reads of an HttpResponse `.headers` object.
 *
 * A response variable is one assigned from `<reqVar>.send()`, where `<reqVar>`
 * was assigned from `new Script.Util.HttpRequest(...)` or `Script.Util.HttpGet(...)`.
 * Reading `<respVar>.headers` by indexing (`resp.headers["x"]`), `.Get("x")`, or
 * `.Item("x")` throws "Use of Common Language Runtime (CLR) is not allowed" at
 * runtime — these are flagged with a quick-fix that inserts a `getHeaderMap()`
 * helper and rewrites the read to `getHeaderMap(resp)[…]`.
 * @param text - Full document text.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for CLR header reads (length ≤ budget).
 */
function collectClrHeaderAccessDiagnostics(
    text: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0) return diagnostics;

    // 1. Collect request variables: `var req = new Script.Util.HttpRequest(...)`
    //    or `var greq = Script.Util.HttpGet(...)` (HttpGet is often called sans new).
    const requestVars = new Set<string>();
    const reqPattern =
        /\b(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?Script\s*\.\s*Util\s*\.\s*(?:HttpRequest|HttpGet)\s*\(/g;
    let rm: RegExpExecArray | null;
    while ((rm = reqPattern.exec(text)) !== null) {
        if (isInCommentRange(rm.index, commentRanges)) continue;
        requestVars.add(rm[1]);
    }
    if (requestVars.size === 0) return diagnostics;

    // 2. Collect response variables: `var resp = <reqVar>.send()`.
    const responseVars = new Set<string>();
    const sendPattern =
        /\b(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*send\s*\(/g;
    let sm: RegExpExecArray | null;
    while ((sm = sendPattern.exec(text)) !== null) {
        if (isInCommentRange(sm.index, commentRanges)) continue;
        if (requestVars.has(sm[2])) responseVars.add(sm[1]);
    }
    if (responseVars.size === 0) return diagnostics;

    // 3a. Computed index read: `<resp>.headers["Content-Type"]`.
    const indexPattern = /\b([A-Za-z_$][\w$]*)\s*\.\s*headers\s*\[\s*([^\]]*?)\s*\]/g;
    let im: RegExpExecArray | null;
    while ((im = indexPattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(im.index, commentRanges)) continue;
        if (!responseVars.has(im[1])) continue;
        const data: ClrHeaderAccessDiagnosticData = { respName: im[1], keyText: im[2].trim() };
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, im.index),
                end: offsetToPosition(text, im.index + im[0].length),
            },
            message:
                'Reading a header this way throws "Use of Common Language Runtime (CLR) is not allowed" at runtime. ' +
                'HttpResponse headers are only readable by enumerating with for..in — use a getHeaderMap() helper.',
            source: 'ssjs',
            code: DIAG_CODE_SSJS_CLR_HEADER_ACCESS,
            data,
        });
    }

    // 3b. CLR method call: `<resp>.headers.Get("x")` / `<resp>.headers.Item("x")`.
    const callPattern =
        /\b([A-Za-z_$][\w$]*)\s*\.\s*headers\s*\.\s*(?:Get|Item)\s*\(\s*([^)]*?)\s*\)/g;
    let cm: RegExpExecArray | null;
    while ((cm = callPattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(cm.index, commentRanges)) continue;
        if (!responseVars.has(cm[1])) continue;
        const data: ClrHeaderAccessDiagnosticData = { respName: cm[1], keyText: cm[2].trim() };
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, cm.index),
                end: offsetToPosition(text, cm.index + cm[0].length),
            },
            message:
                'Reading a header this way throws "Use of Common Language Runtime (CLR) is not allowed" at runtime. ' +
                'HttpResponse headers are only readable by enumerating with for..in — use a getHeaderMap() helper.',
            source: 'ssjs',
            code: DIAG_CODE_SSJS_CLR_HEADER_ACCESS,
            data,
        });
    }

    return diagnostics;
}

/**
 * Scan the document for raw reads of an HttpResponse `.content` CLR string that
 * are not wrapped in `String()`.
 *
 * A response variable is one assigned from `<reqVar>.send()`, where `<reqVar>`
 * was assigned from `new Script.Util.HttpRequest(...)` or `Script.Util.HttpGet(...)`.
 * `<respVar>.content` is a CLR string, not a JavaScript string, so using it
 * directly (ParseJSON, string methods, concatenation, assignment) is unreliable.
 * Reads that are already the direct argument of a `String(...)` call are skipped.
 * Each flag carries a quick-fix that wraps the access in `String(...)`.
 * @param text - Full document text.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for raw content reads (length ≤ budget).
 */
function collectClrContentAccessDiagnostics(
    text: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0) return diagnostics;

    // 1. Collect request variables (same shape as the header rule).
    const requestVars = new Set<string>();
    const reqPattern =
        /\b(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?Script\s*\.\s*Util\s*\.\s*(?:HttpRequest|HttpGet)\s*\(/g;
    let rm: RegExpExecArray | null;
    while ((rm = reqPattern.exec(text)) !== null) {
        if (isInCommentRange(rm.index, commentRanges)) continue;
        requestVars.add(rm[1]);
    }
    if (requestVars.size === 0) return diagnostics;

    // 2. Collect response variables: `var resp = <reqVar>.send()`.
    const responseVars = new Set<string>();
    const sendPattern =
        /\b(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*send\s*\(/g;
    let sm: RegExpExecArray | null;
    while ((sm = sendPattern.exec(text)) !== null) {
        if (isInCommentRange(sm.index, commentRanges)) continue;
        if (requestVars.has(sm[2])) responseVars.add(sm[1]);
    }
    if (responseVars.size === 0) return diagnostics;

    // 3. Raw `.content` read (word boundary after `content` so we don't match a
    //    longer identifier like `contentType`). Skip when the immediately
    //    preceding non-space token is `String(` — that is the verified-safe wrap.
    const contentPattern = /\b([A-Za-z_$][\w$]*)\s*\.\s*content\b/g;
    let em: RegExpExecArray | null;
    while ((em = contentPattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(em.index, commentRanges)) continue;
        if (!responseVars.has(em[1])) continue;
        // Skip `String(<resp>.content)` — check the text right before the match.
        const before = text.slice(Math.max(0, em.index - 8), em.index);
        if (/String\s*\(\s*$/.test(before)) continue;
        const contentText = em[0].replaceAll(/\s+/g, '');
        const data: ClrContentAccessDiagnosticData = { respName: em[1], contentText };
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, em.index),
                end: offsetToPosition(text, em.index + em[0].length),
            },
            message:
                'Reading `.content` directly is unreliable — it is a CLR string, not a JavaScript string. ' +
                'Wrap it with `String(...)` before passing it to ParseJSON() or any string operation.',
            source: 'ssjs',
            code: DIAG_CODE_SSJS_CLR_CONTENT_ACCESS,
            data,
        });
    }

    return diagnostics;
}

/**
 * Parse an assignment RHS literal source into a typed value, or `undefined` when
 * the source is not a plain string/number/boolean literal (variables, expressions,
 * template strings, etc. cannot be statically verified and are left alone).
 * @param raw - Trimmed RHS source, e.g. `'POT'`, `5`, `-2.45`, `true`, `someVar`.
 * @returns `{ value }` for a recognised literal, or `undefined` to skip.
 */
function parseLiteralValue(raw: string): { value: string | number | boolean } | undefined {
    // String literal: '…' or "…" with no embedded quote of the same kind.
    const strMatch = /^(['"])((?:(?!\1).)*)\1$/.exec(raw);
    if (strMatch) return { value: strMatch[2] };
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    // Numeric literal (integer or decimal, optional leading sign). Reject NaN etc.
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
        const n = Number(raw);
        if (!Number.isNaN(n)) return { value: n };
    }
    return undefined;
}

/**
 * Validate a literal value against a property value constraint.
 * @param value - The parsed literal value.
 * @param constraint - The property's value constraint from ssjs-data.
 * @returns A human-readable violation message, or `undefined` when the value is valid.
 */
function checkValueConstraint(
    value: string | number | boolean,
    constraint: HttpPropertyValueConstraint,
): string | undefined {
    if (constraint.enum) {
        if (constraint.enum.includes(value as string | number)) return undefined;
        const allowed = constraint.enum
            .map((v) => (typeof v === 'string' ? `"${v}"` : String(v)))
            .join(', ');
        return `must be one of ${allowed}`;
    }
    if (constraint.numeric) {
        if (typeof value !== 'number') return `must be a number`;
        if (constraint.numeric === 'integer' && !Number.isSafeInteger(value)) {
            return `must be a whole number (integer)`;
        }
        if (constraint.min !== undefined && value < constraint.min) {
            return `must be >= ${constraint.min}`;
        }
    }
    return undefined;
}

/**
 * Build the replacement suggestions offered by the quick-fix for a constraint
 * violation. Enum → each allowed value (quoted for strings), each carrying its
 * `enumLabels` meaning when defined. Numeric → nothing offered (no single
 * unambiguous fix). Returns at most a handful.
 * @param constraint - The violated constraint.
 * @returns Array of suggestions (may be empty).
 */
function constraintSuggestions(
    constraint: HttpPropertyValueConstraint,
): InvalidHttpPropertySuggestion[] {
    if (constraint.enum) {
        const labels = constraint.enumLabels;
        return constraint.enum.map((v) => ({
            code: typeof v === 'string' ? `'${v}'` : String(v),
            label: labels ? labels[String(v)] : undefined,
        }));
    }
    return [];
}

/**
 * Scan the document for literal assignments to an HttpRequest / HttpGet writable
 * property whose value violates the property's ssjs-data value constraint.
 *
 * A request variable is one assigned from `new Script.Util.HttpRequest(...)` or
 * `Script.Util.HttpGet(...)`. For each `<reqVar>.<prop> = <literal>;` where
 * `<prop>` carries a `valueConstraint`, the RHS literal is parsed and validated.
 * Only literal string/number/boolean RHS values are checked — variables and
 * expressions cannot be statically verified and are skipped to avoid false
 * positives.
 * @param text - Full document text.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for invalid property assignments (length ≤ budget).
 */
function collectInvalidHttpPropertyDiagnostics(
    text: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0 || httpPropertyConstraintLookup.size === 0) return diagnostics;

    // 1. Collect request variables (same shape as the CLR rules).
    const requestVars = new Set<string>();
    const reqPattern =
        /\b(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?Script\s*\.\s*Util\s*\.\s*(?:HttpRequest|HttpGet)\s*\(/g;
    let rm: RegExpExecArray | null;
    while ((rm = reqPattern.exec(text)) !== null) {
        if (isInCommentRange(rm.index, commentRanges)) continue;
        requestVars.add(rm[1]);
    }
    if (requestVars.size === 0) return diagnostics;

    // 2. `<reqVar>.<prop> = <rhs>;` assignments (single-line RHS up to ; or newline).
    const assignPattern = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
    let am: RegExpExecArray | null;
    while ((am = assignPattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(am.index, commentRanges)) continue;
        const [, reqVar, propName, rhsRaw] = am;
        if (!requestVars.has(reqVar)) continue;
        const constraint = httpPropertyConstraintLookup.get(propName);
        if (!constraint) continue;
        const parsed = parseLiteralValue(rhsRaw.trim());
        if (!parsed) continue;
        const violation = checkValueConstraint(parsed.value, constraint);
        if (!violation) continue;
        const data: InvalidHttpPropertyDiagnosticData = {
            propName,
            suggestions: constraintSuggestions(constraint),
        };
        // Range covers just the RHS literal for a focused squiggle + quick-fix.
        const rhsTrimmed = rhsRaw.trim();
        const rhsRawStart = am.index + am[0].length - rhsRaw.length;
        const rhsStart = rhsRawStart + (rhsRaw.length - rhsRaw.trimStart().length);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, rhsStart),
                end: offsetToPosition(text, rhsStart + rhsTrimmed.length),
            },
            message: `Invalid value for ${propName}: it ${violation}.`,
            source: 'ssjs',
            code: DIAG_CODE_SSJS_INVALID_HTTP_PROPERTY,
            data,
        });
    }

    return diagnostics;
}

/**
 * Builds the diagnostic message for a restricted-access violation.
 * @param owner - Qualified owner name (e.g. `Platform.Request`).
 * @param name - Property name as declared in ssjs-data.
 * @param access - The restriction that was violated.
 * @returns The human-readable diagnostic message.
 */
function propertyAccessMessage(owner: string, name: string, access: PropertyAccess): string {
    if (access === 'write-only') {
        return (
            `'${owner}.${name}' is write-only. Reading it throws "Property Get method was not ` +
            `found." at runtime — outside a try/catch that throw aborts the whole page. Keep the ` +
            `value in your own variable instead.`
        );
    }
    if (access === 'write-only-opaque') {
        return (
            `'${owner}.${name}' does not read back the value you assigned — the runtime returns ` +
            `an opaque CLR value. Keep the value in your own variable instead.`
        );
    }
    return `'${owner}.${name}' is read-only. Assigning to it has no effect.`;
}

/**
 * Scan the document for property accesses that go against the direction the
 * runtime supports: reading a `write-only` / `write-only-opaque` property, or
 * assigning to a `read-only` one. The restrictions come from ssjs-data's
 * `access` field, so this pass and the `ssjs-no-invalid-property-access` rule
 * share one source of truth.
 *
 * Accesses on a bare identifier only count when that identifier holds a
 * `Script.Util.HttpRequest` / `HttpGet` instance (same tracking as the other
 * HTTP passes); `Platform.Request.*` / `Platform.Response.*` are matched on the
 * literal member path.
 * @param text - Full document text.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for invalid property accesses (length ≤ budget).
 */
function collectInvalidPropertyAccessDiagnostics(
    text: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0 || propertyAccessLookup.size === 0) return diagnostics;

    // 1. Collect request variables (same shape as the other HTTP passes).
    const requestVars = new Set<string>();
    const reqPattern =
        /\b(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?Script\s*\.\s*Util\s*\.\s*(?:HttpRequest|HttpGet)\s*\(/g;
    let rm: RegExpExecArray | null;
    while ((rm = reqPattern.exec(text)) !== null) {
        if (isInCommentRange(rm.index, commentRanges)) continue;
        requestVars.add(rm[1]);
    }

    // 2. Every `Platform.Request|Response.<prop>` or `<identifier>.<prop>` access.
    // The Platform branch is listed first so it wins over the bare-identifier one.
    const accessPattern =
        /\bPlatform\s*\.\s*(Request|Response)\s*\.\s*([A-Za-z_$][\w$]*)|\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/g;
    let am: RegExpExecArray | null;
    while ((am = accessPattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(am.index, commentRanges)) continue;
        const [match, platformNs, platformProp, identifier, identifierProp] = am;
        let owner: string;
        let propName: string;
        if (platformNs) {
            owner = `Platform.${platformNs}`;
            propName = platformProp;
        } else if (requestVars.has(identifier)) {
            owner = 'Script.Util.HttpRequest';
            propName = identifierProp;
        } else {
            continue;
        }
        const entry = propertyAccessLookup.get(`${owner}.${propName}`.toLowerCase());
        if (!entry) continue;

        // A plain `=` right after the member expression makes this a write;
        // `==` / `===` / `=>` are comparisons or arrows, i.e. still reads.
        const after = text.slice(am.index + match.length);
        const isWrite = /^\s*=(?![=>])/.test(after);
        if (isWrite !== (entry.access === 'read-only')) continue;
        // The call form (`Platform.Response.ContentType()`) is already reported
        // by the property-call diagnostics — skip it here to avoid duplicates.
        if (!isWrite && /^\s*\(/.test(after)) continue;

        diagnostics.push({
            severity:
                entry.access === 'write-only-opaque'
                    ? DiagnosticSeverity.Warning
                    : DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, am.index),
                end: offsetToPosition(text, am.index + match.length),
            },
            message: propertyAccessMessage(entry.owner, entry.name, entry.access),
            source: 'ssjs',
            code: DIAG_CODE_SSJS_INVALID_PROPERTY_ACCESS,
        });
    }

    return diagnostics;
}

/**
 * Renders a `validArities` set as a human phrase, e.g. `[1, 6]` → "1 or 6",
 * `[1, 2, 4]` → "1, 2 or 4".
 * @param arities - Sorted list of exact permitted argument counts.
 * @returns A human-readable phrase joining the arities with commas and "or".
 */
function formatArities(arities: number[]): string {
    if (arities.length === 0) return '';
    if (arities.length === 1) return String(arities[0]);
    return `${arities.slice(0, -1).join(', ')} or ${arities.at(-1)}`;
}

/**
 * Blanks the contents of single/double-quoted string literals and line/block
 * comments (preserving length and newlines) so that commas inside strings or
 * comments do not inflate top-level argument counts. Positions are preserved,
 * so offsets computed on the returned text map 1:1 onto the original document.
 * @param text - Full document text.
 * @returns A copy of `text` with string/comment contents replaced by spaces.
 */
function blankStringsAndComments(text: string): string {
    const chars = [...text];
    let index = 0;
    while (index < chars.length) {
        const ch = chars[index];
        if (ch === '/' && chars[index + 1] === '/') {
            index = blankLineComment(chars, index);
        } else if (ch === '/' && chars[index + 1] === '*') {
            index = blankBlockComment(chars, index);
        } else if (ch === '"' || ch === "'") {
            index = blankStringLiteral(chars, index, ch);
        } else {
            index++;
        }
    }
    return chars.join('');
}

/**
 * Blanks a `//` line comment starting at `index` up to (but excluding) the
 * newline. Returns the index just past the blanked region.
 * @param chars - Mutable character array being sanitized.
 * @param index - Index of the first `/` of the line comment.
 * @returns Index of the character after the blanked comment.
 */
function blankLineComment(chars: string[], index: number): number {
    let cursor = index;
    while (cursor < chars.length && chars[cursor] !== '\n') {
        chars[cursor] = ' ';
        cursor++;
    }
    return cursor;
}

/**
 * Blanks a block comment (slash-star … star-slash) starting at `index`,
 * preserving newlines. Returns the index just past the closing delimiter
 * (or end of input).
 * @param chars - Mutable character array being sanitized.
 * @param index - Index of the opening `/` of the block comment.
 * @returns Index of the character after the blanked comment.
 */
function blankBlockComment(chars: string[], index: number): number {
    chars[index] = ' ';
    chars[index + 1] = ' ';
    let cursor = index + 2;
    while (cursor < chars.length && !(chars[cursor] === '*' && chars[cursor + 1] === '/')) {
        if (chars[cursor] !== '\n') chars[cursor] = ' ';
        cursor++;
    }
    if (cursor < chars.length) {
        chars[cursor] = ' ';
        chars[cursor + 1] = ' ';
        cursor += 2;
    }
    return cursor;
}

/**
 * Blanks a single/double-quoted string literal starting at the opening quote,
 * honouring backslash escapes and preserving newlines. Returns the index just
 * past the closing quote (or end of input).
 * @param chars - Mutable character array being sanitized.
 * @param index - Index of the opening quote.
 * @param quote - The quote character that delimits the literal.
 * @returns Index of the character after the blanked literal.
 */
function blankStringLiteral(chars: string[], index: number, quote: string): number {
    let cursor = index + 1;
    while (cursor < chars.length && chars[cursor] !== quote) {
        if (chars[cursor] === '\\') {
            chars[cursor] = ' ';
            cursor++;
            if (cursor < chars.length && chars[cursor] !== '\n') chars[cursor] = ' ';
        } else {
            if (chars[cursor] !== '\n') chars[cursor] = ' ';
        }
        cursor++;
    }
    return cursor + 1;
}

/**
 * Flags Platform.Function calls whose argument count is within the contiguous
 * [minArgs, maxArgs] range but is NOT one of the exact permitted arities for a
 * discontinuous overload (ssjs-data `validArities`). Only runs for functions
 * that declare `validArities`; all other functions are left to the normal
 * contiguous range checks (handled by eslint-plugin-sfmc), so nothing else
 * regresses.
 * @param text - Full document text.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for invalid discontinuous arities (length ≤ budget).
 */
function collectPlatformFunctionArityDiagnostics(
    text: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0) return diagnostics;

    // Only functions with an explicit validArities set participate.
    const arityFunctions = [...platformFunctionLookup.values()].filter(
        (f) => Array.isArray(f.validArities) && f.validArities.length > 0,
    );
    if (arityFunctions.length === 0) return diagnostics;

    // String/comment-blanked copy so commas inside args don't inflate counts.
    const sanitizedText = blankStringsAndComments(text);

    for (const entry of arityFunctions) {
        if (diagnostics.length >= budget) break;
        const validArities = entry.validArities!;
        // Match Platform.Function.<Name>( — tolerant of whitespace around dots.
        const pattern = new RegExp(
            String.raw`Platform\s*\.\s*Function\s*\.\s*${entry.name}\s*\(`,
            'gi',
        );
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null && diagnostics.length < budget) {
            const openParenPos = match.index + match[0].length - 1;
            const actual = countFunctionArguments(sanitizedText, openParenPos);
            // Flag only real (non-comment) calls whose count is inside the
            // contiguous range but is not one of the exact permitted arities.
            const isDiscontinuousViolation =
                !isInCommentRange(match.index, commentRanges) &&
                actual >= entry.minArgs &&
                actual <= entry.maxArgs &&
                !validArities.includes(actual);
            if (isDiscontinuousViolation) {
                // Highlight just the function name for a focused squiggle.
                const nameStart =
                    match.index + match[0].toLowerCase().lastIndexOf(entry.name.toLowerCase());
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, nameStart),
                        end: offsetToPosition(text, nameStart + entry.name.length),
                    },
                    message: `'${entry.name}' must be called with exactly ${formatArities(validArities)} arguments (got ${actual}); intermediate argument counts throw at runtime.`,
                    source: 'ssjs',
                    code: DIAG_CODE_SSJS_INVALID_ARITY,
                });
            }
        }
    }

    return diagnostics;
}

/**
 * Extract a short factual pointer (first sentence) from an entry's
 * officialDocsNote for the warning message. Returns '' when absent.
 * @param entry - ssjs-data method entry, or undefined.
 * @returns A short note, or empty string.
 */
function nonFunctionalShortNote(entry: SsjsFunction | undefined): string {
    if (!entry || typeof entry.officialDocsNote !== 'string') {
        return '';
    }
    const trimmed = entry.officialDocsNote.trim();
    if (trimmed === '') {
        return '';
    }
    const sentenceEnd = trimmed.indexOf('. ');
    return sentenceEnd === -1 ? trimmed : trimmed.slice(0, sentenceEnd + 1);
}

/**
 * Collect diagnostics for Core Library method calls that resolve at runtime but
 * have no known working invocation (ssjs-data `nonFunctionalAtRuntime`).
 *
 * Resolves both static (`FilterDefinition.Update(...)`, `DataExtension.Rows.Add(...)`)
 * and instance (`var fd = FilterDefinition.Init(...); fd.Update(...)`) call styles,
 * mirroring the eslint-plugin-sfmc `ssjs-no-nonfunctional-method` rule.
 * @param text - Full document text.
 * @param commentRanges - Precomputed comment ranges to skip.
 * @param remaining - Maximum number of diagnostics to emit.
 * @returns Array of Error diagnostics.
 */
function collectNonFunctionalMethodDiagnostics(
    text: string,
    commentRanges: ReturnType<typeof buildCommentRanges>,
    remaining: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (coreNonFunctionalMethodLookup.size === 0 || remaining <= 0) {
        return diagnostics;
    }

    // Track `var x = Class.Init(...)` / `x = A.B.Init(...)` → x maps to the class.
    const initVars = new Map<string, string>();
    const initPattern =
        /(?:\b(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$.]*)\s*\.\s*Init\s*\(/g;
    let initMatch: RegExpExecArray | null;
    while ((initMatch = initPattern.exec(text)) !== null) {
        if (isInCommentRange(initMatch.index, commentRanges)) continue;
        const className = initMatch[2];
        if (coreObjectNameSet.has(className)) {
            initVars.set(initMatch[1], className);
        }
    }

    // Match any `<receiver>.<Method>(` call. The receiver may be a dotted path.
    const callPattern =
        /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callPattern.exec(text)) !== null && diagnostics.length < remaining) {
        if (isInCommentRange(callMatch.index, commentRanges)) continue;
        const receiver = callMatch[1].replaceAll(/\s+/g, '');
        const methodName = callMatch[2];

        // Resolve the class key: either the receiver IS a core object path
        // (STATIC call style), or its leftmost segment is an Init-tracked
        // instance variable (INSTANCE call style).
        let classKey: string | null = null;
        let displayReceiver: string | null = null;
        let isInstanceStyle = false;
        if (coreObjectNameSet.has(receiver)) {
            classKey = receiver.toLowerCase();
            displayReceiver = receiver;
        } else {
            const segments = receiver.split('.');
            const rootType = initVars.get(segments[0]);
            if (rootType) {
                const resolvedPath = [rootType, ...segments.slice(1)].join('.');
                classKey = resolvedPath.toLowerCase();
                displayReceiver = resolvedPath;
                isInstanceStyle = true;
            }
        }
        if (!classKey || !displayReceiver) continue;

        const classLookup = coreNonFunctionalMethodLookup.get(classKey);
        if (!classLookup) continue;
        const entry = classLookup.get(methodName.toLowerCase());
        if (!entry) continue;
        // A method's `isStatic` flag determines which call style it is valid
        // for (mirrors the SendInstance/namespace split in generate-dts.mjs).
        // Skip a match where the call style contradicts the entry's flag —
        // e.g. calling a static-only method via an instance variable is not a
        // "known" call at all, so it must not be reported as this diagnostic.
        if (isInstanceStyle ? entry.isStatic !== false : entry.isStatic === false) continue;

        // Report on the method name identifier. It is the last identifier in the
        // match (immediately before the optional whitespace and `(`), so locate it
        // from the tail to avoid colliding with an identical name in the receiver.
        const matchText = callMatch[0];
        const methodOffset =
            callMatch.index + matchText.lastIndexOf(methodName, matchText.length - 1);
        const note = nonFunctionalShortNote(entry);
        diagnostics.push({
            // Confirmed non-functional at runtime (every tested call fails) — this is
            // stronger than a mere deprecation warning, so it is reported as an Error.
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, methodOffset),
                end: offsetToPosition(text, methodOffset + methodName.length),
            },
            message: `'${displayReceiver}.${methodName}' exists in SFMC SSJS but has no known working invocation at runtime (every tested call fails).${note ? ` ${note}` : ''}`,
            source: 'ssjs',
            code: DIAG_CODE_SSJS_NONFUNCTIONAL_METHOD,
        });
    }

    return diagnostics;
}

/**
 * Extracts the trailing "Deprecated — ..." / "DEPRECATED — ..." sentence from a
 * deprecated method's `description` so each Core Library class can surface its
 * own reasoning (e.g. Email vs ContentAreaObj vs Send.Definition wording differs).
 * @param entry - The deprecated method entry.
 * @returns The deprecation sentence, or a generic fallback when none is found.
 */
function deprecationNote(entry: SsjsFunction): string {
    const match = /deprecated\s*—\s*(.+)$/i.exec(entry.description ?? '');
    return match ? `Deprecated — ${match[1]}` : 'This API is deprecated.';
}

// Matches `Platform.Load("core", "<version>")`. Kept as a source string because the
// pattern is used with the global flag in two places and would otherwise share
// lastIndex state between scans.
const PLATFORM_LOAD_VERSION_SOURCE = String.raw`Platform\s*\.\s*Load\s*\(\s*["']core["']\s*,\s*["']([^"']*)["']\s*\)`;

/**
 * Find the Core version a document loads via `Platform.Load("core", "<version>")`.
 * @param text - Full document text.
 * @param commentRanges - Precomputed comment ranges to skip.
 * @returns The first non-commented version string, or undefined when none is found.
 */
function findLoadedCoreVersion(
    text: string,
    commentRanges: ReturnType<typeof buildCommentRanges>,
): string | undefined {
    const pattern = new RegExp(PLATFORM_LOAD_VERSION_SOURCE, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        if (isInCommentRange(match.index, commentRanges)) continue;
        return match[1];
    }
    return undefined;
}

/**
 * Split a Core version string into three numeric segments, padding missing ones
 * with 0 so "1" and "1.0.0" are equivalent.
 * @param version - Version string, e.g. "1" or "1.1.5".
 * @returns Three numeric segments.
 */
function parseCoreVersion(version: string): number[] {
    const parts = version.split('.').map((p) => Number(p) || 0);
    while (parts.length < 3) parts.push(0);
    return parts;
}

/**
 * Compare two Core version strings ("1", "1.1.5", …) numerically.
 * @param a - Left version.
 * @param b - Right version.
 * @returns Negative when a < b, 0 when equal, positive when a > b.
 */
function compareCoreVersions(a: string, b: string): number {
    const left = parseCoreVersion(a);
    const right = parseCoreVersion(b);
    for (const [index, element] of left.entries()) {
        if (element !== right[index]) return element - right[index];
    }
    return 0;
}

/**
 * Collect diagnostics for Core Library method calls flagged `deprecated` in
 * ssjs-data (e.g. `ContentAreaObj.Init`, `Send.Definition.Add`, `Portfolio.Update`).
 *
 * Resolves both static (`Portfolio.Retrieve(...)`) and instance
 * (`var p = Portfolio.Init(...); p.Update(...)`) call styles, mirroring the
 * eslint-plugin-sfmc `ssjs-no-deprecated-function` rule and the sibling
 * `collectNonFunctionalMethodDiagnostics` above.
 * @param text - Full document text.
 * @param commentRanges - Precomputed comment ranges to skip.
 * @param remaining - Maximum number of diagnostics to emit.
 * @returns Array of Warning diagnostics.
 */
function collectDeprecatedMethodDiagnostics(
    text: string,
    commentRanges: ReturnType<typeof buildCommentRanges>,
    remaining: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (coreDeprecatedMethodLookup.size === 0 || remaining <= 0) {
        return diagnostics;
    }

    // Track `var x = Class.Init(...)` / `x = A.B.Init(...)` → x maps to the class.
    const initVars = new Map<string, string>();
    const initPattern =
        /(?:\b(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$.]*)\s*\.\s*Init\s*\(/g;
    let initMatch: RegExpExecArray | null;
    while ((initMatch = initPattern.exec(text)) !== null) {
        if (isInCommentRange(initMatch.index, commentRanges)) continue;
        const className = initMatch[2];
        if (coreObjectNameSet.has(className)) {
            initVars.set(initMatch[1], className);
        }
    }

    // Match any `<receiver>.<Method>(` call. The receiver may be a dotted path.
    const callPattern =
        /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callPattern.exec(text)) !== null && diagnostics.length < remaining) {
        if (isInCommentRange(callMatch.index, commentRanges)) continue;
        const receiver = callMatch[1].replaceAll(/\s+/g, '');
        const methodName = callMatch[2];

        // Resolve the class key: either the receiver IS a core object path
        // (STATIC call style), or its leftmost segment is an Init-tracked
        // instance variable (INSTANCE call style).
        let classKey: string | null = null;
        let displayReceiver: string | null = null;
        let isInstanceStyle = false;
        if (coreObjectNameSet.has(receiver)) {
            classKey = receiver.toLowerCase();
            displayReceiver = receiver;
        } else {
            const segments = receiver.split('.');
            const rootType = initVars.get(segments[0]);
            if (rootType) {
                const resolvedPath = [rootType, ...segments.slice(1)].join('.');
                classKey = resolvedPath.toLowerCase();
                displayReceiver = resolvedPath;
                isInstanceStyle = true;
            }
        }
        if (!classKey || !displayReceiver) continue;

        const classLookup = coreDeprecatedMethodLookup.get(classKey);
        if (!classLookup) continue;
        const entry = classLookup.get(methodName.toLowerCase());
        if (!entry) continue;
        // A method's `isStatic` flag determines which call style it is valid
        // for (mirrors the <Class>Instance/namespace split in generate-dts.mjs).
        // Skip a match where the call style contradicts the entry's flag —
        // e.g. `send.RetrieveLists()` calls a static-only method via an
        // instance variable, which is not a "known" deprecated call at all
        // (it does not exist on SendInstance), so it must not be reported here.
        if (isInstanceStyle ? entry.isStatic !== false : entry.isStatic === false) continue;

        // Report on the method name identifier. It is the last identifier in the
        // match (immediately before the optional whitespace and `(`), so locate it
        // from the tail to avoid colliding with an identical name in the receiver.
        const matchText = callMatch[0];
        const methodOffset =
            callMatch.index + matchText.lastIndexOf(methodName, matchText.length - 1);
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: offsetToPosition(text, methodOffset),
                end: offsetToPosition(text, methodOffset + methodName.length),
            },
            message: `'${displayReceiver}.${methodName}' is deprecated. ${deprecationNote(entry)}`,
            source: 'ssjs',
            code: DIAG_CODE_SSJS_DEPRECATED,
        });
    }

    return diagnostics;
}

/**
 * A single top-level clause of a switch body: its `case`/`default` keyword
 * offset, the offset where its body (consequent statements) begins, and the
 * offset just before the next clause keyword (or the closing brace).
 */
interface SwitchClause {
    keywordOffset: number;
    bodyStart: number;
    bodyEnd: number;
}

/**
 * Find the matching closing brace for the `{` at `openIndex` in the sanitized
 * text (strings/comments already blanked so braces inside them do not count).
 * @param sanitized - String/comment-blanked copy of the document.
 * @param openIndex - Index of the opening `{`.
 * @returns Index of the matching `}`, or -1 when unbalanced.
 */
function findMatchingBrace(sanitized: string, openIndex: number): number {
    let depth = 0;
    for (let index = openIndex; index < sanitized.length; index++) {
        const ch = sanitized[index];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return index;
        }
    }
    return -1;
}

/**
 * Split a switch body (the text between its braces) into its top-level
 * `case`/`default` clauses. Only depth-0 `case`/`default` keywords count, so
 * labels inside a nested switch/block are not treated as clauses of this one.
 * @param sanitized - String/comment-blanked copy of the document.
 * @param bodyStart - Offset just after the switch body's opening `{`.
 * @param bodyEnd - Offset of the switch body's closing `}`.
 * @returns The clauses in source order (empty when the switch has none).
 */
function splitSwitchClauses(sanitized: string, bodyStart: number, bodyEnd: number): SwitchClause[] {
    const clausePattern = /\b(case|default)\b/g;
    clausePattern.lastIndex = bodyStart;
    const keywordOffsets: number[] = [];
    let depth = 0;
    let index = bodyStart;
    // Walk char by char, tracking brace depth, and record clause keywords found
    // only at depth 0 (i.e. directly inside this switch, not a nested block).
    while (index < bodyEnd) {
        const ch = sanitized[index];
        if (ch === '{') {
            depth++;
            index++;
            continue;
        }
        if (ch === '}') {
            depth--;
            index++;
            continue;
        }
        if (depth === 0 && (ch === 'c' || ch === 'd')) {
            clausePattern.lastIndex = index;
            const match = clausePattern.exec(sanitized);
            if (match && match.index === index) {
                keywordOffsets.push(index);
                index += match[0].length;
                continue;
            }
        }
        index++;
    }

    return keywordOffsets.map((keywordOffset, order) => {
        // The body of a clause starts after its label's colon.
        const colon = sanitized.indexOf(':', keywordOffset);
        const bodyStartOffset = colon === -1 ? keywordOffset : colon + 1;
        const bodyEndOffset =
            order + 1 < keywordOffsets.length ? keywordOffsets[order + 1] : bodyEnd;
        return {
            keywordOffset,
            bodyStart: bodyStartOffset,
            bodyEnd: bodyEndOffset,
        };
    });
}

/**
 * Scan the document for `switch` statements that rely on fall-through, which the
 * SFMC SSJS engine never performs. Two broken shapes are flagged on every clause
 * except the last (which has nothing to fall into):
 *   - an EMPTY `case`/`default` label immediately followed by another clause
 *     (stacked-label fall-through), and
 *   - a NON-EMPTY body that does not end in a terminating statement
 *     (`break`/`return`/`throw`/`continue`) before the next clause (cascade
 *     fall-through).
 * Mirrors the eslint-plugin-sfmc `ssjs-no-switch-fallthrough` rule.
 * @param text - Full document text.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for switch fall-through reliance (length ≤ budget).
 */
function collectSwitchFallthroughDiagnostics(
    text: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0) return diagnostics;

    // Blank strings/comments so braces, colons and keywords inside them are
    // ignored; offsets stay aligned 1:1 with the original text.
    const sanitized = blankStringsAndComments(text);
    const switchPattern = /\bswitch\s*\(/g;
    let sm: RegExpExecArray | null;
    while ((sm = switchPattern.exec(sanitized)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(sm.index, commentRanges)) continue;
        // Find the `{` that opens the switch body (skip the discriminant parens).
        const braceOpen = sanitized.indexOf('{', sm.index + sm[0].length);
        if (braceOpen === -1) continue;
        const braceClose = findMatchingBrace(sanitized, braceOpen);
        if (braceClose === -1) continue;

        const clauses = splitSwitchClauses(sanitized, braceOpen + 1, braceClose);
        const remaining = budget - diagnostics.length;
        diagnostics.push(...clauseFallthroughDiagnostics(text, sanitized, clauses, remaining));
    }

    return diagnostics;
}

/**
 * Build fall-through diagnostics for the clauses of a single `switch` body.
 * Every clause except the last is checked (the last has nothing to fall into).
 * @param text - Full document text (for offset→position mapping).
 * @param sanitized - Strings/comments-blanked text (for body inspection).
 * @param clauses - Clauses of one switch body, in source order.
 * @param budget - Maximum number of diagnostics to emit.
 * @returns Diagnostics for clauses relying on fall-through (length ≤ budget).
 */
function clauseFallthroughDiagnostics(
    text: string,
    sanitized: string,
    clauses: SwitchClause[],
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    // Every clause except the last (nothing follows it to fall into).
    const nonTerminalClauses = clauses.slice(0, -1);
    for (const clause of nonTerminalClauses) {
        if (diagnostics.length >= budget) break;
        const body = sanitized.slice(clause.bodyStart, clause.bodyEnd);
        const isEmpty = body.trim().length === 0;
        const terminates = /\b(?:break|return|throw|continue)\b[^;]*;?\s*$/.test(body.trim());
        // A non-empty, properly terminated body does not rely on fall-through.
        if (!isEmpty && terminates) continue;
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: offsetToPosition(text, clause.keywordOffset),
                end: offsetToPosition(text, clause.bodyStart),
            },
            message: isEmpty
                ? 'This empty case relies on fall-through into the next label, but SFMC SSJS ' +
                  'has no fall-through — the shared body never runs. Give this case its own ' +
                  'break-terminated body, or use if / a lookup map.'
                : 'This case body has no terminating break/return/throw, so it relies on ' +
                  'cascading into the next case — but SFMC SSJS has no fall-through and each ' +
                  'case runs only its own statements. End every case with break, or use if / ' +
                  'a lookup map.',
            source: 'ssjs',
            code: DIAG_CODE_SSJS_SWITCH_FALLTHROUGH,
        });
    }
    return diagnostics;
}

/**
 * Names of the built-in / host constructors that are legitimately used with
 * `new` and must never be flagged by the object-returning-constructor check,
 * even in the unlikely event a same-named local function exists.
 */
const NEW_SAFE_BUILTINS = new Set<string>([
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Date',
    'RegExp',
    'Error',
    'Function',
]);

/**
 * Determine whether the body of a function declaration/expression contains a
 * top-level `return { ... }` (a ReturnStatement whose argument is an object
 * literal). Only the function's own body is inspected — `return {}` inside a
 * nested function is ignored by tracking brace depth relative to the body.
 * @param sanitized - String/comment-blanked copy of the document.
 * @param bodyOpen - Offset of the function body's opening `{`.
 * @param bodyClose - Offset of the function body's matching `}`.
 * @returns True when a depth-1 `return {` is found in the body.
 */
function bodyReturnsObjectLiteral(sanitized: string, bodyOpen: number, bodyClose: number): boolean {
    // Walk the body looking for `return` keywords that sit directly in the
    // function body (depth 1 relative to bodyOpen), whose next non-space token
    // is `{`. A `return {` nested inside another function/block is at a deeper
    // depth and is skipped so we only judge THIS constructor's return value.
    const returnPattern = /\breturn\b/g;
    returnPattern.lastIndex = bodyOpen + 1;
    let match: RegExpExecArray | null;
    while ((match = returnPattern.exec(sanitized)) !== null) {
        if (match.index >= bodyClose) break;
        // Compute brace depth between bodyOpen and this return.
        let depth = 0;
        for (let index = bodyOpen; index < match.index; index++) {
            const ch = sanitized[index];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        // depth 1 === directly inside the function body (not a nested block/fn).
        if (depth !== 1) continue;
        // Next non-whitespace character after `return` must be `{` (object literal).
        let cursor = match.index + 'return'.length;
        while (cursor < bodyClose && /\s/.test(sanitized[cursor])) cursor++;
        if (sanitized[cursor] === '{') return true;
    }
    return false;
}

/**
 * Collect the names of user-defined functions whose body `return`s an object
 * literal. Matches both `function Name(...) { ... }` declarations and
 * `var Name = function (...) { ... }` expressions. Uses the sanitized text so
 * that braces/keywords inside strings and comments are ignored.
 * @param text - Full document text.
 * @param sanitized - String/comment-blanked copy of the document.
 * @param commentRanges - Comment ranges to skip.
 * @returns Set of function names that return an object literal.
 */
function collectObjectReturningFunctionNames(
    text: string,
    sanitized: string,
    commentRanges: Array<[number, number]>,
): Set<string> {
    const names = new Set<string>();
    // `function Name(` (declaration) or `var Name = function(` (expression).
    const fnPattern =
        /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b([A-Za-z_$][\w$]*)\s*=\s*function\s*(?:[A-Za-z_$][\w$]*\s*)?\(/g;
    let match: RegExpExecArray | null;
    while ((match = fnPattern.exec(text)) !== null) {
        if (isInCommentRange(match.index, commentRanges)) continue;
        const name = match[1] ?? match[2];
        if (!name) continue;
        // Find the function body's opening `{` after the parameter list.
        const parenOpen = sanitized.indexOf('(', match.index);
        if (parenOpen === -1) continue;
        const parenClose = findMatchingParen(sanitized, parenOpen);
        if (parenClose === -1) continue;
        const bodyOpen = sanitized.indexOf('{', parenClose);
        if (bodyOpen === -1) continue;
        const bodyClose = findMatchingBrace(sanitized, bodyOpen);
        if (bodyClose === -1) continue;
        if (bodyReturnsObjectLiteral(sanitized, bodyOpen, bodyClose)) {
            names.add(name);
        }
    }
    return names;
}

/**
 * Find the matching closing paren for the `(` at `openIndex` in sanitized text.
 * @param sanitized - String/comment-blanked copy of the document.
 * @param openIndex - Index of the opening `(`.
 * @returns Index of the matching `)`, or -1 when unbalanced.
 */
function findMatchingParen(sanitized: string, openIndex: number): number {
    let depth = 0;
    for (let index = openIndex; index < sanitized.length; index++) {
        const ch = sanitized[index];
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return index;
        }
    }
    return -1;
}

/**
 * Scan the document for `new X(...)` expressions where `X` is a user-defined
 * function whose body `return`s an object literal.
 *
 * In the SFMC SSJS engine, `new` on such a constructor returns the empty `this`
 * and silently discards the returned object literal, so the members the caller
 * expects are `undefined` — and calling one of them as a function later aborts
 * the page. Built-in constructors (`new Date()` etc.) and constructors that do
 * not return an object literal are deliberately NOT flagged.
 * @param text - Full document text.
 * @param sanitized - String/comment-blanked copy of the document.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for object-returning-constructor `new` calls (length ≤ budget).
 */
function collectNewObjectReturnDiagnostics(
    text: string,
    sanitized: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0) return diagnostics;

    const objectReturningNames = collectObjectReturningFunctionNames(
        text,
        sanitized,
        commentRanges,
    );
    if (objectReturningNames.size === 0) return diagnostics;

    // `new X(` where X is one of the object-returning user functions.
    const newPattern = /\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = newPattern.exec(text)) !== null && diagnostics.length < budget) {
        if (isInCommentRange(match.index, commentRanges)) continue;
        const calleeName = match[1];
        if (NEW_SAFE_BUILTINS.has(calleeName)) continue;
        if (!objectReturningNames.has(calleeName)) continue;
        // Highlight the callee name for a focused squiggle.
        const nameStart = match.index + match[0].indexOf(calleeName);
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: offsetToPosition(text, nameStart),
                end: offsetToPosition(text, nameStart + calleeName.length),
            },
            message:
                `'new ${calleeName}()' calls a constructor that returns an object literal, which the ` +
                'SFMC SSJS engine discards — the engine returns the empty `this`, so the returned ' +
                'members will be undefined and calling one of them aborts the page. Call ' +
                `'${calleeName}(...)' without 'new', or assign to 'this.<member>' inside the ` +
                'constructor instead of returning an object.',
            source: 'ssjs',
            code: DIAG_CODE_SSJS_NEW_OBJECT_RETURN,
        });
    }
    return diagnostics;
}

/**
 * A single `<script runat="server">` block: the character offsets of its body
 * (between the opening tag and `</script>`) within the full document.
 */
interface ServerScriptBlock {
    bodyStart: number;
    bodyEnd: number;
}

/**
 * Find every `<script runat="server">` block in document order and return the
 * offsets of each block's body. When the document contains no such tag it is
 * treated as a single implicit block spanning the whole text (the pure-`.ssjs`
 * case), so callers can always assume ≥ 1 block.
 * @param text - Full document text.
 * @returns Server-script blocks in document order (at least one).
 */
function findServerScriptBlocks(text: string): ServerScriptBlock[] {
    const blocks: ServerScriptBlock[] = [];
    // `<script ... runat="server" ...>` … `</script>`, case-insensitive, tolerant
    // of attribute order and single/double quotes around the runat value.
    const blockPattern =
        /<script\b[^>]*\brunat\s*=\s*["']server["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
    let match: RegExpExecArray | null;
    while ((match = blockPattern.exec(text)) !== null) {
        const bodyStart = match.index + match[0].indexOf(match[1], match[0].indexOf('>'));
        blocks.push({ bodyStart, bodyEnd: bodyStart + match[1].length });
    }
    // No explicit tag → the whole document is one implicit SSJS block.
    if (blocks.length === 0) {
        blocks.push({ bodyStart: 0, bodyEnd: text.length });
    }
    return blocks;
}

/**
 * Collect the top-level `function Name(...)` declarations inside a single block
 * body. Only depth-0 declarations count (a function nested inside another
 * function is not hoisted to the shared global scope for cross-block use).
 * @param sanitized - String/comment-blanked copy of the document.
 * @param block - The block whose body is scanned.
 * @returns Set of function names declared at the block's top level.
 */
function collectBlockFunctionNames(sanitized: string, block: ServerScriptBlock): Set<string> {
    const names = new Set<string>();
    const fnPattern = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
    fnPattern.lastIndex = block.bodyStart;
    let match: RegExpExecArray | null;
    while ((match = fnPattern.exec(sanitized)) !== null) {
        if (match.index >= block.bodyEnd) break;
        // Depth of this declaration relative to the block body start.
        let depth = 0;
        for (let index = block.bodyStart; index < match.index; index++) {
            const ch = sanitized[index];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0) names.add(match[1]);
    }
    return names;
}

/**
 * Scan a multi-block SSJS document for a call in one `<script runat="server">`
 * block to a function whose ONLY declaration lives in a LATER block.
 *
 * SSJS executes server blocks in document order over one shared global scope.
 * A function declared in an earlier block, or in the same block (intra-block
 * hoisting), resolves fine; a forward cross-block reference throws
 * "Object expected" at runtime. Only documents with ≥ 2 server blocks can
 * exhibit this, so single-block (pure `.ssjs`) files never flag.
 * @param text - Full document text.
 * @param sanitized - String/comment-blanked copy of the document.
 * @param commentRanges - Comment ranges to skip.
 * @param budget - Maximum number of diagnostics still allowed.
 * @returns Diagnostics for forward cross-block references (length ≤ budget).
 */
function collectCrossBlockForwardRefDiagnostics(
    text: string,
    sanitized: string,
    commentRanges: Array<[number, number]>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    if (budget <= 0) return diagnostics;

    const blocks = findServerScriptBlocks(text);
    // A cross-block forward reference requires at least two blocks.
    if (blocks.length < 2) return diagnostics;

    // Per-block top-level function declarations, plus the union of names declared
    // in THIS block or any EARLIER block (the set that resolves at each block).
    const perBlockNames = blocks.map((block) => collectBlockFunctionNames(sanitized, block));
    const declaredUpToBlock: Set<string>[] = [];
    const seen = new Set<string>();
    for (const blockNames of perBlockNames) {
        for (const name of blockNames) seen.add(name);
        declaredUpToBlock.push(new Set(seen));
    }
    // Names declared anywhere in the document (to distinguish a forward
    // cross-block ref from an unknown global/local, which we do not flag).
    const declaredAnywhere = seen;

    // Scan each block for forward cross-block references, one block at a time.
    for (const [blockIndex, block] of blocks.entries()) {
        if (diagnostics.length >= budget) break;
        const blockDiagnostics = collectBlockForwardRefDiagnostics(
            text,
            sanitized,
            commentRanges,
            block,
            declaredUpToBlock[blockIndex],
            declaredAnywhere,
            budget - diagnostics.length,
        );
        diagnostics.push(...blockDiagnostics);
    }
    return diagnostics;
}

/**
 * Keyword tokens that look like a call (`name(`) but are language constructs,
 * never a user-function reference, so they must never be flagged.
 */
const FORWARD_REF_SKIP_KEYWORDS = new Set<string>(['function', 'if', 'for', 'while', 'switch']);

/**
 * Scan a single `<script runat="server">` block body for calls whose callee is
 * declared only in a LATER block. Extracted from
 * `collectCrossBlockForwardRefDiagnostics` so its `break`/`continue` live in a
 * single (non-nested) loop.
 * @param text - Full document text.
 * @param sanitized - String/comment-blanked copy of the document.
 * @param commentRanges - Comment ranges to skip.
 * @param block - The block whose body is scanned.
 * @param resolvableHere - Function names declared in this or any earlier block.
 * @param declaredAnywhere - Function names declared anywhere in the document.
 * @param budget - Maximum number of diagnostics to emit.
 * @returns Diagnostics for this block's forward references (length ≤ budget).
 */
function collectBlockForwardRefDiagnostics(
    text: string,
    sanitized: string,
    commentRanges: Array<[number, number]>,
    block: ServerScriptBlock,
    resolvableHere: Set<string>,
    declaredAnywhere: Set<string>,
    budget: number,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    // Match `name(` call sites. A call is flagged only when the callee is a
    // user function declared somewhere later — never in this or an earlier block.
    const callPattern = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    callPattern.lastIndex = block.bodyStart;
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(sanitized)) !== null && diagnostics.length < budget) {
        if (match.index >= block.bodyEnd) break;
        const name = match[1];
        // Skip language keywords, calls that resolve here, comments, and names
        // that are not declared as a user function anywhere in the document.
        const isForwardRef =
            !FORWARD_REF_SKIP_KEYWORDS.has(name) &&
            !isInCommentRange(match.index, commentRanges) &&
            declaredAnywhere.has(name) &&
            !resolvableHere.has(name);
        if (!isForwardRef) continue;
        const nameStart = match.index + match[0].indexOf(name);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: offsetToPosition(text, nameStart),
                end: offsetToPosition(text, nameStart + name.length),
            },
            message:
                `'${name}()' is declared in a later <script runat="server"> block. SSJS ` +
                'executes server blocks in document order over one shared scope, so this ' +
                'forward reference throws "Object expected" at runtime. Move the declaration ' +
                'to this block or an earlier one.',
            source: 'ssjs',
            code: DIAG_CODE_SSJS_CROSS_BLOCK_FORWARD_REF,
        });
    }
    return diagnostics;
}

/**
 * Validate an SSJS document and return LSP Diagnostics.
 * @param text - Full document text.
 * @param settings - Validation settings.
 * @returns Array of LSP Diagnostic objects.
 */
export function validateSsjs(
    text: string,
    settings: SfmcSettings = DEFAULT_SETTINGS,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    let problems = 0;
    const max = settings.maxNumberOfProblems;

    // Build comment ranges once here so every section below can skip them.
    const commentRanges = buildCommentRanges(text);

    // Find the character offset of the first real (non-comment) Platform.Load call.
    // Infinity means no load call exists anywhere in the document.
    const plCheckPat = /Platform\s*\.\s*Load\s*\(\s*["']core["']/gi;
    let plm: RegExpExecArray | null;
    let platformLoadOffset = Infinity;
    while ((plm = plCheckPat.exec(text)) !== null) {
        if (!isInCommentRange(plm.index, commentRanges)) {
            platformLoadOffset = plm.index;
            break;
        }
    }

    // 1. Core library usage without Platform.Load
    const coreObjectPattern =
        /\b(DataExtension|Subscriber|Email|TriggeredSend|List|ContentArea|Folder|QueryDefinition|Send|Template|DeliveryProfile|SenderProfile|SendClassification|FilterDefinition|Account|AccountUser|Portfolio|BounceEvent|ClickEvent|ForwardedEmailEvent|ForwardedEmailOptInEvent|NotSentEvent|OpenEvent|SentEvent|SurveyEvent|UnsubEvent)\s*\.\s*(Init|Retrieve)\s*\(/g;
    let coreMatch: RegExpExecArray | null;
    while ((coreMatch = coreObjectPattern.exec(text)) !== null && problems < max) {
        if (isInCommentRange(coreMatch.index, commentRanges)) continue;
        if (coreMatch.index < platformLoadOffset) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, coreMatch.index),
                    end: offsetToPosition(text, coreMatch.index + coreMatch[0].length - 1),
                },
                message: `Platform.Load("core", "1.1.5") must be called before using ${coreMatch[1]}.Init(). Without it, this call will fail at runtime.`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_REQUIRE_PLATFORM_LOAD,
            });
        }
    }

    // 1b. requiresCoreLoad methods used without a preceding Platform.Load
    const requiresCoreLoadEntries: Array<{ prefix: string; name: string }> = [
        ...httpHeaderMethods,
        ...dateTimeTimezoneMethods,
        ...errorUtilMethods,
    ]
        .filter((m) => m.requiresCoreLoad)
        .map((m) => ({ prefix: m.prefix ?? '', name: m.name }));

    for (const entry of requiresCoreLoadEntries) {
        if (problems >= max) break;
        const entryDiagnostics = collectCoreLoadCallDiagnostics(
            text,
            entry,
            commentRanges,
            platformLoadOffset,
            max - problems,
        );
        problems += entryDiagnostics.length;
        diagnostics.push(...entryDiagnostics);
    }

    // 1c. Bare-name globals that require Platform.Load (e.g. Stringify, Now, GUID)
    // Use negative lookbehind for '.' so Platform.Function.Now() is NOT flagged —
    // only genuine bare calls like Now() are.
    if (requiresCoreLoadGlobals.size > 0) {
        const bareNames = [...requiresCoreLoadGlobals]
            .map((n) => n.replaceAll('.', String.raw`\.`))
            .join('|');
        const barePattern = new RegExp(String.raw`(?<!\.)(\b(?:${bareNames}))\s*\(`, 'g');
        let bareMatch: RegExpExecArray | null;
        while ((bareMatch = barePattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(bareMatch.index, commentRanges)) continue;
            if (bareMatch.index < platformLoadOffset) {
                problems++;
                const name = bareMatch[1];
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, bareMatch.index),
                        end: offsetToPosition(text, bareMatch.index + name.length),
                    },
                    message: `Platform.Load("core", "1.1.5") must be called before using ${name}(). Without it, this call will fail at runtime.`,
                    source: 'ssjs',
                    code: DIAG_CODE_SSJS_REQUIRE_PLATFORM_LOAD,
                });
            }
        }
    }

    // 1d. Phantom globals: documented but do NOT exist at runtime (ReferenceError),
    // e.g. Redirect(). Negative lookbehind for '.' so member calls like
    // Platform.Response.Redirect() are NOT flagged — only bare-name calls.
    if (nonexistentGlobals.size > 0) {
        const phantomNames = [...nonexistentGlobals.keys()]
            .map((n) => n.replaceAll('.', String.raw`\.`))
            .join('|');
        const phantomPattern = new RegExp(String.raw`(?<!\.)(\b(?:${phantomNames}))\s*\(`, 'g');
        let phantomMatch: RegExpExecArray | null;
        while ((phantomMatch = phantomPattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(phantomMatch.index, commentRanges)) continue;
            problems++;
            const name = phantomMatch[1];
            const entry = nonexistentGlobals.get(name);
            const replacement = phantomReplacement(entry);
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, phantomMatch.index),
                    end: offsetToPosition(text, phantomMatch.index + name.length),
                },
                message: `${name}() does not exist at runtime (calling it throws a ReferenceError). Use ${replacement} instead.`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_NONEXISTENT_GLOBAL,
            });
        }
    }

    // 1e. Deprecated bare-name globals (e.g. ContentArea, ContentAreaByName).
    // Still callable at runtime, so a Warning rather than an Error.
    if (deprecatedGlobals.size > 0) {
        const deprecatedNames = [...deprecatedGlobals.keys()]
            .map((n) => n.replaceAll('.', String.raw`\.`))
            .join('|');
        const deprecatedPattern = new RegExp(
            String.raw`(?<!\.)(\b(?:${deprecatedNames}))\s*\(`,
            'g',
        );
        let deprecatedMatch: RegExpExecArray | null;
        while ((deprecatedMatch = deprecatedPattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(deprecatedMatch.index, commentRanges)) continue;
            problems++;
            const name = deprecatedMatch[1];
            const entry = deprecatedGlobals.get(name);
            const replacement = entry?.aliasOf
                ? ` Use '${entry.aliasOf}' instead.`
                : ' Use a supported alternative.';
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, deprecatedMatch.index),
                    end: offsetToPosition(text, deprecatedMatch.index + name.length),
                },
                message: `'${name}' is deprecated.${replacement}`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_DEPRECATED,
            });
        }
    }

    // 1e2. Deprecated Platform.Function.* calls (data-driven from
    // platformFunctionLookup entries flagged `deprecated`, e.g.
    // Platform.Function.ContentArea / ContentAreaByName).
    {
        const deprecatedPlatformFns = [...platformFunctionLookup.values()].filter(
            (f) => f.deprecated,
        );
        if (deprecatedPlatformFns.length > 0) {
            const names = deprecatedPlatformFns
                .map((f) => f.name.replaceAll('.', String.raw`\.`))
                .join('|');
            const pfDepPattern = new RegExp(
                String.raw`\bPlatform\s*\.\s*Function\s*\.\s*(${names})\s*\(`,
                'g',
            );
            let pfDepMatch: RegExpExecArray | null;
            while ((pfDepMatch = pfDepPattern.exec(text)) !== null && problems < max) {
                if (isInCommentRange(pfDepMatch.index, commentRanges)) continue;
                problems++;
                const name = pfDepMatch[1];
                const nameStart = pfDepMatch.index + pfDepMatch[0].indexOf(name);
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: offsetToPosition(text, nameStart),
                        end: offsetToPosition(text, nameStart + name.length),
                    },
                    message: `'Platform.Function.${name}' is deprecated. Use a supported alternative.`,
                    source: 'ssjs',
                    code: DIAG_CODE_SSJS_DEPRECATED,
                });
            }
        }
    }

    // 1f. Deprecated ErrorUtil methods (e.g. ErrorUtil.ThrowWSProxyError). Only
    // exists under Platform.Load("Core", "1"); undefined in newer Core versions.
    // ErrorUtil is not a CORE_LIBRARY_OBJECTS entry (no Init()), so it is not
    // covered by the generic coreDeprecatedMethodLookup pass below.
    const deprecatedErrorUtil = errorUtilMethods.filter((m) => m.deprecated);
    if (deprecatedErrorUtil.length > 0) {
        const methodNames = deprecatedErrorUtil.map((m) => m.name).join('|');
        const errorUtilPattern = new RegExp(
            String.raw`\bErrorUtil\s*\.\s*(${methodNames})\s*\(`,
            'g',
        );
        // The wording depends on which Core version the file loads: under a version
        // above maxCoreVersion, ErrorUtil is undefined and the call throws.
        const maxCoreVersion = maxCoreVersionLookup.get('errorutil')?.maxCoreVersion;
        const loadedCoreVersion = findLoadedCoreVersion(text, commentRanges);
        const isUnavailable =
            maxCoreVersion !== undefined &&
            loadedCoreVersion !== undefined &&
            compareCoreVersions(loadedCoreVersion, maxCoreVersion) > 0;
        let euMatch: RegExpExecArray | null;
        while ((euMatch = errorUtilPattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(euMatch.index, commentRanges)) continue;
            problems++;
            const name = euMatch[1];
            const nameStart = euMatch.index + euMatch[0].indexOf(name);
            diagnostics.push({
                severity: isUnavailable ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, nameStart),
                    end: offsetToPosition(text, nameStart + name.length),
                },
                message: isUnavailable
                    ? `'ErrorUtil.${name}' is undefined under Platform.Load("Core", "${loadedCoreVersion}") — it only exists in Core version "${maxCoreVersion}", so this call throws a TypeError at runtime. Check 'result.Status' and 'throw new Error(...)' instead.`
                    : `'ErrorUtil.${name}' is deprecated — it only exists under Platform.Load("Core", "1") and is undefined in newer Core versions. Check 'result.Status' and 'throw new Error(...)' instead.`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_DEPRECATED,
            });
        }
    }

    // 1g. Deprecated Core Library methods (e.g. ContentAreaObj.Init, Send.Definition.Add,
    // <portfolioVar>.Update). Resolves both static (`Portfolio.Retrieve(...)`) and
    // instance (`var p = Portfolio.Init(...); p.Update(...)`) call styles, mirroring
    // the eslint-plugin-sfmc `ssjs-no-deprecated-function` rule.
    if (problems < max) {
        const deprecatedMethodDiagnostics = collectDeprecatedMethodDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += deprecatedMethodDiagnostics.length;
        diagnostics.push(...deprecatedMethodDiagnostics);
    }

    // 2. Wrong Platform.Load version
    const platformLoadVersionPattern = new RegExp(PLATFORM_LOAD_VERSION_SOURCE, 'gi');
    let versionMatch: RegExpExecArray | null;
    while ((versionMatch = platformLoadVersionPattern.exec(text)) !== null && problems < max) {
        if (isInCommentRange(versionMatch.index, commentRanges)) continue;
        const actualVersion = versionMatch[1];
        if (actualVersion !== '1.1.5') {
            problems++;
            const versionStart = versionMatch.index + versionMatch[0].lastIndexOf(actualVersion);
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, versionStart - 1),
                    end: offsetToPosition(text, versionStart + actualVersion.length + 1),
                },
                message: `Platform.Load("Core", "${actualVersion}") should use version "1.1.5" to get the latest bug-fixes.`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_PLATFORM_LOAD_VERSION,
            });
        }
    }

    // 3. ES6+ patterns not supported in SFMC SSJS
    const es6Patterns: { pattern: RegExp; message: string }[] = [
        {
            pattern: /\b(let|const)\s+/g,
            message:
                "'let'/'const' declarations are not supported in SFMC SSJS. Use 'var' instead.",
        },
        {
            pattern: /=>\s*[{(]/g,
            message:
                'Arrow functions are not supported in SFMC SSJS. Use a regular function expression.',
        },
        {
            pattern: /`[^`]*`/g,
            message: 'Template literals are not supported in SFMC SSJS. Use string concatenation.',
        },
        {
            pattern: /\bclass\s+\w+/g,
            message:
                'Class declarations are not supported in SFMC SSJS. Use constructor functions.',
        },
        {
            pattern: /\basync\s+function/g,
            message: 'Async functions are not supported in SFMC SSJS.',
        },
        { pattern: /\bawait\s+/g, message: 'Await expressions are not supported in SFMC SSJS.' },
        {
            pattern: /\bfor\s*\(\s*(?:var\s+)?\w+\s+of\s+/g,
            message: "'for...of' loops are not supported in SFMC SSJS. Use a regular for loop.",
        },
        {
            // Match a generator only on a single line (function* or function *name).
            // Using [ \t]* instead of \s* prevents the keyword `function` and a `*`
            // on a later line (e.g. the first `*` of a following JSDoc block) from
            // being treated as a generator declaration.
            pattern: /\bfunction[ \t]*\*/g,
            message: 'Generator functions are not supported in SFMC SSJS.',
        },
        {
            pattern: /\.{3}/g,
            message: 'Spread operator (...) is not supported in SFMC SSJS.',
        },
        {
            pattern: /\bvar\s*\{/g,
            message:
                'Object destructuring is not supported in SFMC SSJS. Assign properties individually.',
        },
        {
            pattern: /\bvar\s*\[/g,
            message: 'Array destructuring is not supported in SFMC SSJS. Use index access instead.',
        },
    ];

    for (const { pattern, message } of es6Patterns) {
        if (problems >= max) break;
        const patternDiagnostics = collectEs6PatternDiagnostics(
            text,
            pattern,
            message,
            commentRanges,
            max - problems,
        );
        problems += patternDiagnostics.length;
        diagnostics.push(...patternDiagnostics);
    }

    // 4. Polyfill-required ECMAScript built-in members. These are absent/broken
    //    in the SFMC engine but a verified polyfill exists in ssjs-data, so the
    //    diagnostic carries the polyfill source in `data` for an "insert
    //    polyfill" code action. Members with NO polyfill are deliberately left
    //    to TypeScript's own diagnostics and are not reported here.
    //
    //    When the polyfill is already present in the document the diagnostic is
    //    suppressed entirely (no squiggle) — the method is now safe to use.
    //
    // 4a. Static polyfillable members (e.g. Array.isArray, Array.of, Math.max)
    //     — matched on an explicit owner prefix.
    if (polyfillableStaticLookup.size > 0) {
        const staticPolyPattern = /\b([A-Z]\w*)\s*\.\s*([A-Za-z_$][\w$]*)/g;
        let m: RegExpExecArray | null;
        while ((m = staticPolyPattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(m.index, commentRanges)) continue;
            const entry = polyfillableStaticLookup.get(`${m[1]}.${m[2]}`.toLowerCase());
            if (!entry) continue;
            if (isPolyfillPresent(text, entry.polyfill)) continue;
            problems++;
            const data: PolyfillDiagnosticData = {
                owner: entry.owner,
                method: entry.method,
                polyfill: entry.polyfill,
            };
            diagnostics.push({
                // The member is absent/broken in the SFMC engine — code using it
                // will fail at runtime without the polyfill, so this is an error.
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, m.index),
                    end: offsetToPosition(text, m.index + m[0].length),
                },
                message: polyfillRequiredMessage(`${entry.owner}.${entry.method}`, entry.category),
                source: 'ssjs',
                code: DIAG_CODE_SSJS_POLYFILL_REQUIRED,
                data,
            });
        }
    }

    // 4a-ii. Replaceable static members (no polyfill, but a direct
    //        Platform.Function alternative exists, e.g. JSON.parse →
    //        Platform.Function.ParseJSON). Emit a diagnostic carrying the
    //        replacement so the editor can offer a "replace with …" quick-fix.
    if (replaceableStaticLookup.size > 0) {
        const replacePattern = /\b([A-Z]\w*)\s*\.\s*([A-Za-z_$][\w$]*)/g;
        let m: RegExpExecArray | null;
        while ((m = replacePattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(m.index, commentRanges)) continue;
            const entry = replaceableStaticLookup.get(`${m[1]}.${m[2]}`.toLowerCase());
            if (!entry) continue;
            problems++;
            const data: ReplaceDiagnosticData = {
                owner: entry.owner,
                member: entry.member,
                replacement: entry.replacement,
            };
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, m.index),
                    end: offsetToPosition(text, m.index + m[0].length),
                },
                message: `${entry.owner}.${entry.member} is not available in SFMC SSJS. Use ${entry.replacement} instead.`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_REPLACE_WITH_PLATFORM_FUNCTION,
                data,
            });
        }
    }

    // 4b. Prototype polyfillable members (e.g. .forEach, .map, .filter).
    //     Members also valid on String.prototype in ES3 (ambiguousWithString,
    //     e.g. slice/indexOf/lastIndexOf) are EXCLUDED from the lookup to avoid
    //     false positives on string receivers — only call-shaped uses match.
    if (polyfillablePrototypeLookup.size > 0) {
        const protoPolyPattern = /\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
        let m: RegExpExecArray | null;
        while ((m = protoPolyPattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(m.index, commentRanges)) continue;
            const entry = polyfillablePrototypeLookup.get(m[1].toLowerCase());
            if (!entry) continue;
            if (isPolyfillPresent(text, entry.polyfill)) continue;
            problems++;
            const memberStart = m.index + m[0].indexOf(m[1]);
            const owner = entry.owner.replace('.prototype', '');
            const data: PolyfillDiagnosticData = {
                owner: entry.owner,
                method: entry.method,
                polyfill: entry.polyfill,
            };
            diagnostics.push({
                // The member is absent/broken in the SFMC engine — code using it
                // will fail at runtime without the polyfill, so this is an error.
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, memberStart),
                    end: offsetToPosition(text, memberStart + m[1].length),
                },
                message: polyfillRequiredMessage(
                    `${owner}.prototype.${entry.method}`,
                    entry.category,
                ),
                source: 'ssjs',
                code: DIAG_CODE_SSJS_POLYFILL_REQUIRED,
                data,
            });
        }
    }

    // 4c. CLR-unsafe reads of HttpResponse `.headers` (indexing / .Get() / .Item()).
    if (problems < max) {
        const headerDiagnostics = collectClrHeaderAccessDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += headerDiagnostics.length;
        diagnostics.push(...headerDiagnostics);
    }

    // 4d. Raw reads of HttpResponse `.content` CLR string without a String() wrap.
    if (problems < max) {
        const contentDiagnostics = collectClrContentAccessDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += contentDiagnostics.length;
        diagnostics.push(...contentDiagnostics);
    }

    // 4e. Invalid literal values assigned to HttpRequest/HttpGet writable props.
    if (problems < max) {
        const invalidPropDiagnostics = collectInvalidHttpPropertyDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += invalidPropDiagnostics.length;
        diagnostics.push(...invalidPropDiagnostics);
    }

    // 4e-2. Property accesses against the runtime-supported direction: reads of
    // write-only properties (`req.postData`, `Platform.Response.ContentType`) and
    // assignments to read-only ones (`Platform.Request.Method = …`).
    if (problems < max) {
        const accessDiagnostics = collectInvalidPropertyAccessDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += accessDiagnostics.length;
        diagnostics.push(...accessDiagnostics);
    }

    // 4f. Platform.Function calls with a discontinuous-overload arity violation
    // (argument count in [minArgs, maxArgs] but not in validArities, e.g. HTTPGet
    // called with 2-5 args). Only functions declaring validArities participate.
    if (problems < max) {
        const arityDiagnostics = collectPlatformFunctionArityDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += arityDiagnostics.length;
        diagnostics.push(...arityDiagnostics);
    }

    // 4g. Core Library method calls that RESOLVE at runtime but have no known
    // working invocation (ssjs-data `nonFunctionalAtRuntime`), e.g.
    // `FilterDefinition.Update` / `.Remove`. Reported as an Error — the call is
    // confirmed to fail at runtime. The member is still KEPT in completions/hover.
    // Skipped in MCN (SSJS unsupported there anyway).
    if (settings.targetPlatform !== 'next' && problems < max) {
        const nonFunctionalDiagnostics = collectNonFunctionalMethodDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += nonFunctionalDiagnostics.length;
        diagnostics.push(...nonFunctionalDiagnostics);
    }

    // 4h. switch statements that rely on fall-through, which the SFMC SSJS engine
    // never performs (empty stacked labels and break-less bodies both fail).
    // Reported as a Warning. Skipped in MCN (SSJS unsupported there anyway).
    if (settings.targetPlatform !== 'next' && problems < max) {
        const switchDiagnostics = collectSwitchFallthroughDiagnostics(
            text,
            commentRanges,
            max - problems,
        );
        problems += switchDiagnostics.length;
        diagnostics.push(...switchDiagnostics);
    }

    // 4i. `new X()` where X is a user constructor that returns an object literal
    // (the engine discards the returned object and returns the empty `this`), and
    // 4j. a call to a function whose only declaration is in a LATER
    // `<script runat="server">` block (a forward cross-block reference). Both need
    // the string/comment-blanked copy so braces/keywords inside strings and
    // comments are ignored. Skipped in MCN (SSJS unsupported there anyway).
    if (settings.targetPlatform !== 'next' && problems < max) {
        const sanitizedForScope = blankStringsAndComments(text);

        const newObjectReturnDiagnostics = collectNewObjectReturnDiagnostics(
            text,
            sanitizedForScope,
            commentRanges,
            max - problems,
        );
        problems += newObjectReturnDiagnostics.length;
        diagnostics.push(...newObjectReturnDiagnostics);

        if (problems < max) {
            const forwardRefDiagnostics = collectCrossBlockForwardRefDiagnostics(
                text,
                sanitizedForScope,
                commentRanges,
                max - problems,
            );
            problems += forwardRefDiagnostics.length;
            diagnostics.push(...forwardRefDiagnostics);
        }
    }

    // MCN compatibility — SSJS is not supported in Marketing Cloud Next.
    // Emit one document-level diagnostic covering the first non-empty line.
    if (settings.targetPlatform === 'next' && problems < max) {
        const lines = text.split('\n');
        const firstNonBlankLine = lines.findIndex((l) => l.trim().length > 0);
        const lineIndex = Math.max(0, firstNonBlankLine);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: lineIndex, character: 0 },
                end: { line: lineIndex, character: lines[lineIndex]?.length ?? 0 },
            },
            message:
                'SSJS is not supported in Marketing Cloud Next. Rewrite this code in AMPscript.',
            source: 'ssjs',
            code: DIAG_CODE_SSJS_MCN_NOT_SUPPORTED,
        });
    }

    return diagnostics;
}
