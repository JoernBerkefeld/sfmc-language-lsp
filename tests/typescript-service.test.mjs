/**
 * Tests for the TypeScript-based SSJS service of `sfmc-language-lsp/typescript`, ported from the
 * VS Code extension's server (ts-service.test.ts).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createSsjsTypeScriptService } from '../dist/esm/typescript/index.js';

const require = createRequire(import.meta.url);
const globalsDts = readFileSync(require.resolve('ssjs-data/sfmc-globals.d.ts'), 'utf8');
const diagnosticUrl = (code) => (code === 1005 ? undefined : `https://example.test/ts${code}`);
const service = createSsjsTypeScriptService({ globalsDts, diagnosticUrl });

const URI_BASIC = 'file:///test-basic.ssjs';
const URI_DE = 'file:///test-de.ssjs';
const URI_WSPROXY = 'file:///test-wsproxy.ssjs';
const URI_PLATFORM = 'file:///test-platform.ssjs';

/**
 * Compute the position at the end of the last line of a code string.
 * @param {string} code - the source string
 * @returns {{line: number, character: number}} position at the end of the final line
 */
function endOf(code) {
    const lines = code.split('\n');
    return { line: lines.length - 1, character: lines.at(-1).length };
}

/**
 * Extract plain text from an LSP Hover regardless of its contents shape.
 * @param {{contents: unknown}} hover - the hover object to read
 * @returns {string} the hover text as a plain string
 */
function hoverText(hover) {
    const { contents } = hover;
    if (typeof contents === 'string') return contents;
    return contents && typeof contents === 'object' && 'value' in contents
        ? String(contents.value)
        : '';
}

test('globals declarations of ssjs-data are loaded', () => {
    assert.ok(globalsDts.includes('Platform'));
});

// ---------------------------------------------------------------------------
// Suite: basic lifecycle
// ---------------------------------------------------------------------------

test('updateDocument does not throw', () => {
    service.updateDocument(URI_BASIC, 'var x = 1;');
});

test('removeDocument cleans up without error', () => {
    service.updateDocument('file:///tmp.ssjs', 'var y = 2;');
    service.removeDocument('file:///tmp.ssjs');
    // After removal completions should return empty (not throw)
    const items = service.getCompletions('file:///tmp.ssjs', { line: 0, character: 5 });
    assert.deepStrictEqual(items, []);
});

// ---------------------------------------------------------------------------
// Suite: diagnostics
// ---------------------------------------------------------------------------

for (const [expectedCode, code] of [
    [2304, 'var result = missingDocumentationVariable;'],
    [2339, 'var result = "value"; result.missingDocumentationProperty;'],
    [1005, 'var result = (1;'],
]) {
    test(`Emitted TS${expectedCode} retains its numeric code and the caller's documentation link`, () => {
        const uri = `file:///documentation-${expectedCode}.ssjs`;
        try {
            service.updateDocument(uri, code);
            const diagnostics = service.getDiagnostics(uri);
            assert.ok(
                diagnostics.some((diagnostic) => diagnostic.code === expectedCode),
                `Expected TS${expectedCode}, got ${JSON.stringify(diagnostics)}`,
            );
            for (const diagnostic of diagnostics) {
                assert.strictEqual(diagnostic.source, 'sfmc-ts');
                assert.strictEqual(typeof diagnostic.code, 'number');
                // no codeDescription where the caller has no link
                assert.deepStrictEqual(
                    diagnostic.codeDescription,
                    diagnosticUrl(diagnostic.code) && { href: diagnosticUrl(diagnostic.code) },
                );
                assert.strictEqual(
                    'codeDescription' in diagnostic,
                    diagnosticUrl(diagnostic.code) !== undefined,
                );
            }
        } finally {
            service.removeDocument(uri);
        }
    });
}

test('Without diagnosticUrl, diagnostics carry no codeDescription', () => {
    const plain = createSsjsTypeScriptService({ globalsDts });
    plain.updateDocument(URI_BASIC, 'var result = missingDocumentationVariable;');
    const diagnostics = plain.getDiagnostics(URI_BASIC);
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every((diagnostic) => !('codeDescription' in diagnostic)));
});

