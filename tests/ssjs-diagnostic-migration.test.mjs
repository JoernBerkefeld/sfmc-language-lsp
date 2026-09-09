import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
    SfmcLanguageService,
    DEFAULT_SETTINGS,
    DIAGNOSTIC_RULES,
    LSP_PACKAGE_VERSION,
} from '../dist/esm/index.js';
import { validateSsjs } from '../dist/esm/validators/ssjs.js';
import { getSsjsCodeActions } from '../dist/esm/codeActions/ssjs.js';
import { nonexistentGlobals, polyfillableStaticLookup } from '../dist/esm/data/ssjs.js';

const service = new SfmcLanguageService();
const response =
    'var req = new Script.Util.HttpRequest("https://example.com"); var resp = req.send(); ';
const crossBlock =
    '<script runat="server">later();</script>\n<script runat="server">function later() { return 1; }</script>';
const samples = [
    ['ssjs/polyfill-required', 'Array.isArray(value);'],
    ['ssjs/polyfill-required', 'items.forEach(callback);'],
    ['ssjs/replace-with-platform-function', 'JSON.parse(value);'],
    ['ssjs/mcn-not-supported', 'var value = 1;', { targetPlatform: 'next' }],
    ['ssjs/require-platform-load', 'DataExtension.Init("key");'],
    ['ssjs/require-platform-load', 'HTTPHeader.SetValue("x", "y");'],
    ['ssjs/require-platform-load', 'Stringify(value);'],
    ['ssjs/platform-load-version', 'Platform.Load("Core", "1");'],
    ['ssjs/unsupported-syntax', 'let value = 1;'],
    ['ssjs/clr-header-access', `${response}resp.headers["Content-Type"];`],
    ['ssjs/clr-header-access', `${response}resp.headers.Get("Content-Type");`],
    ['ssjs/clr-content-access', `${response}var body = resp.content;`],
    ['ssjs/invalid-http-property-value', `${response}req.emptyContentHandling = 5;`],
    ['ssjs/invalid-property-access', 'Platform.Request.Method = "GET";'],
    ['ssjs/nonexistent-global', `${[...nonexistentGlobals.keys()][0]}();`],
    ['ssjs/deprecated', 'ContentArea("key");'],
    ['ssjs/deprecated', 'Platform.Function.ContentArea("key");'],
    ['ssjs/deprecated', 'ErrorUtil.ThrowWSProxyError(result);'],
    ['ssjs/deprecated', 'Template.Retrieve("Name", "key");'],
    ['ssjs/invalid-arity', 'Platform.Function.HTTPGet("url", false);'],
    ['ssjs/nonfunctional-method', 'var fd = FilterDefinition.Init("key"); fd.Update({});'],
    ['ssjs/switch-fallthrough', 'switch (value) { case 1: case 2: break; }'],
    [
        'ssjs/new-object-returning-constructor',
        'function Factory() { return { value: 1 }; } new Factory();',
    ],
    ['ssjs/cross-block-forward-reference', crossBlock],
];

/**
 * Remove diagnostic associations when comparing legacy and canonical action bodies.
 * @param {object[]} actions - Generated code actions.
 * @returns {object[]} Titles, edits, and all other action fields.
 */
function actionBodies(actions) {
    return actions.map((action) => {
        const result = { ...action };
        delete result.diagnostics;
        return result;
    });
}

