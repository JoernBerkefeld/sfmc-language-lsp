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
    PLATFORM_RECIPIENT_METHODS,
    CORE_LIBRARY_OBJECTS,
    WSPROXY_METHODS,
    HTTP_METHODS,
    HTTPHEADER_METHODS,
    DATE_TIME_METHODS,
    DATE_TIME_TIMEZONE_METHODS,
    ERROR_UTIL_METHODS,
    SCRIPT_UTIL_CONSTRUCTORS,
    SCRIPT_UTIL_REQUEST_METHODS,
    ECMASCRIPT_BUILTINS,
    POLYFILLABLE_METHODS,
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
    requiresCoreLoad?: boolean;
    aliasOf?: string;
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

export const ssjsGlobals: SsjsFunction[] = SSJS_GLOBALS.filter((g) => g.type === 'function').map(
    (g) => ({
        name: g.name,
        minArgs: g.minArgs ?? 1,
        maxArgs: g.maxArgs ?? 1,
        description: g.description,
        ...(g.params && { params: g.params }),
        ...(g.returnType && { returnType: g.returnType }),
        ...(g.syntax && { syntax: g.syntax }),
    }),
);

// ── Variable/Response/Request objects ────────────────────────────────────────

export const platformVariableMethods: SsjsFunction[] = PLATFORM_VARIABLE_METHODS.map((m) => ({
    ...m,
    prefix: 'Platform.Variable',
}));

export const platformResponseMethods: SsjsFunction[] = PLATFORM_RESPONSE_METHODS.map((m) => ({
    ...m,
    prefix: 'Platform.Response',
}));

export const platformRequestMethods: SsjsFunction[] = PLATFORM_REQUEST_METHODS.map((m) => ({
    ...m,
    prefix: 'Platform.Request',
}));

// ── Core library objects ─────────────────────────────────────────────────────

export const coreLibraryObjects: SsjsObject[] = CORE_LIBRARY_OBJECTS.map((o) => ({
    name: o.name,
    methods: o.methods,
    description: o.description,
}));

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
