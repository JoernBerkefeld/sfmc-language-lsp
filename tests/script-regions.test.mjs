import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    getScriptRegions,
    extractScriptBodies,
    validateMixedDocumentSsjs,
    validateSsjs,
    DEFAULT_SETTINGS,
} from '../dist/esm/index.js';

describe('shared script classification', () => {
    it('classifies browser, server, AMPscript and data scripts in document order', () => {
        const cases = [
            ['', 'browser-classic'],
            ['TYPE=""', 'browser-classic'],
            ['type=module', 'browser-module'],
            ['type=" MODULE "', 'browser-module'],
            ['language=JavaScript', 'browser-classic'],
            ['type="text/javascript"', 'browser-classic'],
            ['type="application/x-ecmascript"', 'browser-classic'],
            ['type="text/javascript1.5"', 'browser-classic'],
            ['RUNAT = server language = JavaScript', 'ssjs'],
            ["language='JavaScript' runat='SERVER' type='application/javascript'", 'ssjs'],
            ['language=AMPscript runat=server', 'ampscript'],
            ['runat=server type=module', 'non-js'],
            ['type=application/json', 'non-js'],
            ['type=application/ld+json', 'non-js'],
            ['type=importmap', 'non-js'],
            ['type=speculationrules', 'non-js'],
            ['type=text/vbscript runat=server', 'non-js'],
            ['language=vbscript', 'non-js'],
            ['language=vbscript type=""', 'browser-classic'],
            ['language=javascript type=application/json', 'non-js'],
            ['type="text/javascript; charset=utf-8"', 'non-js'],
        ];
        const text = cases
            .map(([attributes]) => `<ScRiPt ${attributes}>body</sCrIpT \n>`)
            .join('\n');
        const regions = getScriptRegions(text);
        assert.deepEqual(
            regions.map(({ kind }) => kind),
            cases.map(([, kind]) => kind),
        );
        for (const region of regions) {
            assert.equal(text.slice(region.bodyStart, region.bodyEnd), 'body');
            assert.match(text.slice(region.tagStart, region.tagEnd), /^<ScRiPt/);
            assert.equal(region.tagEnd, region.bodyStart);
            assert.equal(region.closeTagStart, region.bodyEnd);
            assert.equal(text.slice(region.closeTagStart, region.closeTagEnd), '</sCrIpT \n>');
        }
    });

    it('parses actual attribute names, quotes, order and first duplicate values', () => {
        const text = `<script data-note="runat='server' > <script>" data-runat=server TYPE='module' type='application/json' src=/file.js>hello</script>`;
        const [region] = getScriptRegions(text);
        assert.equal(region.kind, 'browser-module');
        assert.equal(region.attributes.type, 'module');
        assert.equal(region.attributes['data-runat'], 'server');
        assert.equal(region.attributes.src, '/file.js');
        assert.equal(region.attributes['data-note'], "runat='server' > <script>");
        assert.equal(text.slice(region.bodyStart, region.bodyEnd), 'hello');
    });

    it('ignores HTML comments, quoted HTML attributes and other raw-text bodies', () => {
        const fake = '<script runat=server>fake</script>';
        const text = `<!-- ${fake} --><div title='${fake}'>ok</div><style>${fake}</style><textarea>${fake}</textarea><title>${fake}</title><script>real</script><!-- ${fake}`;
        const regions = getScriptRegions(text);
        assert.equal(regions.length, 1);
        assert.equal(text.slice(regions[0].bodyStart, regions[0].bodyEnd), 'real');
        assert.deepEqual(getScriptRegions(`<plaintext>${fake}`), []);
    });

    it('does not discover nested opening tags in JavaScript or data bodies', () => {
        const text =
            '<script>const tag = "<script runat=server>"; /* <script type=module> */</script><script type=application/json>{"tag":"<script>"}</script>';
        assert.deepEqual(
            getScriptRegions(text).map(({ kind }) => kind),
            ['browser-classic', 'non-js'],
        );
    });

    it('uses HTML closing boundaries, not JavaScript string or comment boundaries', () => {
        const text = '<script>"</scripture>"; "</script>"<script runat=server>server</script>';
        const regions = getScriptRegions(text);
        assert.equal(regions.length, 2);
        assert.equal(text.slice(regions[0].bodyStart, regions[0].bodyEnd), '"</scripture>"; "');
        assert.equal(regions[1].kind, 'ssjs');
    });

    it('handles empty and unfinished bodies without inventing opening tags', () => {
        const text = '<script></script><script runat=server>var unfinished = "<script>";';
        const regions = getScriptRegions(text);
        assert.equal(regions[0].bodyStart, regions[0].bodyEnd);
        assert.equal(regions[1].bodyEnd, text.length);
        assert.equal(regions[1].closeTagStart, null);
        assert.equal(regions[1].closeTagEnd, null);
        assert.deepEqual(getScriptRegions('<script runat="server'), []);
        assert.deepEqual(getScriptRegions('<scripture>not a script</scripture>'), []);
    });
});