describe('SSJS canonical diagnostic migration', () => {
    it('covers every SSJS registry variant and every emission site', () => {
        assert.deepEqual(
            new Set(samples.map(([variant]) => variant)),
            new Set(
                DIAGNOSTIC_RULES.filter((rule) => rule.variant.startsWith('ssjs/')).map(
                    (rule) => rule.variant,
                ),
            ),
        );
        const source = readFileSync(new URL('../src/validators/ssjs.ts', import.meta.url), 'utf8');
        assert.equal((source.match(/createDiagnostic\(DIAG_CODE_SSJS_/g) ?? []).length, 24);
        assert.doesNotMatch(source, /diagnostics\.push\(\s*\{/);
        assert.doesNotMatch(source, /code:\s*DIAG_CODE_SSJS_/);
    });

    for (const [variant, text, overrides = {}] of samples) {
        it(`preserves direct/public metadata and suppression: ${variant} — ${text.slice(0, 40)}`, () => {
            const settings = { ...DEFAULT_SETTINGS, ...overrides };
            const doc = { text, languageId: 'ssjs', uri: 'file:///migration.ssjs' };
            const direct = validateSsjs(text, settings);
            assert.deepEqual(service.validate(doc, settings), direct);
            const diagnostic = direct.find((item) => item.data?.sfmc.variant === variant);
            assert.ok(diagnostic, `missing ${variant}: ${JSON.stringify(direct)}`);
            for (const item of direct) {
                const rule = DIAGNOSTIC_RULES.find((row) => row.variant === item.data.sfmc.variant);
                assert.ok(rule);
                assert.equal(item.code, rule.ruleId);
                assert.equal(
                    item.codeDescription.href,
                    `https://github.com/JoernBerkefeld/sfmc-language-lsp/blob/v${LSP_PACKAGE_VERSION}/${rule.documentationPath}`,
                );
            }
            const retained = direct.filter(
                (item) =>
                    !DIAGNOSTIC_RULES.find((row) => row.variant === item.data.sfmc.variant)
                        .suppressWithEslint,
            );
            assert.deepEqual(
                service.validate(doc, { ...settings, disableLspDiagnosticsForEslintRules: true }),
                retained,
            );
        });
    }

    it('preserves exact payloads and legacy action edits for all actionable variants', () => {
        const expected = new Map([
            [
                'ssjs/polyfill-required',
                {
                    owner: 'Array',
                    method: 'isArray',
                    polyfill: polyfillableStaticLookup.get('array.isarray').polyfill,
                },
            ],
            [
                'ssjs/replace-with-platform-function',
                { owner: 'JSON', member: 'parse', replacement: 'Platform.Function.ParseJSON' },
            ],
            ['ssjs/clr-header-access', { respName: 'resp', keyText: '"Content-Type"' }],
            ['ssjs/clr-content-access', { respName: 'resp', contentText: 'resp.content' }],
            [
                'ssjs/invalid-http-property-value',
                {
                    propName: 'emptyContentHandling',
                    suggestions: [
                        { code: '0', label: 'continue' },
                        { code: '1', label: 'stop' },
                        { code: '2', label: 'continue to next subscriber - email sends only' },
                    ],
                },
            ],
        ]);
        for (const [variant, payload] of expected) {
            const [, text] = samples.find(([name]) => name === variant);
            const doc = { text, languageId: 'ssjs', uri: 'file:///migration.ssjs' };
            const canonical = service
                .validate(doc)
                .find((item) => item.data.sfmc.variant === variant);
            assert.deepEqual(canonical.data, { sfmc: { variant, payload } });
            const legacy = { ...canonical };
            delete legacy.codeDescription;
            legacy.code = variant;
            legacy.data = payload;
            const actions = service.getCodeActions(doc, [canonical]);
            assert.ok(actions.length > 0, variant);
            assert.deepEqual(actions, getSsjsCodeActions(text, doc.uri, [canonical]));
            assert.deepEqual(
                actionBodies(actions),
                actionBodies(service.getCodeActions(doc, [legacy])),
            );
            const wire = JSON.stringify(canonical);
            const transported = JSON.parse(wire);
            assert.deepEqual(
                actionBodies(service.getCodeActions(doc, [transported])),
                actionBodies(actions),
            );
        }
    });

    it('distinguishes polyfill insertion from replacement under the same public ID', () => {
        const doc = {
            text: 'Array.isArray(value); JSON.parse(value);',
            languageId: 'ssjs',
            uri: 'file:///migration.ssjs',
        };
        const diagnostics = service.validate(doc);
        const polyfill = diagnostics.find(
            (item) => item.data.sfmc.variant === 'ssjs/polyfill-required',
        );
        const replacement = diagnostics.find(
            (item) => item.data.sfmc.variant === 'ssjs/replace-with-platform-function',
        );
        assert.equal(polyfill.code, replacement.code);
        const insert = service.getCodeActions(doc, [polyfill])[0];
        const replace = service.getCodeActions(doc, [replacement])[0];
        assert.match(insert.title, /Insert polyfill/);
        assert.deepEqual(insert.edit.changes[doc.uri][0].range, {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        });
        assert.ok(
            insert.edit.changes[doc.uri][0].newText.includes(polyfill.data.sfmc.payload.polyfill),
        );
        assert.deepEqual(replace.edit.changes[doc.uri], [
            { range: replacement.range, newText: 'Platform.Function.ParseJSON' },
        ]);
        assert.deepEqual(
            service.getCodeActions(doc, [{ ...polyfill, data: polyfill.data.sfmc.payload }]),
            [],
        );
    });
});
