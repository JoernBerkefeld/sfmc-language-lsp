/**
 * SSJS language data for the language server.
 *
 * Re-exports SSJS function/object metadata from ssjs-data (the single
 * source of truth) into formats suitable for LSP completions, hover,
 * and diagnostics. No hand-maintained copies — updates to ssjs-data
 * propagate automatically.
 */

import {
    PLATFORM_METHODS,
    PLATFORM_FUNCTIONS,
    SSJS_GLOBALS,
    PLATFORM_VARIABLE_METHODS,
    PLATFORM_RESPONSE_METHODS,
    PLATFORM_REQUEST_METHODS,
    REQUEST_UTILITY_METHODS,
    PLATFORM_RECIPIENT_METHODS,
    CORE_LIBRARY_OBJECTS,
    coreObjectNames,
    coreNonFunctionalMethodLookup as ssjsCoreNonFunctionalMethodLookup,
    coreDeprecatedMethodLookup as ssjsCoreDeprecatedMethodLookup,
    maxCoreVersionLookup as ssjsMaxCoreVersionLookup,
    propertyAccessLookup as ssjsPropertyAccessLookup,
    WSPROXY_METHODS,
    HTTP_METHODS,
    HTTPHEADER_METHODS,
    DATE_TIME_METHODS,
    DATE_TIME_TIMEZONE_METHODS,
    ERROR_UTIL_METHODS,
    SCRIPT_UTIL_CONSTRUCTORS,
    SCRIPT_UTIL_REQUEST_METHODS,
    SCRIPT_UTIL_REQUEST_PROPERTIES,
    SCRIPT_UTIL_HTTPGET_PROPERTIES,
    ECMASCRIPT_BUILTINS,
    POLYFILLABLE_METHODS,
    KNOWN_UNSUPPORTED,
} from 'ssjs-data';
import { ECMASCRIPT_URLS, GUIDE_BASE_URL, mdnBuiltinUrl } from 'ssjs-data/urls';

export interface SsjsFunctionParam {
    name: string;
    description: string;
    type?: string;
    optional?: boolean;
}

export interface SsjsFunction {
    name: string;
    minArgs: number;
    maxArgs: number;
    description: string;
    prefix?: string;
    params?: SsjsFunctionParam[];
    returnType?: string;
    syntax?: string;
    example?: string;
    isStatic?: boolean;
    deprecated?: boolean;
    notDefinedAtRuntime?: boolean;
    /**
     * True when the member EXISTS/RESOLVES at runtime but has no known working
     * invocation (every tested call fails). Unlike notDefinedAtRuntime it is KEPT
     * in completions/hover; call sites are warned instead.
     */
    nonFunctionalAtRuntime?: boolean;
    officialDocsNote?: string;
    requiresCoreLoad?: boolean;
    /**
     * Highest `Platform.Load("Core", <version>)` that still provides this member.
     * Loading a newer Core version leaves it `undefined` at runtime.
     */
    maxCoreVersion?: string;
    aliasOf?: string;
    /**
     * Exact set of permitted argument counts for a discontinuous overload where a
     * contiguous minArgs..maxArgs range would wrongly accept intermediate counts.
     * When present, a call is valid only when its argument count is within
     * [minArgs, maxArgs] AND a member of this array (e.g. HTTPGet accepts only 1 or
     * 6 arguments; 2-5 throw at runtime). Absent → pure contiguous range.
     */
    validArities?: number[];
}

export interface EcmascriptBuiltin {
    name: string;
    owner: string;
    description: string;
    caveat?: string;
    params?: SsjsFunctionParam[];
    returnType?: string;
    syntax?: string;
    example?: string;
    guideUrl?: string;
    mdnUrl?: string;
}

export interface PolyfillableMethod {
    method: string;
    owner: string;
    esVersion: 3 | 5 | 6;
    isStatic: boolean;
    category: 'unavailable' | 'broken';
    ambiguousWithString?: boolean;
    description: string;
    polyfill: string;
}

export interface SsjsObject {
    name: string;
    methods: string[];
    description: string;
    deprecated?: boolean;
}

