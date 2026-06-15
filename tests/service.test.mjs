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

    // ── AMPscript repeat-group activeParameter (#1) ──
    it('Concat: single repeat group cycles on the last param slot', () => {
        // params: string1(0), string2(1), stringN(2); repeat {start:0,size:1}
        // 4th arg (index 3) folds back to slot 0.
        const sig = ampSig("%%=Concat('a','b','c',");
        assert.ok(sig, 'expected signature help for Concat');
        assert.strictEqual(sig.activeParameter, 0, '4th Concat arg should map to slot 0');
    });

    it('HTTPPost2: header pairs cycle within the two-param group', () => {
        // repeat {start:6,size:2}. Index 6 -> headerName1 (6), index 7 -> headerValue1 (7),
        // index 8 -> back to headerName1 (6).
        const base = '%%=HTTPPost2(url,ct,body,false,@r,@rs,';
        assert.strictEqual(ampSig(base).activeParameter, 6, 'index 6 -> headerName slot');
        assert.strictEqual(ampSig(base + 'n1,').activeParameter, 7, 'index 7 -> headerValue slot');
        assert.strictEqual(
            ampSig(base + 'n1,v1,').activeParameter,
            6,
            'index 8 -> back to headerName slot',
        );
    });

    it('UpsertData: countParam splits search block from upsert block', () => {
        // params: dataExt(0), columnValuePairs(1), searchColumnName1(2), searchValue1(3),
        //   searchColumnNameN(4), searchValueN(5), columnToUpsert1(6), upsertedValue1(7) ...
        // group1 {start:2,size:2,countParam:columnValuePairs}, group2 {start:4,size:2}
        // With columnValuePairs = 1, searchBlockEnd = 2 + 1*2 = 4.
        // paramIndex 4 (>= searchBlockEnd) -> group2 slot: 4 + ((4-4)%2) = 4 (the upsert/N slot).
        const c1 = "%%=UpsertData('DE',1,'k','v',";
        assert.strictEqual(
            ampSig(c1).activeParameter,
            4,
            'index 4 with count=1 -> upsert (group2) slot',
        );

        // With columnValuePairs = 2, searchBlockEnd = 2 + 2*2 = 6.
        // paramIndex 4 (< searchBlockEnd) -> group1 slot: 2 + ((4-2)%2) = 2 (still in search block).
        const c2 = "%%=UpsertData('DE',2,'k1','v1',";
        assert.strictEqual(
            ampSig(c2).activeParameter,
            2,
            'index 4 with count=2 -> back to search slot',
        );
    });
});