it('preserves starred JSDoc during ESLint autofix', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ fix: true });
    const source = '/**\n * A documented value.\n */\nexport const documentedValue = 1;\n';
    const config = await eslint.calculateConfigForFile('src/utils/regions.ts');
    assert.equal(config.rules['unicorn/no-asterisk-prefix-in-documentation-comments'][0], 0);
    const [result] = await eslint.lintText(source, { filePath: 'src/utils/regions.ts' });
    assert.equal(result.output ?? source, source);
});

const variants = (diagnostics) => diagnostics.map((item) => item.data.sfmc.variant);

describe('mixed-document SSJS validation', () => {
    it('ignores browser, AMPscript, data and commented scripts, including in MCN', () => {
        const text = `<!-- <script runat=server>let fake;</script> -->
<script>const modern = () => document.body;</script>
<script type=module>await fetch('/data');</script>
<script language=ampscript>SET @x = 1</script>
<script runat=server type=application/json>{"let":true}</script>`;
        assert.deepEqual(validateMixedDocumentSsjs(text), []);
        assert.deepEqual(
            validateMixedDocumentSsjs(text, { ...DEFAULT_SETTINGS, targetPlatform: 'next' }),
            [],
        );
        assert.deepEqual(validateMixedDocumentSsjs('let raw = 1;'), []);
        assert.ok(variants(validateSsjs('let raw = 1;')).includes('ssjs/unsupported-syntax'));
    });

    it('keeps server diagnostics at original UTF-16 positions and preserves raw checks', () => {
        const body = 'let invalid = 1;';
        const text = `😀<script>const valid = 1;</script>\r\n<div>😀</div><script RUNAT=server>${body}</script>`;
        const diagnostics = validateMixedDocumentSsjs(text);
        assert.deepEqual(variants(diagnostics), variants(validateSsjs(body)));
        const diagnostic = diagnostics.find(
            (item) => item.data.sfmc.variant === 'ssjs/unsupported-syntax',
        );
        const line = text.split('\n', 2)[1];
        assert.equal(diagnostic.range.start.line, 1);
        assert.equal(diagnostic.range.start.character, line.indexOf('let invalid'));
    });

    it('does not let browser loads or polyfills suppress server warnings', () => {
        const text = `<script>Platform.Load("core", "1.1.5"); Array.isArray = function(value) { return true; };</script>
<script runat=server>DataExtension.Init("key"); Array.isArray(value);</script>`;
        const diagnostics = variants(validateMixedDocumentSsjs(text));
        assert.ok(diagnostics.includes('ssjs/require-platform-load'));
        assert.ok(diagnostics.includes('ssjs/polyfill-required'));
    });

    it('preserves cross-block warnings despite masked tags and browser declarations', () => {
        const text = `<script>function later() {}</script><script RUNAT=server>later();</script>
<script type=module>function later() {}</script><script runat='server'>var label = "😀"; function later() { return 1; }</script>`;
        const diagnostics = validateMixedDocumentSsjs(text).filter(
            (item) => item.data.sfmc.variant === 'ssjs/cross-block-forward-reference',
        );
        assert.equal(diagnostics.length, 1);
        assert.deepEqual(diagnostics[0].range.start, {
            line: 0,
            character: text.indexOf('later();'),
        });
        assert.deepEqual(
            validateMixedDocumentSsjs(
                '<script runat=server>function earlier() {}</script><script runat=server>earlier();</script>',
            ),
            [],
        );
    });

    it('does not treat browser-only declarations as server constructors or later functions', () => {
        const text = `<script runat=server>browserOnly(); new BrowserFactory();</script>
<script>function browserOnly() {} function BrowserFactory() { return {}; }</script>`;
        assert.deepEqual(validateMixedDocumentSsjs(text), []);
    });

    it('retains server load ordering, unfinished bodies and the diagnostic budget', () => {
        assert.deepEqual(
            validateMixedDocumentSsjs(
                '<script runat=server>Platform.Load("core", "1.1.5");</script><script runat=server>DataExtension.Init("key");</script>',
            ),
            [],
        );
        const text = '<script runat=server>let first = 1; const second = 2;';
        assert.equal(
            validateMixedDocumentSsjs(text, { ...DEFAULT_SETTINGS, maxNumberOfProblems: 1 }).length,
            1,
        );
        assert.ok(
            variants(
                validateMixedDocumentSsjs(text, {
                    ...DEFAULT_SETTINGS,
                    targetPlatform: 'next',
                }),
            ).includes('ssjs/mcn-not-supported'),
        );
    });

    it('exports the mixed validator from CommonJS as well as ESM', () => {
        const require = createRequire(import.meta.url);
        const cjs = require('../dist/cjs/index.cjs');
        const text = '<script runat=server>let value = 1;</script>';
        assert.deepEqual(cjs.validateMixedDocumentSsjs(text), validateMixedDocumentSsjs(text));
    });
});

