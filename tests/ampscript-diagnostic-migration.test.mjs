import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { validateAmpscript } from '../dist/esm/validators/ampscript.js';
import { getAmpscriptCodeActions } from '../dist/esm/codeActions/ampscript.js';
import { SfmcLanguageService, DEFAULT_SETTINGS } from '../dist/esm/index.js';
import {
    DIAGNOSTIC_RULES,
    getDiagnosticRule,
    getDiagnosticDocumentationUrl,
} from '../dist/esm/diagnostic-rules.js';
import { functionLookup } from '../dist/esm/data/ampscript.js';

const fixtures = [
    ['unclosed-block', '%%['],
    ['unexpected-block-close', ']%%'],
    ['unclosed-inline', '%%='],
    ['unexpected-inline-close', '=%%'],
    ['unmatched-endif', '%%[ endif ]%%'],
    ['unmatched-next', '%%[ next ]%%'],
    ['unclosed-if', '%%[ if @x then ]%%'],
    ['unclosed-for', '%%[ for @i = 1 to 2 do ]%%'],
    ['unknown-function', '%%[ MissingFunction() ]%%'],
    ['function-arity', '%%[ Add(1) ]%%'],
    ['function-arity', '%%[ Add(1, 2, 3) ]%%'],
    ['function-arity', '%%[ InsertDE("DE", "Column", "Value", "Incomplete") ]%%'],
    ['arg-type', '%%[ Uppercase(true) ]%%'],
    ['arg-type', '%%[ set @r = Row(LookupRows("DE", "x", "y"), 1) set @n = RowCount(@r) ]%%'],
    ['enum-value', '%%[ DatePart("2026-01-15", "decade") ]%%'],
    ['nonfunctional-function', '%%=GetPortfolioItem("key")=%%'],
    ['set-no-target', '%%[ set = 1 ]%%'],
    ['smart-quotes', '%%[ set @x = “value” ]%%'],
    ['prefer-attribute-value', '%%[ set @x = FirstName ]%%'],
    ['html-comment', '%%[ <!-- comment --> ]%%'],
    ['js-line-comment', '%%[\n// comment\n]%%', 'engagement', 'comment'],
    [
        'nested-script-tag',
        '<script language="ampscript"><script language="ampscript"></script></script>',
    ],
    [
        'nested-delimiter-in-script',
        '<script language="ampscript">%%[ set @x = 1 ]%%</script>',
        'engagement',
        '%%[',
    ],
    [
        'nested-delimiter-in-script',
        '<script language="ampscript">%%=Add(1,2)=%%</script>',
        'engagement',
        '%%=',
    ],
    ['nested-delimiter', '%%[ %%[ set @x = 1 ]%% ]%%', 'engagement', '%%['],
    ['nested-delimiter', '%%= %%=Add(1,2)=%% =%%', 'engagement', '%%='],
    ['mcn-unsupported-function', '%%[ InsertDE("DE", "x", "y") ]%%', 'next'],
];
const deprecated = functionLookup.values().find((entry) => entry.deprecated);
assert.ok(deprecated, 'catalog contains a deprecated function');
const replacement =
    typeof deprecated.deprecated === 'object' ? deprecated.deprecated.replacement : undefined;
fixtures.push([
    'deprecated-function',
    `%%[ ${deprecated.name}() ]%%`,
    'engagement',
    replacement || undefined,
]);

