/**
 * Tests for SfmcLanguageService — validates that the extracted package
 * behaves identically to what the VS Code extension server previously did.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SfmcLanguageService, sfmcLanguageService } from '../dist/esm/index.js';

const service = new SfmcLanguageService();

// ── Validation — AMPscript ─────────────────────────────────────────────────

describe('AMPscript validation', () => {
    it('returns empty diagnostics for valid code', () => {
        const doc = { text: '%%[ set @x = Add(1, 2) ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.deepEqual(diags, []);
    });

    it('reports unclosed %%[ block', () => {
        const doc = { text: '%%[ set @x = 1', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.length > 0, 'expected at least one diagnostic');
        assert.match(diags[0].message, /Unclosed AMPscript block/);
    });

    it('reports unmatched ]%% close', () => {
        const doc = { text: ']%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('Unexpected ]%%')));
    });

    it('reports unknown function', () => {
        const doc = { text: '%%[ MyCustomFunc() ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes("Unknown AMPscript function 'MyCustomFunc'")));
    });

    it('reports arity error (too few args)', () => {
        const doc = { text: '%%[ Add(1) ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes("requires at least")));
    });

    it('reports arity error (too many args) for fixed-arity function', () => {
        const doc = { text: '%%[ Add(1, 2, 3) ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes("accepts at most")));
    });

    it('reports IF without ENDIF', () => {
        const doc = { text: '%%[ if @x == 1 then /* no endif */ ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('IF without a matching ENDIF')));
    });

    it('reports ENDIF without IF', () => {
        const doc = { text: '%%[ endif ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('ENDIF without a matching IF')));
    });

    it('respects maxNumberOfProblems setting', () => {
        const manyErrors = Array.from({ length: 10 }, (_, i) => `%%[ Unknown${i}() ]%%`).join('\n');
        const doc = { text: manyErrors, languageId: 'ampscript' };
        const limited = service.validate(doc, { maxNumberOfProblems: 3 });
        assert.ok(limited.length <= 3);
    });

    it('reports // line comment inside AMPscript', () => {
        const doc = { text: '%%[ // this is wrong ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.code === 'ampscript/js-line-comment'));
    });
});

// ── Validation — SSJS ──────────────────────────────────────────────────────