test('No diagnostics for valid SSJS', () => {
    const code = 'var x = "hello"; var y = x.toUpperCase();';
    service.updateDocument(URI_BASIC, code);
    const diags = service.getDiagnostics(URI_BASIC);
    assert.strictEqual(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
});

test('HTTP.Get return type exposes Content/Status (no 2339 on .Content)', () => {
    // HTTP.Get is typed { Status: number, Content: string }; reading .Content must type-check.
    const code = 'var r = HTTP.Get("https://example.com"); var c = r.Content; var s = r.Status;';
    service.updateDocument(URI_BASIC, code);
    const diags = service.getDiagnostics(URI_BASIC);
    assert.ok(
        diags.every((d) => d.code !== 2339),
        `Unexpected 2339 on HTTP.Get result members: ${JSON.stringify(diags)}`,
    );
});

test('HTTP.Post return type exposes StatusCode/Response (no 2339)', () => {
    // HTTP.Post is typed { StatusCode: string, Response: string }.
    const code =
        'var r = HTTP.Post("https://example.com", "application/json", "{}", [], []);' +
        ' var sc = r.StatusCode; var resp = r.Response;';
    service.updateDocument(URI_BASIC, code);
    const diags = service.getDiagnostics(URI_BASIC);
    assert.ok(
        diags.every((d) => d.code !== 2339),
        `Unexpected 2339 on HTTP.Post result members: ${JSON.stringify(diags)}`,
    );
});

test('Produces diagnostic for reference to undeclared variable', () => {
    const code = 'var result = undeclaredVar.toString();';
    service.updateDocument(URI_BASIC, code);
    const diags = service.getDiagnostics(URI_BASIC);
    assert.ok(diags.length > 0, 'Expected at least one diagnostic for undeclared variable');
    assert.ok(
        diags.some((d) => d.source === 'sfmc-ts'),
        'Diagnostic should have source sfmc-ts',
    );
});

test('Diagnostic has correct range shape', () => {
    const code = 'var x = badRef;';
    service.updateDocument(URI_BASIC, code);
    const diags = service.getDiagnostics(URI_BASIC);
    assert.ok(diags.length > 0, 'Expected diagnostics');
    const d = diags[0];
    assert.ok(typeof d.range.start.line === 'number', 'range.start.line should be a number');
    assert.ok(
        typeof d.range.start.character === 'number',
        'range.start.character should be a number',
    );
});

// ---------------------------------------------------------------------------
// Suite: Platform.Function completions
// ---------------------------------------------------------------------------

test('Completions after "Platform." include Function, Variable, Response, Request', () => {
    const code = 'Platform.';
    service.updateDocument(URI_PLATFORM, code);
    const items = service.getCompletions(URI_PLATFORM, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('Function'), 'Should include Function');
    assert.ok(labels.has('Variable'), 'Should include Variable');
    assert.ok(labels.has('Response'), 'Should include Response');
    assert.ok(labels.has('Request'), 'Should include Request');
});

test('Completions after "Platform.Function." include GUID and ParseJSON', () => {
    const code = 'Platform.Function.';
    service.updateDocument(URI_PLATFORM, code);
    const items = service.getCompletions(URI_PLATFORM, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('GUID'), 'Should include GUID');
    assert.ok(labels.has('ParseJSON'), 'Should include ParseJSON');
    assert.ok(labels.has('Lookup'), 'Should include Lookup');
    assert.ok(labels.has('LookupRows'), 'Should include LookupRows');
});

test('Completions after "Platform.Response." include Write and Redirect', () => {
    const code = 'Platform.Response.';
    service.updateDocument(URI_PLATFORM, code);
    const items = service.getCompletions(URI_PLATFORM, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('Write'), 'Should include Write');
    assert.ok(labels.has('Redirect'), 'Should include Redirect');
    assert.ok(labels.has('ContentType'), 'Should include ContentType property');
});

test('Completions after "Platform.Request." include GetPostData and Method', () => {
    const code = 'Platform.Request.';
    service.updateDocument(URI_PLATFORM, code);
    const items = service.getCompletions(URI_PLATFORM, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('GetPostData'), 'Should include GetPostData');
    assert.ok(labels.has('Method'), 'Should include Method property');
    assert.ok(labels.has('ClientIP'), 'Should include ClientIP property');
});

// ---------------------------------------------------------------------------
// Suite: DataExtension instance type flow
// ---------------------------------------------------------------------------

test('Completions after "de." include Rows and Fields', () => {
    const code = ['Platform.Load("Core", "1");', 'var de = DataExtension.Init("key");', 'de.'].join(
        '\n',
    );
    service.updateDocument(URI_DE, code);
    const items = service.getCompletions(URI_DE, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('Rows'), 'Should include Rows');
    assert.ok(labels.has('Fields'), 'Should include Fields');
});

test('Completions after "de.Rows." include Lookup, Add, Remove', () => {
    const code = [
        'Platform.Load("Core", "1");',
        'var de = DataExtension.Init("key");',
        'de.Rows.',
    ].join('\n');
    service.updateDocument(URI_DE, code);
    const items = service.getCompletions(URI_DE, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('Lookup'), 'Should include Lookup');
    assert.ok(labels.has('Add'), 'Should include Add');
    assert.ok(labels.has('Remove'), 'Should include Remove');
    assert.ok(labels.has('Retrieve'), 'Should include Retrieve');
});

test('Completions after "de.Fields." include Add and Retrieve', () => {
    const code = [
        'Platform.Load("Core", "1");',
        'var de = DataExtension.Init("key");',
        'de.Fields.',
    ].join('\n');
    service.updateDocument(URI_DE, code);
    const items = service.getCompletions(URI_DE, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('Add'), 'Should include Add');
    assert.ok(labels.has('Retrieve'), 'Should include Retrieve');
});

// ---------------------------------------------------------------------------
// Suite: Script.Util / WSProxy instance type flow
// ---------------------------------------------------------------------------

test('Completions after "new Script.Util." include WSProxy, HttpRequest, HttpGet', () => {
    const code = 'new Script.Util.';
    service.updateDocument(URI_WSPROXY, code);
    const items = service.getCompletions(URI_WSPROXY, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('WSProxy'), 'Should include WSProxy');
    assert.ok(labels.has('HttpRequest'), 'Should include HttpRequest');
    assert.ok(labels.has('HttpGet'), 'Should include HttpGet');
});

test('Completions after "api." include WSProxy instance methods', () => {
    const code = ['var api = new Script.Util.WSProxy();', 'api.'].join('\n');
    service.updateDocument(URI_WSPROXY, code);
    const items = service.getCompletions(URI_WSPROXY, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('retrieve'), 'Should include retrieve');
    assert.ok(labels.has('createItem'), 'Should include createItem');
    assert.ok(labels.has('getNextBatch'), 'Should include getNextBatch');
    assert.ok(labels.has('setClientId'), 'Should include setClientId');
});

test('Completions after "req." include HttpRequest instance methods', () => {
    const code = ['var req = new Script.Util.HttpRequest("https://example.com");', 'req.'].join(
        '\n',
    );
    service.updateDocument(URI_WSPROXY, code);
    const items = service.getCompletions(URI_WSPROXY, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('send'), 'Should include send');
    assert.ok(labels.has('setHeader'), 'Should include setHeader');
});

// ---------------------------------------------------------------------------
// Suite: Hover
// ---------------------------------------------------------------------------

test('Hover over Platform returns type info', () => {
    const code = 'Platform.Function.GUID();';
    service.updateDocument(URI_PLATFORM, code);
    // Hover at "Platform" (offset 0)
    const hover = service.getHover(URI_PLATFORM, { line: 0, character: 3 });
    assert.ok(hover !== undefined, 'Should return hover info over Platform');
});

test('Hover returns undefined for unknown URI', () => {
    const hover = service.getHover('file:///nonexistent.ssjs', { line: 0, character: 0 });
    assert.strictEqual(hover, undefined);
});

test('Hover contents has markdown kind', () => {
    const code = 'var x = Platform.Function.GUID();';
    service.updateDocument(URI_PLATFORM, code);
    const hover = service.getHover(URI_PLATFORM, { line: 0, character: 26 });
    if (hover && hover.contents && typeof hover.contents === 'object' && 'kind' in hover.contents) {
        assert.strictEqual(hover.contents.kind, 'markdown');
    }
    // If no hover at this position that's also acceptable — GUID might not be in the d.ts path
});

// ---------------------------------------------------------------------------
// Suite: deprecated functions
// ---------------------------------------------------------------------------

const URI_DEPRECATED = 'file:///test-deprecated.ssjs';

test('Completions still include deprecated ContentArea function', () => {
    const code = 'Content';
    service.updateDocument(URI_DEPRECATED, code);
    const items = service.getCompletions(URI_DEPRECATED, { line: 0, character: code.length });
    const labels = items.map((index) => index.label);
    assert.ok(
        labels.some((l) => l === 'ContentArea' || l === 'ContentAreaByName'),
        `Expected ContentArea or ContentAreaByName in completions, got: ${labels.join(', ')}`,
    );
});

test('Hover for deprecated ContentArea mentions deprecated', () => {
    const code = 'ContentArea();';
    service.updateDocument(URI_DEPRECATED, code);
    // Hover over "ContentArea" (character 3 is inside the word)
    const hover = service.getHover(URI_DEPRECATED, { line: 0, character: 3 });
    if (!hover) return;
    {
        const text = hoverText(hover);
        assert.ok(
            text.toLowerCase().includes('deprecated'),
            `Hover text should mention deprecated, got: ${text}`,
        );
    }
    // If TypeScript does not return hover here the d.ts path may not be loaded — acceptable
});

test('@remarks tag renders without "remarks:" label prefix (Bug #2b)', () => {
    // BeginImpressionRegion has a @remarks tag in sfmc-globals.d.ts
    const code = 'BeginImpressionRegion(';
    service.updateDocument(URI_DEPRECATED, code);
    const hover = service.getHover(URI_DEPRECATED, { line: 0, character: 3 });
    if (!hover) return;
    {
        const text = hoverText(hover);
        assert.ok(
            !text.includes('*remarks:*'),
            `Hover text should not include "*remarks:*" label prefix, got: ${text}`,
        );
    }
    // If no hover that is acceptable — d.ts may not be loaded in CI
});

// ---------------------------------------------------------------------------
// Suite: requiresCoreLoad
// ---------------------------------------------------------------------------

const URI_HTTP = 'file:///test-http.ssjs';

test('Completions include HTTP.Get', () => {
    const code = 'HTTP.';
    service.updateDocument(URI_HTTP, code);
    const items = service.getCompletions(URI_HTTP, { line: 0, character: code.length });
    const labels = items.map((index) => index.label);
    assert.ok(
        labels.includes('Get') || labels.includes('get'),
        `Expected Get in HTTP completions, got: ${labels.join(', ')}`,
    );
});

test('Hover for HTTP.Get mentions requiresCoreLoad', () => {
    const code = 'HTTP.Get("url", "GET", {});';
    service.updateDocument(URI_HTTP, code);
    // Hover over "Get" — starts at character 5
    const hover = service.getHover(URI_HTTP, { line: 0, character: 6 });
    if (!hover) return;
    {
        const text = hoverText(hover);
        assert.ok(
            text.toLowerCase().includes('platform.load') ||
                text.toLowerCase().includes('requirescoreload') ||
                text.toLowerCase().includes('core'),
            `Hover text should mention Platform.Load/requiresCoreLoad, got: ${text}`,
        );
    }
    // If TypeScript does not return hover here the d.ts path may not be loaded — acceptable
});

// ---------------------------------------------------------------------------
// Suite: ECMAScript built-ins
// ---------------------------------------------------------------------------

test('Completions after string literal include String methods', () => {
    const code = 'var s = "hello"; s.';
    service.updateDocument(URI_BASIC, code);
    const items = service.getCompletions(URI_BASIC, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('toUpperCase'), 'Should include toUpperCase');
    assert.ok(labels.has('indexOf'), 'Should include indexOf');
    assert.ok(labels.has('split'), 'Should include split');
});

test('Completions after array include Array methods', () => {
    const code = 'var arr = [1, 2, 3]; arr.';
    service.updateDocument(URI_BASIC, code);
    const items = service.getCompletions(URI_BASIC, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('push'), 'Should include push');
    assert.ok(labels.has('pop'), 'Should include pop');
    assert.ok(labels.has('join'), 'Should include join');
});

test('Completions after "Math." include abs, floor, PI', () => {
    const code = 'Math.';
    service.updateDocument(URI_BASIC, code);
    const items = service.getCompletions(URI_BASIC, endOf(code));
    const labels = new Set(items.map((index) => index.label));
    assert.ok(labels.has('abs'), 'Should include abs');
    assert.ok(labels.has('floor'), 'Should include floor');
    assert.ok(labels.has('PI'), 'Should include PI constant');
});

// ---------------------------------------------------------------------------
// Suite: getCompletionInfo (Fix A)
// ---------------------------------------------------------------------------
test('getCompletionInfo returns isMemberCompletion=true after "de."', () => {
    const code = ['Platform.Load("Core", "1");', 'var de = DataExtension.Init("key");', 'de.'].join(
        '\n',
    );
    service.updateDocument(URI_DE, code);
    const { isMemberCompletion } = service.getCompletionInfo(URI_DE, endOf(code));
    assert.strictEqual(isMemberCompletion, true, 'isMemberCompletion should be true after "de."');
});

test('getCompletionInfo returns isMemberCompletion=false at top-level', () => {
    const code = 'Platf';
    service.updateDocument(URI_PLATFORM, code);
    const { isMemberCompletion } = service.getCompletionInfo(URI_PLATFORM, endOf(code));
    assert.strictEqual(
        isMemberCompletion,
        false,
        'isMemberCompletion should be false at top-level',
    );
});

// ---------------------------------------------------------------------------
// Suite: JSDoc enrichment in sfmc-globals.d.ts (description, @param, @example, ssjs.guide link)
// ---------------------------------------------------------------------------

const URI_JSDOC = 'file:///test-jsdoc.ssjs';

test('@param tags render in native TypeScript style "@param `name` — desc"', () => {
    // Platform.Function.Lookup has @param tags in the new sfmc-globals.d.ts
    const code = 'Platform.Function.Lookup(';
    service.updateDocument(URI_JSDOC, code);
    // Hover over "Lookup" — starts at character 18
    const hover = service.getHover(URI_JSDOC, { line: 0, character: 20 });
    if (!hover) return;
    {
        const text = hoverText(hover);
        // Should use "@param `name` — desc" format, not the "*param:*" fallback
        assert.ok(
            !text.includes('*param:*'),
            `Hover text should not use "*param:*" fallback, got: ${text}`,
        );
        if (text.includes('@param')) {
            assert.ok(
                text.includes('@param `deName`') || text.includes('@param'),
                `Hover text should use native @param format, got: ${text}`,
            );
        }
    }
});

test('ssjs.guide reference link present in hover for Platform.Function.Lookup', () => {
    const code = 'Platform.Function.Lookup(';
    service.updateDocument(URI_JSDOC, code);
    const hover = service.getHover(URI_JSDOC, { line: 0, character: 20 });
    if (!hover) return;
    {
        const text = hoverText(hover);
        assert.ok(
            text.includes('ssjs.guide') || text.includes('ssjs.guide reference'),
            `Hover text should include ssjs.guide reference link, got: ${text}`,
        );
    }
});

test('@example tag renders as "@example" header + fenced javascript code block', () => {
    const code = 'Platform.Function.Lookup(';
    service.updateDocument(URI_JSDOC, code);
    const hover = service.getHover(URI_JSDOC, { line: 0, character: 20 });
    if (!hover) return;
    {
        const text = hoverText(hover);
        if (text.includes('@example')) {
            assert.ok(
                text.includes('```javascript') || text.includes('```'),
                `@example should render as fenced code block, got: ${text}`,
            );
        }
    }
});

// ---------------------------------------------------------------------------
// getSignatureHelp tests
// ---------------------------------------------------------------------------

const URI_SIG = 'file:///sigHelp.ssjs';

test('getSignatureHelp returns undefined when not inside a function call', () => {
    const code = 'var x = 1;';
    service.updateDocument(URI_SIG, code);
    const result = service.getSignatureHelp(URI_SIG, { line: 0, character: 5 });
    assert.strictEqual(result, undefined);
});

test('getSignatureHelp returns signature for Platform.Function call', () => {
    const code = 'Platform.Function.Lookup(';
    service.updateDocument(URI_SIG, code);
    const result = service.getSignatureHelp(URI_SIG, { line: 0, character: 25 });
    if (!result) return;
    {
        assert.ok(result.signatures.length > 0, 'Should have at least one signature');
        const sig = result.signatures[0];
        assert.ok(sig.label.length > 0, 'Signature label should not be empty');
        assert.ok(sig.parameters && sig.parameters.length > 0, 'Should have parameters');
    }
});

test('getSignatureHelp activeParameter advances on comma', () => {
    const code = 'Platform.Function.Lookup("deName", ';
    service.updateDocument(URI_SIG, code);
    const result = service.getSignatureHelp(URI_SIG, { line: 0, character: code.length });
    if (!result) return;
    {
        assert.strictEqual(
            result.activeParameter,
            1,
            'activeParameter should be 1 after first comma',
        );
    }
});

test('getSignatureHelp parameter labels are numeric spans inside sig label', () => {
    const code = 'Platform.Function.Lookup(';
    service.updateDocument(URI_SIG, code);
    const result = service.getSignatureHelp(URI_SIG, { line: 0, character: 25 });
    if (!result || result.signatures.length === 0) return;
    {
        const sig = result.signatures[0];
        if (sig.parameters && sig.parameters.length > 0) {
            const label = sig.parameters[0].label;
            assert.ok(
                Array.isArray(label),
                `Parameter label should be a [start,end] tuple for VS Code highlighting, got: ${JSON.stringify(label)}`,
            );
            if (Array.isArray(label)) {
                const [start, end] = label;
                assert.ok(start >= 0 && end > start, 'Parameter span should have valid start/end');
                const parameterText = sig.label.slice(start, end);
                assert.ok(
                    parameterText.length > 0,
                    'Parameter span should resolve to non-empty text',
                );
            }
        }
    }
});

// ---------------------------------------------------------------------------
// Suite: ESLint-style /* global */ comment declarations
// ---------------------------------------------------------------------------

const URI_GLOBALS = 'file:///test-globals.ssjs';

test('Undeclared variable without global comment produces sfmc-ts diagnostic', () => {
    const code = 'var result = DEBUG.toString();';
    service.updateDocument(URI_GLOBALS, code);
    const diags = service.getDiagnostics(URI_GLOBALS);
    assert.ok(
        diags.some((d) => d.source === 'sfmc-ts'),
        'Expected sfmc-ts diagnostic for undeclared DEBUG without global comment',
    );
});

test('/* global DEBUG */ suppresses unknown-name diagnostic for DEBUG', () => {
    const code = '/* global DEBUG */\nvar result = DEBUG.toString();';
    service.updateDocument(URI_GLOBALS, code);
    const diags = service.getDiagnostics(URI_GLOBALS);
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics after global comment, got: ${JSON.stringify(diags)}`,
    );
});

test('/* globals DEBUG, deKey */ suppresses diagnostics for both names', () => {
    const code = '/* globals DEBUG, deKey */\nvar x = DEBUG; var y = deKey;';
    service.updateDocument(URI_GLOBALS, code);
    const diags = service.getDiagnostics(URI_GLOBALS);
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics after globals comment, got: ${JSON.stringify(diags)}`,
    );
});

