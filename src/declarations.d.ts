/**
 * Type declarations for JavaScript-only npm packages.
 * These packages have no TypeScript declarations of their own.
 */

declare module 'ampscript-data' {
    export interface AmpscriptDataParam {
        name: string;
        description: string;
        type?: string;
        optional?: boolean;
        enum?: (string | number)[];
        default?: string | number | boolean;
    }
    /**
     * Describes how trailing arguments repeat for a variadic function.
     * Coordinates are 0-based argument-stream indices.
     */
    export interface AmpscriptDataRepeatGroup {
        /**
         * First argument index where the repeating group begins.
         */
        startIndex: number;
        /**
         * Number of arguments that form one repeatable unit.
         */
        groupSize: number;
        /**
         * Minimum number of complete groups required.
         */
        minGroups: number;
        /**
         * Name of an earlier param whose literal value dictates the group count.
         */
        countParam?: string;
    }
    export interface AmpscriptDataFunction {
        name: string;
        category: string;
        minArgs: number;
        maxArgs: number;
        /**
         * Human-readable description of what the function does.
         */
        description: string;
        params: AmpscriptDataParam[];
        /**
         * Repeating-group model for variadic functions (maxArgs === Infinity).
         */
        repeat?: AmpscriptDataRepeatGroup[];
        returnType?: string;
        /**
         * Prose description of the return value.
         */
        returnDescription?: string;
        /**
         * Fixed set of literal return values, when the function returns an enum.
         */
        returnEnum?: (string | number)[];
        /**
         * Canonical signature string, e.g. `Add(number1, number2)`.
         */
        syntax?: string;
        /**
         * Usage example, where available.
         */
        example?: string;
        /**
         * URL to the official Salesforce developer documentation page.
         */
        docUrl?: string;
        /**
         * URL to the ampscript.guide reference page.
         */
        guideUrl?: string;
        /**
         * API version in which MCN support was introduced (e.g. 67), or null if not supported in MCN.
         */
        mcnSince: number | null;
        /**
         * Behavioral difference notes for MCN, or null if none.
         */
        mcnNotes: string | null;
        /**
         * Name of the MCN Handlebars helper that replaces this AMPscript function
         * when converting to Marketing Cloud Next, or null when there is no helper.
         */
        handlebarsEquivalent?: string | null;
        /**
         * Only meaningful when `handlebarsEquivalent` is set: true when the helper
         * is an argument-for-argument drop-in, false when it does the same job with
         * a different call shape (conversion emits a hint rather than a substitution).
         */
        handlebarsExact?: boolean;
        /**
         * True when the function is deprecated and should be avoided in new code.
         */
        deprecated?: boolean;
        /**
         * Suggested replacement function name when this function is deprecated.
         */
        deprecatedReplacement?: string;
        /**
         * Human-readable reason explaining the deprecation.
         */
        deprecatedReason?: string;
        /**
         * Exact set of permitted argument counts for a discontinuous overload.
         * When present, a call is valid only when its argument count is within
         * [minArgs, maxArgs] AND a member of this array.
         */
        validArities?: number[];
        /**
         * True when the entry's behavior was verified against the live AMPscript engine.
         */
        isConfirmed?: boolean;
        /**
         * True when the function resolves at runtime but has no known working
         * invocation — every reached call aborts the page (e.g. the underlying
         * Classic feature is retired). Stronger than a deprecation warning.
         */
        nonFunctionalAtRuntime?: boolean;
        /**
         * True when a runtime verification was attempted but could not complete.
         * Requires `isConfirmed: false` and a `verificationBlockedReason`.
         */
        verificationBlocked?: boolean;
        /**
         * Blocker category, required whenever `verificationBlocked` is true.
         */
        verificationBlockedReason?: string;
        /**
         * True when the verified runtime behavior contradicts the official docs.
         */
        differsFromOfficialDocs?: boolean;
        /**
         * Evidence describing how the runtime behavior differs from the official docs.
         */
        officialDocsNote?: string;
        /**
         * Runtime-context flag (orthogonal to the Engagement/Next platform flags): true when a
         * live CloudPage/landing-page probe rendered the function successfully, false when it was
         * probed there and proven not to work. Absent means never probed — not unsupported.
         */
        supportedInCloudPage?: boolean;
        /**
         * Runtime-context flag for the email/send context: true when a live email/send probe
         * rendered or evaluated the function successfully (a data/connector gate that still lets
         * the function run counts as supported), false when the send-content parser proved it does
         * not work there. Absent means never probed — not unsupported.
         */
        supportedInEmail?: boolean;
    }
    export interface AmpscriptDataKeyword {
        name: string;
        description: string;
        snippet?: string;
        /**
         * Name of the Handlebars helper/construct that plays the same role, or null
         * when the keyword has no counterpart.
         */
        handlebarsEquivalent?: string | null;
        /**
         * Human-readable caveat about how the Handlebars construct differs; only set
         * when `handlebarsEquivalent` is non-null.
         */
        handlebarsNote?: string | null;
    }
    export interface AmpscriptDataOperator {
        name: string;
        category: 'comparison' | 'assignment';
        description: string;
        /**
         * Name of the Handlebars helper that plays the same role, or null.
         */
        handlebarsEquivalent: string | null;
        /**
         * Caveat about how the Handlebars helper is invoked; only set when
         * `handlebarsEquivalent` is non-null.
         */
        handlebarsNote: string | null;
    }
    export interface AmpscriptDataPersonalization {
        name: string;
        description: string;
        /**
         * Regex matcher for parameterized personalization strings (e.g. MSG(0).NOUN([n])).
         */
        matcher?: RegExp;
    }
    export interface AmpscriptDataGlobal {
        name: string;
        description: string;
    }
    export const FUNCTIONS: AmpscriptDataFunction[];
    export const functionLookup: Map<string, AmpscriptDataFunction>;
    export const functionNames: Set<string>;
    export const CANONICAL_FUNCTIONS: string[];
    export const FUNCTION_CANONICAL_MAP: Map<string, string>;
    export const deprecatedFunctionLookup: Map<string, AmpscriptDataFunction>;
    export const AMPSCRIPT_KEYWORDS: AmpscriptDataKeyword[];
    export const AMPSCRIPT_OPERATORS: AmpscriptDataOperator[];
    export const AMPSCRIPT_GLOBALS: AmpscriptDataGlobal[];
    export const PERSONALIZATION_STRINGS: AmpscriptDataPersonalization[];
    /**
     * Blocker categories permitted as `verificationBlockedReason`.
     */
    export const VERIFICATION_BLOCKED_REASONS: readonly string[];
    /**
     * Returns true when the given name is a known Marketing Cloud system
     * personalization string, exact or parameterized. Case-insensitive.
     * @param name - Personalization string name to test (without brackets).
     * @returns True when the name matches a known system personalization string.
     */
    export function isSystemPersonalizationString(name: string): boolean;
    export function isEmailExcluded(name: string): boolean;
    /**
     * Returns the API version in which MCN support was introduced, or null.
     * @param name - Function name (case-insensitive).
     * @returns API version number (e.g. 67) or null when MCN support is unavailable.
     */
    export function getMcnApiVersion(name: string): number | null;
    /**
     * Returns true when the given AMPscript function is supported in Marketing Cloud Next.
     * @param name - Function name (case-insensitive).
     * @returns True when MCN support was introduced.
     */
    export function isMcnSupported(name: string): boolean;
    /**
     * Returns the MCN behavioral difference notes for the given function, or null.
     * @param name - Function name (case-insensitive).
     * @returns Behavioral difference notes string, or null when none.
     */
    export function getMcnNotes(name: string): string | null;
}