// ── Top-level Platform methods ───────────────────────────────────────────────

export const platformMethods: SsjsFunction[] = PLATFORM_METHODS.map((m) => ({
    ...m,
    prefix: 'Platform',
}));

// ── Platform.Function methods ────────────────────────────────────────────────

export const platformFunctions: SsjsFunction[] = PLATFORM_FUNCTIONS.map((f) => ({
    ...f,
    prefix: 'Platform.Function',
}));

export const platformFunctionLookup = new Map<string, SsjsFunction>(
    platformFunctions.map((f) => [f.name.toLowerCase(), f]),
);

// ── Global functions ─────────────────────────────────────────────────────────

// Phantom globals (notDefinedAtRuntime, e.g. Redirect) are EXCLUDED here so the
// LSP never offers them in completions/hover/signature help — they throw a
// ReferenceError at runtime. The validator flags any usage separately.
// Callables often omit `type` (same shape as ContentArea / ContentAreaByName);
// only explicit `type: 'object'` entries are excluded.
export const ssjsGlobals: SsjsFunction[] = SSJS_GLOBALS.filter(
    (g) => g.type !== 'object' && !g.notDefinedAtRuntime,
).map((g) => ({
    name: g.name,
    minArgs: g.minArgs ?? 1,
    maxArgs: g.maxArgs ?? 1,
    description: g.description,
    ...(g.deprecated && { deprecated: true }),
    ...(g.params && { params: g.params }),
    ...(g.returnType && { returnType: g.returnType }),
    ...(g.syntax && { syntax: g.syntax }),
    ...(g.aliasOf && { aliasOf: g.aliasOf }),
}));

// ── Variable/Response/Request objects ────────────────────────────────────────

export const platformVariableMethods: SsjsFunction[] = PLATFORM_VARIABLE_METHODS.map((m) => ({
    ...m,
    prefix: 'Platform.Variable',
}));

export const platformResponseMethods: SsjsFunction[] = PLATFORM_RESPONSE_METHODS.map((m) => ({
    ...m,
    prefix: 'Platform.Response',
}));

// notDefinedAtRuntime Platform.Request members (e.g. GetUserLanguages, which throws
// a frame-security error in the only frame CloudPages provide) are EXCLUDED here so
// the LSP never offers them in completions/hover/signature help — mirroring how
// ssjsGlobals drops phantom bare-name globals. They stay in ssjs-data/ssjs.guide for
// discoverability.
export const platformRequestMethods: SsjsFunction[] = PLATFORM_REQUEST_METHODS.filter(
    (m) => !m.notDefinedAtRuntime,
).map((m) => ({
    ...m,
    prefix: 'Platform.Request',
}));

// ── Core Request object members ──────────────────────────────────────────────

// The Core library `Request` object is a DISTINCT namespace from Platform.Request.
// It exposes its own 8 members (REQUEST_UTILITY_METHODS in ssjs-data): six 0-arg
// context getters (URL, PagePath, Method, ApplicationID, PackageID,
// ApplicationBaseURL) plus GetQueryStringParameter / GetFormField (1 string arg,
// requiresCoreLoad). Completions/hover for bare `Request.` must use THIS set, not
// platformRequestMethods (Platform.Request members like RequestURL/GetCookieValue
// are NOT valid on the Core Request object). notDefinedAtRuntime members are
// filtered out to mirror platformRequestMethods (none currently).
export const coreRequestMethods: SsjsFunction[] = REQUEST_UTILITY_METHODS.filter(
    (m) => !m.notDefinedAtRuntime,
).map((m) => ({
    ...m,
    prefix: 'Request',
}));

// ── Core library objects ─────────────────────────────────────────────────────

export const coreLibraryObjects: SsjsObject[] = CORE_LIBRARY_OBJECTS.map((o) => ({
    name: o.name,
    methods: o.methods,
    description: o.description,
    ...(o.deprecated && { deprecated: true }),
}));

/**
 * Set of Core Library object names (e.g. `FilterDefinition`, `DataExtension.Rows`).
 */
