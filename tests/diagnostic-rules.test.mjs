import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as esm from '../dist/esm/index.js';
import * as amp from '../dist/esm/validators/ampscript.js';
import * as ssjs from '../dist/esm/validators/ssjs.js';
import * as hbs from '../dist/esm/validators/mcnHandlebars.js';
import { validateGtlBlocks } from '../dist/esm/validators/gtl.js';

import { getAmpscriptCodeActions } from '../dist/esm/codeActions/ampscript.js';
import { getSsjsCodeActions } from '../dist/esm/codeActions/ssjs.js';
import { getHandlebarsCodeActions } from '../dist/esm/codeActions/mcnHandlebars.js';

const cjs = createRequire(import.meta.url)('../dist/cjs/index.cjs');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('direct Handlebars and GTL emissions', () => {
    it('links every emitted variant and preserves suggestion payloads', () => {
        const samples = [
            [hbs.validateMcnHandlebars, '{{#if x}}', 'handlebars/syntax-error'],
            [hbs.validateMcnHandlebars, '{{> partial}}', 'handlebars/unsupported-construct'],
            [hbs.validateMcnHandlebars, '{{eech items}}', 'handlebars/unknown-helper'],
            [hbs.validateMcnHandlebars, '{!$foo.Bar}', 'handlebars/unknown-binding'],
            [validateGtlBlocks, '{{/each}}', 'gtl/unexpected-close'],
            [validateGtlBlocks, '{{#each items}}', 'gtl/unclosed-block'],
        ];
        for (const [validate, text, variant] of samples) {
            const diagnostics = [];
            validate(text, diagnostics, 100);
            assert.equal(diagnostics.length, 1);
            const [diagnostic] = diagnostics;
            const rule = esm.getDiagnosticRule(variant);
            assert.equal(diagnostic.code, rule.ruleId);
            assert.equal(
                diagnostic.codeDescription.href,
                esm.getDiagnosticDocumentationUrl(variant),
            );
            assert.equal(diagnostic.data.sfmc.variant, variant);
            if (variant === 'handlebars/unknown-helper') {
                assert.deepEqual(diagnostic.data.sfmc.payload, {
                    typed: 'eech',
                    suggestion: 'each',
                });
            }
            const empty = [];
            validate(text, empty, 0);
            assert.deepEqual(empty, []);
        }
    });

    it('suppresses overlapping Handlebars variants but retains parser and GTL balance errors', () => {
        const service = new esm.SfmcLanguageService();
        for (const [text, targetPlatform, retained] of [
            ['{{> partial}}', 'next', false],
            ['{{eech items}}', 'next', false],
            ['{!$foo.Bar}', 'next', false],
            ['{{#if x}}', 'next', true],
            ['{{/each}}', 'engagement', true],
            ['{{#each items}}', 'engagement', true],
        ]) {
            const doc = { text, languageId: 'ampscript' };
            const settings = { ...esm.DEFAULT_SETTINGS, targetPlatform };
            const original = service.validate(doc, settings);
            assert.equal(original.length, 1);
            const filtered = service.validate(doc, {
                ...settings,
                disableLspDiagnosticsForEslintRules: true,
            });
            assert.deepEqual(filtered, retained ? original : []);
        }
    });
});

