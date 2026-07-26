/**
 * Data-driven invariant: every ssjs-data callable flagged `deprecated: true`
 * that hover/completion treat as deprecated must also be diagnosable via
 * `ssjs/deprecated` when invoked. Prevents regressions like ContentArea
 * (deprecated in data + hover) silently missing the diagnostic because a
 * lookup filter was too strict (e.g. requiring `type === 'function'`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SSJS_GLOBALS,
    PLATFORM_FUNCTIONS,
    coreDeprecatedMethodLookup,
    coreObjectNames,
    ERROR_UTIL_METHODS,
} from 'ssjs-data';
import {
    SfmcLanguageService,
    deprecatedGlobals,
    platformFunctionLookup,
} from '../dist/esm/index.js';

const service = new SfmcLanguageService();

/**
 * Validate an SSJS snippet.
 * @param {string} text - SSJS source.
 * @returns {import('../dist/esm/index.js').Diagnostic[]} Diagnostics for the snippet.
 */
const validate = (text) => service.validate({ text, languageId: 'ssjs' });

/** Callable globals: deprecated and not typed as object (ErrorUtil is methods-only). */
const deprecatedCallableGlobals = SSJS_GLOBALS.filter((g) => g.deprecated && g.type !== 'object');

const deprecatedPlatformFns = PLATFORM_FUNCTIONS.filter((f) => f.deprecated);

const deprecatedErrorUtilMethods = ERROR_UTIL_METHODS.filter((m) => m.deprecated);

/** Canonical Core class name for a lowercase lookup key (e.g. send.definition → Send.Definition). */
const coreNameByLower = new Map([...coreObjectNames].map((n) => [n.toLowerCase(), n]));

/** Flatten coreDeprecatedMethodLookup into { className, methodName, isStatic } rows. */
const deprecatedCoreMethods = [];
for (const [classKey, methods] of coreDeprecatedMethodLookup) {
    const className = coreNameByLower.get(classKey) || classKey;
    for (const [, entry] of methods) {
        deprecatedCoreMethods.push({
            className,
            methodName: entry.name,
            isStatic: entry.isStatic !== false,
        });
    }
}

describe('ssjs/deprecated catalog invariants', () => {
    it('deprecatedGlobals lookup covers every deprecated callable global in ssjs-data', () => {
        assert.ok(
            deprecatedCallableGlobals.length > 0,
            'expected at least one deprecated callable global in ssjs-data',
        );
        for (const g of deprecatedCallableGlobals) {
            assert.ok(
                deprecatedGlobals.has(g.name),
                `deprecatedGlobals missing '${g.name}' (type=${JSON.stringify(g.type)}) — ` +
                    `lookup must not require type==='function'`,
            );
        }
    });

    it('platformFunctionLookup exposes deprecated flag for every deprecated Platform.Function', () => {
        assert.ok(
            deprecatedPlatformFns.length > 0,
            'expected at least one deprecated Platform.Function in ssjs-data',
        );
        for (const f of deprecatedPlatformFns) {
            const entry = platformFunctionLookup.get(f.name.toLowerCase());
            assert.ok(entry, `platformFunctionLookup missing '${f.name}'`);
            assert.equal(entry.deprecated, true, `'${f.name}' must carry deprecated: true`);
        }
    });

    it('emits ssjs/deprecated for every currently deprecated bare global call', () => {
        for (const g of deprecatedCallableGlobals) {
            // Minimal 1-arg call — ContentArea/ContentAreaByName accept string/number.
            const text = `${g.name}("x");`;
            const diags = validate(text).filter((d) => d.code === 'ssjs/deprecated');
            assert.ok(
                diags.some((d) => d.message.includes(g.name)),
                `expected ssjs/deprecated for bare call ${text}, got: ${JSON.stringify(diags)}`,
            );
        }
    });

    it('emits ssjs/deprecated for every currently deprecated Platform.Function call', () => {
        for (const f of deprecatedPlatformFns) {
            const text = `Platform.Function.${f.name}("x");`;
            const diags = validate(text).filter((d) => d.code === 'ssjs/deprecated');
            assert.ok(
                diags.some((d) => d.message.includes(f.name)),
                `expected ssjs/deprecated for ${text}, got: ${JSON.stringify(diags)}`,
            );
        }
    });

    it('emits ssjs/deprecated for every deprecated ErrorUtil method call', () => {
        for (const m of deprecatedErrorUtilMethods) {
            const text = `ErrorUtil.${m.name}(result);`;
            const diags = validate(text).filter((d) => d.code === 'ssjs/deprecated');
            assert.ok(
                diags.some((d) => d.message.includes(m.name)),
                `expected ssjs/deprecated for ${text}, got: ${JSON.stringify(diags)}`,
            );
        }
    });

    it('emits ssjs/deprecated for a representative sample of deprecated Core methods', () => {
        // Prefer static Retrieve/Init style calls where possible — one per class.
        const byClass = new Map();
        for (const row of deprecatedCoreMethods) {
            if (!byClass.has(row.className)) byClass.set(row.className, row);
            // Prefer Retrieve over Init when both exist (matches Template.Retrieve F5 case).
            if (row.methodName === 'Retrieve' && row.isStatic) {
                byClass.set(row.className, row);
            }
        }
        assert.ok(byClass.size > 0, 'expected deprecated core methods in ssjs-data');

        for (const row of byClass.values()) {
            const text = row.isStatic
                ? `${row.className}.${row.methodName}("Name", "x");`
                : `var _x = ${row.className}.Init("ck"); _x.${row.methodName}();`;
            const diags = validate(text).filter((d) => d.code === 'ssjs/deprecated');
            assert.ok(
                diags.length > 0,
                `expected ssjs/deprecated for core sample ${text}, got none`,
            );
        }
    });
});