export const coreObjectNameSet: Set<string> = coreObjectNames;

/**
 * Core Library methods that resolve at runtime but have no known working
 * invocation (nonFunctionalAtRuntime). Map<classNameLower, Map<methodNameLower,
 * entry>> re-exposed from ssjs-data so validators can warn at call sites and
 * surface the entry's officialDocsNote.
 */
export const coreNonFunctionalMethodLookup: Map<
    string,
    Map<string, SsjsFunction>
> = ssjsCoreNonFunctionalMethodLookup;

/**
 * Core Library methods that still work at runtime but are deprecated (superseded
 * by newer functionality, e.g. Content Builder assets replacing Classic Content).
 * Map<classNameLower, Map<methodNameLower, entry>> re-exposed from ssjs-data so
 * validators/hover/completions can surface deprecation warnings and notes.
 */
export const coreDeprecatedMethodLookup: Map<
    string,
    Map<string, SsjsFunction>
> = ssjsCoreDeprecatedMethodLookup;

/**
 * Members that exist only up to a maximum `Platform.Load("Core", <version>)`.
 * Map<qualifiedNameLower, { name, maxCoreVersion }> re-exposed from ssjs-data so
 * validators can tell "deprecated but callable" from "undefined at runtime".
 */
export const maxCoreVersionLookup: Map<string, { name: string; maxCoreVersion: string }> =
    ssjsMaxCoreVersionLookup;

// ── WSProxy methods ──────────────────────────────────────────────────────────

export const wsproxyMethods: SsjsFunction[] = WSPROXY_METHODS.map((m) => ({
    ...m,
    prefix: 'WSProxy',
}));

// ── HTTP methods ─────────────────────────────────────────────────────────────

export const httpMethods: SsjsFunction[] = HTTP_METHODS.map((m) => ({
    ...m,
    prefix: 'HTTP',
}));

// ── HTTPHeader methods ───────────────────────────────────────────────────────

export const httpHeaderMethods: SsjsFunction[] = HTTPHEADER_METHODS.map((m) => ({
    ...m,
    prefix: 'HTTPHeader',
}));

// ── DateTime methods ──────────────────────────────────────────────────────────

export const dateTimeMethods: SsjsFunction[] = DATE_TIME_METHODS.map((m) => ({
    ...m,
    prefix: 'DateTime',
}));

// ── DateTime.TimeZone methods ────────────────────────────────────────────────

export const dateTimeTimezoneMethods: SsjsFunction[] = DATE_TIME_TIMEZONE_METHODS.map((m) => ({
    ...m,
    prefix: 'DateTime.TimeZone',
}));

// ── ErrorUtil methods ────────────────────────────────────────────────────────

export const errorUtilMethods: SsjsFunction[] = ERROR_UTIL_METHODS.map((m) => ({
    ...m,
    prefix: 'ErrorUtil',
}));

// ── Platform.Recipient methods ────────────────────────────────────────────────

export const platformRecipientMethods: SsjsFunction[] = PLATFORM_RECIPIENT_METHODS.map((m) => ({
    ...m,
    prefix: 'Platform.Recipient',
}));

// ── Script.Util constructors ─────────────────────────────────────────────────

export const scriptUtilConstructors: SsjsFunction[] = SCRIPT_UTIL_CONSTRUCTORS.map((c) => ({
    ...c,
    prefix: 'Script.Util',
}));

// ── Script.Util request methods ──────────────────────────────────────────────

export const scriptUtilRequestMethods: SsjsFunction[] = SCRIPT_UTIL_REQUEST_METHODS.map((m) => ({
    ...m,
    prefix: 'req',
}));

// ── Bare-name globals requiring Platform.Load ────────────────────────────────

/**
 * Bare-name globals (e.g. Stringify, Write, Now, GUID) that require a
 * preceding `Platform.Load("core", "1.1.5")` call. Object-typed entries
 * (Attribute, HTTPHeader, DateTime, ErrorUtil) are excluded because the
 * validator already has dedicated patterns for those.
 */
