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
    platformFunctionLookup,
} from '../data/ssjs.js';
import type { HttpPropertyValueConstraint, SsjsFunction } from '../data/ssjs.js';
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
 *   - nonexistent-global → `ssjs-no-nonexistent-global`
 *   - deprecated → `ssjs-no-deprecated-function`
 *   - invalid-arity → `ssjs-platform-function-arity`
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
    DIAG_CODE_SSJS_NONEXISTENT_GLOBAL,
    DIAG_CODE_SSJS_DEPRECATED,
    DIAG_CODE_SSJS_INVALID_ARITY,
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

    // 1f. Deprecated ErrorUtil methods (e.g. ErrorUtil.ThrowWSProxyError). Only
    // exists under Platform.Load("Core", "1"); undefined in newer Core versions.
    const deprecatedErrorUtil = errorUtilMethods.filter((m) => m.deprecated);
    if (deprecatedErrorUtil.length > 0) {
        const methodNames = deprecatedErrorUtil.map((m) => m.name).join('|');
        const errorUtilPattern = new RegExp(
            String.raw`\bErrorUtil\s*\.\s*(${methodNames})\s*\(`,
            'g',
        );
        let euMatch: RegExpExecArray | null;
        while ((euMatch = errorUtilPattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(euMatch.index, commentRanges)) continue;
            problems++;
            const name = euMatch[1];
            const nameStart = euMatch.index + euMatch[0].indexOf(name);
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, nameStart),
                    end: offsetToPosition(text, nameStart + name.length),
                },
                message: `'ErrorUtil.${name}' is deprecated — it only exists under Platform.Load("Core", "1") and is undefined in newer Core versions. Check 'result.Status' and 'throw new Error(...)' instead.`,
                source: 'ssjs',
                code: DIAG_CODE_SSJS_DEPRECATED,
            });
        }
    }

    // 2. Wrong Platform.Load version
    const platformLoadVersionPattern =
        /Platform\s*\.\s*Load\s*\(\s*["']core["']\s*,\s*["']([^"']*)["']\s*\)/gi;
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