describe('SSJS validation', () => {
    it('returns empty diagnostics for valid code', () => {
        const doc = { text: 'var x = Platform.Function.Now();', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.deepEqual(diags, []);
    });

    it('reports let/const usage', () => {
        const doc = { text: 'let x = 1;', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes("'let'/'const'")));
    });

    it('reports arrow function usage', () => {
        const doc = { text: 'var fn = (x) => { return x; };', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('Arrow functions')));
    });

    it('reports core object usage without Platform.Load', () => {
        const doc = { text: 'var de = DataExtension.Init("test");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('Platform.Load')));
    });

    it('does not report core object usage with Platform.Load', () => {
        const code = 'Platform.Load("core","1.1.5");\nvar de = DataExtension.Init("test");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(!diags.some((d) => d.message.includes('Platform.Load("core"')));
    });

    it('warns about wrong Platform.Load version', () => {
        const doc = { text: 'Platform.Load("core","1.0");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('"1.1.5"')));
    });
});

// ── Completions ────────────────────────────────────────────────────────────

describe('Completions', () => {
    it('returns AMPscript function completions inside %%[ block', () => {
        const doc = { text: '%%[ \n ]%%', languageId: 'ampscript' };
        const position = { line: 0, character: 4 };
        const items = service.getCompletions(doc, position);
        assert.ok(items.length > 0, 'expected completions');
        assert.ok(items.some((i) => i.label === 'Add'), 'expected Add function');
    });

    it('returns no AMPscript completions outside delimiters', () => {
        const doc = { text: 'plain HTML text', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 5 });
        assert.deepEqual(items, []);
    });

    it('returns SSJS completions for ssjs language', () => {
        const doc = { text: 'var x = ', languageId: 'ssjs' };
        const items = service.getCompletions(doc, { line: 0, character: 0 });
        assert.ok(items.length > 0);
        assert.ok(items.some((i) => i.label?.toString().startsWith('Platform')));
    });
});

// ── Hover ──────────────────────────────────────────────────────────────────

describe('Hover', () => {
    it('returns hover for known AMPscript function', () => {
        const doc = { text: '%%[ Add(1,2) ]%%', languageId: 'ampscript' };
        const line = '%%[ Add(1,2) ]%%';
        const hover = service.getHover(doc, line, { line: 0, character: 4 });
        assert.ok(hover !== null, 'expected hover result');
        assert.ok(hover.contents.value.includes('Add'));
    });

    it('returns null for unknown word', () => {
        const doc = { text: '%%[ foobar ]%%', languageId: 'ampscript' };
        const hover = service.getHover(doc, '%%[ foobar ]%%', { line: 0, character: 4 });
        assert.equal(hover, null);
    });

    it('returns hover for SSJS Platform.Function', () => {
        const doc = { text: 'Platform.Function.Now();', languageId: 'ssjs' };
        const line = 'Platform.Function.Now();';
        const hover = service.getHover(doc, line, { line: 0, character: 18 });
        assert.ok(hover !== null, 'expected hover for Now');
    });
});

// ── Catalog / Lookup ───────────────────────────────────────────────────────

describe('Catalog / Lookup', () => {
    it('lookupAmpscriptFunction returns function for known name', () => {
        const fn = service.lookupAmpscriptFunction('Add');
        assert.ok(fn !== null);
        assert.equal(fn.name, 'Add');
    });

    it('lookupAmpscriptFunction is case-insensitive', () => {
        const fn = service.lookupAmpscriptFunction('add');
        assert.ok(fn !== null);
    });

    it('lookupAmpscriptFunction returns null for unknown name', () => {
        assert.equal(service.lookupAmpscriptFunction('DoesNotExist'), null);
    });

    it('lookupSsjsFunction returns function for known name', () => {
        const fn = service.lookupSsjsFunction('Now');
        assert.ok(fn !== null);
    });

    it('getAllAmpscriptFunctions returns a non-empty array', () => {
        const fns = service.getAllAmpscriptFunctions();
        assert.ok(fns.length > 0);
    });

    it('getAllSsjsFunctions returns a non-empty array', () => {
        const fns = service.getAllSsjsFunctions();
        assert.ok(fns.length > 0);
    });

    it('getAmpscriptKeywords returns a non-empty array', () => {
        const kws = service.getAmpscriptKeywords();
        assert.ok(kws.length > 0);
    });

    it('getUnsupportedSsjsSyntax returns a non-empty array', () => {
        const unsupported = service.getUnsupportedSsjsSyntax();
        assert.ok(unsupported.length > 0);
    });

    it('sfmcLanguageService singleton is a SfmcLanguageService instance', () => {
        assert.ok(sfmcLanguageService instanceof SfmcLanguageService);
    });
});

// ── Code Actions ───────────────────────────────────────────────────────────

describe('Code Actions', () => {
    it('suggests converting // to /* */ for JS line comment diagnostic', () => {
        const doc = { text: '%%[ // wrong ]%%', languageId: 'ampscript', uri: 'file:///test.amp' };
        const diags = service.validate(doc);
        const jsComment = diags.find((d) => d.code === 'ampscript/js-line-comment');
        assert.ok(jsComment, 'expected js-line-comment diagnostic');
        const actions = service.getCodeActions(doc, [jsComment]);
        assert.ok(actions.length > 0, 'expected at least one code action');
        assert.ok(actions.some((a) => a.title.includes('block comment')));
    });

    it('returns empty code actions for SSJS', () => {
        const doc = { text: 'var x = 1;', languageId: 'ssjs', uri: 'file:///test.ssjs' };
        const actions = service.getCodeActions(doc, []);
        assert.deepEqual(actions, []);
    });
});

// ── Definitions ────────────────────────────────────────────────────────────

describe('Definitions', () => {
    it('returns location for local SSJS function', () => {
        const code = 'function greet(name) {\n  return "Hello " + name;\n}\ngreet("World");';
        const doc = { text: code, languageId: 'ssjs', uri: 'file:///test.ssjs' };
        const location = service.getDefinition(doc, 'greet');
        assert.ok(location !== null, 'expected definition location');
        assert.equal(location.range.start.line, 0);
    });

    it('returns null for AMPscript language', () => {
        const doc = { text: '%%[ set @x = 1 ]%%', languageId: 'ampscript', uri: 'file:///test.amp' };
        const location = service.getDefinition(doc, 'x');
        assert.equal(location, null);
    });

    it('returns null for unknown SSJS function', () => {
        const doc = { text: 'var x = 1;', languageId: 'ssjs', uri: 'file:///test.ssjs' };
        const location = service.getDefinition(doc, 'unknownFn');
        assert.equal(location, null);
    });
});
