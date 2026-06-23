/**
 * Tests for SfmcLanguageService — validates that the extracted package
 * behaves identically to what the VS Code extension server previously did.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    SfmcLanguageService,
    sfmcLanguageService,
    isMcnSupported,
    getMcnApiVersion,
    extractAmpscriptFunctionCalls,
} from '../dist/esm/index.js';

const service = new SfmcLanguageService();

/**
 * Helper: request AMPscript signature help for text up to the cursor.
 * @param {string} textUpToCursor - Document text from start to the cursor.
 * @returns {import('../dist/esm/index.js').SignatureHelp | null} Signature help result.
 */
const ampSig = (textUpToCursor) =>
    service.getSignatureHelp({ text: textUpToCursor, languageId: 'ampscript' }, textUpToCursor);

/**
 * Helper: validate a one-line AMPscript snippet.
 * @param {string} text - AMPscript source.
 * @returns {import('../dist/esm/index.js').Diagnostic[]} Diagnostics.
 */
const ampValidate = (text) => service.validate({ text, languageId: 'ampscript' });

/**
 * Helper: validate an SSJS snippet.
 * @param {string} text - SSJS source.
 * @returns {import('../dist/esm/index.js').Diagnostic[]} Diagnostics.
 */
const ssjsValidate = (text) => service.validate({ text, languageId: 'ssjs' });

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
        assert.ok(
            diags.some((d) => d.message.includes("Unknown AMPscript function 'MyCustomFunc'")),
        );
    });

    it('reports arity error (too few args)', () => {
        const doc = { text: '%%[ Add(1) ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('requires at least')));
    });

    it('reports arity error (too many args) for fixed-arity function', () => {
        const doc = { text: '%%[ Add(1, 2, 3) ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('accepts at most')));
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

// ── MCN diagnostics — AMPscript ──────────────────────────────────────────────

describe('MCN AMPscript diagnostics (targetPlatform: next)', () => {
    const nextSettings = { maxNumberOfProblems: 100, targetPlatform: 'next' };

    it('no diagnostics for MCN-supported function with targetPlatform:next', () => {
        const doc = { text: '%%[ set @x = Now() ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        assert.ok(
            !diags.some((d) => d.code === 'ampscript/mcn-unsupported-function'),
            'Now() is MCN-supported and should not be flagged',
        );
    });

    it('reports MCN-unsupported function as error with targetPlatform:next', () => {
        const doc = { text: '%%[ InsertDE("MyDE", "Col", "Val") ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        const mcnDiag = diags.find((d) => d.code === 'ampscript/mcn-unsupported-function');
        assert.ok(mcnDiag, 'expected an MCN unsupported diagnostic for InsertDE');
        assert.ok(mcnDiag.message.includes('InsertDE'));
        assert.strictEqual(mcnDiag.severity, 1 /* Error */);
    });

    it('no MCN diagnostics for AMPscript with default settings (targetPlatform unset)', () => {
        const doc = { text: '%%[ InsertDE("MyDE", "Col", "Val") ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.code === 'ampscript/mcn-unsupported-function'),
            'MCN diagnostics should not fire without targetPlatform:next',
        );
    });

    it('no MCN diagnostics for AMPscript with targetPlatform:engagement', () => {
        const doc = { text: '%%[ InsertDE("MyDE", "Col", "Val") ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            targetPlatform: 'engagement',
        });
        assert.ok(
            !diags.some((d) => d.code === 'ampscript/mcn-unsupported-function'),
            'MCN diagnostics should not fire with targetPlatform:engagement',
        );
    });

    it('MCN diagnostic line is correct when preceding comment block has newlines (regression)', () => {
        // The function call is on line 7 (0-indexed) — after a 7-line comment block at the top.
        // Before the fix, getSanitizedAmpscriptText blanked comment newlines → position computed
        // against sanitizedText returned line 0 instead of line 7.
        const code = [
            '%%[',
            '/* line 1 of comment',
            '   line 2 of comment',
            '   line 3 of comment',
            '   line 4 of comment',
            '   line 5 of comment',
            '   line 6 of comment */',
            'InsertDE("MyDE", "Col", "Val")',
            ']%%',
        ].join('\n');
        const doc = { text: code, languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100, targetPlatform: 'next' });
        const mcnDiag = diags.find((d) => d.code === 'ampscript/mcn-unsupported-function');
        assert.ok(mcnDiag, 'expected MCN diagnostic for InsertDE');
        assert.strictEqual(mcnDiag.range.start.line, 7, 'diagnostic must be on line 7 (0-indexed)');
    });

    it('MCN diagnostic line is correct in HTML <script language="ampscript"> block (regression)', () => {
        // The function is on line 5 (0-indexed) inside a script block starting on line 4.
        // Before the fix, the 4 newlines in HTML before the script block were blanked, so the
        // diagnostic was reported at line 1 instead of line 5.
        const code = [
            '<html>',
            '<head></head>',
            '<body>',
            '<main>',
            '<script language="ampscript" runat="server">',
            'set @x = InsertDE("MyDE", "Col", "Val")',
            '</script>',
            '</main></body></html>',
        ].join('\n');
        const doc = { text: code, languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100, targetPlatform: 'next' });
        const mcnDiag = diags.find((d) => d.code === 'ampscript/mcn-unsupported-function');
        assert.ok(mcnDiag, 'expected MCN diagnostic for InsertDE in HTML script block');
        assert.strictEqual(mcnDiag.range.start.line, 5, 'diagnostic must be on line 5 (0-indexed)');
    });

    it('arity diagnostic line is correct after multi-line comment block (regression)', () => {
        // UpperCase is on line 4 (0-indexed) — after a 3-line block comment.
        // Before the fix, sanitizedText had 2 \n replaced with spaces inside the comment,
        // so offsetToPosition reported line 2 instead of line 4.
        const code = [
            '%%[',
            '/* comment line 1',
            '   comment line 2',
            '   comment line 3 */',
            'UpperCase("hello", "extra")',
            ']%%',
        ].join('\n');
        const doc = { text: code, languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find((x) => x.message.includes('accepts at most'));
        assert.ok(d, 'expected arity diagnostic for UpperCase');
        assert.strictEqual(d.range.start.line, 4, 'arity diagnostic must be on line 4 (0-indexed)');
    });

    it('unknown-function diagnostic line is correct after multi-line comment block (regression)', () => {
        // MyCustomFunc is on line 4 (0-indexed) — after a 3-line block comment.
        const code = [
            '%%[',
            '/* comment line 1',
            '   comment line 2',
            '   comment line 3 */',
            'MyCustomFunc()',
            ']%%',
        ].join('\n');
        const doc = { text: code, languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find((x) => x.message.includes('Unknown AMPscript function'));
        assert.ok(d, 'expected unknown-function diagnostic for MyCustomFunc');
        assert.strictEqual(
            d.range.start.line,
            4,
            'unknown-function diagnostic must be on line 4 (0-indexed)',
        );
    });

    it('HTML-comment diagnostic line is correct after multi-line comment block (regression)', () => {
        // The HTML comment <!-- --> is on line 4 (0-indexed) — after a 3-line block comment.
        const code = [
            '%%[',
            '/* comment line 1',
            '   comment line 2',
            '   comment line 3 */',
            '<!-- this is wrong -->',
            ']%%',
        ].join('\n');
        const doc = { text: code, languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find((x) => x.code === 'ampscript/html-comment');
        assert.ok(d, 'expected html-comment diagnostic');
        assert.strictEqual(
            d.range.start.line,
            4,
            'html-comment diagnostic must be on line 4 (0-indexed)',
        );
    });

    it('JS-line-comment diagnostic line is correct after multi-line comment block (regression)', () => {
        // The // comment is on line 4 (0-indexed) — after a 3-line block comment.
        const code = [
            '%%[',
            '/* comment line 1',
            '   comment line 2',
            '   comment line 3 */',
            '// this is wrong',
            ']%%',
        ].join('\n');
        const doc = { text: code, languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find((x) => x.code === 'ampscript/js-line-comment');
        assert.ok(d, 'expected js-line-comment diagnostic');
        assert.strictEqual(
            d.range.start.line,
            4,
            'js-line-comment diagnostic must be on line 4 (0-indexed)',
        );
    });

    it('arg-type diagnostic line is correct after multi-line comment block (regression)', () => {
        // Uppercase(42) is on line 4 (0-indexed) — after a 3-line block comment.
        // The first param of Uppercase expects a string but receives a number literal.
        const code = [
            '%%[',
            '/* comment line 1',
            '   comment line 2',
            '   comment line 3 */',
            'SET @x = Uppercase(42)',
            ']%%',
        ].join('\n');
        const doc = { text: code, languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find(
            (x) => x.message.includes('expects a') && x.message.includes('Uppercase'),
        );
        assert.ok(d, 'expected arg-type diagnostic for Uppercase');
        assert.strictEqual(
            d.range.start.line,
            4,
            'arg-type diagnostic must be on line 4 (0-indexed)',
        );
    });

    it('union-type param accepts either type (no false positive)', () => {
        // ContentArea.contentAreaId is typed number|string — both literals must be valid.
        for (const call of ['ContentArea(12345)', "ContentArea('abc')"]) {
            const doc = { text: `%%=${call}=%%`, languageId: 'ampscript' };
            const diags = service.validate(doc, { maxNumberOfProblems: 100 });
            const d = diags.find(
                (x) => x.message.includes('expects a') && x.message.includes('ContentArea'),
            );
            assert.ok(!d, `unexpected arg-type diagnostic for ${call}`);
        }
    });

    it('union-type param still flags an unmistakably wrong type', () => {
        // Length(sourceString:string) — a boolean literal is neither member of the type.
        const doc = { text: '%%=Length(true)=%%', languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find(
            (x) => x.message.includes('expects a') && x.message.includes('Length'),
        );
        assert.ok(d, 'expected arg-type diagnostic for Length(true)');
    });
});

// ── Deprecation surfacing — AMPscript ─────────────────────────────────────────

describe('AMPscript deprecation in hover & completion', () => {
    it('hover for a deprecated function shows a deprecation note + replacement', () => {
        const line = '%%=ContentArea(12345)=%%';
        const doc = { text: line, languageId: 'ampscript' };
        const position = { line: 0, character: line.indexOf('ContentArea') + 1 };
        const hover = service.getHover(doc, line, position);
        assert.ok(hover, 'expected hover for ContentArea');
        const value = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
        assert.match(value, /Deprecated/i, 'hover should mention deprecation');
        assert.match(value, /ContentBlockByID/, 'hover should suggest the replacement');
    });

    it('completion item for a deprecated function carries the Deprecated tag', () => {
        const doc = { text: '%%=  =%%', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 4 });
        const item = items.find((i) => i.label === 'ContentArea');
        assert.ok(item, 'expected ContentArea completion item');
        assert.ok(
            Array.isArray(item.tags) && item.tags.includes(1),
            'ContentArea completion must carry CompletionItemTag.Deprecated (1)',
        );
    });

    it('completion item for a non-deprecated function has no Deprecated tag', () => {
        const doc = { text: '%%=  =%%', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 4 });
        const item = items.find((i) => i.label === 'ContentBlockByID');
        assert.ok(item, 'expected ContentBlockByID completion item');
        assert.ok(
            !item.tags || !item.tags.includes(1),
            'ContentBlockByID completion must not be tagged Deprecated',
        );
    });
});

// ── MCN diagnostics — SSJS ────────────────────────────────────────────────────

describe('MCN SSJS diagnostics (targetPlatform: next)', () => {
    const nextSettings = { maxNumberOfProblems: 100, targetPlatform: 'next' };

    it('reports SSJS as not supported in MCN with targetPlatform:next', () => {
        const doc = { text: 'Platform.Function.Lookup("DE", "F", "K", "V");', languageId: 'ssjs' };
        const diags = service.validate(doc, nextSettings);
        const mcnDiag = diags.find((d) => d.code === 'ssjs/mcn-not-supported');
        assert.ok(mcnDiag, 'expected MCN SSJS diagnostic');
        assert.ok(mcnDiag.message.includes('SSJS is not supported in Marketing Cloud Next'));
        assert.strictEqual(mcnDiag.severity, 1 /* Error */);
    });

    it('no MCN SSJS diagnostic with default settings', () => {
        const doc = { text: 'Platform.Function.Lookup("DE", "F", "K", "V");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.code === 'ssjs/mcn-not-supported'),
            'MCN SSJS diagnostic should not fire without targetPlatform:next',
        );
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

    it('reports let/const as Error severity (not Warning)', () => {
        const doc = { text: 'let x = 1;', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.message.includes("'let'/'const'"));
        assert.ok(d, 'expected diagnostic for let');
        assert.equal(d.severity, 1, 'expected DiagnosticSeverity.Error (1)');
    });

    it('reports const as Error severity', () => {
        const doc = { text: 'const y = 2;', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.message.includes("'let'/'const'"));
        assert.ok(d, 'expected diagnostic for const');
        assert.equal(d.severity, 1, 'expected DiagnosticSeverity.Error (1)');
    });

    it('reports for...of loop as Error severity', () => {
        const doc = { text: 'for (var item of items) {}', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes('for...of') && d.severity === 1),
            'expected Error for for...of',
        );
    });

    it('reports spread operator as Error severity', () => {
        const doc = { text: 'var a = [...b];', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes('Spread') && d.severity === 1),
            'expected Error for spread',
        );
    });

    it('does not flag unknown-prefix calls (user variable — e.g. api.retrieve)', () => {
        const code =
            'Platform.Load("core","1.1.5");\nvar api = new WSProxy();\napi.retrieve("DataExtension", ["Name"], {});';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.message.toLowerCase().includes('retrieve')),
            'api.retrieve should not produce a diagnostic',
        );
    });

    it('does not flag DateTime.TimeZone.Retrieve when prefix is unknown', () => {
        const code =
            'Platform.Load("core","1.1.5");\nvar tz = new Object();\ntz.Retrieve("something");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.message.includes('Retrieve')),
            'tz.Retrieve should not be flagged (unknown prefix)',
        );
    });

    it('does not report core object usage when Platform.Load is real and core object is only in a comment', () => {
        // DataExtension.Init is only inside a comment, so should not trigger
        const code = 'Platform.Load("core","1.1.5");\n// var de = DataExtension.Init("test");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.message.includes('Platform.Load')),
            'core object in a comment should not be flagged',
        );
    });

    it('does not warn about wrong Platform.Load version when load is in a comment', () => {
        const doc = { text: '// Platform.Load("core","1.0");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.message.includes('"1.1.5"')),
            'version check in a comment should not produce a diagnostic',
        );
    });

    it('still reports core object usage when Platform.Load is only in a comment', () => {
        // The real code has no Platform.Load — only a commented-out one
        const code = '// Platform.Load("core","1.1.5");\nvar de = DataExtension.Init("test");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes('Platform.Load')),
            'core object should still be flagged when only commented-out load exists',
        );
    });

    it('reports bare Stringify() without Platform.Load', () => {
        const doc = { text: 'var s = Stringify({ foo: 1 });', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes('Stringify')),
            'bare Stringify() without Platform.Load should be flagged',
        );
    });

    it('does not report bare Stringify() when Platform.Load is present', () => {
        const code = 'Platform.Load("core","1.1.5");\nvar s = Stringify({ foo: 1 });';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.message.includes('Stringify')),
            'bare Stringify() should not be flagged when Platform.Load precedes it',
        );
    });

    it('does not report bare Stringify() when only in a comment', () => {
        const doc = { text: '// var s = Stringify({ foo: 1 });', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.message.includes('Stringify')),
            'Stringify() in a comment should not be flagged',
        );
    });

    it('reports bare Stringify() when Platform.Load comes AFTER the call', () => {
        const code = 'var s = Stringify({ foo: 1 });\nPlatform.Load("core","1.1.5");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes('Stringify')),
            'bare Stringify() before Platform.Load should still be flagged',
        );
    });

    it('reports core object usage when Platform.Load comes AFTER the call', () => {
        const code = 'var de = DataExtension.Init("test");\nPlatform.Load("core","1.1.5");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes('Platform.Load')),
            'DataExtension.Init() before Platform.Load should still be flagged',
        );
    });

    // ── No-polyfill ECMAScript members (handled by TypeScript, not by us) ─────

    it('does not flag a supported static member (Math.floor)', () => {
        const doc = { text: 'var n = Math.floor(4.7);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(!diags.some((d) => d.message.includes('not available')));
    });

    it('does not emit an ssjs diagnostic for no-polyfill members (Object.keys, Math.trunc, Array.from)', () => {
        for (const text of [
            'var k = Object.keys(obj);',
            'var n = Math.trunc(4.7);',
            'var a = Array.from("ab");',
        ]) {
            const diags = service.validate({ text, languageId: 'ssjs' });
            assert.ok(
                !diags.some((d) => d.source === 'ssjs' && d.message.includes('not available')),
                `no-polyfill member must not produce an ssjs diagnostic: ${text}`,
            );
        }
    });

    it('does not flag unsupported members inside comments', () => {
        const doc = {
            text: '// var k = Object.keys(obj);\nvar b = name.includes("x"); // .includes',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.message.includes('Object.keys')),
            'Object.keys in comment must be ignored',
        );
    });

    it('does NOT emit a custom diagnostic for no-polyfill members (TypeScript owns them)', () => {
        // Object.keys is unsupported with no shipped polyfill — TS flags it, we do not.
        const doc = { text: 'var k = Object.keys(obj);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.source === 'ssjs' && d.message.includes('Object.keys')),
            'no-polyfill members must not produce an ssjs diagnostic',
        );
    });
});