const uri = 'file:///transport.txt';
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };
const insertionRange = { start: range.start, end: range.start };
const cases = [
    {
        variant: 'ampscript/html-wrapped-comment',
        source: 'ampscript',
        text: 'abc',
        payload: '/* original */',
        handler: getAmpscriptCodeActions,
        edits: [{ range, newText: '/* original */' }],
    },
    {
        variant: 'ampscript/html-comment',
        source: 'ampscript',
        text: 'abc',
        handler: getAmpscriptCodeActions,
        edits: [{ range, newText: '/* abc */' }],
    },
    {
        variant: 'ampscript/js-line-comment',
        source: 'ampscript',
        text: 'abc',
        payload: 'preserved comment',
        handler: getAmpscriptCodeActions,
        edits: [{ range, newText: '/* preserved comment */' }],
    },
    {
        variant: 'ampscript/nested-script-tag',
        source: 'ampscript',
        text: 'abc',
        handler: getAmpscriptCodeActions,
        edits: [{ range: insertionRange, newText: '</script>\n' }],
    },
    ...['ampscript/nested-delimiter', 'ampscript/nested-delimiter-in-script'].map((variant) => ({
        variant,
        source: 'ampscript',
        text: '%%[x]%%',
        payload: '%%[',
        handler: getAmpscriptCodeActions,
        edits: [{ range, newText: '' }],
        secondEdits: [
            {
                range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } },
                newText: '',
            },
            { range, newText: '' },
        ],
    })),
    {
        variant: 'ssjs/polyfill-required',
        source: 'ssjs',
        text: 'abc',
        payload: { owner: 'Array', method: 'example', polyfill: '/* verified fixture */\n' },
        handler: getSsjsCodeActions,
        edits: [{ range: insertionRange, newText: '/* verified fixture */\n\n' }],
    },
    {
        variant: 'ssjs/replace-with-platform-function',
        source: 'ssjs',
        text: 'abc',
        payload: { owner: 'JSON', member: 'parse', replacement: 'Platform.Function.ParseJSON' },
        handler: getSsjsCodeActions,
        edits: [{ range, newText: 'Platform.Function.ParseJSON' }],
    },
    {
        variant: 'ssjs/clr-content-access',
        source: 'ssjs',
        text: 'abc',
        payload: { respName: 'response', contentText: 'response.content' },
        handler: getSsjsCodeActions,
        edits: [{ range, newText: 'String(response.content)' }],
    },
    {
        variant: 'ssjs/invalid-http-property-value',
        source: 'ssjs',
        text: 'abc',
        payload: { propName: 'method', suggestions: [{ code: '"GET"' }] },
        handler: getSsjsCodeActions,
        edits: [{ range, newText: '"GET"' }],
    },
    ...['handlebars/unknown-helper', 'handlebars/unknown-binding'].map((variant) => ({
        variant,
        source: 'handlebars',
        text: 'abc',
        payload: { typed: 'abc', suggestion: 'correct' },
        handler: getHandlebarsCodeActions,
        edits: [{ range, newText: 'correct' }],
    })),
];