describe('AMPscript canonical emission migration', () => {
    for (const [name, text, targetPlatform = 'engagement', payload] of fixtures) {
        it(`${name}: ${text}`, () => {
            const variant = `ampscript/${name}`;
            const diagnostics = validateAmpscript(text, { ...DEFAULT_SETTINGS, targetPlatform });
            const diagnostic = diagnostics.find((entry) => entry.data?.sfmc?.variant === variant);
            assert.ok(diagnostic, JSON.stringify(diagnostics));
            assert.equal(diagnostic.code, getDiagnosticRule(variant).ruleId);
            assert.deepEqual(diagnostic.codeDescription, {
                href: getDiagnosticDocumentationUrl(variant),
            });
            assert.deepEqual(diagnostic.data, { sfmc: { variant, payload } });
            for (const entry of diagnostics) {
                if (entry.source !== 'ampscript') continue;
                assert.ok(entry.code.startsWith('sfmc/amp-'));
                assert.equal(
                    entry.codeDescription.href,
                    getDiagnosticDocumentationUrl(entry.data.sfmc.variant),
                );
            }
        });
    }

    it('covers every registry variant, except the intentionally unreachable wrapped-comment branch', () => {
        const covered = new Set(fixtures.map(([name]) => `ampscript/${name}`));
        const variants = DIAGNOSTIC_RULES.filter((rule) =>
            rule.variant.startsWith('ampscript/'),
        ).map((rule) => rule.variant);
        assert.deepEqual(
            variants.filter((variant) => !covered.has(variant)),
            ['ampscript/html-wrapped-comment'],
        );
        const diagnostics = validateAmpscript('%%[ <!--/* comment */--> ]%%');
        assert.equal(
            diagnostics.some(
                (entry) => entry.data.sfmc.variant === 'ampscript/html-wrapped-comment',
            ),
            false,
        );
    });

    it('wraps all 27 AMP emission sites, including the unreachable conditional variant', () => {
        const source = ts.createSourceFile(
            'ampscript.ts',
            readFileSync(new URL('../src/validators/ampscript.ts', import.meta.url), 'utf8'),
            ts.ScriptTarget.Latest,
            true,
        );
        const emissions = [];
        /**
         * Inspect diagnostic pushes without confusing spread argument diagnostics.
         * @param {import('typescript').Node} node - AST node.
         * @returns {void}
         */
        function visit(node) {
            if (
                ts.isCallExpression(node) &&
                node.expression.getText(source) === 'diagnostics.push' &&
                !ts.isSpreadElement(node.arguments[0])
            ) {
                const emission = node.arguments[0];
                assert.ok(ts.isCallExpression(emission));
                assert.equal(emission.expression.getText(source), 'createDiagnostic');
                emissions.push(emission);
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
        assert.equal(emissions.length, 27);
        assert.ok(
            emissions.some((emission) =>
                emission.arguments[0].getText(source).includes('DIAG_CODE_HTML_WRAPPED_COMMENT'),
            ),
        );
    });

    for (const targetPlatform of ['engagement', 'next']) {
        it(`suppresses AttributeValue only when enabled, preserving ${targetPlatform} behavior`, () => {
            const service = new SfmcLanguageService();
            const document = { text: '%%[ set @x = FirstName ]%%', languageId: 'ampscript' };
            for (const disableLspDiagnosticsForEslintRules of [false, true]) {
                const diagnostics = service.validate(document, {
                    ...DEFAULT_SETTINGS,
                    targetPlatform,
                    disableLspDiagnosticsForEslintRules,
                });
                assert.equal(
                    diagnostics.some((entry) => entry.code === 'sfmc/amp-prefer-attribute-value'),
                    !disableLspDiagnosticsForEslintRules,
                );
            }
        });
    }

    for (const [text, variant, payload, expectedEdits] of [
        [
            '%%[\n// comment\n]%%',
            'ampscript/js-line-comment',
            'comment',
            [
                {
                    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
                    newText: '/* comment */',
                },
            ],
        ],
        [
            '%%[ %%[ set @x = 1 ]%% ]%%',
            'ampscript/nested-delimiter',
            '%%[',
            [
                {
                    range: { start: { line: 0, character: 19 }, end: { line: 0, character: 22 } },
                    newText: '',
                },
                {
                    range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } },
                    newText: '',
                },
            ],
        ],
    ]) {
        it(`preserves primitive payload and exact quick fix through JSON transport: ${variant}`, () => {
            const diagnostic = validateAmpscript(text).find(
                (entry) => entry.data.sfmc.variant === variant,
            );
            const serialized = JSON.stringify(diagnostic);
            const transported = JSON.parse(serialized);
            assert.equal(transported.data.sfmc.payload, payload);
            const uri = 'file:///migration.amp';
            const actions = getAmpscriptCodeActions(text, uri, [transported]);
            const preferred = actions.find((action) => action.isPreferred);
            assert.deepEqual(preferred.edit.changes[uri], expectedEdits);
            const legacy = { ...transported, code: variant, data: payload };
            assert.deepEqual(
                getAmpscriptCodeActions(text, uri, [legacy]).map((action) => action.edit),
                actions.map((action) => action.edit),
            );
        });
    }
});
