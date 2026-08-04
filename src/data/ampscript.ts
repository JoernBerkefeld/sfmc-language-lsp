/**
 * AMPscript function definitions for auto-completion and hover/intellisense.
 *
 * Canonical function names, keywords, and personalization strings are sourced
 * from the shared ampscript-data package. Rich descriptions, parameter docs,
 * and examples in this file are original content for this extension.
 */

// Re-export shared canonical data for use throughout the language server.
// ampscript-data is the single source of truth for AMPscript functions,
// keywords, and personalization strings.
import { FUNCTIONS, type AmpscriptDataFunction } from 'ampscript-data';

export {
    FUNCTIONS as canonicalFunctions,
    FUNCTION_CANONICAL_MAP,
    functionNames,
    isEmailExcluded,
    isMcnSupported,
    getMcnApiVersion,
    getMcnNotes,
    AMPSCRIPT_KEYWORDS as ampscriptKeywords,
    AMPSCRIPT_GLOBALS as ampscriptGlobals,
    PERSONALIZATION_STRINGS as personalizationStrings,
} from 'ampscript-data';
export type {
    AmpscriptDataFunction,
    AmpscriptDataParam,
    AmpscriptDataRepeatGroup,
    AmpscriptDataKeyword,
    AmpscriptDataGlobal,
    AmpscriptDataPersonalization,
} from 'ampscript-data';

// The local hand-authored function catalog has been removed: the canonical
// ampscript-data catalog is a superset of the old local shape (it adds
// minArgs/maxArgs/repeat/docUrl/guideUrl/returnDescription/etc.). These aliases
// keep existing consumer imports compiling against the canonical type.
export type AmpscriptFunction = AmpscriptDataFunction;
export type AmpscriptFunctionParam = AmpscriptDataFunction['params'][number];

/**
 * All AMPscript functions, sourced from the canonical ampscript-data catalog.
 */
export const ampscriptFunctions: AmpscriptDataFunction[] = FUNCTIONS;

/**
 * AMPscript language keywords with description + completion snippet.
 */

/**
 * Common system personalization strings.
 */

/**
 * Build a lookup map for fast case-insensitive function retrieval.
 */
export const functionLookup = new Map<string, AmpscriptFunction>();
for (const function_ of ampscriptFunctions) {
    functionLookup.set(function_.name.toLowerCase(), function_);
}