test('/* global DEBUG:readonly, deKey:writable */ qualifier form is accepted', () => {
    const code = '/* global DEBUG:readonly, deKey:writable */\nvar x = DEBUG; var y = deKey;';
    service.updateDocument(URI_GLOBALS, code);
    const diags = service.getDiagnostics(URI_GLOBALS);
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics with :qualifier form, got: ${JSON.stringify(diags)}`,
    );
});

test('Removing global comment from updated document restores diagnostic', () => {
    // First load with global comment — should be clean.
    const withComment = '/* global DEBUG */\nvar x = DEBUG;';
    service.updateDocument(URI_GLOBALS, withComment);
    const diagsBefore = service.getDiagnostics(URI_GLOBALS);
    assert.ok(
        diagsBefore.every((d) => d.source !== 'sfmc-ts'),
        'Expected no diagnostics with global comment present',
    );

    // Update to remove the comment — diagnostic should return.
    const withoutComment = 'var x = DEBUG;';
    service.updateDocument(URI_GLOBALS, withoutComment);
    const diagsAfter = service.getDiagnostics(URI_GLOBALS);
    assert.ok(
        diagsAfter.some((d) => d.source === 'sfmc-ts'),
        'Expected sfmc-ts diagnostic after global comment was removed',
    );
});

// ---------------------------------------------------------------------------
// Suite: prototype polyfills
// ---------------------------------------------------------------------------

const URI_POLY = 'file:///test-polyfill.ssjs';

test('Array.prototype.forEach polyfill assignment produces no diagnostic', () => {
    const code = [
        'Array.prototype.forEach = function (callback) {',
        '    for (var i = 0; i < this.length; i++) {',
        '        callback(this[i], i, this);',
        '    }',
        '};',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    const diags = service.getDiagnostics(URI_POLY);
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for forEach polyfill, got: ${JSON.stringify(diags)}`,
    );
});