declare module 'ssjs-data' {
    export interface SsjsDataParam {
        name: string;
        description: string;
        type?: string;
        optional?: boolean;
    }
    /**
     * Restricted access direction of a property at runtime:
     * - `write-only` — assignment works, reading throws.
     * - `write-only-opaque` — assignment works, reading returns an opaque CLR value.
     * - `read-only` — reading works, assignment is silently ineffective.
     */
    export type SsjsDataPropertyAccess = 'write-only' | 'write-only-opaque' | 'read-only';
    export interface SsjsDataFunction {
        name: string;
        minArgs: number;
        maxArgs: number;
        description: string;
        prefix?: string;
        params?: SsjsDataParam[];
        returnType?: string;
        syntax?: string;
        example?: string;
        type?: string;
        isStatic?: boolean;
        deprecated?: boolean;
        requiresCoreLoad?: boolean;
        /**
         * Highest `Platform.Load("Core", <version>)` that still provides this member.
         * Loading a newer Core version leaves it `undefined` at runtime.
         */
        maxCoreVersion?: string;
        /**
         * Restricted access direction of a property at runtime. See
         * `propertyAccessLookup` for the meaning of each value.
         */
        access?: SsjsDataPropertyAccess;
        /**
         * True when the global is documented but throws a ReferenceError at runtime.
         */
        notDefinedAtRuntime?: boolean;
        /**
         * True when the member EXISTS/RESOLVES at runtime but has no known working
         * invocation (every tested call fails). Unlike notDefinedAtRuntime it is KEPT
         * in the .d.ts and completions; call sites are warned instead.
         */
        nonFunctionalAtRuntime?: boolean;
        /**
         * Note describing the runtime-safe replacement for a phantom/differing global.
         */
        officialDocsNote?: string;
        aliasOf?: string;
        /**
         * Exact set of permitted argument counts for a discontinuous overload
         * (PLATFORM_FUNCTIONS only). When present, a call is valid only when its
         * argument count is within [minArgs, maxArgs] AND a member of this array.
         */
        validArities?: number[];
    }
    export interface SsjsDataObject {
        name: string;
        methods: string[];
        description: string;
        deprecated?: boolean;
    }
    export interface SsjsDataBuiltin {
        name: string;
        owner: string;
        description: string;
        caveat?: string;
        params?: SsjsDataParam[];
        returnType?: string;
        syntax?: string;
        example?: string;
    }
    export interface SsjsDataKnownUnsupported {
        member: string;
        owner: string;
        esVersion: 3 | 5 | 6;
        isStatic: boolean;
        isProperty?: boolean;
        category: 'unavailable' | 'broken';
        hasPolyfill: boolean;
        suggestion: string;
    }
    export interface SsjsDataPolyfillable {
        method: string;
        owner: string;
        esVersion: 3 | 5 | 6;
        isStatic: boolean;
        category: 'unavailable' | 'broken';
        ambiguousWithString?: boolean;
        description: string;
        polyfill: string;
    }
    export const SSJS_GLOBALS: SsjsDataFunction[];
    export const SSJS_GLOBALS_MAP: Record<string, SsjsDataFunction>;
    export const notDefinedAtRuntimeGlobalNames: Set<string>;
    export const notDefinedAtRuntimeGlobalLookup: Map<string, SsjsDataFunction>;
    export const PLATFORM_METHODS: SsjsDataFunction[];
    export const PLATFORM_FUNCTIONS: SsjsDataFunction[];
    export const platformFunctionLookup: Map<string, SsjsDataFunction>;
    export const platformFunctionNames: Set<string>;
    export const CORE_LIBRARY_OBJECTS: SsjsDataObject[];
    export const coreObjectNames: Set<string>;
    export const coreObjectLookup: Map<string, SsjsDataObject>;
    /**
     * Core Library methods that resolve at runtime but have no known working
     * invocation (nonFunctionalAtRuntime). Map<classNameLower, Map<methodNameLower, entry>>.
     */
    export const coreNonFunctionalMethodLookup: Map<string, Map<string, SsjsDataFunction>>;
    /**
     * Core Library methods flagged `deprecated` (still callable at runtime but
     * retired in favor of newer APIs, e.g. Content Builder replacing classic
     * Content Areas). Map<classNameLower, Map<methodNameLower, entry>>.
     */
    export const coreDeprecatedMethodLookup: Map<string, Map<string, SsjsDataFunction>>;
    /**
     * Members that exist only up to a maximum `Platform.Load("Core", <version>)`.
     * Map<qualifiedNameLower, { name, maxCoreVersion }> — e.g. "errorutil" and
     * "errorutil.throwwsproxyerror" both map to maxCoreVersion "1".
     */
    export const maxCoreVersionLookup: Map<string, { name: string; maxCoreVersion: string }>;
    export const HTTP_METHODS: SsjsDataFunction[];
    export const httpMethodNames: Set<string>;
    export const WSPROXY_METHODS: SsjsDataFunction[];
    export const wsproxyMethodNames: Set<string>;
    export const HTTPHEADER_METHODS: SsjsDataFunction[];
    export const httpHeaderMethodNames: Set<string>;
    export const DATE_TIME_TIMEZONE_METHODS: SsjsDataFunction[];
    export const DATE_TIME_METHODS: SsjsDataFunction[];
    export const ERROR_UTIL_METHODS: SsjsDataFunction[];
    export const PLATFORM_VARIABLE_METHODS: SsjsDataFunction[];
    export const PLATFORM_RESPONSE_METHODS: SsjsDataFunction[];
    export const PLATFORM_REQUEST_METHODS: SsjsDataFunction[];
    /**
     * Core library `Request` object members (distinct from Platform.Request).
     */
    export const REQUEST_UTILITY_METHODS: SsjsDataFunction[];
    export const requestUtilityLookup: Map<string, SsjsDataFunction>;
    export const PLATFORM_RECIPIENT_METHODS: SsjsDataFunction[];
    export const platformRecipientMethodNames: Set<string>;
    export const SCRIPT_UTIL_CONSTRUCTORS: SsjsDataFunction[];
    export const SCRIPT_UTIL_REQUEST_METHODS: SsjsDataFunction[];
    /**
     * Value constraint on a writable HttpRequest/HttpGet instance property.
     */
    export interface SsjsDataValueConstraint {
        enum?: Array<string | number>;
        enumLabels?: Record<string, string>;
        numeric?: 'integer' | 'number';
        min?: number;
    }
    /**
     * A writable HttpRequest/HttpGet instance property (optionally constrained).
     */
    export interface SsjsDataHttpProperty {
        name: string;
        type: string;
        description: string;
        isConfirmed?: boolean;
        differsFromOfficialDocs?: boolean;
        officialDocsNote?: string;
        valueConstraint?: SsjsDataValueConstraint;
        /**
         * Restricted access direction of the property at runtime. See
         * `propertyAccessLookup` for the meaning of each value.
         */
        access?: SsjsDataPropertyAccess;
    }
    export const SCRIPT_UTIL_REQUEST_PROPERTIES: SsjsDataHttpProperty[];
    export const SCRIPT_UTIL_HTTPGET_PROPERTIES: SsjsDataHttpProperty[];
    /**
     * Properties whose access direction is restricted at runtime.
     * Map<qualifiedNameLower, { name, owner, access }> — e.g.
     * "platform.request.method" maps to access "read-only".
     */
    export const propertyAccessLookup: Map<
        string,
        { name: string; owner: string; access: SsjsDataPropertyAccess }
    >;
    export const ECMASCRIPT_BUILTINS: SsjsDataBuiltin[];
    export const KNOWN_UNSUPPORTED: SsjsDataKnownUnsupported[];
    export const POLYFILLABLE_METHODS: SsjsDataPolyfillable[];
    export const knownUnsupportedByPrototypeName: Map<string, SsjsDataKnownUnsupported>;
    export const knownUnsupportedByStaticName: Map<string, SsjsDataKnownUnsupported>;
    export const UNSUPPORTED_SYNTAX: Array<{ feature: string; message: string }>;
}