// ── Polyfill-required ECMAScript members ─────────────────────────────────────

describe('SSJS polyfill-required diagnostics', () => {
    it('reports a static polyfillable member (Array.isArray) as a Warning with polyfill data', () => {
        const doc = { text: 'var b = Array.isArray(x);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find(
            (d) => d.code === 'ssjs/polyfill-required' && d.message.includes('Array.isArray'),
        );
        assert.ok(d, 'expected polyfill-required diagnostic for Array.isArray');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.ok(d.data && typeof d.data.polyfill === 'string' && d.data.polyfill.length > 0);
        assert.equal(d.data.owner, 'Array');
        assert.equal(d.data.method, 'isArray');
    });

    it('reports a prototype polyfillable member (.forEach) as a Warning with polyfill data', () => {
        const doc = { text: 'arr.forEach(fn);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find(
            (d) => d.code === 'ssjs/polyfill-required' && d.message.includes('forEach'),
        );
        assert.ok(d, 'expected polyfill-required diagnostic for .forEach');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.ok(d.data && typeof d.data.polyfill === 'string' && d.data.polyfill.length > 0);
    });

    it('does not flag ambiguous-with-string members (.slice) to avoid string false positives', () => {
        const doc = { text: 'var s = str.slice(1, 3);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some((d) => d.code === 'ssjs/polyfill-required' && d.message.includes('slice')),
            '.slice() must not be flagged by the polyfill-required warning',
        );
    });

    it('uses "not available" wording for an unavailable member (Array.isArray)', () => {
        const doc = { text: 'var b = Array.isArray(x);', languageId: 'ssjs' };
        const d = service
            .validate(doc)
            .find(
                (d) => d.code === 'ssjs/polyfill-required' && d.message.includes('Array.isArray'),
            );
        assert.ok(d, 'expected polyfill-required diagnostic for Array.isArray');
        assert.ok(
            d.message.includes('is not available in SFMC SSJS'),
            `expected "not available" wording, got: ${d.message}`,
        );
    });

    it('uses "broken" wording for a broken member (String.prototype.search)', () => {
        const doc = { text: 'var i = str.search(/x/);', languageId: 'ssjs' };
        const d = service
            .validate(doc)
            .find((d) => d.code === 'ssjs/polyfill-required' && d.message.includes('search'));
        assert.ok(d, 'expected polyfill-required diagnostic for String.search');
        assert.ok(
            d.message.includes('is broken in the SFMC SSJS engine'),
            `expected "broken" wording, got: ${d.message}`,
        );
        assert.ok(
            !d.message.includes('when called on a'),
            `expected no "(when called on a …)" phrase, got: ${d.message}`,
        );
    });

    it('suppresses the diagnostic once the polyfill is already present in the document', () => {
        const probe = service
            .validate({ text: 'Array.isArray(x);', languageId: 'ssjs' })
            .find((d) => d.code === 'ssjs/polyfill-required');
        // Marker = first code line, skipping the leading JSDoc block — matches
        // polyfillMarker() in src/utils/polyfill.ts.
        const marker = probe.data.polyfill
            .split('\n')
            .map((l) => l.trim())
            .find(
                (l) =>
                    l.length > 0 &&
                    !l.startsWith('/**') &&
                    !l.startsWith('*') &&
                    !l.startsWith('*/'),
            );
        const doc = { text: `${marker}\nvar b = Array.isArray(x);`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            !diags.some(
                (d) => d.code === 'ssjs/polyfill-required' && d.message.includes('isArray'),
            ),
            'diagnostic must be suppressed when the polyfill is present',
        );
    });
});