describe('quick-fix transport compatibility', () => {
    for (const entry of cases) {
        it(`preserves exact legacy and canonical edits: ${entry.variant}`, () => {
            const input = { range, message: 'fixture', source: entry.source, data: entry.payload };
            const legacy = { ...input, code: entry.variant };
            const wire = JSON.stringify(esm.createDiagnostic(entry.variant, input));
            const canonical = JSON.parse(wire);
            const oldActions = entry.handler(entry.text, uri, [legacy]);
            const newActions = entry.handler(entry.text, uri, [canonical]);
            assert.equal(newActions.length, entry.secondEdits ? 2 : 1);
            assert.deepEqual(newActions[0].edit.changes[uri], entry.edits);
            if (entry.secondEdits)
                assert.deepEqual(newActions[1].edit.changes[uri], entry.secondEdits);
            assert.deepEqual(
                newActions.map((action) => ({ ...action, diagnostics: undefined })),
                oldActions.map((action) => ({ ...action, diagnostics: undefined })),
            );
            assert.equal(newActions[0].diagnostics[0], canonical);
            assert.equal(oldActions[0].diagnostics[0], legacy);
            assert.deepEqual(
                entry.handler(entry.text, uri, [
                    { ...canonical, data: { sfmc: { variant: 'bogus', payload: entry.payload } } },
                ]),
                [],
            );
        });
    }

    it('never infers polyfill versus replacement from their shared public ID', () => {
        for (const entry of cases) {
            if (
                entry.variant !== 'ssjs/polyfill-required' &&
                entry.variant !== 'ssjs/replace-with-platform-function'
            )
                continue;
            const diagnostic = esm.createDiagnostic(entry.variant, {
                range,
                message: 'fixture',
                source: 'ssjs',
                data: entry.payload,
            });
            assert.deepEqual(
                getSsjsCodeActions(entry.text, uri, [{ ...diagnostic, data: entry.payload }]),
                [],
            );
            const otherVariant =
                entry.variant === 'ssjs/polyfill-required'
                    ? 'ssjs/replace-with-platform-function'
                    : 'ssjs/polyfill-required';
            assert.deepEqual(
                getSsjsCodeActions(entry.text, uri, [
                    { ...diagnostic, data: esm.encodeDiagnosticData(otherVariant, entry.payload) },
                ]),
                [],
            );
        }
    });

    it('preserves CLR header helper insertion and replacement through transport', () => {
        const input = {
            range,
            message: 'fixture',
            source: 'ssjs',
            data: { respName: 'response', keyText: '"x-token"' },
        };
        const legacy = { ...input, code: 'ssjs/clr-header-access' };
        const wire = JSON.stringify(esm.createDiagnostic(legacy.code, input));
        const canonical = JSON.parse(wire);
        const oldActions = getSsjsCodeActions('abc', uri, [legacy]);
        const newActions = getSsjsCodeActions('abc', uri, [canonical]);
        assert.deepEqual(newActions[0].edit, oldActions[0].edit);
        assert.deepEqual(newActions[0].edit.changes[uri][0], {
            range,
            newText: 'getHeaderMap(response)["x-token"]',
        });
        assert.equal(newActions[0].edit.changes[uri].length, 2);
        assert.match(newActions[0].edit.changes[uri][1].newText, /function getHeaderMap\(resp\)/);
    });
});