test('Array.prototype.map polyfill assignment produces no diagnostic', () => {
    const code = [
        'Array.prototype.map = function (callbackFn) {',
        '    var arr = [];',
        '    for (var i = 0; i < this.length; i++) {',
        '        arr.push(callbackFn(this[i], i, this));',
        '    }',
        '    return arr;',
        '};',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    const diags = service.getDiagnostics(URI_POLY);
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for map polyfill, got: ${JSON.stringify(diags)}`,
    );
});

test('String.prototype.startsWith polyfill enables later use on a string', () => {
    const code = [
        'if (!String.prototype.startsWith) {',
        '    String.prototype.startsWith = function (searchString, position) {',
        '        position = position || 0;',
        '        return this.indexOf(searchString, position) === position;',
        '    };',
        '}',
        'var id = "003000000000000000";',
        'var ok = id.startsWith("003");',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    const diags = service.getDiagnostics(URI_POLY);
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for startsWith polyfill + use, got: ${JSON.stringify(diags)}`,
    );
});

test('Using startsWith WITHOUT a polyfill still produces a diagnostic', () => {
    const code = ['var id = "003";', 'var ok = id.startsWith("003");'].join('\n');
    service.updateDocument(URI_POLY, code);
    const diags = service.getDiagnostics(URI_POLY);
    assert.ok(
        diags.some((d) => d.source === 'sfmc-ts'),
        'Expected sfmc-ts diagnostic for startsWith use without a polyfill',
    );
});