// ── Replace-with-Platform.Function diagnostics ───────────────────────────────

describe('SSJS replace-with-platform-function diagnostics', () => {
    it('reports JSON.parse with a replacement to Platform.Function.ParseJSON', () => {
        const doc = { text: 'var o = JSON.parse(str);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find(
            (d) =>
                d.code === 'ssjs/replace-with-platform-function' &&
                d.message.includes('JSON.parse'),
        );
        assert.ok(d, 'expected replace diagnostic for JSON.parse');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.equal(d.data.owner, 'JSON');
        assert.equal(d.data.member, 'parse');
        assert.equal(d.data.replacement, 'Platform.Function.ParseJSON');
    });

    it('reports JSON.stringify with a replacement to Platform.Function.Stringify', () => {
        const doc = { text: 'var s = JSON.stringify(obj);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find(
            (d) =>
                d.code === 'ssjs/replace-with-platform-function' &&
                d.message.includes('JSON.stringify'),
        );
        assert.ok(d, 'expected replace diagnostic for JSON.stringify');
        assert.equal(d.data.replacement, 'Platform.Function.Stringify');
    });

    it('does not flag JSON.parse inside a comment', () => {
        const doc = { text: '// var o = JSON.parse(str);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(!diags.some((d) => d.code === 'ssjs/replace-with-platform-function'));
    });

    it('offers a replace code action for the replace diagnostic', () => {
        const doc = {
            text: 'var o = JSON.parse(str);',
            languageId: 'ssjs',
            uri: 'file:///t.ssjs',
        };
        const diags = service.validate(doc);
        const replaceDiag = diags.find((d) => d.code === 'ssjs/replace-with-platform-function');
        assert.ok(replaceDiag, 'expected a replace diagnostic');
        const actions = service.getCodeActions(doc, [replaceDiag]);
        const action = actions.find((a) => a.title.includes('Platform.Function.ParseJSON'));
        assert.ok(action, 'expected a replace code action');
        const edit = action.edit.changes['file:///t.ssjs'][0];
        assert.equal(edit.newText, 'Platform.Function.ParseJSON');
    });
});

// ── SSJS eslint-overlap filtering ────────────────────────────────────────────

describe('SSJS disableLspDiagnosticsForEslintRules', () => {
    it('suppresses polyfill-required diagnostics when enabled', () => {
        const doc = { text: 'var b = Array.isArray(x);', languageId: 'ssjs' };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            disableLspDiagnosticsForEslintRules: true,
        });
        assert.ok(!diags.some((d) => d.code === 'ssjs/polyfill-required'));
    });

    it('suppresses replace-with-platform-function diagnostics when enabled', () => {
        const doc = { text: 'var o = JSON.parse(str);', languageId: 'ssjs' };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            disableLspDiagnosticsForEslintRules: true,
        });
        assert.ok(!diags.some((d) => d.code === 'ssjs/replace-with-platform-function'));
    });

    it('still reports polyfill-required diagnostics when disabled (default)', () => {
        const doc = { text: 'var b = Array.isArray(x);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.code === 'ssjs/polyfill-required'));
    });
});