const formats = Object.entries({ esm, cjs });
for (const [format, api] of formats) {
    describe(`diagnostic registry (${format})`, () => {
        it('enumerates every existing named variant and eleven reserved unnamed sites', () => {
            const codes = [amp, ssjs, hbs].flatMap((module) =>
                Object.entries(module)
                    .filter(([name]) => name.startsWith('DIAG_CODE_'))
                    .map(([, code]) => code),
            );
            const legacy = api.DIAGNOSTIC_RULES.filter((rule) => rule.legacyCode !== null);
            assert.equal(codes.length, 36);
            assert.deepEqual(
                legacy.map((rule) => rule.legacyCode).toSorted((a, b) => a.localeCompare(b)),
                codes.toSorted((a, b) => a.localeCompare(b)),
            );
            assert.equal(api.DIAGNOSTIC_RULES.length, 47);
            assert.equal(new Set(api.DIAGNOSTIC_RULES.map((rule) => rule.variant)).size, 47);
            assert.equal(api.getDiagnosticRule('toString'), undefined);
        });

        it('preserves suppression classifications with only the planned attribute correction', () => {
            const suppressed = new Set([
                ...amp.ESLINT_DUPLICATE_DIAG_CODES,
                ...ssjs.SSJS_ESLINT_DUPLICATE_DIAG_CODES,
                ...hbs.HBS_ESLINT_DUPLICATE_DIAG_CODES,
                'ampscript/prefer-attribute-value',
            ]);
            for (const rule of api.DIAGNOSTIC_RULES) {
                assert.equal(rule.suppressWithEslint, suppressed.has(rule.variant), rule.variant);
                assert.equal(rule.eslintRuleId, rule.suppressWithEslint ? rule.ruleId : null);
            }
        });

        it('uses explicit public IDs and owning-package versioned paths', () => {
            assert.equal(api.LSP_PACKAGE_VERSION, version);
            for (const rule of api.DIAGNOSTIC_RULES) {
                assert.match(rule.ruleId, /^sfmc\/(?:amp|ssjs|hbs|gtl)-[a-z-]+$/);
                assert.match(
                    rule.documentationPath,
                    /^docs\/rules\/(?:amp|ssjs|hbs|gtl)\/[a-z-]+\.md$/,
                );
                assert.equal(
                    api.getDiagnosticDocumentationUrl(rule.variant),
                    `https://github.com/JoernBerkefeld/sfmc-language-lsp/blob/v${version}/${rule.documentationPath}`,
                );
                assert.ok(Object.isFrozen(rule));
            }
        });

        it('roundtrips primitive, object, array, null and absent payloads without flattening', () => {
            for (const rule of api.DIAGNOSTIC_RULES) {
                for (const payload of [
                    'original text',
                    { nested: { value: 7 } },
                    [1, 'two'],
                    null,
                    false,
                    0,
                    undefined,
                ]) {
                    const encoded = api.encodeDiagnosticData(rule.variant, payload);
                    assert.equal(encoded.sfmc.payload, payload);
                    const wire = JSON.stringify(encoded);
                    const transported = JSON.parse(wire);
                    assert.deepEqual(api.decodeDiagnosticData(rule.ruleId, transported), {
                        variant: rule.variant,
                        payload,
                    });
                    if (rule.legacyCode) {
                        assert.deepEqual(api.decodeDiagnosticData(rule.legacyCode, payload), {
                            variant: rule.variant,
                            payload,
                        });
                    }
                }
            }
        });

        it('requires explicit variants for every many-to-one canonical rule', () => {
            for (const rule of api.DIAGNOSTIC_RULES) {
                const siblings = api.DIAGNOSTIC_RULES.filter(
                    (candidate) => candidate.ruleId === rule.ruleId,
                );
                const decoded = api.decodeDiagnosticData(rule.ruleId, 'legacy payload');
                assert.deepEqual(
                    decoded,
                    siblings.length > 1
                        ? undefined
                        : { variant: rule.variant, payload: 'legacy payload' },
                );
            }
            assert.equal(
                api.getDiagnosticRule('ssjs/polyfill-required').ruleId,
                api.getDiagnosticRule('ssjs/replace-with-platform-function').ruleId,
            );
        });

        it('creates immutable-input emissions with exact metadata for every variant', () => {
            const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
            for (const rule of api.DIAGNOSTIC_RULES) {
                for (const payload of [undefined, '%%[', { member: 'parse' }]) {
                    const input = Object.freeze({ range, message: 'example', data: payload });
                    const diagnostic = api.createDiagnostic(rule.variant, input);
                    assert.notEqual(diagnostic, input);
                    assert.equal(diagnostic.range, range);
                    assert.equal(diagnostic.message, input.message);
                    assert.equal(diagnostic.code, rule.ruleId);
                    assert.equal(
                        diagnostic.codeDescription.href,
                        api.getDiagnosticDocumentationUrl(rule.variant),
                    );
                    const wire = JSON.stringify(diagnostic.data);
                    const transported = JSON.parse(wire);
                    assert.deepEqual(api.decodeDiagnosticData(diagnostic.code, transported), {
                        variant: rule.variant,
                        payload,
                    });
                }
            }
        });

        it('rejects invalid canonical envelopes and unrelated codes', () => {
            for (const data of [
                { sfmc: null },
                { sfmc: {} },
                { sfmc: { variant: 'bogus' } },
                api.encodeDiagnosticData('ssjs/polyfill-required', {}),
            ]) {
                assert.equal(api.decodeDiagnosticData('sfmc/amp-no-html-comment', data), undefined);
            }
            for (const code of [undefined, 2550, 'third-party/rule', 'ampscript/unclosed-block']) {
                assert.equal(api.decodeDiagnosticData(code, {}), undefined);
            }
            const payload = { sfmc: { variant: 'not-an-envelope', payload: 1 } };
            assert.equal(
                api.decodeDiagnosticData('ampscript/html-comment', payload).payload,
                payload,
            );
        });
    });
}