describe('offset-preserving script extraction', () => {
    it('retains selected bodies and metadata without browser/server contamination', () => {
        const text =
            '😀\r\n<div>outside</div><script>Platform.Load("core");</script>\n<script RUNAT=server>first();\r\n"😀";</script>\r<script type=module>const modern = () => 1;</script><script runat=server>function first() {}</script>';
        const result = extractScriptBodies(text, ['ssjs']);
        assert.equal(result.text.length, text.length);
        assert.equal(result.regions.length, 2);
        assert.equal(result.regions[0].attributes.runat, 'server');
        assert.ok(!result.text.includes('Platform.Load'));
        assert.ok(!result.text.includes('modern'));
        for (let index = 0; index < text.length; index++) {
            const retained = result.regions.some(
                ({ bodyStart, bodyEnd }) => index >= bodyStart && index < bodyEnd,
            );
            assert.equal(
                result.text[index],
                retained || /[\r\n]/.test(text[index]) ? text[index] : ' ',
            );
        }
        assert.equal(result.regions[0].bodyStart, text.indexOf('first();'));
        assert.equal(result.regions[1].bodyStart, text.indexOf('function first'));
        const browser = extractScriptBodies(text, ['browser-classic', 'browser-module']);
        assert.equal(browser.regions.length, 2);
        assert.ok(browser.text.includes('Platform.Load'));
        assert.ok(!browser.text.includes('function first'));
    });

    it('preserves all newlines with no scripts or no selected kinds', () => {
        assert.deepEqual(extractScriptBodies('😀\r\ntext\n', ['ssjs']), {
            text: '  \r\n    \n',
            regions: [],
        });
        assert.deepEqual(extractScriptBodies('<script>x</script>\n', []), {
            text: `${' '.repeat(18)}\n`,
            regions: [],
        });
    });

    it('retains incomplete code and template content verbatim', () => {
        const text = '<script type=module>const value = "%%=v(@x)=%% {{binding}} 😀";\n';
        const result = extractScriptBodies(text, ['browser-module']);
        assert.equal(
            result.text.slice(result.regions[0].bodyStart),
            text.slice(text.indexOf('>') + 1),
        );
    });

    it('exports the same helpers from the CommonJS build', () => {
        const require = createRequire(import.meta.url);
        const cjs = require('../dist/cjs/index.cjs');
        const text = '<script runat=server>x</script>';
        assert.deepEqual(cjs.getScriptRegions(text), getScriptRegions(text));
        assert.deepEqual(
            cjs.extractScriptBodies(text, ['ssjs']),
            extractScriptBodies(text, ['ssjs']),
        );
    });
});