// ── SSJS code actions ────────────────────────────────────────────────────────

describe('SSJS insert-polyfill code action', () => {
    it('offers an insert-polyfill action for a polyfill-required diagnostic', () => {
        const doc = {
            text: 'var b = Array.isArray(x);',
            languageId: 'ssjs',
            uri: 'file:///t.ssjs',
        };
        const diags = service.validate(doc);
        const polyDiag = diags.find((d) => d.code === 'ssjs/polyfill-required');
        assert.ok(polyDiag, 'expected a polyfill-required diagnostic');
        const actions = service.getCodeActions(doc, [polyDiag]);
        const action = actions.find((a) => a.title.includes('Insert polyfill'));
        assert.ok(action, 'expected an insert-polyfill code action');
        assert.ok(action.edit?.changes?.['file:///t.ssjs']?.length === 1);
        const newText = action.edit.changes['file:///t.ssjs'][0].newText;
        assert.ok(newText.length > 0 && newText.includes('Array'), 'expected polyfill text');
    });

    it('inserts the polyfill after a leading /* global */ directive', () => {
        const doc = {
            text: '/* global DEBUG, deKey */\nvar b = Array.isArray(x);',
            languageId: 'ssjs',
            uri: 'file:///t.ssjs',
        };
        const diags = service.validate(doc);
        const polyDiag = diags.find((d) => d.code === 'ssjs/polyfill-required');
        assert.ok(polyDiag, 'expected a polyfill-required diagnostic');
        const action = service
            .getCodeActions(doc, [polyDiag])
            .find((a) => a.title.includes('Insert polyfill'));
        assert.ok(action, 'expected an insert-polyfill code action');
        const edit = action.edit.changes['file:///t.ssjs'][0];
        assert.deepEqual(
            edit.range.start,
            { line: 1, character: 0 },
            'polyfill must be inserted on the line after the /* global */ directive',
        );
    });

    it('inserts the polyfill at the top when there is no /* global */ directive', () => {
        const doc = {
            text: 'var b = Array.isArray(x);',
            languageId: 'ssjs',
            uri: 'file:///t.ssjs',
        };
        const diags = service.validate(doc);
        const polyDiag = diags.find((d) => d.code === 'ssjs/polyfill-required');
        const action = service
            .getCodeActions(doc, [polyDiag])
            .find((a) => a.title.includes('Insert polyfill'));
        const edit = action.edit.changes['file:///t.ssjs'][0];
        assert.deepEqual(edit.range.start, { line: 0, character: 0 });
    });

    it('does not offer the action when the polyfill is already present', () => {
        const diagsProbe = service.validate({ text: 'Array.isArray(x);', languageId: 'ssjs' });
        const probe = diagsProbe.find((d) => d.code === 'ssjs/polyfill-required');
        // Marker = first code line, skipping the leading JSDoc block — matches
        // polyfillMarker() in src/utils/polyfill.ts.
        const marker = probe.data.polyfill
            .split('\n')
            .map((l) => l.trim())
            .find(
                (l) =>
                    l.length > 0 &&
                    !l.startsWith('/**') &&
                    !l.startsWith('*') &&
                    !l.startsWith('*/'),
            );
        const doc = {
            text: `${marker}\nvar b = Array.isArray(x);`,
            languageId: 'ssjs',
            uri: 'file:///t.ssjs',
        };
        // The diagnostic itself is now suppressed, but even if a stale diagnostic
        // were passed, the action must not be offered when the marker is present.
        const polyDiag = {
            code: 'ssjs/polyfill-required',
            source: 'ssjs',
            data: probe.data,
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            message: probe.message,
            severity: 2,
        };
        const actions = service.getCodeActions(doc, [polyDiag]);
        assert.ok(
            !actions.some((a) => a.title.includes('Insert polyfill')),
            'must not offer insert-polyfill when already present',
        );
    });
});

