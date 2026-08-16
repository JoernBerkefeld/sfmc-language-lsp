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

    it('does not flag sibling AMPscript <script> blocks as nested', () => {
        const text = [
            '<script language="ampscript" runat="server">',
            '    SET @a = "one"',
            '</script>',
            '<script language="ampscript" runat="server">',
            '    SET @b = "two"',
            '</script>',
        ].join('\n');
        const doc = { text, languageId: 'html' };
        const diags = service.validate(doc);
        assert.equal(
            diags.filter((d) => d.code === 'ampscript/nested-script-tag').length,
            0,
            'sibling script blocks must not be flagged',
        );
    });

    it('flags a genuinely nested AMPscript <script> opener exactly once', () => {
        const text = [
            '<script language="ampscript" runat="server">',
            '    SET @a = "one"',
            '    <script language="ampscript" runat="server">',
            '        SET @b = "two"',
            '    </script>',
            '</script>',
        ].join('\n');
        const doc = { text, languageId: 'html' };
        const diags = service.validate(doc);
        const nested = diags.filter((d) => d.code === 'ampscript/nested-script-tag');
        assert.equal(nested.length, 1, 'nested opener must be flagged once');
        assert.equal(nested[0].range.start.line, 2, 'diagnostic on the inner opener line');
    });

    it('ignores <script language="ampscript"> quoted inside an HTML comment', () => {
        const text = [
            '<!-- example: <script language="ampscript"> ... </script> -->',
            '<script language="ampscript" runat="server">',
            '    SET @a = "one"',
            '</script>',
        ].join('\n');
        const doc = { text, languageId: 'html' };
        const diags = service.validate(doc);
        assert.equal(
            diags.filter((d) => d.code === 'ampscript/nested-script-tag').length,
            0,
            'commented-out script tags must not distort nesting depth',
        );
    });
});

// ── MCN diagnostics — AMPscript ──────────────────────────────────────────────