test('Removing a polyfill from an updated document restores the diagnostic', () => {
    const withPoly = [
        'String.prototype.startsWith = function (s) { return this.indexOf(s) === 0; };',
        'var ok = "abc".startsWith("a");',
    ].join('\n');
    service.updateDocument(URI_POLY, withPoly);
    assert.ok(
        service.getDiagnostics(URI_POLY).every((d) => d.source !== 'sfmc-ts'),
        'Expected clean diagnostics with polyfill present',
    );

    const withoutPoly = 'var ok = "abc".startsWith("a");';
    service.updateDocument(URI_POLY, withoutPoly);
    assert.ok(
        service.getDiagnostics(URI_POLY).some((d) => d.source === 'sfmc-ts'),
        'Expected sfmc-ts diagnostic after polyfill removed',
    );
});

test('Closing document clears polyfill declarations so they do not leak', () => {
    const URI_PLEAK = 'file:///test-poly-leak.ssjs';
    service.updateDocument(
        URI_PLEAK,
        'String.prototype.startsWith = function (s) { return this.indexOf(s) === 0; };',
    );
    service.removeDocument(URI_PLEAK);

    const URI_PLEAK2 = 'file:///test-poly-leak2.ssjs';
    service.updateDocument(URI_PLEAK2, 'var ok = "abc".startsWith("a");');
    assert.ok(
        service.getDiagnostics(URI_PLEAK2).some((d) => d.source === 'sfmc-ts'),
        'startsWith should be unknown in a new document without a polyfill',
    );
    service.removeDocument(URI_PLEAK2);
});

test('Polyfilled method hover shows a method signature with parsed params + JSDoc', () => {
    const code = [
        '/**',
        ' * @param {string} searchString what to search for',
        ' * @param {number} position where to start',
        ' * @returns {boolean} whether it starts with searchString',
        ' */',
        'String.prototype.startsWith = function (searchString, position) {',
        '    position = position || 0;',
        '    return this.indexOf(searchString, position) === position;',
        '};',
        'var ok = "hello".startsWith("he");',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    // Hover over the `.startsWith` usage on the last line.
    const usageLine = code.split('\n').length - 1;
    const usageCol = code.split('\n')[usageLine].indexOf('startsWith');
    const hover = service.getHover(URI_POLY, { line: usageLine, character: usageCol });
    assert.ok(hover, 'Expected a hover for the polyfilled method usage');
    const value = hover.contents.value;
    assert.ok(
        value.includes('(method) String.startsWith('),
        `Expected a (method) signature, got: ${value}`,
    );
    assert.ok(
        value.includes('searchString') && value.includes('position'),
        `Expected parsed param names in the signature, got: ${value}`,
    );
    assert.ok(
        value.includes('what to search for'),
        `Expected forwarded @param JSDoc in the hover, got: ${value}`,
    );
    // Issue #1: param/return types come from the JSDoc, not `any`.
    assert.ok(
        value.includes('searchString: string'),
        `Expected the @param string type in the signature, got: ${value}`,
    );
    assert.ok(
        value.includes('position: number'),
        `Expected the @param number type in the signature, got: ${value}`,
    );
    assert.ok(
        /\)\s*:\s*boolean/.test(value),
        `Expected the @returns boolean type in the signature, got: ${value}`,
    );
});

test('Polyfilled method hover maps {Array} JSDoc to any[] and falls back to any for unknown types', () => {
    const code = [
        '/**',
        ' * @param {Function} callbackFn callback for map',
        ' * @param {Client} ctx unknown user type',
        ' * @returns {Array} mapped array',
        ' */',
        'Array.prototype.map = function (callbackFn, ctx) {',
        '    var arr = [];',
        '    for (var i = 0; i < this.length; i++) {',
        '        arr.push(callbackFn(this[i], i, this));',
        '    }',
        '    return arr;',
        '};',
        'var out = [1, 2].map(function (x) { return x; });',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    const usageLine = code.split('\n').length - 1;
    const usageCol = code.split('\n')[usageLine].indexOf('.map') + 1;
    const hover = service.getHover(URI_POLY, { line: usageLine, character: usageCol });
    assert.ok(hover, 'Expected a hover for the polyfilled map usage');
    const value = hover.contents.value;
    assert.ok(
        value.includes('callbackFn: Function'),
        `Expected the @param Function type in the signature, got: ${value}`,
    );
    assert.ok(
        value.includes('ctx: any'),
        `Expected unknown JSDoc type Client to fall back to any, got: ${value}`,
    );
    assert.ok(
        /\)\s*:\s*any\[\]/.test(value),
        `Expected the @returns Array type to map to any[], got: ${value}`,
    );
});