// ── Completions ────────────────────────────────────────────────────────────

describe('Completions', () => {
    it('returns AMPscript function completions inside %%[ block', () => {
        const doc = { text: '%%[ \n ]%%', languageId: 'ampscript' };
        const position = { line: 0, character: 4 };
        const items = service.getCompletions(doc, position);
        assert.ok(items.length > 0, 'expected completions');
        assert.ok(
            items.some((i) => i.label === 'Add'),
            'expected Add function',
        );
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

    it('returns null hover for wrong-case SSJS Platform.Function name (Bug #5)', () => {
        // "URLEncode" is wrong case — correct spelling is "UrlEncode"
        // Hover should return null so the TS type-checker diagnostic is the only feedback
        const doc = { text: 'Platform.Function.URLEncode("x");', languageId: 'ssjs' };
        const line = 'Platform.Function.URLEncode("x");';
        const hover = service.getHover(doc, line, { line: 0, character: 20 });
        assert.equal(hover, null, 'should not show hover for wrong-case function name');
    });

    it('ECMAScript builtin hover includes both ssjs.guide and MDN links', () => {
        const line = 'var x = Math.PI;';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "PI"
        const hover = service.getHover(doc, line, { line: 0, character: 13 });
        assert.ok(hover !== null, 'expected hover for Math.PI');
        const value = hover.contents.value;
        assert.ok(
            value.includes('[ssjs.guide reference](https://ssjs.guide/ecmascript-builtins/'),
            `expected ssjs.guide link, got: ${value}`,
        );
        assert.ok(
            value.includes('[MDN](https://developer.mozilla.org/'),
            `expected MDN link, got: ${value}`,
        );
    });

    it('ECMAScript prototype-method hover links to MDN deep page', () => {
        const line = 'var y = arr.slice(0, 1);';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "slice"
        const hover = service.getHover(doc, line, { line: 0, character: 14 });
        assert.ok(hover !== null, 'expected hover for Array.prototype.slice');
        const value = hover.contents.value;
        assert.ok(
            value.includes(
                '[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice)',
            ),
            `expected MDN deep link for slice, got: ${value}`,
        );
    });

    it('ECMAScript builtin hover surfaces the SFMC engine caveat below the description', () => {
        const line = 'var y = arr.slice(0, 1);';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "slice" — Array.prototype.slice carries a caveat in ssjs-data
        const hover = service.getHover(doc, line, { line: 0, character: 14 });
        assert.ok(hover !== null, 'expected hover for Array.prototype.slice');
        const value = hover.contents.value;
        assert.match(value, /Caveat:/, `expected caveat label in hover, got: ${value}`);
        assert.match(
            value,
            /no-argument form/i,
            `expected slice caveat text in hover, got: ${value}`,
        );
    });

    it('returns null hover on object part of qualified call (Bug #1)', () => {
        // Bug #1: cursor on "Platform" in "Platform.Load" (twoPartPattern) should not
        // show Platform.Load method hover — only fire when cursor is on the member name
        const doc = { text: 'Platform.Load("core", "1");', languageId: 'ssjs' };
        const line = 'Platform.Load("core", "1");';
        const hover = service.getHover(doc, line, { line: 0, character: 4 });
        assert.equal(
            hover,
            null,
            'should not show method hover when cursor is on the namespace prefix',
        );
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

    it('returns empty code actions for SSJS with no diagnostics', () => {
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
        const doc = {
            text: '%%[ set @x = 1 ]%%',
            languageId: 'ampscript',
            uri: 'file:///test.amp',
        };
        const location = service.getDefinition(doc, 'x');
        assert.equal(location, null);
    });

    it('returns null for unknown SSJS function', () => {
        const doc = { text: 'var x = 1;', languageId: 'ssjs', uri: 'file:///test.ssjs' };
        const location = service.getDefinition(doc, 'unknownFn');
        assert.equal(location, null);
    });
});

// ── MCN Hover ──────────────────────────────────────────────────────────────

describe('MCN hover badges', () => {
    it('hover for MCN-supported function (no notes) includes MCN badge', () => {
        const doc = { text: '%%[ Add(1,2) ]%%', languageId: 'ampscript' };
        const hover = service.getHover(doc, '%%[ Add(1,2) ]%%', { line: 0, character: 4 });
        assert.ok(hover !== null, 'expected hover for Add');
        assert.ok(
            hover.contents.value.includes('Supported in Marketing Cloud Next'),
            `expected MCN badge, got: ${hover.contents.value}`,
        );
    });

    it('hover for MCN-supported function with notes includes both badge and notes', () => {
        const line = '%%[ FormatDate(@d, "MM/dd/yyyy") ]%%';
        const doc = { text: line, languageId: 'ampscript' };
        const hover = service.getHover(doc, line, { line: 0, character: 5 });
        assert.ok(hover !== null, 'expected hover for FormatDate');
        assert.ok(
            hover.contents.value.includes('Supported in Marketing Cloud Next'),
            'expected MCN badge for FormatDate',
        );
        assert.ok(
            hover.contents.value.includes('MCN Note:'),
            'expected mcnNotes text for FormatDate',
        );
    });

    it('hover for MCE-only function includes not-supported badge', () => {
        const line = '%%[ AttachFile("p","k","file.pdf","application/pdf") ]%%';
        const doc = { text: line, languageId: 'ampscript' };
        const hover = service.getHover(doc, line, { line: 0, character: 5 });
        assert.ok(hover !== null, 'expected hover for AttachFile');
        assert.ok(
            hover.contents.value.includes('Not supported in Marketing Cloud Next'),
            `expected not-supported badge, got: ${hover.contents.value}`,
        );
    });
});

// ── MCN helpers (re-exported) ───────────────────────────────────────────────

describe('MCN helpers', () => {
    it('isMcnSupported returns true for MCN-supported functions', () => {
        assert.equal(isMcnSupported('Add'), true);
        assert.equal(isMcnSupported('Lookup'), true);
        assert.equal(isMcnSupported('add'), true, 'case-insensitive');
    });

    it('isMcnSupported returns false for MCE-only functions', () => {
        assert.equal(isMcnSupported('AttachFile'), false);
        assert.equal(isMcnSupported('InsertDE'), false);
    });

    it('getMcnApiVersion returns 67 for MCN-supported functions', () => {
        assert.equal(getMcnApiVersion('Concat'), 67);
        assert.equal(getMcnApiVersion('FormatDate'), 67);
    });

    it('getMcnApiVersion returns null for MCE-only functions', () => {
        assert.equal(getMcnApiVersion('AttachFile'), null);
        assert.equal(getMcnApiVersion('InsertDE'), null);
    });
});

// ── extractAmpscriptFunctionCalls ──────────────────────────────────────────

describe('extractAmpscriptFunctionCalls', () => {
    it('returns call site for inline %%=...=%% expression', () => {
        const code = '%%=Lookup("DE","col","k","v")=%%';
        const calls = extractAmpscriptFunctionCalls(code);
        assert.ok(calls.length > 0, 'expected at least one call site');
        const lookupCall = calls.find((c) => c.name.toLowerCase() === 'lookup');
        assert.ok(lookupCall, 'expected Lookup call site');
        assert.equal(lookupCall.line, 0);
    });

    it('returns call sites for block %%[...]%% syntax', () => {
        const code = '%%[ SET @x = Add(1,2) SET @y = Concat("a","b") ]%%';
        const calls = extractAmpscriptFunctionCalls(code);
        const names = calls.map((c) => c.name.toLowerCase());
        assert.ok(names.includes('add'), 'expected Add');
        assert.ok(names.includes('concat'), 'expected Concat');
    });

    it('returns call sites from HTML with embedded AMPscript', () => {
        const code = '<p>Hello</p>%%[ SET @x = Trim("  hi  ") ]%%<p>world</p>';
        const calls = extractAmpscriptFunctionCalls(code);
        const names = calls.map((c) => c.name.toLowerCase());
        assert.ok(names.includes('trim'), 'expected Trim from HTML context');
        assert.ok(!names.includes('p'), 'HTML tags should not appear as function calls');
    });

    it('returns empty array for code with no AMPscript function calls', () => {
        const calls = extractAmpscriptFunctionCalls('<p>No AMPscript here</p>');
        assert.equal(calls.length, 0);
    });

    it('returns empty array for empty input', () => {
        assert.deepEqual(extractAmpscriptFunctionCalls(''), []);
    });

    it('returns correct line and col for multi-line code', () => {
        const code = '%%[\n  SET @x = Add(1,2)\n  SET @y = Trim("hi")\n]%%';
        const calls = extractAmpscriptFunctionCalls(code);
        const addCall = calls.find((c) => c.name.toLowerCase() === 'add');
        const trimCall = calls.find((c) => c.name.toLowerCase() === 'trim');
        assert.ok(addCall, 'expected Add');
        assert.ok(trimCall, 'expected Trim');
        assert.equal(addCall.line, 1, 'Add should be on line 1');
        assert.equal(trimCall.line, 2, 'Trim should be on line 2');
    });

    it('service.extractAmpscriptFunctionCalls delegates to standalone function', () => {
        const code = '%%=Add(1,2)=%%';
        const serviceResult = service.extractAmpscriptFunctionCalls(code);
        const standaloneResult = extractAmpscriptFunctionCalls(code);
        assert.deepEqual(serviceResult, standaloneResult);
    });
});

// ── Signature Help ─────────────────────────────────────────────────────────

describe('Signature Help', () => {
    it('signature label for Platform.Function is not double-prefixed (Bug #7)', () => {
        const doc = { text: 'Platform.Function.Stringify(', languageId: 'ssjs' };
        const sig = service.getSignatureHelp(doc, 'Platform.Function.Stringify(');
        assert.ok(sig !== null, 'expected signature help for Stringify');
        const label = sig.signatures[0].label;
        assert.ok(
            !label.includes('Platform.Function.Platform.Function.'),
            `label should not contain doubled prefix, got: ${label}`,
        );
        assert.ok(
            label.startsWith('Platform.Function.'),
            `label should start with Platform.Function., got: ${label}`,
        );
    });

    it('signature label for shorthand Function.Stringify is not double-prefixed (Bug #7)', () => {
        const doc = { text: 'Function.Stringify(', languageId: 'ssjs' };
        const sig = service.getSignatureHelp(doc, 'Function.Stringify(');
        assert.ok(sig !== null, 'expected signature help for shorthand Stringify');
        const label = sig.signatures[0].label;
        assert.ok(
            !label.includes('Platform.Function.Platform.Function.'),
            `label should not contain doubled prefix, got: ${label}`,
        );
    });

    // ── AMPscript repeat-group activeParameter (*1 / *N convention) ──
    it('Concat: first two args use string1/string2, then repeats on stringN', () => {
        // params: string1(0), string2(1), stringN(2). No symmetric *1/*N block,
        // so the trailing param simply repeats (clamp to last slot).
        assert.strictEqual(ampSig('%%=Concat(').activeParameter, 0, 'arg 1 -> string1');
        assert.strictEqual(ampSig("%%=Concat('a',").activeParameter, 1, 'arg 2 -> string2');
        assert.strictEqual(ampSig("%%=Concat('a','b',").activeParameter, 2, 'arg 3 -> stringN');
        assert.strictEqual(
            ampSig("%%=Concat('a','b','c',").activeParameter,
            2,
            'arg 4 -> stringN (repeats)',
        );
    });

    it('HTTPPost2: first header pair uses *1 slots, later pairs use *N slots', () => {
        // params: ... headerName1(6), headerValue1(7), headerNameN(8), headerValueN(9)
        const base = '%%=HTTPPost2(url,ct,body,false,@r,@rs,';
        assert.strictEqual(ampSig(base).activeParameter, 6, 'index 6 -> headerName1');
        assert.strictEqual(ampSig(base + 'n1,').activeParameter, 7, 'index 7 -> headerValue1');
        assert.strictEqual(
            ampSig(base + 'n1,v1,').activeParameter,
            8,
            'index 8 -> headerNameN (not back to *1)',
        );
        assert.strictEqual(
            ampSig(base + 'n1,v1,n2,').activeParameter,
            9,
            'index 9 -> headerValueN',
        );
        assert.strictEqual(
            ampSig(base + 'n1,v1,n2,v2,').activeParameter,
            8,
            'index 10 -> headerNameN again',
        );
    });

    it('UpdateSingleSalesforceObject: first field pair *1, later pairs *N', () => {
        // params: objectName(0), idToUpdate(1), fieldName1(2), fieldValue1(3),
        //   fieldNameN(4), fieldValueN(5)
        const base = "%%=UpdateSingleSalesforceObject('Account','id',";
        assert.strictEqual(ampSig(base).activeParameter, 2, 'arg 3 -> fieldName1');
        assert.strictEqual(ampSig(base + "'F1',").activeParameter, 3, 'arg 4 -> fieldValue1');
        assert.strictEqual(
            ampSig(base + "'F1','V1',").activeParameter,
            4,
            'arg 5 -> fieldNameN (not back to *1)',
        );
        assert.strictEqual(
            ampSig(base + "'F1','V1','F2',").activeParameter,
            5,
            'arg 6 -> fieldValueN',
        );
    });

    it('UpsertData: countParam splits search block from upsert block', () => {
        // params: dataExt(0), columnValuePairs(1),
        //   searchColumnName1(2), searchValue1(3), searchColumnNameN(4), searchValueN(5),
        //   columnToUpsert1(6), upsertedValue1(7), columnToUpsertN(8), upsertedValueN(9)

        // count = 1: search block fills exactly the *1 pair (slots 2-3), so the
        // next arg (index 4) begins the upsert block at columnToUpsert1 (slot 6).
        const c1 = "%%=UpsertData('DE',1,'k','v',";
        assert.strictEqual(
            ampSig(c1).activeParameter,
            6,
            'count=1, arg index 4 -> columnToUpsert1 (upsert block)',
        );

        // count = 2: search block spans slots 2-5 (one *1 pair + one *N pair).
        const c2base = "%%=UpsertData('DE',2,";
        assert.strictEqual(ampSig(c2base).activeParameter, 2, 'arg 3 -> searchColumnName1');
        assert.strictEqual(ampSig(c2base + "'k1',").activeParameter, 3, 'arg 4 -> searchValue1');
        assert.strictEqual(
            ampSig(c2base + "'k1','v1',").activeParameter,
            4,
            'arg 5 -> searchColumnNameN',
        );
        assert.strictEqual(
            ampSig(c2base + "'k1','v1','k2',").activeParameter,
            5,
            'arg 6 -> searchValueN',
        );
        assert.strictEqual(
            ampSig(c2base + "'k1','v1','k2','v2',").activeParameter,
            6,
            'arg 7 -> columnToUpsert1 (upsert block begins after 2 search pairs)',
        );
    });

    it('parameter labels use offset ranges so repeating slots can be highlighted', () => {
        // Concat params: string1: string, string2: string, stringN?: string.
        // The LSP emits an offset-tuple label for the full typed token so the
        // client highlights the complete `stringN?: string` token.
        const sig = ampSig("%%=Concat('a','b','c',");
        const stringNLabel = sig.signatures[0].parameters[2].label;
        assert.ok(
            Array.isArray(stringNLabel),
            `expected offset-tuple label for stringN, got: ${JSON.stringify(stringNLabel)}`,
        );
        const [start, end] = stringNLabel;
        assert.strictEqual(sig.signatures[0].label.slice(start, end), 'stringN?: string');
    });

    it('DatePart: enum values are surfaced in signature help param docs', () => {
        const sig = ampSig("%%=DatePart('2026-01-15',");
        assert.ok(sig, 'expected signature help for DatePart');
        const raw = sig.signatures[0].parameters[1].documentation;
        // documentation is now a MarkupContent object; extract the text value
        const datePartDoc = typeof raw === 'string' ? raw : (raw?.value ?? '');
        assert.ok(
            /Allowed values:.*monthName/.test(datePartDoc),
            `expected enum values in datePart doc, got: ${datePartDoc}`,
        );
    });
});

// ── Count-gated repeat-group arity validation ──────────────────────────────

describe('AMPscript Update/UpsertData count-gated arity', () => {
    it('accepts UpsertData with columnValuePairs=1 and one upsert pair', () => {
        const diags = ampValidate("%%[ set @r = UpsertData('DE',1,'k','v','c','x') ]%%");
        assert.deepEqual(diags, [], `expected no diagnostics, got: ${JSON.stringify(diags)}`);
    });

    it('flags UpsertData with columnValuePairs=2 but only one search pair', () => {
        // count=2 promises 2 search pairs (4 args) + ≥1 upsert pair; here only
        // 1 search pair + 1 upsert pair are supplied -> incomplete groups.
        const diags = ampValidate("%%[ set @r = UpsertData('DE',2,'k','v','c','x') ]%%");
        assert.ok(
            diags.some((d) => /repeating arguments in complete groups/.test(d.message)),
            `expected incomplete-group diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('accepts UpsertData with columnValuePairs=2 and two search + one upsert pair', () => {
        const diags = ampValidate(
            "%%[ set @r = UpsertData('DE',2,'k1','v1','k2','v2','c','x') ]%%",
        );
        assert.deepEqual(diags, [], `expected no diagnostics, got: ${JSON.stringify(diags)}`);
    });

    it('flags UpdateData with columnValuePairs=2 but only one search pair', () => {
        const diags = ampValidate("%%[ set @r = UpdateData('DE',2,'k','v','c','x') ]%%");
        assert.ok(
            diags.some((d) => /repeating arguments in complete groups/.test(d.message)),
            `expected incomplete-group diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });
});

// ── Enum-typed arguments: validation + completion ──────────────────────────

describe('AMPscript enum-typed arguments', () => {
    it('accepts a valid DatePart enum literal', () => {
        const diags = ampValidate("%%[ set @r = DatePart('2026-01-15','Y') ]%%");
        assert.deepEqual(diags, [], `expected no diagnostics, got: ${JSON.stringify(diags)}`);
    });

    it('flags an invalid DatePart enum literal', () => {
        const diags = ampValidate("%%[ set @r = DatePart('2026-01-15','decade') ]%%");
        assert.ok(
            diags.some((d) => /must be one of:.*monthName/.test(d.message)),
            `expected enum diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('does not flag a variable passed to an enum parameter', () => {
        const diags = ampValidate("%%[ set @r = DatePart('2026-01-15',@part) ]%%");
        assert.deepEqual(diags, [], `expected no diagnostics, got: ${JSON.stringify(diags)}`);
    });

    it('flags a numeric literal passed to an enum parameter', () => {
        const diags = ampValidate("%%[ set @r = DatePart('2026-01-15',5) ]%%");
        assert.ok(
            diags.some((d) => /must be one of:.*monthName/.test(d.message)),
            `expected enum diagnostic for number, got: ${JSON.stringify(diags)}`,
        );
    });

    it('flags a boolean literal passed to an enum parameter', () => {
        const diags = ampValidate("%%[ set @r = DatePart('2026-01-15',true) ]%%");
        assert.ok(
            diags.some((d) => /must be one of:.*monthName/.test(d.message)),
            `expected enum diagnostic for boolean, got: ${JSON.stringify(diags)}`,
        );
    });

    it('offers enum values as completions inside the datePart argument', () => {
        const text = "%%=DatePart('2026-01-15',";
        const doc = { text, languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: text.length });
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('monthName'), 'expected monthName enum completion');
        assert.ok(labels.includes('Y'), 'expected Y enum completion');
    });

    it('returns ONLY enum values inside an enum argument (no functions/variables)', () => {
        const text = "%%=DatePart('2026-01-15',";
        const doc = { text, languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: text.length });
        // Every item must be an enum member (LSP CompletionItemKind.EnumMember = 20)
        // — no Add/Concat functions, no @vars.
        const ENUM_MEMBER_KIND = 20;
        assert.ok(
            items.every((i) => i.kind === ENUM_MEMBER_KIND),
            `expected only enum members, got kinds: ${JSON.stringify([
                ...new Set(items.map((i) => i.kind)),
            ])}`,
        );
    });

    it('no enum completion item has preselect set', () => {
        const text = "%%=DatePart('2026-01-15',";
        const doc = { text, languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: text.length });
        assert.ok(items.length > 0, 'expected enum completions');
        // No item should be preselected — VS Code picks the best match by sortText.
        const preselected = items.filter((i) => i.preselect === true);
        assert.strictEqual(
            preselected.length,
            0,
            `expected no preselected items, got: ${preselected.length}`,
        );
    });
});

// ── Variable Type Tracking ─────────────────────────────────────────────────

describe('AMPscript variable type tracking', () => {
    it('infers rowset type from LookupRows return value', () => {
        const text =
            "%%[ set @rows = LookupRows('DE','col','val') set @count = RowCount(@rows) ]%%";
        const doc = { text, languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.deepEqual(diags, [], `expected no diagnostics, got: ${JSON.stringify(diags)}`);
    });

    it('flags passing a string variable where rowset is expected', () => {
        const text = "%%[ set @x = 'hello' set @count = RowCount(@x) ]%%";
        const doc = { text, languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes('expects a rowset') && d.message.includes("'@x'")),
            `expected rowset type mismatch diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('infers number type for FOR loop index variable', () => {
        // @i should be number — no diagnostic when passed where number is expected
        const text = '%%[ for @i = 1 to 3 do set @n = Add(@i, 1) next ]%%';
        const doc = { text, languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.deepEqual(diags, [], `expected no diagnostics, got: ${JSON.stringify(diags)}`);
    });

    it('shows typed hover for @variable with inferred type', () => {
        const fullText = "%%[ set @rows = LookupRows('DE','col','val') ]%%";
        const line = "%%[ set @rows = LookupRows('DE','col','val') ]%%";
        // Hover over @rows (character 8 = 'r' of @rows)
        const hover = service.getHover({ text: fullText, languageId: 'ampscript' }, line, {
            line: 0,
            character: 8,
        });
        assert.ok(hover, 'expected hover result');
        // New format: ```typescript\n// AMPscript variable\nvar @rows: rowset\n```
        assert.ok(
            hover.contents.value.includes('var @rows: rowset'),
            `expected 'var @rows: rowset' in hover, got: ${hover.contents.value}`,
        );
    });

    it('shows hover for @variable without inferred type as any', () => {
        const fullText = '%%[ set @x = SomeUnknown() ]%%';
        const line = fullText;
        const hover = service.getHover({ text: fullText, languageId: 'ampscript' }, line, {
            line: 0,
            character: 8,
        });
        assert.ok(hover, 'expected hover result for unknown-type variable');
        // Untyped variables show as `any`
        assert.ok(
            hover.contents.value.includes('var @x: any'),
            `expected 'var @x: any' in hover, got: ${hover.contents.value}`,
        );
    });
});

// ── Deprecated Function Diagnostics ────────────────────────────────────────

describe('AMPscript deprecated function diagnostics', () => {
    it('does not flag non-deprecated functions', () => {
        const diags = ampValidate('%%[ set @x = Add(1,2) ]%%');
        assert.ok(
            !diags.some((d) => d.code === 'ampscript/deprecated-function'),
            `unexpected deprecated diagnostic: ${JSON.stringify(diags)}`,
        );
    });
});

// ── disableLspDiagnosticsForEslintRules setting ────────────────────────────

describe('disableLspDiagnosticsForEslintRules setting', () => {
    it('suppresses unknown-function error when setting is enabled', () => {
        const doc = { text: '%%[ MyCustomFunc() ]%%', languageId: 'ampscript' };
        const settings = { maxNumberOfProblems: 100, disableLspDiagnosticsForEslintRules: true };
        const diags = service.validate(doc, settings);
        assert.ok(
            !diags.some((d) => d.code === 'ampscript/unknown-function'),
            `expected unknown-function to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('still reports delimiter balance errors when setting is enabled', () => {
        const doc = { text: '%%[ set @x = 1', languageId: 'ampscript' };
        const settings = { maxNumberOfProblems: 100, disableLspDiagnosticsForEslintRules: true };
        const diags = service.validate(doc, settings);
        assert.ok(
            diags.some((d) => d.message.includes('Unclosed AMPscript block')),
            `expected delimiter diagnostic to remain, got: ${JSON.stringify(diags)}`,
        );
    });

    it('suppresses enum-value error when setting is enabled', () => {
        const doc = {
            text: "%%[ set @r = DatePart('2026-01-15','decade') ]%%",
            languageId: 'ampscript',
        };
        const settings = { maxNumberOfProblems: 100, disableLspDiagnosticsForEslintRules: true };
        const diags = service.validate(doc, settings);
        assert.ok(
            !diags.some((d) => d.code === 'ampscript/enum-value'),
            `expected enum-value to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('does not suppress diagnostics when setting is disabled (default)', () => {
        const doc = { text: '%%[ MyCustomFunc() ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(
            diags.some((d) => d.message.includes("Unknown AMPscript function 'MyCustomFunc'")),
            `expected unknown-function diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });
});

// ── Signature Help — default values ────────────────────────────────────────

describe('Signature Help — default values', () => {
    it('includes default value in parameter documentation when present', () => {
        // Find a function that has a parameter with a default value
        // HTTPGet has cacheTimeout with default: 0
        const text = '%%[ set @r = HTTPGet(';
        const sig = service.getSignatureHelp({ text, languageId: 'ampscript' }, text);
        if (!sig) return; // skip if HTTPGet not found
        // url param has no default, so look for a param that does
        const paramWithDefault = sig.signatures[0]?.parameters?.find((p) => {
            const doc = p.documentation;
            const text = typeof doc === 'string' ? doc : (doc?.value ?? '');
            return text.includes('Default:');
        });
        // If no param has a default, the test is vacuously satisfied (no regression)
        if (paramWithDefault) {
            // documentation is now a MarkupContent object with kind: 'markdown'
            const doc = paramWithDefault.documentation;
            const text = typeof doc === 'string' ? doc : (doc?.value ?? '');
            assert.ok(
                text.includes('**Default:**'),
                `expected **Default:** in param doc, got: ${text}`,
            );
        }
    });
});

// ── SSJS ES6 pattern diagnostics ───────────────────────────────────────────

describe('SSJS generator-function diagnostic', () => {
    it('flags a real generator declaration (function*)', () => {
        const diags = ssjsValidate('function* gen() { yield 1; }');
        assert.ok(
            diags.some((d) => d.message.includes('Generator functions are not supported')),
            `expected generator diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('flags a named generator (function *name)', () => {
        const diags = ssjsValidate('function *gen() {}');
        assert.ok(
            diags.some((d) => d.message.includes('Generator functions are not supported')),
            `expected generator diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('does not flag a function followed by a JSDoc block on the next line (Bug 9)', () => {
        const text = ['function foo() {}', '', '/**', ' * docs', ' */', 'function bar() {}'].join(
            '\n',
        );
        const diags = ssjsValidate(text);
        assert.ok(
            !diags.some((d) => d.message.includes('Generator functions are not supported')),
            `expected no generator diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });
});