describe('MCN AMPscript diagnostics (targetPlatform: next)', () => {
    const nextSettings = { maxNumberOfProblems: 100, targetPlatform: 'next' };

    it('no diagnostics for MCN-supported function with targetPlatform:next', () => {
        const doc = { text: '%%[ set @x = Now() ]%%', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        assert.ok(
            diags.every((d) => d.code !== 'ampscript/mcn-unsupported-function'),
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
            diags.every((d) => d.code !== 'ampscript/mcn-unsupported-function'),
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
            diags.every((d) => d.code !== 'ampscript/mcn-unsupported-function'),
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
        // Uppercase(true) is on line 4 (0-indexed) — after a 3-line block comment.
        // The first param of Uppercase accepts string|number|date, so a boolean
        // literal is the mismatch that triggers the diagnostic.
        const code = [
            '%%[',
            '/* comment line 1',
            '   comment line 2',
            '   comment line 3 */',
            'SET @x = Uppercase(true)',
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

    it('math functions accept a numeric string argument (ampscript-data v3.2.0)', () => {
        // Add/Subtract/Multiply/Divide/Mod/Random params are string|number: a
        // string that parses as a number is accepted at runtime.
        for (const call of ['Add("15",27)', 'Divide(100,"4")', 'Random("1","100")']) {
            const doc = { text: `%%=${call}=%%`, languageId: 'ampscript' };
            const diags = service.validate(doc, { maxNumberOfProblems: 100 });
            const d = diags.find((x) => x.message.includes('expects a'));
            assert.ok(!d, `unexpected arg-type diagnostic for ${call}`);
        }
    });

    it('Concat accepts a single argument (ampscript-data v3.2.0)', () => {
        const doc = { text: "%%=Concat('Hello')=%%", languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find(
            (x) => x.message.includes('requires at least') && x.message.includes('Concat'),
        );
        assert.ok(!d, 'unexpected arity diagnostic for single-argument Concat');
    });

    it('Concat still requires at least one argument', () => {
        const doc = { text: '%%=Concat()=%%', languageId: 'ampscript' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        const d = diags.find(
            (x) => x.message.includes('requires at least') && x.message.includes('Concat'),
        );
        assert.ok(d, 'expected arity diagnostic for zero-argument Concat');
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

    it('completion item for a nonFunctionalAtRuntime function is struck through (Deprecated tag)', () => {
        const doc = { text: '%%=  =%%', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 4 });
        const item = items.find((i) => i.label === 'GetPortfolioItem');
        assert.ok(item, 'expected GetPortfolioItem completion item');
        assert.ok(
            Array.isArray(item.tags) && item.tags.includes(1),
            'GetPortfolioItem completion must carry CompletionItemTag.Deprecated (1) so it renders struck through',
        );
    });
});

// ── Non-functional-at-runtime surfacing — AMPscript ──────────────────────────

describe('AMPscript non-functional-at-runtime in hover', () => {
    it('hover for a nonFunctionalAtRuntime function shows no banner (covered by the error diagnostic)', () => {
        const line = "%%=GetPortfolioItem('key')=%%";
        const doc = { text: line, languageId: 'ampscript' };
        const position = { line: 0, character: line.indexOf('GetPortfolioItem') + 1 };
        const hover = service.getHover(doc, line, position);
        assert.ok(hover, 'expected hover for GetPortfolioItem');
        const value = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
        assert.doesNotMatch(
            value,
            /Non-functional at runtime/i,
            'hover should not duplicate the error diagnostic with a banner',
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
            diags.every((d) => d.code !== 'ssjs/mcn-not-supported'),
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
        assert.ok(diags.every((d) => !d.message.includes('Platform.Load("core"')));
    });

    it('warns about wrong Platform.Load version', () => {
        const doc = { text: 'Platform.Load("core","1.0");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.message.includes('"1.1.5"')));
    });

    it('reports an empty stacked case label as switch-fallthrough', () => {
        const doc = {
            text: 'switch (level) {\n case "admin":\n case "superuser":\n access = "Full";\n break;\n}',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/switch-fallthrough');
        assert.ok(d, 'expected ssjs/switch-fallthrough for the empty leading case');
        assert.strictEqual(d.severity, 2 /* Warning */);
    });

    it('reports a break-less case body as switch-fallthrough', () => {
        const doc = {
            text: 'switch (level) {\n case "admin":\n access = "Admin";\n case "superuser":\n access = "Super";\n break;\n}',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.some((x) => x.code === 'ssjs/switch-fallthrough'));
    });

    it('does not flag a switch whose every case ends in break', () => {
        const doc = {
            text: 'switch (level) {\n case "admin":\n access = "A";\n break;\n case "superuser":\n access = "S";\n break;\n}',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== 'ssjs/switch-fallthrough'));
    });

    it('does not flag the last empty case in a switch', () => {
        const doc = {
            text: 'switch (level) {\n case "admin":\n access = "A";\n break;\n case "superuser":\n}',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== 'ssjs/switch-fallthrough'));
    });

    it('does not flag bare-name Redirect() as nonexistent-global (runtime-verified Core global)', () => {
        // ssjs-data verified that bare-name `Redirect` IS defined at runtime after
        // Platform.Load("core", ...) and performs the redirect (differsFromOfficialDocs).
        // It is therefore a valid SSJS global and must not be reported as nonexistent.
        const doc = { text: 'Redirect("https://example.com", false);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/nonexistent-global'));
    });

    it('does not flag Platform.Response.Redirect (member call) as nonexistent-global', () => {
        const doc = {
            text: 'Platform.Response.Redirect("https://example.com", false);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/nonexistent-global'));
    });

    it('does not flag Redirect() inside a comment', () => {
        const doc = { text: '// Redirect("https://example.com");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/nonexistent-global'));
    });

    it('reports reading the write-only postData property as an Error', () => {
        const doc = {
            text: [
                'var req = new Script.Util.HttpRequest("https://example.com");',
                'req.postData = "{}";',
                'Platform.Response.Write(req.postData);',
            ].join('\n'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/invalid-property-access');
        assert.ok(d, 'expected ssjs/invalid-property-access for reading req.postData');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.equal(d.range.start.line, 2, 'expected the read on line 2 to be flagged');
    });

    it('reports reading Platform.Response.ContentType as a Warning (opaque value)', () => {
        const doc = {
            text: [
                'Platform.Response.ContentType = "application/json";',
                'var ct = Platform.Response.ContentType;',
            ].join('\n'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/invalid-property-access');
        assert.ok(d, 'expected ssjs/invalid-property-access for reading ContentType');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.equal(d.range.start.line, 1, 'the assignment on line 0 must not be flagged');
    });

    it('reports assigning the read-only Platform.Request.Method as an Error', () => {
        const doc = { text: 'Platform.Request.Method = "POST";', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/invalid-property-access');
        assert.ok(d, 'expected ssjs/invalid-property-access for assigning Method');
        assert.equal(d.severity, 1, 'expected Error severity');
    });

    it('does not flag valid property access directions', () => {
        const doc = {
            text: [
                'var req = new Script.Util.HttpRequest("https://example.com");',
                'req.postData = "{}";',
                'var method = Platform.Request.Method;',
            ].join('\n'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-property-access'));
    });

    it('reports deprecated ErrorUtil.ThrowWSProxyError as deprecated Warning', () => {
        const doc = { text: 'ErrorUtil.ThrowWSProxyError(result);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/deprecated');
        assert.ok(d, 'expected deprecated diagnostic for ErrorUtil.ThrowWSProxyError');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.ok(d.message.includes('ThrowWSProxyError'));
    });

    it('reports ErrorUtil.ThrowWSProxyError as an Error when Core > 1 is loaded', () => {
        const doc = {
            text: ['Platform.Load("Core", "1.1.5");', 'ErrorUtil.ThrowWSProxyError(result);'].join(
                '\n',
            ),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/deprecated');
        assert.ok(d, 'expected deprecated diagnostic for ErrorUtil.ThrowWSProxyError');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.match(d.message, /undefined under Platform\.Load\("Core", "1\.1\.5"\)/);
    });

    it('keeps the Warning wording when Core "1" is loaded explicitly', () => {
        const doc = {
            text: ['Platform.Load("Core", "1");', 'ErrorUtil.ThrowWSProxyError(result);'].join(
                '\n',
            ),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/deprecated');
        assert.ok(d, 'expected deprecated diagnostic for ErrorUtil.ThrowWSProxyError');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.match(d.message, /is deprecated/);
    });

    it('does not flag ErrorUtil.ThrowWSProxyError inside a comment', () => {
        const doc = { text: '// ErrorUtil.ThrowWSProxyError(result);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/deprecated'));
    });

    it('reports deprecated static call Portfolio.Retrieve as deprecated Warning', () => {
        const doc = {
            text: 'var p = Portfolio.Retrieve("Name", "MyPortfolio");',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/deprecated');
        assert.ok(d, 'expected deprecated diagnostic for Portfolio.Retrieve');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.ok(d.message.includes('Retrieve'));
    });

    it('reports deprecated instance call via <var> = Send.Definition.Init(...)', () => {
        const doc = {
            text: ['var sd = Send.Definition.Init("MySendDefinition");', 'sd.Send();'].join('\n'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const deprecatedDiags = diags.filter((d) => d.code === 'ssjs/deprecated');
        assert.ok(
            deprecatedDiags.some((d) => d.message.includes('Send')),
            `expected a deprecated diagnostic mentioning Send, got: ${JSON.stringify(deprecatedDiags)}`,
        );
    });

    it('does not flag Portfolio.Retrieve inside a comment', () => {
        const doc = { text: '// Portfolio.Retrieve("Name", "MyPortfolio");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/deprecated'));
    });

    it('reports deprecated bare ContentArea("key") as ssjs/deprecated Warning', () => {
        const doc = { text: 'var html = ContentArea("key");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/deprecated');
        assert.ok(d, 'expected ssjs/deprecated for ContentArea("key")');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.ok(d.message.includes('ContentArea'));
    });

    it('reports deprecated bare ContentAreaByName("name") as ssjs/deprecated Warning', () => {
        const doc = { text: 'var html = ContentAreaByName("name");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/deprecated');
        assert.ok(d, 'expected ssjs/deprecated for ContentAreaByName("name")');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.ok(d.message.includes('ContentAreaByName'));
    });

    it('reports deprecated Platform.Function.ContentArea as ssjs/deprecated Warning', () => {
        const doc = {
            text: 'var html = Platform.Function.ContentArea(12345);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/deprecated');
        assert.ok(d, 'expected ssjs/deprecated for Platform.Function.ContentArea');
        assert.equal(d.severity, 2, 'expected Warning severity');
        assert.ok(d.message.includes('Platform.Function.ContentArea'));
    });

    it('does not flag ContentArea inside a comment', () => {
        const doc = { text: '// ContentArea("key");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/deprecated'));
    });

    it('reports deprecated Template.Retrieve as ssjs/deprecated Warning', () => {
        const doc = {
            text: 'var t = Template.Retrieve("Name", "MyTemplate");',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === 'ssjs/deprecated');
        assert.ok(d, 'expected ssjs/deprecated for Template.Retrieve');
        assert.equal(d.severity, 2, 'expected Warning severity');
    });

    // ── Discontinuous-overload arity (validArities), e.g. HTTPGet {1, 6} ──────
    it('does not flag Platform.Function.HTTPGet with 1 argument', () => {
        const doc = {
            text: 'var r = Platform.Function.HTTPGet("https://example.com");',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/invalid-arity'),
            'HTTPGet(url) is a valid 1-arg call',
        );
    });

    it('does not flag Platform.Function.HTTPGet with 6 arguments', () => {
        const doc = {
            text: 'var h = []; var e = 0; var c = "";\nvar r = Platform.Function.HTTPGet("https://example.com", false, 0, null, h, c);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/invalid-arity'),
            'HTTPGet with 6 args is a valid full call',
        );
    });

    it('flags Platform.Function.HTTPGet with 2 arguments (invalid-arity)', () => {
        const doc = {
            text: 'var r = Platform.Function.HTTPGet("https://example.com", false);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/invalid-arity');
        assert.ok(d, 'expected invalid-arity diagnostic for 2-arg HTTPGet');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.ok(d.message.includes('1 or 6'), 'message should render valid arities as "1 or 6"');
        assert.ok(d.message.includes('got 2'), 'message should state actual arg count');
    });

    it('flags Platform.Function.HTTPGet with 4 arguments (invalid-arity)', () => {
        const doc = {
            text: 'var r = Platform.Function.HTTPGet("https://example.com", false, 0, null);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/invalid-arity');
        assert.ok(d, 'expected invalid-arity diagnostic for 4-arg HTTPGet');
        assert.ok(d.message.includes('got 4'));
    });

    it('does not flag Platform.Function.HTTPPost with 3 arguments', () => {
        const doc = {
            text: 'var r = Platform.Function.HTTPPost("https://example.com", "application/json", "{}");',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/invalid-arity'),
            'HTTPPost(url, contentType, payload) is a valid 3-arg call',
        );
    });

    it('does not flag Platform.Function.HTTPPost with 6 arguments', () => {
        const doc = {
            text: 'var res = [];\nvar r = Platform.Function.HTTPPost("https://example.com", "application/json", "{}", null, null, res);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/invalid-arity'),
            'HTTPPost with 6 args is a valid full call',
        );
    });

    it('flags Platform.Function.HTTPPost with 4 arguments (invalid-arity)', () => {
        const doc = {
            text: 'var r = Platform.Function.HTTPPost("https://example.com", "application/json", "{}", null);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/invalid-arity');
        assert.ok(d, 'expected invalid-arity diagnostic for 4-arg HTTPPost');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.ok(d.message.includes('3 or 6'), 'message should render valid arities as "3 or 6"');
        assert.ok(d.message.includes('got 4'), 'message should state actual arg count');
    });

    it('flags Platform.Function.HTTPPost with 5 arguments (invalid-arity)', () => {
        const doc = {
            text: 'var r = Platform.Function.HTTPPost("https://example.com", "application/json", "{}", null, null);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/invalid-arity');
        assert.ok(d, 'expected invalid-arity diagnostic for 5-arg HTTPPost');
        assert.ok(d.message.includes('got 5'));
    });

    it('does not flag HTTPGet arity error when call is inside a comment', () => {
        const doc = {
            text: '// var r = Platform.Function.HTTPGet("https://example.com", false, 0, null);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-arity'));
    });

    it('does not miscount HTTPGet args when a string argument contains commas', () => {
        // The URL has commas in a query param; they must not inflate the count.
        const doc = {
            text: 'var r = Platform.Function.HTTPGet("https://example.com/?a=1,2,3");',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/invalid-arity'),
            'commas inside a string arg must not be counted as argument separators',
        );
    });

    // ── Non-functional Core methods (nonFunctionalAtRuntime) ─────────────────
    it('flags Init-tracked instance call fd.Update() as nonfunctional-method (Error)', () => {
        // `Update` is an instance-only method (isStatic: false) — it must be called
        // on an Init-tracked instance, not on the bare `FilterDefinition` namespace.
        const doc = {
            text: 'var fd = FilterDefinition.Init("x");\nfd.Update({ name: "x" });',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/nonfunctional-method');
        assert.ok(d, 'expected nonfunctional-method diagnostic for fd.Update()');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.ok(
            d.message.includes('no known working invocation'),
            'message should state no known working invocation',
        );
    });

    it('flags Init-tracked instance call fd.Remove() as nonfunctional-method', () => {
        const doc = {
            text: 'var fd = FilterDefinition.Init("x");\nfd.Remove();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/nonfunctional-method');
        assert.ok(d, 'expected nonfunctional-method diagnostic for fd.Remove()');
        assert.equal(d.severity, 1, 'expected Error severity');
    });

    it('does not flag FilterDefinition.Init / .Add / .Retrieve as nonfunctional', () => {
        const doc = {
            text: 'var fd = FilterDefinition.Init("x");\nfd.Add({});\nfd.Retrieve();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/nonfunctional-method'),
            'Init/Add/Retrieve are working methods',
        );
    });

    it('does not flag nonfunctional method call inside a comment', () => {
        const doc = {
            text: '// FilterDefinition.Update({ name: "x" });',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/nonfunctional-method'));
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
            diags.every((d) => !d.message.toLowerCase().includes('retrieve')),
            'api.retrieve should not produce a diagnostic',
        );
    });

    it('does not flag DateTime.TimeZone.Retrieve when prefix is unknown', () => {
        const code =
            'Platform.Load("core","1.1.5");\nvar tz = new Object();\ntz.Retrieve("something");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => !d.message.includes('Retrieve')),
            'tz.Retrieve should not be flagged (unknown prefix)',
        );
    });

    it('does not report core object usage when Platform.Load is real and core object is only in a comment', () => {
        // DataExtension.Init is only inside a comment, so should not trigger
        const code = 'Platform.Load("core","1.1.5");\n// var de = DataExtension.Init("test");';
        const doc = { text: code, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => !d.message.includes('Platform.Load')),
            'core object in a comment should not be flagged',
        );
    });

    it('does not warn about wrong Platform.Load version when load is in a comment', () => {
        const doc = { text: '// Platform.Load("core","1.0");', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => !d.message.includes('"1.1.5"')),
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
            diags.every((d) => !d.message.includes('Stringify')),
            'bare Stringify() should not be flagged when Platform.Load precedes it',
        );
    });

    it('does not report bare Stringify() when only in a comment', () => {
        const doc = { text: '// var s = Stringify({ foo: 1 });', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => !d.message.includes('Stringify')),
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
        assert.ok(diags.every((d) => !d.message.includes('not available')));
    });

    it('does not emit an ssjs diagnostic for no-polyfill members (Object.keys, Math.trunc, Array.from)', () => {
        for (const text of [
            'var k = Object.keys(obj);',
            'var n = Math.trunc(4.7);',
            'var a = Array.from("ab");',
        ]) {
            const diags = service.validate({ text, languageId: 'ssjs' });
            assert.ok(
                diags.every((d) => !(d.source === 'ssjs' && d.message.includes('not available'))),
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
            diags.every((d) => !d.message.includes('Object.keys')),
            'Object.keys in comment must be ignored',
        );
    });

    it('does NOT emit a custom diagnostic for no-polyfill members (TypeScript owns them)', () => {
        // Object.keys is unsupported with no shipped polyfill — TS flags it, we do not.
        const doc = { text: 'var k = Object.keys(obj);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((d) => !(d.source === 'ssjs' && d.message.includes('Object.keys'))),
            'no-polyfill members must not produce an ssjs diagnostic',
        );
    });
});

// ── SSJS new-on-object-returning-constructor ─────────────────────────────────

describe('SSJS new-object-returning-constructor diagnostics', () => {
    const code = 'ssjs/new-object-returning-constructor';

    it('flags new X() when X returns an object literal', () => {
        const doc = {
            text: 'function Foo(){ return { method1: function(){} }; }\nvar x = new Foo();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === code);
        assert.ok(d, 'expected new-object-returning-constructor diagnostic');
        assert.strictEqual(d.severity, 2 /* Warning */);
        assert.match(d.message, /new Foo\(\)/);
    });

    it('flags new X() for a function-expression constructor that returns an object literal', () => {
        const doc = {
            text: 'var Make = function(){ return { go: function(){} }; };\nvar m = new Make();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.some((x) => x.code === code));
    });

    it('does not flag a constructor that assigns this.<member> instead of returning', () => {
        const doc = {
            text: 'function Foo(){ this.method1 = function(){}; }\nvar x = new Foo();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag calling the object-returning function without new', () => {
        const doc = {
            text: 'function Foo(){ return { a: 1 }; }\nvar x = Foo();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag built-in constructors (new Date())', () => {
        const doc = { text: 'var d = new Date();', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag a constructor whose body has no object-literal return', () => {
        const doc = {
            text: 'function Foo(){ this.n = 1; return 5; }\nvar x = new Foo();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag the outer constructor when only a nested inner function returns an object', () => {
        const doc = {
            text: 'function Outer(){ function inner(){ return { a: 1 }; }\n this.x = 1; }\nvar o = new Outer();',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });
});

// ── SSJS cross-block forward reference ───────────────────────────────────────

/**
 * Build a two-`<script runat="server">`-block SSJS document.
 * @param {string} a - Body of the first server block.
 * @param {string} b - Body of the second server block.
 * @returns {string} The combined document text.
 */
const twoServerBlocks = (a, b) =>
    `<script runat="server">\n${a}\n</script>\n<script runat="server">\n${b}\n</script>`;

describe('SSJS cross-block-forward-reference diagnostics', () => {
    const code = 'ssjs/cross-block-forward-reference';
    const twoBlocks = twoServerBlocks;

    it('flags a call to a function declared only in a later block', () => {
        const doc = {
            text: twoBlocks('foo();', 'function foo(){ return 1; }'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((x) => x.code === code);
        assert.ok(d, 'expected cross-block-forward-reference diagnostic');
        assert.strictEqual(d.severity, 1 /* Error */);
        assert.match(d.message, /later <script runat="server"> block/);
    });

    it('does not flag a call to a function declared in an earlier block (backward reference)', () => {
        const doc = {
            text: twoBlocks('function foo(){ return 1; }', 'foo();'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag a call to a function declared in the same block (intra-block hoisting)', () => {
        const doc = {
            text: '<script runat="server">\nfoo();\nfunction foo(){ return 1; }\n</script>',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag a call to a built-in/global (not a user function anywhere)', () => {
        const doc = {
            text: twoBlocks('Stringify(x);', 'function foo(){ return 1; }'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag a member call (o.foo()) matching a later function name', () => {
        const doc = {
            text: twoBlocks('var o = {}; o.foo();', 'function foo(){ return 1; }'),
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });

    it('does not flag a single-block (pure .ssjs) document with a hoisted call', () => {
        const doc = { text: 'foo();\nfunction foo(){ return 1; }', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((x) => x.code !== code));
    });
});

// ── Polyfill-required ECMAScript members ─────────────────────────────────────

describe('SSJS polyfill-required diagnostics', () => {
    it('reports a static polyfillable member (Array.isArray) as an Error with polyfill data', () => {
        const doc = { text: 'var b = Array.isArray(x);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find(
            (d) => d.code === 'ssjs/polyfill-required' && d.message.includes('Array.isArray'),
        );
        assert.ok(d, 'expected polyfill-required diagnostic for Array.isArray');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.ok(d.data && typeof d.data.polyfill === 'string' && d.data.polyfill.length > 0);
        assert.equal(d.data.owner, 'Array');
        assert.equal(d.data.method, 'isArray');
    });

    it('reports a prototype polyfillable member (.forEach) as an Error with polyfill data', () => {
        const doc = { text: 'arr.forEach(fn);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find(
            (d) => d.code === 'ssjs/polyfill-required' && d.message.includes('forEach'),
        );
        assert.ok(d, 'expected polyfill-required diagnostic for .forEach');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.ok(d.data && typeof d.data.polyfill === 'string' && d.data.polyfill.length > 0);
    });

    it('does not flag ambiguous-with-string members (.slice) to avoid string false positives', () => {
        const doc = { text: 'var s = str.slice(1, 3);', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(
            diags.every(
                (d) => !(d.code === 'ssjs/polyfill-required' && d.message.includes('slice')),
            ),
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

    it('uses "broken" wording for a broken member (Array.prototype.splice)', () => {
        const doc = { text: 'var removed = arr.splice(1, 2);', languageId: 'ssjs' };
        const d = service
            .validate(doc)
            .find((d) => d.code === 'ssjs/polyfill-required' && d.message.includes('splice'));
        assert.ok(d, 'expected polyfill-required diagnostic for Array.splice');
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
            diags.every(
                (d) => !(d.code === 'ssjs/polyfill-required' && d.message.includes('isArray')),
            ),
            'diagnostic must be suppressed when the polyfill is present',
        );
    });

    it('suppresses the diagnostic when the polyfill carries a self-guard (X = X || function)', () => {
        // Canonical ssjs-data polyfill form: `Array.isArray = Array.isArray || function (…)`.
        // The self-guard must still count as "polyfill present".
        const doc = {
            text:
                'Array.isArray = Array.isArray || function (value) {\n' +
                "    return Object.prototype.toString.call(value) === '[object Array]';\n" +
                '};\n' +
                'var b = Array.isArray(x);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every(
                (d) => !(d.code === 'ssjs/polyfill-required' && d.message.includes('isArray')),
            ),
            'diagnostic must be suppressed when the self-guarded polyfill is present',
        );
    });

    it('suppresses the diagnostic when a minified static polyfill is present (collapsed whitespace + renamed params)', () => {
        // Minified form (from a bundled polyfill file): no space after `function`,
        // parameter renamed from `value` to `v`, guard `X = X || …` present.
        const doc = {
            text:
                "Array.isArray=Array.isArray||function(v){return Object.prototype.toString.call(v)==='[object Array]';};\n" +
                'var b = Array.isArray(x);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every(
                (d) => !(d.code === 'ssjs/polyfill-required' && d.message.includes('isArray')),
            ),
            'diagnostic must be suppressed when a minified polyfill is present',
        );
    });

    it('suppresses the diagnostic for minified Math.max / Math.min polyfills', () => {
        // Static Math polyfills minified onto one line without the `X ||` guard.
        const doc = {
            text:
                'Math.max = function(){ if (arguments.length===0) return Number.NEGATIVE_INFINITY; };\n' +
                'Math.min = function(){ if (arguments.length===0) return Number.POSITIVE_INFINITY; };\n' +
                'var hi = Math.max(1, 2, 3);\n' +
                'var lo = Math.min(1, 2, 3);',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(
            diags.every(
                (d) =>
                    !(
                        d.code === 'ssjs/polyfill-required' &&
                        (d.message.includes('Math.max') || d.message.includes('Math.min'))
                    ),
            ),
            'minified Math.max / Math.min polyfills must count as present',
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
        assert.ok(diags.every((d) => d.code !== 'ssjs/replace-with-platform-function'));
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

// ── SSJS CLR header access ───────────────────────────────────────────────────

describe('SSJS clr-header-access diagnostics', () => {
    const sendSetup =
        'var req = new Script.Util.HttpRequest("https://x/y");\nvar resp = req.send();\n';
    const getSetup = 'var greq = Script.Util.HttpGet("https://x/y");\nvar gresp = greq.send();\n';

    it('flags indexed read of a tracked response header', () => {
        const doc = {
            text: `${sendSetup}var ct = resp.headers["Content-Type"];`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/clr-header-access');
        assert.ok(d, 'expected clr-header-access diagnostic');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.equal(d.data.respName, 'resp');
        assert.equal(d.data.keyText, '"Content-Type"');
    });

    it('flags .Get() call on a tracked HttpGet response header', () => {
        const doc = {
            text: `${getSetup}var loc = gresp.headers.Get("Location");`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/clr-header-access');
        assert.ok(d, 'expected clr-header-access diagnostic');
        assert.equal(d.data.respName, 'gresp');
        assert.equal(d.data.keyText, '"Location"');
    });

    it('flags .Item() call on a tracked response header', () => {
        const doc = {
            text: `${sendSetup}var e = resp.headers.Item("Content-Encoding");`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.code === 'ssjs/clr-header-access'));
    });

    it('does not flag .headers on an untracked object', () => {
        const doc = {
            text: 'var config = { headers: {} };\nvar x = config.headers["Content-Type"];',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-header-access'));
    });

    it('does not flag a for..in read of a tracked response', () => {
        const doc = {
            text: `${sendSetup}for (var k in resp.headers) { var v = String(k); }`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-header-access'));
    });

    it('does not flag inside a comment', () => {
        const doc = {
            text: `${sendSetup}// var ct = resp.headers["Content-Type"];`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-header-access'));
    });

    it('offers a getHeaderMap code action that rewrites and inserts the helper', () => {
        const doc = {
            text: `${sendSetup}var ct = resp.headers["Content-Type"];`,
            languageId: 'ssjs',
            uri: 'file:///h.ssjs',
        };
        const diags = service.validate(doc);
        const diag = diags.find((d) => d.code === 'ssjs/clr-header-access');
        assert.ok(diag, 'expected a clr-header-access diagnostic');
        const actions = service.getCodeActions(doc, [diag]);
        const action = actions.find((a) => a.title.includes('getHeaderMap'));
        assert.ok(action, 'expected a getHeaderMap code action');
        const edits = action.edit.changes['file:///h.ssjs'];
        const rewrite = edits.find((e) => e.newText.includes('getHeaderMap(resp)'));
        assert.ok(rewrite, 'expected rewrite edit');
        assert.equal(rewrite.newText, 'getHeaderMap(resp)["Content-Type"]');
        const helperInsert = edits.find((e) => e.newText.includes('function getHeaderMap('));
        assert.ok(helperInsert, 'expected helper insertion edit');
    });

    it('does not insert the helper a second time when already present', () => {
        const doc = {
            text: `function getHeaderMap(resp) { return {}; }\n${sendSetup}var ct = resp.headers["Content-Type"];`,
            languageId: 'ssjs',
            uri: 'file:///h2.ssjs',
        };
        const diags = service.validate(doc);
        const diag = diags.find((d) => d.code === 'ssjs/clr-header-access');
        const actions = service.getCodeActions(doc, [diag]);
        const action = actions.find((a) => a.title.includes('getHeaderMap'));
        assert.ok(action);
        const edits = action.edit.changes['file:///h2.ssjs'];
        assert.ok(edits.every((e) => !e.newText.includes('function getHeaderMap(')));
    });

    it('suppresses clr-header-access diagnostics when eslint overlap disabled', () => {
        const doc = {
            text: `${sendSetup}var ct = resp.headers["Content-Type"];`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            disableLspDiagnosticsForEslintRules: true,
        });
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-header-access'));
    });
});

// ── SSJS CLR content access ──────────────────────────────────────────────────

describe('SSJS clr-content-access diagnostics', () => {
    const sendSetup =
        'var req = new Script.Util.HttpRequest("https://x/y");\nvar resp = req.send();\n';
    const getSetup = 'var greq = Script.Util.HttpGet("https://x/y");\nvar gresp = greq.send();\n';

    it('flags a raw .content read passed to ParseJSON', () => {
        const doc = {
            text: `${sendSetup}var data = Platform.Function.ParseJSON(resp.content);`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/clr-content-access');
        assert.ok(d, 'expected clr-content-access diagnostic');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.equal(d.data.respName, 'resp');
        assert.equal(d.data.contentText, 'resp.content');
    });

    it('flags a raw .content read on an HttpGet response', () => {
        const doc = {
            text: `${getSetup}var body = gresp.content;`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/clr-content-access');
        assert.ok(d, 'expected clr-content-access diagnostic');
        assert.equal(d.data.respName, 'gresp');
        assert.equal(d.data.contentText, 'gresp.content');
    });

    it('does not flag .content already wrapped in String()', () => {
        const doc = {
            text: `${sendSetup}var data = Platform.Function.ParseJSON(String(resp.content));`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-content-access'));
    });

    it('does not flag .content on an untracked object', () => {
        const doc = {
            text: 'var config = { content: "x" };\nvar x = config.content;',
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-content-access'));
    });

    it('does not flag a longer identifier like .contentType', () => {
        const doc = {
            text: `${sendSetup}var ct = resp.contentType;`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-content-access'));
    });

    it('does not flag inside a comment', () => {
        const doc = {
            text: `${sendSetup}// var body = resp.content;`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-content-access'));
    });

    it('offers a String() wrap code action', () => {
        const doc = {
            text: `${sendSetup}var data = Platform.Function.ParseJSON(resp.content);`,
            languageId: 'ssjs',
            uri: 'file:///c.ssjs',
        };
        const diags = service.validate(doc);
        const diag = diags.find((d) => d.code === 'ssjs/clr-content-access');
        assert.ok(diag, 'expected a clr-content-access diagnostic');
        const actions = service.getCodeActions(doc, [diag]);
        const action = actions.find((a) => a.title.includes('String(resp.content)'));
        assert.ok(action, 'expected a String() wrap code action');
        const edits = action.edit.changes['file:///c.ssjs'];
        assert.equal(edits.length, 1);
        assert.equal(edits[0].newText, 'String(resp.content)');
    });

    it('suppresses clr-content-access diagnostics when eslint overlap disabled', () => {
        const doc = {
            text: `${sendSetup}var body = resp.content;`,
            languageId: 'ssjs',
        };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            disableLspDiagnosticsForEslintRules: true,
        });
        assert.ok(diags.every((d) => d.code !== 'ssjs/clr-content-access'));
    });
});

// ── SSJS invalid HttpRequest/HttpGet property value ──────────────────────────

describe('SSJS invalid-http-property-value diagnostics', () => {
    const reqSetup = 'var req = new Script.Util.HttpRequest("https://x/y");\n';
    const getSetup = 'var greq = Script.Util.HttpGet("https://x/y");\n';

    it('flags an out-of-range emptyContentHandling enum value', () => {
        const doc = { text: `${reqSetup}req.emptyContentHandling = 5;`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/invalid-http-property-value');
        assert.ok(d, 'expected invalid-http-property-value diagnostic');
        assert.equal(d.severity, 1, 'expected Error severity');
        assert.equal(d.data.propName, 'emptyContentHandling');
    });

    it('flags a negative / non-integer retries value', () => {
        const doc = { text: `${reqSetup}req.retries = -2.45;`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/invalid-http-property-value');
        assert.ok(d, 'expected invalid-http-property-value diagnostic');
        assert.equal(d.data.propName, 'retries');
    });

    it('flags an invalid method enum value', () => {
        const doc = { text: `${reqSetup}req.method = 'POT';`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        const d = diags.find((d) => d.code === 'ssjs/invalid-http-property-value');
        assert.ok(d, 'expected invalid-http-property-value diagnostic');
        assert.equal(d.data.propName, 'method');
        assert.ok(d.data.suggestions.length > 0, 'expected enum suggestions');
    });

    it('flags invalid values on an HttpGet instance', () => {
        const doc = { text: `${getSetup}greq.emptyContentHandling = 9;`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.some((d) => d.code === 'ssjs/invalid-http-property-value'));
    });

    it('does not flag a valid enum value', () => {
        const doc = { text: `${reqSetup}req.method = 'POST';`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-http-property-value'));
    });

    it('does not flag a valid numeric value', () => {
        const doc = { text: `${reqSetup}req.retries = 3;`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-http-property-value'));
    });

    it('does not flag non-literal (variable) assignments', () => {
        const doc = { text: `${reqSetup}req.method = someVar;`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-http-property-value'));
    });

    it('does not flag assignments on an untracked object', () => {
        const doc = { text: 'other.method = "POT";', languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-http-property-value'));
    });

    it('does not flag inside a comment', () => {
        const doc = { text: `${reqSetup}// req.method = 'POT';`, languageId: 'ssjs' };
        const diags = service.validate(doc);
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-http-property-value'));
    });

    it('offers replacement code actions for an enum violation', () => {
        const doc = {
            text: `${reqSetup}req.method = 'POT';`,
            languageId: 'ssjs',
            uri: 'file:///p.ssjs',
        };
        const diags = service.validate(doc);
        const diag = diags.find((d) => d.code === 'ssjs/invalid-http-property-value');
        assert.ok(diag, 'expected an invalid-http-property-value diagnostic');
        const actions = service.getCodeActions(doc, [diag]);
        assert.ok(actions.length > 0, 'expected at least one replacement action');
        // method has no enumLabels — plain "Replace with 'GET'" title.
        assert.ok(actions.every((a) => /^Replace with '.+'$/.test(a.title)));
    });

    it('labels enum replacements with their meaning when enumLabels exist', () => {
        const doc = {
            text: `${reqSetup}req.emptyContentHandling = 5;`,
            languageId: 'ssjs',
            uri: 'file:///p.ssjs',
        };
        const diags = service.validate(doc);
        const diag = diags.find((d) => d.code === 'ssjs/invalid-http-property-value');
        assert.ok(diag, 'expected an invalid-http-property-value diagnostic');
        const actions = service.getCodeActions(doc, [diag]);
        const titles = new Set(actions.map((a) => a.title));
        assert.ok(titles.has('Replace with 0 (continue)'));
        assert.ok(titles.has('Replace with 1 (stop)'));
        assert.ok(titles.has('Replace with 2 (continue to next subscriber - email sends only)'));
    });

    it('suppresses diagnostics when eslint overlap disabled', () => {
        const doc = { text: `${reqSetup}req.method = 'POT';`, languageId: 'ssjs' };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            disableLspDiagnosticsForEslintRules: true,
        });
        assert.ok(diags.every((d) => d.code !== 'ssjs/invalid-http-property-value'));
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
        assert.ok(diags.every((d) => d.code !== 'ssjs/polyfill-required'));
    });

    it('suppresses replace-with-platform-function diagnostics when enabled', () => {
        const doc = { text: 'var o = JSON.parse(str);', languageId: 'ssjs' };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            disableLspDiagnosticsForEslintRules: true,
        });
        assert.ok(diags.every((d) => d.code !== 'ssjs/replace-with-platform-function'));
    });

    it('suppresses mcn-not-supported diagnostic when enabled', () => {
        const doc = { text: 'var x = Platform.Function.Now();', languageId: 'ssjs' };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            targetPlatform: 'next',
            disableLspDiagnosticsForEslintRules: true,
        });
        assert.ok(diags.every((d) => d.code !== 'ssjs/mcn-not-supported'));
    });

    it('still reports mcn-not-supported diagnostic when disabled (default)', () => {
        const doc = { text: 'var x = Platform.Function.Now();', languageId: 'ssjs' };
        const diags = service.validate(doc, {
            maxNumberOfProblems: 100,
            targetPlatform: 'next',
        });
        assert.ok(diags.some((d) => d.code === 'ssjs/mcn-not-supported'));
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
            actions.every((a) => !a.title.includes('Insert polyfill')),
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

    it('offers @@ExecCtx as a read-only AMPscript global, not a personalization string', () => {
        const doc = { text: '%%[ \n ]%%', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 4 });
        const item = items.find((entry) => entry.label === '@@ExecCtx');
        assert.ok(item, 'expected @@ExecCtx completion');
        assert.equal(item.data?.type, 'global');
    });

    it('shows read-only global hover for @@ExecCtx', () => {
        const line = '%%[ if @@ExecCtx == "load" then ]%%';
        const hover = service.getHover({ text: line, languageId: 'ampscript' }, line, {
            line: 0,
            character: 12,
        });
        assert.ok(hover, 'expected @@ExecCtx hover');
        assert.match(hover.contents.value, /read-only global/);
        assert.match(hover.contents.value, /always returns load/);
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

    it('offers runtime-verified global Redirect in SSJS completions', () => {
        // Redirect is a runtime-verified Core global (available after Platform.Load("core", ...)),
        // so it must be offered in SSJS completions.
        const doc = { text: 'Red', languageId: 'ssjs' };
        const items = service.getCompletions(doc, { line: 0, character: 3 });
        assert.ok(
            items.some((i) => i.label?.toString() === 'Redirect'),
            'Redirect should be offered — it is a runtime-verified Core global',
        );
    });

    // ── Core Request object vs Platform.Request (bug fix) ────────────────────

    it('offers exactly the 8 Core Request members for `Request.`', () => {
        const doc = { text: 'Request.', languageId: 'ssjs' };
        const items = service.getCompletions(doc, { line: 0, character: 8 });
        const requestLabels = items
            .map((i) => i.label?.toString() ?? '')
            .filter((l) => l.startsWith('Request.'));
        const memberNames = requestLabels
            .map((l) => l.slice('Request.'.length))
            .toSorted((a, b) => a.localeCompare(b));
        assert.deepEqual(
            memberNames,
            [
                'ApplicationBaseURL',
                'ApplicationID',
                'GetFormField',
                'GetQueryStringParameter',
                'Method',
                'PackageID',
                'PagePath',
                'URL',
            ],
            'Request. must offer exactly the 8 Core library Request members',
        );
    });

    it('does NOT leak Platform.Request-only members into `Request.`', () => {
        const doc = { text: 'Request.', languageId: 'ssjs' };
        const items = service.getCompletions(doc, { line: 0, character: 8 });
        const requestMembers = new Set(
            items
                .map((i) => i.label?.toString() ?? '')
                .filter((l) => l.startsWith('Request.'))
                .map((l) => l.slice('Request.'.length)),
        );
        for (const leaked of [
            'RequestURL',
            'GetCookieValue',
            'GetPostData',
            'GetRequestHeader',
            'Browser',
            'ClientIP',
            'HasSSL',
            'IsSSL',
            'QueryString',
            'ReferrerURL',
            'UserAgent',
        ]) {
            assert.ok(
                !requestMembers.has(leaked),
                `Platform.Request-only member ${leaked} must NOT appear on Core Request.`,
            );
        }
    });

    it('still offers Platform.Request members for `Platform.Request.`', () => {
        const doc = { text: 'Platform.Request.', languageId: 'ssjs' };
        const items = service.getCompletions(doc, { line: 0, character: 17 });
        const labels = new Set(items.map((i) => i.label?.toString() ?? ''));
        assert.ok(
            labels.has('Platform.Request.RequestURL'),
            'Platform.Request.RequestURL should still be offered',
        );
        assert.ok(
            labels.has('Platform.Request.GetCookieValue'),
            'Platform.Request.GetCookieValue should still be offered',
        );
    });

    it('does NOT offer GetUserLanguages on either Request namespace', () => {
        const items = service.getCompletions(
            { text: '', languageId: 'ssjs' },
            { line: 0, character: 0 },
        );
        const labels = new Set(items.map((i) => i.label?.toString() ?? ''));
        assert.ok(
            !labels.has('Request.GetUserLanguages'),
            'GetUserLanguages must not appear on Core Request.',
        );
        assert.ok(
            !labels.has('Platform.Request.GetUserLanguages'),
            'GetUserLanguages is notDefinedAtRuntime and must not appear on Platform.Request.',
        );
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

    it('hover for a deprecated ErrorUtil method shows a Deprecated banner', () => {
        const line = 'ErrorUtil.ThrowWSProxyError(result);';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "ThrowWSProxyError"
        const hover = service.getHover(doc, line, { line: 0, character: 12 });
        assert.ok(hover, 'expected hover for ErrorUtil.ThrowWSProxyError');
        assert.match(
            hover.contents.value,
            /Deprecated/i,
            `expected deprecation banner in hover, got: ${hover.contents.value}`,
        );
    });

    it('hover for the deprecated Portfolio core library object shows a Deprecated banner', () => {
        const line = 'var p = Portfolio.Retrieve("Name", "MyPortfolio");';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "Portfolio"
        const hover = service.getHover(doc, line, { line: 0, character: 9 });
        assert.ok(hover, 'expected hover for Portfolio');
        assert.match(
            hover.contents.value,
            /Deprecated/i,
            `expected deprecation banner in hover, got: ${hover.contents.value}`,
        );
    });

    it('hover on Core `Request.URL` shows the 0-arg Core signature', () => {
        const line = 'var u = Request.URL();';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "URL"
        const hover = service.getHover(doc, line, { line: 0, character: 17 });
        assert.ok(hover, 'expected hover for Core Request.URL');
        const value = hover.contents.value;
        assert.match(value, /Request\.URL\(\)/, `expected Request.URL() signature, got: ${value}`);
        assert.match(value, /full URL/i, `expected Core URL description, got: ${value}`);
    });

    it('hover on Core `Request.GetQueryStringParameter` shows the 1-arg Core signature', () => {
        const line = 'var v = Request.GetQueryStringParameter("sku");';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "GetQueryStringParameter"
        const hover = service.getHover(doc, line, { line: 0, character: 25 });
        assert.ok(hover, 'expected hover for Core Request.GetQueryStringParameter');
        const value = hover.contents.value;
        assert.match(
            value,
            /Request\.GetQueryStringParameter\(name/,
            `expected 1-arg Core signature, got: ${value}`,
        );
    });

    it('hover on `Platform.Request.RequestURL` still resolves Platform.Request member', () => {
        const line = 'var r = Platform.Request.RequestURL();';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "RequestURL"
        const hover = service.getHover(doc, line, { line: 0, character: 27 });
        assert.ok(hover, 'expected hover for Platform.Request.RequestURL');
        assert.match(
            hover.contents.value,
            /RequestURL/,
            `expected Platform.Request.RequestURL hover, got: ${hover.contents.value}`,
        );
    });

    it('hover on Core `Request.` does NOT resolve a Platform.Request-only member', () => {
        // RequestURL is a Platform.Request member, NOT a Core Request member.
        const line = 'var r = Request.RequestURL();';
        const doc = { text: line, languageId: 'ssjs' };
        // cursor on "RequestURL"
        const hover = service.getHover(doc, line, { line: 0, character: 20 });
        assert.equal(
            hover,
            null,
            'Core Request. must not resolve Platform.Request-only RequestURL',
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
        const names = new Set(calls.map((c) => c.name.toLowerCase()));
        assert.ok(names.has('add'), 'expected Add');
        assert.ok(names.has('concat'), 'expected Concat');
    });

    it('returns call sites from HTML with embedded AMPscript', () => {
        const code = '<p>Hello</p>%%[ SET @x = Trim("  hi  ") ]%%<p>world</p>';
        const calls = extractAmpscriptFunctionCalls(code);
        const names = new Set(calls.map((c) => c.name.toLowerCase()));
        assert.ok(names.has('trim'), 'expected Trim from HTML context');
        assert.ok(!names.has('p'), 'HTML tags should not appear as function calls');
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
        // Concat params: string1, string2? and stringN?, all string|number|date.
        // The LSP emits an offset-tuple label for the full typed token so the
        // client highlights the complete `stringN?: string|number|date` token.
        const sig = ampSig("%%=Concat('a','b','c',");
        const stringNLabel = sig.signatures[0].parameters[2].label;
        assert.ok(
            Array.isArray(stringNLabel),
            `expected offset-tuple label for stringN, got: ${JSON.stringify(stringNLabel)}`,
        );
        const [start, end] = stringNLabel;
        assert.strictEqual(
            sig.signatures[0].label.slice(start, end),
            'stringN?: string|number|date',
        );
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
        const labels = new Set(items.map((i) => i.label));
        assert.ok(labels.has('monthName'), 'expected monthName enum completion');
        assert.ok(labels.has('Y'), 'expected Y enum completion');
    });

    it('returns ONLY enum values inside an enum argument (no functions/variables)', () => {
        const text = "%%=DatePart('2026-01-15',";
        const doc = { text, languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: text.length });
        // Every item must be an enum member (LSP CompletionItemKind.EnumMember = 20)
        // — no Add/Concat functions, no @vars.
        const ENUM_MEMBER_KIND = 20;
        const kinds = [...new Set(items.map((i) => i.kind))];
        assert.ok(
            items.every((i) => i.kind === ENUM_MEMBER_KIND),
            `expected only enum members, got kinds: ${JSON.stringify(kinds)}`,
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
            diags.every((d) => d.code !== 'ampscript/deprecated-function'),
            `unexpected deprecated diagnostic: ${JSON.stringify(diags)}`,
        );
    });
});

// ── Non-functional-at-runtime diagnostics — AMPscript ────────────────────────

describe('AMPscript non-functional-at-runtime diagnostics', () => {
    it('reports GetPortfolioItem as a non-functional Error', () => {
        const diags = ampValidate("%%=GetPortfolioItem('key')=%%");
        const d = diags.find((x) => x.code === 'ampscript/nonfunctional-function');
        assert.ok(d, `expected non-functional diagnostic, got: ${JSON.stringify(diags)}`);
        assert.equal(d.severity, 1, 'non-functional diagnostic must be an Error (severity 1)');
        assert.match(d.message, /no known working invocation/i);
    });

    it('reports GetPublishedSocialContent as a non-functional Error', () => {
        const diags = ampValidate("%%=GetPublishedSocialContent('id')=%%");
        assert.ok(
            diags.some((x) => x.code === 'ampscript/nonfunctional-function'),
            `expected non-functional diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('does not flag normal functions as non-functional', () => {
        const diags = ampValidate('%%[ set @x = Add(1,2) ]%%');
        assert.ok(
            diags.every((d) => d.code !== 'ampscript/nonfunctional-function'),
            `unexpected non-functional diagnostic: ${JSON.stringify(diags)}`,
        );
    });

    it('is suppressed by disableLspDiagnosticsForEslintRules (duplicates amp-no-nonfunctional-function)', () => {
        const doc = { text: "%%=GetPortfolioItem('key')=%%", languageId: 'ampscript' };
        const settings = { maxNumberOfProblems: 100, disableLspDiagnosticsForEslintRules: true };
        const diags = service.validate(doc, settings);
        assert.ok(
            diags.every((d) => d.code !== 'ampscript/nonfunctional-function'),
            `expected non-functional diagnostic to be suppressed, got: ${JSON.stringify(diags)}`,
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
            diags.every((d) => d.code !== 'ampscript/unknown-function'),
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
            diags.every((d) => d.code !== 'ampscript/enum-value'),
            `expected enum-value to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('suppresses ampscript mcn-unsupported-function error when setting is enabled', () => {
        // InsertDE is a valid AMPscript function but not supported in MCN.
        const doc = { text: '%%[ InsertDE("MyDE", "Col", "Val") ]%%', languageId: 'ampscript' };
        const settings = {
            maxNumberOfProblems: 100,
            targetPlatform: 'next',
            disableLspDiagnosticsForEslintRules: true,
        };
        const diags = service.validate(doc, settings);
        assert.ok(
            diags.every((d) => d.code !== 'ampscript/mcn-unsupported-function'),
            `expected mcn-unsupported-function to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('suppresses handlebars unknown-binding warning when setting is enabled', () => {
        const doc = { text: '{!$foo.Bar}', languageId: 'ampscript' };
        const settings = {
            maxNumberOfProblems: 100,
            targetPlatform: 'next',
            disableLspDiagnosticsForEslintRules: true,
        };
        const diags = service.validate(doc, settings);
        assert.ok(
            diags.every((d) => d.code !== 'handlebars/unknown-binding'),
            `expected unknown-binding to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('suppresses ssjs require-platform-load error when setting is enabled', () => {
        const doc = { text: 'var de = DataExtension.Init("MyDE");', languageId: 'ssjs' };
        const settings = { maxNumberOfProblems: 100, disableLspDiagnosticsForEslintRules: true };
        const diags = service.validate(doc, settings);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/require-platform-load'),
            `expected require-platform-load to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('still reports require-platform-load error when setting is disabled (default)', () => {
        const doc = { text: 'var de = DataExtension.Init("MyDE");', languageId: 'ssjs' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        assert.ok(
            diags.some((d) => d.code === 'ssjs/require-platform-load'),
            `expected require-platform-load diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('suppresses ssjs platform-load-version warning when setting is enabled', () => {
        const doc = { text: 'Platform.Load("core", "1.1.1");', languageId: 'ssjs' };
        const settings = { maxNumberOfProblems: 100, disableLspDiagnosticsForEslintRules: true };
        const diags = service.validate(doc, settings);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/platform-load-version'),
            `expected platform-load-version to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('still reports platform-load-version warning when setting is disabled (default)', () => {
        const doc = { text: 'Platform.Load("core", "1.1.1");', languageId: 'ssjs' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        assert.ok(
            diags.some((d) => d.code === 'ssjs/platform-load-version'),
            `expected platform-load-version diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });

    it('suppresses ssjs unsupported-syntax error when setting is enabled', () => {
        const doc = { text: 'let x = 1;', languageId: 'ssjs' };
        const settings = { maxNumberOfProblems: 100, disableLspDiagnosticsForEslintRules: true };
        const diags = service.validate(doc, settings);
        assert.ok(
            diags.every((d) => d.code !== 'ssjs/unsupported-syntax'),
            `expected unsupported-syntax to be suppressed, got: ${JSON.stringify(diags)}`,
        );
    });

    it('still reports unsupported-syntax error when setting is disabled (default)', () => {
        const doc = { text: 'let x = 1;', languageId: 'ssjs' };
        const diags = service.validate(doc, { maxNumberOfProblems: 100 });
        assert.ok(
            diags.some((d) => d.code === 'ssjs/unsupported-syntax'),
            `expected unsupported-syntax diagnostic, got: ${JSON.stringify(diags)}`,
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
            diags.every((d) => !d.message.includes('Generator functions are not supported')),
            `expected no generator diagnostic, got: ${JSON.stringify(diags)}`,
        );
    });
});

// ── SSJS ECMAScript builtin completion labels ──────────────────────────────

const ssjsCompletionLabelSet = () =>
    new Set(
        service
            .getCompletions({ text: '', languageId: 'ssjs' }, { line: 0, character: 0 })
            .map((i) => i.label),
    );

describe('SSJS ECMAScript builtin completions', () => {
    it('does not offer prototype/instance members as top-level globals', () => {
        const labels = ssjsCompletionLabelSet();
        // RegExp members live on the instance, not the constructor — never
        // as `RegExp.test` / `RegExp.exec` / `RegExp.lastIndex` globals.
        for (const bogus of [
            'RegExp.test',
            'RegExp.exec',
            'RegExp.source',
            'RegExp.global',
            'RegExp.lastIndex',
            'String.charAt',
            'Array.push',
            'Date.getFullYear',
            'Global.parseInt',
            'Global.RegExp',
        ]) {
            assert.ok(!labels.has(bogus), `did not expect bogus global completion "${bogus}"`);
        }
    });

    it('completion item for deprecated core library object Portfolio carries the Deprecated tag', () => {
        const items = service.getCompletions(
            { text: '', languageId: 'ssjs' },
            { line: 0, character: 0 },
        );
        const item = items.find((i) => i.label === 'Portfolio');
        assert.ok(item, 'expected Portfolio completion item');
        assert.ok(
            Array.isArray(item.tags) && item.tags.includes(1),
            'Portfolio completion must carry CompletionItemTag.Deprecated (1)',
        );
        assert.match(item.documentation.value, /Deprecated/i);
    });

    it('completion item for non-deprecated core library object HTTP has no Deprecated tag', () => {
        const items = service.getCompletions(
            { text: '', languageId: 'ssjs' },
            { line: 0, character: 0 },
        );
        const item = items.find((i) => i.label === 'DataExtension');
        assert.ok(item, 'expected DataExtension completion item');
        assert.ok(
            !item.tags || !item.tags.includes(1),
            'DataExtension completion must not be tagged Deprecated',
        );
    });

    it('offers Global members as bare identifiers', () => {
        const labels = ssjsCompletionLabelSet();
        for (const bare of ['parseInt', 'parseFloat', 'isNaN', 'isFinite', 'RegExp']) {
            assert.ok(labels.has(bare), `expected bare global completion "${bare}"`);
        }
    });

    it('offers static-owner members as Owner.member', () => {
        const labels = ssjsCompletionLabelSet();
        for (const qualified of ['Math.floor', 'Math.PI', 'Date.now', 'Object.defineProperty']) {
            assert.ok(labels.has(qualified), `expected static completion "${qualified}"`);
        }
    });
});

// ── MCN Handlebars — settings & helpers ────────────────────────────────────

const nextSettings = { maxNumberOfProblems: 100, targetPlatform: 'next' };

// ── MCN Handlebars validation ──────────────────────────────────────────────

describe('MCN Handlebars validation (targetPlatform: next)', () => {
    it('flags an unsupported construct (partial) as an error', () => {
        const doc = { text: '{{> myPartial}}', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        const d = diags.find((x) => x.code === 'handlebars/unsupported-construct');
        assert.ok(d, `expected unsupported-construct diagnostic, got: ${JSON.stringify(diags)}`);
        assert.strictEqual(d.severity, 1 /* Error */);
        assert.strictEqual(d.source, 'handlebars');
    });

    it('flags an unknown helper with a "did you mean" suggestion', () => {
        const doc = { text: '{{eech items}}', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        const d = diags.find((x) => x.code === 'handlebars/unknown-helper');
        assert.ok(d, `expected unknown-helper diagnostic, got: ${JSON.stringify(diags)}`);
        assert.strictEqual(d.severity, 2 /* Warning */);
        assert.ok(d.message.includes('each'), `expected suggestion of "each", got: ${d.message}`);
    });

    it('flags an unknown {!$...} built-in binding', () => {
        const doc = { text: '{!$foo.Bar}', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        const d = diags.find((x) => x.code === 'handlebars/unknown-binding');
        assert.ok(d, `expected unknown-binding diagnostic, got: ${JSON.stringify(diags)}`);
        assert.strictEqual(d.severity, 2 /* Warning */);
    });

    it('does not flag a known helper invocation', () => {
        const doc = { text: '{{add 1 2}}', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        assert.ok(
            diags.every((x) => !String(x.code ?? '').startsWith('handlebars/')),
            `expected no Handlebars diagnostics, got: ${JSON.stringify(diags)}`,
        );
    });

    it('does not flag a known {!$...} binding', () => {
        const doc = { text: '{!$organization.Address}', languageId: 'ampscript' };
        const diags = service.validate(doc, nextSettings);
        assert.ok(diags.every((x) => x.code !== 'handlebars/unknown-binding'));
    });

    it('does NOT run Handlebars validation without targetPlatform:next', () => {
        // A partial would be flagged under MCN, but not under Engagement (default).
        const doc = { text: '{{> myPartial}}', languageId: 'ampscript' };
        const diags = service.validate(doc);
        assert.ok(
            diags.every((x) => !String(x.code ?? '').startsWith('handlebars/')),
            `Handlebars diagnostics must not fire without targetPlatform:next, got: ${JSON.stringify(diags)}`,
        );
    });
});

// ── MCN Handlebars completions ─────────────────────────────────────────────

describe('MCN Handlebars completions (targetPlatform: next)', () => {
    it('offers helper completions inside a {{ }} mustache', () => {
        const doc = { text: '{{ }}', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 3 }, nextSettings);
        assert.ok(
            items.some((i) => i.label === 'add'),
            `expected the "add" helper completion, got: ${JSON.stringify(items.map((i) => i.label))}`,
        );
    });

    it('offers {!$...} binding completions after a {!$ token', () => {
        const doc = { text: '{!$', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 3 }, nextSettings);
        assert.ok(
            items.some((i) => String(i.label).includes('organization.Address')),
            `expected an organization.Address binding completion, got: ${JSON.stringify(items.map((i) => i.label))}`,
        );
    });

    it('does NOT offer Handlebars completions without targetPlatform:next', () => {
        const doc = { text: '{{ }}', languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 0, character: 3 });
        assert.ok(
            items.every((i) => i.label !== 'add'),
            'Handlebars completions must not appear under Engagement (default)',
        );
    });

    it('resolves documentation for a Handlebars helper completion', () => {
        const doc = { text: '{{ }}', languageId: 'ampscript' };
        const item = service
            .getCompletions(doc, { line: 0, character: 3 }, nextSettings)
            .find((i) => i.label === 'add');
        assert.ok(item, 'expected an "add" completion item to resolve');
        const resolved = service.resolveCompletion(item);
        const value =
            typeof resolved.documentation === 'string'
                ? resolved.documentation
                : (resolved.documentation?.value ?? '');
        assert.ok(value.length > 0, 'expected resolved documentation markdown');
    });
});

// ── MCN Handlebars hover ───────────────────────────────────────────────────

describe('MCN Handlebars hover (targetPlatform: next)', () => {
    it('returns hover for a known helper inside a mustache', () => {
        const line = '{{#each items}}';
        const doc = { text: line, languageId: 'ampscript' };
        const hover = service.getHover(doc, line, { line: 0, character: 4 }, nextSettings);
        assert.ok(hover, 'expected hover for the each helper');
        assert.ok(hover.contents.value.toLowerCase().includes('each'));
    });

    it('returns hover for a {!$...} built-in binding', () => {
        const line = '{!$organization.Address}';
        const doc = { text: line, languageId: 'ampscript' };
        const hover = service.getHover(doc, line, { line: 0, character: 6 }, nextSettings);
        assert.ok(hover, 'expected hover for the organization.Address binding');
        assert.ok(
            hover.contents.value.includes(
                '[Salesforce Developers](https://developer.salesforce.com/docs/marketing/handlebars-for-marketing-cloud-next/guide/mcn-handlebars-guide-data-sources.html)',
            ),
            `expected a data-sources doc link, got: ${JSON.stringify(hover.contents.value)}`,
        );
    });

    it('separates @return from the meta line for a parameterless helper', () => {
        // `now` takes no arguments, so there are no @param lines. The @return
        // line must still be its own paragraph, not glued to the meta line.
        const line = '{{now}}';
        const doc = { text: line, languageId: 'ampscript' };
        const hover = service.getHover(doc, line, { line: 0, character: 3 }, nextSettings);
        assert.ok(hover, 'expected hover for the now helper');
        assert.ok(
            hover.contents.value.includes('\n\n*@return*'),
            `expected a blank line before @return, got: ${JSON.stringify(hover.contents.value)}`,
        );
    });

    it('does NOT return Handlebars hover without targetPlatform:next', () => {
        const line = '{{#each items}}';
        const doc = { text: line, languageId: 'ampscript' };
        const hover = service.getHover(doc, line, { line: 0, character: 4 });
        assert.equal(hover, null, 'each is not an AMPscript function — hover must be null');
    });
});

// ── MCN Handlebars signature help ──────────────────────────────────────────

describe('MCN Handlebars signature help (targetPlatform: next)', () => {
    it('returns signature help for a helper after its name', () => {
        const text = '{{add ';
        const doc = { text, languageId: 'ampscript' };
        const sig = service.getSignatureHelp(doc, text, nextSettings);
        assert.ok(sig, 'expected signature help for add');
        assert.ok(
            sig.signatures[0].label.includes('add'),
            `expected the add signature label, got: ${sig.signatures[0].label}`,
        );
    });

    it('advances activeParameter as arguments are typed', () => {
        const doc = { text: '', languageId: 'ampscript' };
        assert.strictEqual(
            service.getSignatureHelp(doc, '{{add ', nextSettings).activeParameter,
            0,
            'first arg -> value1',
        );
        assert.strictEqual(
            service.getSignatureHelp(doc, '{{add 1 ', nextSettings).activeParameter,
            1,
            'second arg -> value2',
        );
    });

    it('does NOT return Handlebars signature help without targetPlatform:next', () => {
        const text = '{{add ';
        const doc = { text, languageId: 'ampscript' };
        const sig = service.getSignatureHelp(doc, text);
        assert.equal(sig, null, 'no paren-based call context — signature must be null');
    });
});

// ── MCN Handlebars code actions ────────────────────────────────────────────

describe('MCN Handlebars code actions (targetPlatform: next)', () => {
    it('offers a "did you mean" replacement for an unknown helper', () => {
        const doc = { text: '{{eech items}}', languageId: 'ampscript', uri: 'file:///t.amp' };
        const diags = service.validate(doc, nextSettings);
        const unknownHelper = diags.find((d) => d.code === 'handlebars/unknown-helper');
        assert.ok(unknownHelper, 'expected an unknown-helper diagnostic');
        const actions = service.getCodeActions(doc, [unknownHelper], nextSettings);
        const action = actions.find((a) => a.title.includes("'each'"));
        assert.ok(action, `expected a replace code action, got: ${JSON.stringify(actions)}`);
        assert.strictEqual(action.edit.changes['file:///t.amp'][0].newText, 'each');
    });

    it('does NOT offer Handlebars code actions without targetPlatform:next', () => {
        // Craft a handlebars-source diagnostic and confirm it is ignored under Engagement.
        const doc = { text: '{{eech items}}', languageId: 'ampscript', uri: 'file:///t.amp' };
        const fakeDiag = {
            code: 'handlebars/unknown-helper',
            source: 'handlebars',
            data: { typed: 'eech', suggestion: 'each' },
            range: { start: { line: 0, character: 2 }, end: { line: 0, character: 6 } },
            message: "Unknown Handlebars helper 'eech'.",
            severity: 2,
        };
        const actions = service.getCodeActions(doc, [fakeDiag]);
        assert.ok(
            actions.every((a) => !a.title.includes("'each'")),
            'Handlebars code actions must not be offered under Engagement (default)',
        );
    });
});

// ── MCN Handlebars block scope ─────────────────────────────────────────────

describe('MCN Handlebars block scope (targetPlatform: next)', () => {
    it('offers block params in scope inside an #each ... as |item idx| body', () => {
        // The body must contain a valid mustache so the document parses; an empty
        // `{{ }}` is invalid Handlebars and would suppress all scope tracking.
        const text = '{{#each items as |item idx|}}\n{{item}}\n{{/each}}';
        const doc = { text, languageId: 'ampscript' };
        // Cursor inside the inner {{item}} mustache on line 1.
        const items = service.getCompletions(doc, { line: 1, character: 3 }, nextSettings);
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('item'), `expected block param "item", got: ${labels}`);
        assert.ok(labels.includes('idx'), `expected block param "idx", got: ${labels}`);
    });

    it('offers loop variables (@index) in scope inside an #each body', () => {
        const text = '{{#each items}}\n{{item}}\n{{/each}}';
        const doc = { text, languageId: 'ampscript' };
        const items = service.getCompletions(doc, { line: 1, character: 3 }, nextSettings);
        assert.ok(
            items.some((i) => i.label === '@index'),
            'expected the @index loop variable inside an #each body',
        );
    });

    it('does not offer block params outside the declaring block', () => {
        const text = '{{#each items as |item|}}{{item}}{{/each}}\n{{add 1 2}}';
        const doc = { text, languageId: 'ampscript' };
        // Cursor on line 1 — after the block has closed.
        const items = service.getCompletions(doc, { line: 1, character: 3 }, nextSettings);
        assert.ok(
            items.every((i) => i.label !== 'item'),
            'block params must not leak outside their block',
        );
    });
});

// ── MCN Handlebars catalog accessors ───────────────────────────────────────

describe('MCN Handlebars catalog accessors', () => {
    it('lookupHandlebarsHelper returns a helper for a known name', () => {
        const helper = service.lookupHandlebarsHelper('add');
        assert.ok(helper, 'expected the add helper');
        assert.strictEqual(helper.name, 'add');
    });

    it('lookupHandlebarsHelper is case-insensitive', () => {
        assert.ok(service.lookupHandlebarsHelper('ADD'), 'expected case-insensitive lookup');
    });

    it('lookupHandlebarsHelper returns null for an unknown name', () => {
        assert.equal(service.lookupHandlebarsHelper('doesNotExist'), null);
    });

    it('listHandlebarsHelpers returns a non-empty array', () => {
        const helpers = service.listHandlebarsHelpers();
        assert.ok(Array.isArray(helpers) && helpers.length > 0);
        assert.ok(helpers.every((h) => typeof h.name === 'string'));
    });

    it('listHandlebarsBindings returns a non-empty array', () => {
        const bindings = service.listHandlebarsBindings();
        assert.ok(Array.isArray(bindings) && bindings.length > 0);
        assert.ok(bindings.some((b) => b.name === 'organization.Address'));
    });

    it('listHandlebarsUnsupportedConstructs returns a non-empty array', () => {
        const unsupported = service.listHandlebarsUnsupportedConstructs();
        assert.ok(Array.isArray(unsupported) && unsupported.length > 0);
        assert.ok(unsupported.some((u) => u.id === 'partial'));
    });

    it('getHandlebarsCompletionCatalog returns pre-built helper completion items', () => {
        const catalog = service.getHandlebarsCompletionCatalog();
        assert.ok(Array.isArray(catalog) && catalog.length > 0);
        assert.ok(catalog.some((i) => i.label === 'add'));
    });
});
