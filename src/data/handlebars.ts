/**
 * Handlebars for Marketing Cloud Next (MCN) catalog for completions, hover,
 * signature help, and diagnostics.
 *
 * Canonical helper definitions, built-in bindings, and unsupported-construct
 * definitions are sourced from the shared handlebars-data package, which is the
 * single source of truth. This module only re-exports them with LSP-friendly
 * aliases — it never redefines the data locally.
 */

import {
    HELPERS,
    BUILTIN_BINDINGS,
    UNSUPPORTED_CONSTRUCTS,
    type HandlebarsDataHelper,
    type HandlebarsDataBinding,
    type HandlebarsDataUnsupportedConstruct,
} from 'handlebars-data';

export {
    HELPERS as handlebarsHelpers,
    helperLookup,
    helperNames,
    CANONICAL_HELPERS,
    getHelper,
    isHelper,
    getHelperMcnSince,
    BUILTIN_BINDINGS as builtinBindings,
    bindingLookup,
    bindingNames,
    isBuiltinBinding,
    UNSUPPORTED_CONSTRUCTS as unsupportedConstructs,
    unsupportedByNodeType,
} from 'handlebars-data';
export type {
    HandlebarsDataHelper,
    HandlebarsDataParam,
    HandlebarsDataBinding,
    HandlebarsDataUnsupportedConstruct,
} from 'handlebars-data';

/** Convenience alias used throughout the language server. */
export type HandlebarsHelper = HandlebarsDataHelper;
/** Convenience alias for a built-in `{!$...}` binding. */
export type HandlebarsBinding = HandlebarsDataBinding;
/** Convenience alias for an unsupported Handlebars construct. */
export type HandlebarsUnsupportedConstruct = HandlebarsDataUnsupportedConstruct;

/** All MCN Handlebars helpers, sourced from the canonical handlebars-data catalog. */
export const handlebarsHelperList: HandlebarsDataHelper[] = HELPERS;

/** All built-in `{!$...}` bindings, sourced from handlebars-data. */
export const handlebarsBindingList: HandlebarsDataBinding[] = BUILTIN_BINDINGS;

/** All unsupported Handlebars constructs, sourced from handlebars-data. */
export const handlebarsUnsupportedList: HandlebarsDataUnsupportedConstruct[] =
    UNSUPPORTED_CONSTRUCTS;