export const requiresCoreLoadGlobals: Set<string> = new Set(
    SSJS_GLOBALS.filter((g) => g.requiresCoreLoad && g.type !== 'object').map((g) => g.name),
);

// ── Phantom (notDefinedAtRuntime) globals ────────────────────────────────────

/**
 * SSJS globals that are officially documented but proven NOT to exist at runtime
 * (calling them throws a ReferenceError), e.g. `Redirect`. Keyed by the exact
 * documented name so the validator can flag bare-name usage and suggest the
 * supported `Platform.*` replacement carried on the entry.
 */
export const nonexistentGlobals = new Map<string, SsjsFunction>(
    SSJS_GLOBALS.filter((g) => g.notDefinedAtRuntime).map((g) => [
        g.name,
        {
            name: g.name,
            minArgs: g.minArgs ?? 1,
            maxArgs: g.maxArgs ?? 1,
            description: g.description,
            notDefinedAtRuntime: true,
            ...(g.officialDocsNote && { officialDocsNote: g.officialDocsNote }),
            ...(g.params && { params: g.params }),
            ...(g.returnType && { returnType: g.returnType }),
            ...(g.syntax && { syntax: g.syntax }),
        },
    ]),
);

// ── Deprecated bare-name globals ─────────────────────────────────────────────

/**
 * Bare-name SSJS globals flagged `deprecated` in ssjs-data (e.g. `ContentArea`,
 * `ContentAreaByName`). Keyed by the exact documented name. Consumed by the
 * validator to emit a deprecation warning on bare-name usage.
 *
 * Entries omit `type` or set `type: 'function'` for callables; `type: 'object'`
 * (e.g. ErrorUtil) is excluded — those are handled via their methods.
 * Matching `type === 'function'` alone missed catalog rows that leave `type`
 * unset (the common shape for bare ContentArea / ContentAreaByName).
 */
export const deprecatedGlobals = new Map<string, SsjsFunction>(
    SSJS_GLOBALS.filter((g) => g.deprecated && g.type !== 'object').map((g) => [
        g.name,
        {
            name: g.name,
            minArgs: g.minArgs ?? 1,
            maxArgs: g.maxArgs ?? 1,
            description: g.description,
            deprecated: true,
            ...(g.aliasOf && { aliasOf: g.aliasOf }),
        },
    ]),
);

// ── ECMAScript 3/5 built-in methods ──────────────────────────────────────────

export const ecmascriptBuiltins: EcmascriptBuiltin[] = ECMASCRIPT_BUILTINS.map((b) => {
    const relUrl = ECMASCRIPT_URLS[b.owner];
    return {
        name: b.name,
        owner: b.owner,
        description: b.description,
        ...(b.caveat && { caveat: b.caveat }),
        ...(b.params && { params: b.params }),
        ...(b.returnType && { returnType: b.returnType }),
        ...(b.syntax && { syntax: b.syntax }),
        ...(b.example && { example: b.example }),
        ...(relUrl && { guideUrl: `${GUIDE_BASE_URL}${relUrl}` }),
        mdnUrl: mdnBuiltinUrl(b.owner, b.name),
    };
});

// ── Polyfillable ECMAScript members ──────────────────────────────────────────

/**
 * ECMAScript members empirically confirmed ABSENT or BROKEN in the SFMC SSJS
 * engine but for which a verified polyfill exists in ssjs-data. Consumed by
 * validateSsjs to warn when authored/generated SSJS references one and to offer
 * an "insert polyfill" code action carrying the polyfill source.
 */
export const polyfillableMethods: PolyfillableMethod[] = POLYFILLABLE_METHODS.map((m) => ({
    ...m,
}));

/**
 * Static polyfillable members keyed by `Owner.method` (lowercased), e.g.
 * `array.isarray`, `array.of`, `math.max`. Flagged unambiguously on an
 * explicit owner match.
 */
export const polyfillableStaticLookup = new Map<string, PolyfillableMethod>(
    polyfillableMethods
        .filter((m) => m.isStatic)
        .map((m) => [`${m.owner}.${m.method}`.toLowerCase(), m]),
);