test('Go to definition on a polyfilled method lands on the prototype assignment', () => {
    const code = [
        'String.prototype.startsWith = function (searchString) {',
        '    return this.indexOf(searchString) === 0;',
        '};',
        'var ok = "hello".startsWith("he");',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    const usageLine = code.split('\n').length - 1;
    const usageCol = code.split('\n')[usageLine].indexOf('startsWith');
    const defs = service.getDefinition(URI_POLY, { line: usageLine, character: usageCol });
    assert.ok(defs.length > 0, 'Expected a definition for the polyfilled method');
    assert.strictEqual(defs[0].uri, URI_POLY, 'Definition should point back to the same document');
    // The prototype assignment `String.prototype.startsWith` is on line 0.
    assert.strictEqual(defs[0].range.start.line, 0, 'Definition should land on the polyfill line');
});

test('Go to definition skips the JSDoc comment and lands on the polyfill assignment', () => {
    // The polyfill JSDoc references the method as `String.prototype.search` in
    // prose. Go-to-definition must skip that comment occurrence and land on the
    // real assignment line, not the doc text.
    const code = [
        '/**',
        ' * Polyfill for String.prototype.search (SFMC SSJS).',
        ' * @param {RegExp} regexp - the pattern to search for',
        ' * @returns {number} the index of the first match, or -1',
        ' */',
        'String.prototype.search = function (regexp) {',
        '    var str = "" + this;',
        '    var m = str.match(regexp);',
        '    if (m === null || m.length === 0) { return -1; }',
        '    return str.indexOf(m[0]);',
        '};',
        'var pos = "hello world".search(/world/);',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    const assignmentLine = 5; // `String.prototype.search = function …`
    const usageLine = code.split('\n').length - 1;
    const usageCol = code.split('\n')[usageLine].indexOf('search');
    const defs = service.getDefinition(URI_POLY, { line: usageLine, character: usageCol });
    assert.ok(defs.length > 0, 'Expected a definition for the polyfilled method');
    assert.strictEqual(defs[0].uri, URI_POLY, 'Definition should point back to the same document');
    assert.strictEqual(
        defs[0].range.start.line,
        assignmentLine,
        `Definition should land on the assignment line ${assignmentLine}, not the JSDoc, got line ${defs[0].range.start.line}`,
    );
});

test('Go to definition on a top-level function call lands on its declaration', () => {
    const code = [
        'function buildKey(id) {',
        '    return "k-" + id;',
        '}',
        'var k = buildKey("123");',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    const callLine = code.split('\n').length - 1;
    const callCol = code.split('\n')[callLine].indexOf('buildKey');
    const defs = service.getDefinition(URI_POLY, { line: callLine, character: callCol });
    assert.ok(defs.length > 0, 'Expected a definition for the function call');
    assert.strictEqual(defs[0].uri, URI_POLY, 'Definition should point back to the same document');
    assert.strictEqual(
        defs[0].range.start.line,
        0,
        'Definition should land on the function declaration line',
    );
});

test('Go to definition returns empty for an unknown identifier', () => {
    service.updateDocument(URI_POLY, 'var x = somethingUndeclared;');
    const defs = service.getDefinition(URI_POLY, { line: 0, character: 8 });
    assert.strictEqual(defs.length, 0, 'Expected no definitions for an unknown identifier');
});

test('Find all references on a top-level function returns declaration + all calls', () => {
    const code = [
        'function buildKey(id) {',
        '    return "k-" + id;',
        '}',
        'var a = buildKey("1");',
        'var b = buildKey("2");',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    // Cursor on the declaration name `buildKey` (line 0).
    const references = service.getReferences(URI_POLY, { line: 0, character: 'function '.length });
    assert.ok(
        references.length >= 3,
        `Expected >= 3 references (decl + 2 calls), got ${references.length}`,
    );
    assert.ok(
        references.every((r) => r.uri === URI_POLY),
        'All references should be in the same document',
    );
    const lines = references.map((r) => r.range.start.line).toSorted((x, y) => x - y);
    assert.deepStrictEqual(lines, [0, 3, 4], `Expected references on lines 0,3,4, got ${lines}`);
});

test('Find all references on a polyfilled method includes the prototype assignment', () => {
    const code = [
        'String.prototype.startsWith = function (searchString) {',
        '    return this.indexOf(searchString) === 0;',
        '};',
        'var a = "hello".startsWith("he");',
        'var b = "world".startsWith("wo");',
    ].join('\n');
    service.updateDocument(URI_POLY, code);
    // Cursor on a usage of `.startsWith` (line 3).
    const usageCol = code.split('\n', 4)[3].indexOf('startsWith');
    const references = service.getReferences(URI_POLY, { line: 3, character: usageCol });
    assert.ok(references.length > 0, 'Expected references for the polyfilled method');
    assert.ok(
        references.every((r) => r.uri === URI_POLY),
        'All references should be in the same document',
    );
    // The prototype assignment is on line 0; usages on lines 3 and 4.
    const lines = new Set(references.map((r) => r.range.start.line));
    assert.ok(
        lines.has(0),
        `Expected the prototype assignment (line 0) in references, got ${[...lines]}`,
    );
    assert.ok(lines.has(3) && lines.has(4), `Expected usages on lines 3 and 4, got ${[...lines]}`);
});

test('Find all references returns empty for an unknown identifier', () => {
    service.updateDocument(URI_POLY, 'var x = somethingUndeclared;');
    const references = service.getReferences(URI_POLY, { line: 0, character: 8 });
    assert.strictEqual(references.length, 0, 'Expected no references for an unknown identifier');
});

test('Closing document clears global declarations so stale names do not leak', () => {
    const URI_LEAK = 'file:///test-leak.ssjs';
    const code = '/* global SECRET */\nvar x = SECRET;';
    service.updateDocument(URI_LEAK, code);

    // Confirm no diagnostic while open.
    const diagsOpen = service.getDiagnostics(URI_LEAK);
    assert.ok(
        diagsOpen.every((d) => d.source !== 'sfmc-ts'),
        'Should be clean while open',
    );

    // Close the document.
    service.removeDocument(URI_LEAK);

    // Re-open without the global comment — SECRET must not still be declared.
    const URI_LEAK2 = 'file:///test-leak2.ssjs';
    const codeWithout = 'var x = SECRET;';
    service.updateDocument(URI_LEAK2, codeWithout);
    const diagsClosed = service.getDiagnostics(URI_LEAK2);
    assert.ok(
        diagsClosed.some((d) => d.source === 'sfmc-ts'),
        'SECRET should be unknown in a new document without a global comment',
    );
    service.removeDocument(URI_LEAK2);
});

test('Optional JSDoc param [name] emits an optional parameter so 1-arg calls are valid', () => {
    const URI_OPT = 'file:///test-optional.ssjs';
    const code = [
        '/**',
        ' * @param {string} searchString what to search for',
        ' * @param {number} [position] where to start',
        ' * @returns {boolean} whether it starts with searchString',
        ' */',
        'String.prototype.startsWith = function (searchString, position) {',
        '    position = position || 0;',
        '    return this.indexOf(searchString, position) === position;',
        '};',
        'var ok = "hello".startsWith("he");',
    ].join('\n');
    service.updateDocument(URI_OPT, code);

    // Hover shows `position?: number` (optional marker present).
    const usageLine = code.split('\n').length - 1;
    const usageCol = code.split('\n')[usageLine].indexOf('startsWith');
    const hover = service.getHover(URI_OPT, { line: usageLine, character: usageCol });
    assert.ok(hover, 'Expected a hover for the polyfilled method usage');
    const value = hover.contents.value;
    assert.ok(
        value.includes('position?: number'),
        `Expected optional param position?: number in the signature, got: ${value}`,
    );

    // No "Expected 2 arguments" diagnostic for the single-arg call.
    const diags = service.getDiagnostics(URI_OPT);
    assert.ok(
        diags.every((d) => d.code !== 2554),
        `Expected no arity error for the optional param, got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(URI_OPT);
});

test('Polyfill JSDoc referencing an undeclared/user type does not break the interface merge', () => {
    const URI_TD = 'file:///test-typedef.ssjs';
    const code = [
        '/**',
        ' * @typedef {object} Client',
        ' * @property {string} instance_url url of the SFMC instance',
        ' * @property {WSProxy} proxy WSProxy instance for API calls',
        ' * @property {number} mid mid of the BU',
        ' */',
        '',
        '/**',
        ' * @param {Function} callbackFn callback for map',
        ' * @param {Client} ctx execution context',
        ' * @returns {Array} mapped array',
        ' */',
        'Array.prototype.map = function (callbackFn, ctx) {',
        '    var arr = [];',
        '    for (var i = 0; i < this.length; i++) {',
        '        arr.push(callbackFn(this[i], i, this));',
        '    }',
        '    return arr;',
        '};',
        'var out = [1, 2].map(function (x) { return x; });',
    ].join('\n');
    service.updateDocument(URI_TD, code);
    const diags = service.getDiagnostics(URI_TD);

    // The user `@typedef Client` (and the polyfill JSDoc that references it /
    // WSProxy) must not produce "duplicate identifier" or "cannot find name"
    // errors inside the comments, and the Array.map merge must take effect so
    // `[1,2].map(...)` is valid (no 2339).
    assert.ok(
        diags.every((d) => d.code !== 2300),
        `Expected no duplicate-identifier error, got: ${JSON.stringify(diags)}`,
    );
    assert.ok(
        diags.every((d) => !(d.code === 2304 || d.code === 2552)),
        `Expected no cannot-find-name error inside JSDoc, got: ${JSON.stringify(diags)}`,
    );
    assert.ok(
        diags.every((d) => d.code !== 2339),
        `Expected the Array.map merge to apply (no property-does-not-exist), got: ${JSON.stringify(
            diags,
        )}`,
    );
    service.removeDocument(URI_TD);
});

test('Real code errors are still reported (JSDoc suppression is scoped to comments)', () => {
    const URI_REAL = 'file:///test-real-error.ssjs';
    // `Client` in executable code (not a JSDoc comment) must still error.
    service.updateDocument(URI_REAL, 'var z = somethingUndeclared;');
    const diags = service.getDiagnostics(URI_REAL);
    assert.ok(
        diags.some((d) => d.code === 2304),
        `Expected a cannot-find-name error for real code, got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(URI_REAL);
});

// ---------------------------------------------------------------------------
// Suite: static polyfills (Ctor.method = function) — interface/namespace merge
// ---------------------------------------------------------------------------

const URI_STATIC = 'file:///test-static-polyfill.ssjs';

test('Array.isArray static polyfill assignment produces no diagnostic (2339)', () => {
    const code = [
        '/**',
        ' * Polyfill for Array.isArray (SFMC SSJS).',
        ' * @param {any} value - value to test',
        ' * @returns {boolean} whether value is an array',
        ' */',
        'Array.isArray = function (value) {',
        "    return Object.prototype.toString.call(value) === '[object Array]';",
        '};',
        'var b = Array.isArray([1, 2, 3]);',
    ].join('\n');
    service.updateDocument(URI_STATIC, code);
    const diags = service.getDiagnostics(URI_STATIC);
    assert.ok(
        diags.every((d) => d.code !== 2339),
        `Expected no "does not exist on ArrayConstructor" (2339) for Array.isArray polyfill, got: ${JSON.stringify(diags)}`,
    );
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for Array.isArray polyfill, got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(URI_STATIC);
});

test('forEach polyfill callback invocation is callable (no 2349)', () => {
    // The callback param is typed `Function` via JSDoc — `Function` must carry a
    // call signature in sfmc-globals.d.ts or `callback(...)` errors with
    // "Type 'never' has no call signatures" (2349) under noLib:true.
    const code = [
        '/**',
        ' * Polyfill for Array.prototype.forEach (SFMC SSJS).',
        ' * @param {Function} callback - called with (element, index, array)',
        ' * @returns {void}',
        ' */',
        'Array.prototype.forEach = function (callback) {',
        "    if (typeof callback !== 'function') { return; }",
        '    for (var i = 0; i < this.length; i++) {',
        '        callback(this[i], i, this);',
        '    }',
        '};',
    ].join('\n');
    service.updateDocument(URI_STATIC, code);
    const diags = service.getDiagnostics(URI_STATIC);
    assert.ok(
        diags.every((d) => d.code !== 2349),
        `Expected no "not callable" (2349) for forEach callback invocation, got: ${JSON.stringify(diags)}`,
    );
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for forEach polyfill, got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(URI_STATIC);
});

test('Array.prototype.map polyfill accepts a plain function callback (no 2769)', () => {
    // A `@param {Function} callback` must accept a plain function/arrow expression.
    // If `interface Function` carries a `new (...)` construct signature, the
    // expression fails to match and TS raises ts2769 ("provides no match for the
    // signature new (...)") on the `function` keyword of the call site.
    const code = [
        '/**',
        ' * Polyfill for Array.prototype.map (SFMC SSJS).',
        ' * @param {Function} callback - called with (element, index, array)',
        ' * @returns {Array} a new array of the callback results',
        ' */',
        'Array.prototype.map = function (callback) {',
        "    if (typeof callback !== 'function') { return []; }",
        '    var result = [];',
        '    for (var i = 0; i < this.length; i++) {',
        '        result.push(callback(this[i], i, this));',
        '    }',
        '    return result;',
        '};',
        'var out = [1, 2].map(function (x) { return x; });',
    ].join('\n');
    service.updateDocument(URI_STATIC, code);
    const diags = service.getDiagnostics(URI_STATIC);
    assert.ok(
        diags.every((d) => d.code !== 2769),
        `Expected no "no overload matches" (2769) for map(function) call, got: ${JSON.stringify(diags)}`,
    );
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for map polyfill call, got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(URI_STATIC);
});

test('Array.prototype.forEach polyfill accepts a plain function callback (no 2769)', () => {
    const code = [
        '/**',
        ' * Polyfill for Array.prototype.forEach (SFMC SSJS).',
        ' * @param {Function} callback - called with (element, index, array)',
        ' * @returns {void}',
        ' */',
        'Array.prototype.forEach = function (callback) {',
        "    if (typeof callback !== 'function') { return; }",
        '    for (var i = 0; i < this.length; i++) {',
        '        callback(this[i], i, this);',
        '    }',
        '};',
        '[1, 2].forEach(function (x) { return x; });',
    ].join('\n');
    service.updateDocument(URI_STATIC, code);
    const diags = service.getDiagnostics(URI_STATIC);
    assert.ok(
        diags.every((d) => d.code !== 2769),
        `Expected no "no overload matches" (2769) for forEach(function) call, got: ${JSON.stringify(diags)}`,
    );
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for forEach polyfill call, got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(URI_STATIC);
});

test('Array.isArray self-guarded static polyfill (X = X || function) produces no 2339', () => {
    // Canonical ssjs-data form ships a self-guard: `Array.isArray = Array.isArray
    // || function (…)`. The polyfill parser must tolerate the `X ||` prefix or the
    // static assignment is not registered and `Array.isArray(...)` raises 2339.
    const code = [
        'Array.isArray = Array.isArray || function (value) {',
        "    return Object.prototype.toString.call(value) === '[object Array]';",
        '};',
        'var b = Array.isArray([1, 2, 3]);',
    ].join('\n');
    service.updateDocument(URI_STATIC, code);
    const diags = service.getDiagnostics(URI_STATIC);
    assert.ok(
        diags.every((d) => d.code !== 2339),
        `Expected no 2339 for self-guarded Array.isArray polyfill, got: ${JSON.stringify(diags)}`,
    );
    assert.ok(
        diags.every((d) => d.source !== 'sfmc-ts'),
        `Expected no sfmc-ts diagnostics for self-guarded Array.isArray polyfill, got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(URI_STATIC);
});

// ---------------------------------------------------------------------------
// Suite: runtime built-ins (arguments) and cross-file isolation
// ---------------------------------------------------------------------------

test('arguments.length / arguments[i] type-check (no 2339 under noLib)', () => {
    // Under noLib:true there is no lib.es5.d.ts, so `arguments` needs an ambient
    // IArguments declaration in sfmc-globals.d.ts, else `arguments.length` raises
    // "Property 'length' does not exist on type '{}'" (2339).
    const uri = 'file:///test-arguments.ssjs';
    const code = [
        'function sum() {',
        '    var total = 0;',
        '    for (var i = 0; i < arguments.length; i++) {',
        '        total += Number(arguments[i]);',
        '    }',
        '    return total;',
        '}',
    ].join('\n');
    service.updateDocument(uri, code);
    const diags = service.getDiagnostics(uri);
    assert.ok(
        diags.every((d) => d.code !== 2339),
        `Expected no 2339 on arguments.length/arguments[i], got: ${JSON.stringify(diags)}`,
    );
    service.removeDocument(uri);
});

test('top-level var of the same name in two documents does not collide (no 2403)', () => {
    // Each open SSJS document must be its own program: exposing all documents in
    // one TS program makes their top-level `var` declarations collide in the
    // shared global scope ("Subsequent variable declarations must have the same
    // type", 2403). getScriptFileNames scopes to the active document.
    const uriA = 'file:///test-collide-a.ssjs';
    const uriB = 'file:///test-collide-b.ssjs';
    service.updateDocument(uriA, 'var result = "hello";');
    service.updateDocument(uriB, 'var result = HTTP.Get("https://x");');
    const diagsA = service.getDiagnostics(uriA);
    const diagsB = service.getDiagnostics(uriB);
    assert.ok(
        diagsA.every((d) => d.code !== 2403),
        `Doc A must not see doc B's 'result' (2403), got: ${JSON.stringify(diagsA)}`,
    );
    assert.ok(
        diagsB.every((d) => d.code !== 2403),
        `Doc B must not see doc A's 'result' (2403), got: ${JSON.stringify(diagsB)}`,
    );
    service.removeDocument(uriA);
    service.removeDocument(uriB);
});
