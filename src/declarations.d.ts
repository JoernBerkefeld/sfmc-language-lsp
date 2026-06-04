/**
 * Type declarations for JavaScript-only npm packages.
 * These packages have no TypeScript declarations of their own.
 */

declare module 'ampscript-data' {
    export interface AmpscriptDataFunction {
        name: string;
        category: string;
        /** API version in which MCN support was introduced (e.g. 67), or null if not supported in MCN. */
        mcnSince: number | null;
        /** Behavioral difference notes for MCN, or null if none. */
        mcnNotes: string | null;
    }
    export interface AmpscriptDataKeyword {
        name: string;
        description: string;
        snippet?: string;
    }
    export interface AmpscriptDataPersonalization {
        name: string;
        description: string;
    }
    export const FUNCTIONS: AmpscriptDataFunction[];
    export const functionLookup: Map<string, AmpscriptDataFunction>;
    export const functionNames: Set<string>;
    export const CANONICAL_FUNCTIONS: string[];
    export const FUNCTION_CANONICAL_MAP: Map<string, string>;
    export const DEPRECATED_FUNCTIONS: AmpscriptDataFunction[];
    export const deprecatedFunctionLookup: Map<string, AmpscriptDataFunction>;
    export const AMPSCRIPT_KEYWORDS: AmpscriptDataKeyword[];
    export const PERSONALIZATION_STRINGS: AmpscriptDataPersonalization[];
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
        aliasOf?: string;
    }
    export interface SsjsDataObject {
        name: string;
        methods: string[];
        description: string;
    }
    export interface SsjsDataBuiltin {
        name: string;
        owner: string;
        description: string;
        params?: SsjsDataParam[];
        returnType?: string;
        syntax?: string;
        example?: string;
    }
    export const SSJS_GLOBALS: SsjsDataFunction[];
    export const SSJS_GLOBALS_MAP: Record<string, SsjsDataFunction>;
    export const PLATFORM_METHODS: SsjsDataFunction[];
    export const PLATFORM_FUNCTIONS: SsjsDataFunction[];
    export const platformFunctionLookup: Map<string, SsjsDataFunction>;
    export const platformFunctionNames: Set<string>;
    export const CORE_LIBRARY_OBJECTS: SsjsDataObject[];
    export const coreObjectNames: Set<string>;
    export const coreObjectLookup: Map<string, SsjsDataObject>;
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
    export const PLATFORM_RECIPIENT_METHODS: SsjsDataFunction[];
    export const platformRecipientMethodNames: Set<string>;
    export const SCRIPT_UTIL_CONSTRUCTORS: SsjsDataFunction[];
    export const SCRIPT_UTIL_REQUEST_METHODS: SsjsDataFunction[];
    export const ECMASCRIPT_BUILTINS: SsjsDataBuiltin[];
    export const UNSUPPORTED_SYNTAX: Array<{ feature: string; message: string }>;
}