/**
 * Prototype (instance) polyfillable members keyed by method name (lowercased),
 * e.g. `foreach`, `map`, `filter`. Members also valid on String.prototype in
 * ES3 (`ambiguousWithString`, e.g. slice/indexOf/lastIndexOf) are EXCLUDED to
 * avoid false-positive squiggles on string receivers — a regex validator cannot
 * prove the receiver type. Those still surface via hover caveats and (with AST)
 * the eslint plugin.
 */
export const polyfillablePrototypeLookup = new Map<string, PolyfillableMethod>(
    polyfillableMethods
        .filter((m) => !m.isStatic && !m.ambiguousWithString)
        .map((m) => [m.method.toLowerCase(), m]),
);

// ── Replaceable static members (Platform.Function alternative) ───────────────

export interface ReplaceableMethod {
    member: string;
    owner: string;
    replacement: string;
    suggestion: string;
}

/**
 * Static members with NO polyfill that have a direct `Platform.Function.*`
 * replacement (e.g. `JSON.parse` → `Platform.Function.ParseJSON`). Keyed by
 * `Owner.member` (lowercased). Consumed by validateSsjs to emit a
 * `ssjs/replace-with-platform-function` diagnostic carrying the replacement,
 * so the editor can offer a "replace with …" quick-fix.
 */
export const replaceableStaticLookup = new Map<string, ReplaceableMethod>(
    (KNOWN_UNSUPPORTED as Array<(typeof KNOWN_UNSUPPORTED)[number] & { replacement?: string }>)
        .filter((m) => m.isStatic && typeof m.replacement === 'string')
        .map((m) => [
            `${m.owner}.${m.member}`.toLowerCase(),
            {
                member: m.member,
                owner: m.owner,
                replacement: m.replacement as string,
                suggestion: m.suggestion,
            },
        ]),
);

// ── HttpRequest / HttpGet writable property value constraints ────────────────

/**
 * A value constraint on a writable HttpRequest / HttpGet instance property.
 * `enum` — the value must be one of the listed literals (case-sensitive strings).
 * `numeric` — the value must be a number of that kind (`integer` = whole number),
 * optionally `>= min`.
 */
export interface HttpPropertyValueConstraint {
    enum?: Array<string | number>;
    enumLabels?: Record<string, string>;
    numeric?: 'integer' | 'number';
    min?: number;
}

/**
 * Writable HttpRequest / HttpGet property that carries a value constraint,
 * keyed by property name. Built once from ssjs-data (single source of truth) so
 * the validator can flag invalid literal assignments such as
 * `req.emptyContentHandling = 5` or `req.method = 'POT'`. When both HttpRequest
 * and HttpGet define the same property, the constraints are identical, so a
 * single map keyed by name is sufficient.
 */
/**
 * Restricted access direction of a property at runtime:
 * `write-only` — assignment works, reading throws;
 * `write-only-opaque` — assignment works, reading returns an opaque CLR value;
 * `read-only` — reading works, assignment is silently ineffective.
 */
export type PropertyAccess = 'write-only' | 'write-only-opaque' | 'read-only';

/**
 * Properties whose access direction is restricted at runtime, keyed by the
 * lowercase qualified name (e.g. `platform.request.method`). Re-exposed from
 * ssjs-data so the validator can flag reads of write-only properties and
 * writes to read-only ones.
 */
export const propertyAccessLookup: Map<
    string,
    { name: string; owner: string; access: PropertyAccess }
> = ssjsPropertyAccessLookup;

export const httpPropertyConstraintLookup = new Map<string, HttpPropertyValueConstraint>(
    [
        ...(SCRIPT_UTIL_REQUEST_PROPERTIES as Array<{
            name: string;
            valueConstraint?: HttpPropertyValueConstraint;
        }>),
        ...(SCRIPT_UTIL_HTTPGET_PROPERTIES as Array<{
            name: string;
            valueConstraint?: HttpPropertyValueConstraint;
        }>),
    ]
        .filter((p) => p.valueConstraint)
        .map((p) => [p.name, p.valueConstraint as HttpPropertyValueConstraint]),
);