declare module 'handlebars-data' {
    /**
     * A single parameter of an MCN Handlebars helper.
     */
    export interface HandlebarsDataParam {
        name: string;
        type: string;
        description: string;
        optional?: boolean;
        variadic?: boolean;
    }
    /**
     * A single MCN Handlebars helper definition, enriched with a doc URL.
     */
    export interface HandlebarsDataHelper {
        name: string;
        category: string;
        origin: 'handlebars-builtin' | 'mcn-helper' | 'mcn-platform';
        helperType: 'inline' | 'block' | 'both';
        mcnSince: number;
        description: string;
        params: HandlebarsDataParam[];
        returnType: string;
        /**
         * True when the helper may only be used as a subexpression (e.g. `hash`).
         */
        subexpressionOnly?: boolean;
        /**
         * URL to the official Salesforce developer documentation page.
         */
        docUrl: string;
    }
    /**
     * A Salesforce-only `{!$namespace.Field}` built-in binding.
     */
    export interface HandlebarsDataBinding {
        name: string;
        token: string;
        namespace: string;
        mcnSince: number;
        description: string;
        /**
         * URL to the official Salesforce developer documentation page.
         */
        docUrl: string;
    }
    /**
     * A Handlebars construct that the locked-down MCN engine does not support.
     */
    export interface HandlebarsDataUnsupportedConstruct {
        id: string;
        astNodeType: string;
        helperName: string | null;
        label: string;
        message: string;
    }
    export const HELPERS: HandlebarsDataHelper[];
    export const helperLookup: Map<string, HandlebarsDataHelper>;
    export const helperNames: Set<string>;
    export const CANONICAL_HELPERS: string[];
    export function getHelper(name: string): HandlebarsDataHelper | undefined;
    export function isHelper(name: string): boolean;
    export function getHelperMcnSince(name: string): number | null;
    export const BUILTIN_BINDINGS: HandlebarsDataBinding[];
    export const bindingLookup: Map<string, HandlebarsDataBinding>;
    export const bindingNames: Set<string>;
    export function isBuiltinBinding(name: string): boolean;
    export const UNSUPPORTED_CONSTRUCTS: HandlebarsDataUnsupportedConstruct[];
    export const unsupportedByNodeType: Map<string, HandlebarsDataUnsupportedConstruct[]>;
}

declare module 'ssjs-data/urls' {
    export const GUIDE_BASE_URL: string;
    export const MDN_BASE_URL: string;
    export const ECMASCRIPT_URLS: Record<string, string>;
    /**
     * Derive the MDN documentation URL for an ECMAScript built-in.
     * @param owner - The builtin's owner (e.g. 'Array.prototype', 'Math', 'Global').
     * @param member - The method/property name (e.g. 'splice', 'PI', 'parseInt').
     * @returns Fully-qualified MDN URL.
     */
    export function mdnBuiltinUrl(owner: string, member: string): string;
}
