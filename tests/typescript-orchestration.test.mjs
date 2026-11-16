/**
 * Tests for what `sfmc-language-lsp/typescript` adds to the service it took over from the VS Code
 * extension: the helpers for mixed documents, per-instance state, unchanged text, and the rule
 * that the package's main entry never loads TypeScript.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { extractScriptBodies, sfmcLanguageService } from '../dist/esm/index.js';
import {
    createSsjsTypeScriptService,
    isInSsjsRegion,
    memberCompletions,
    ssjsProjection,
} from '../dist/esm/typescript/index.js';

const require = createRequire(import.meta.url);
const globalsDts = readFileSync(require.resolve('ssjs-data/sfmc-globals.d.ts'), 'utf8');
const URI = 'inmemory://document.ssjs';
const KIND_TEXT = 1;
const KIND_METHOD = 2;
const SNIPPET = 2;

// what the main entry offers for SSJS, whose labels carry their objects
const catalogueItems = sfmcLanguageService.getCompletions(
    { text: '', languageId: 'ssjs', uri: URI },
    { line: 0, character: 0 },
);

/**
 * Asks a service for the members at the end of some SSJS, the way a consumer does.
 * @param {object} service - instance of the TypeScript-based service
 * @param {string} code - SSJS that ends with a member access
 * @returns {{info: {items: object[], isMemberCompletion: boolean}, members: object[] | null}} TypeScript's answer and the shared rule's
 */
function membersAtEnd(service, code) {
    service.updateDocument(URI, code);
    const lines = code.split('\n');
    const info = service.getCompletionInfo(URI, {
        line: lines.length - 1,
        character: lines.at(-1).length,
    });
    const receiver = /((?:[\w$]+\.)*[\w$]+)\.$/.exec(lines.at(-1))?.[1] ?? '';
    const members = memberCompletions({
        typescriptItems: info.items,
        isMemberAccess: info.isMemberCompletion,
        catalogueItems,
        receiver,
    });
    return { info, members };
}

describe('ssjsProjection / isInSsjsRegion', () => {
    const html = [
        '<p>%%=v(@name)=%%</p>',
        '<script runat="server">',
        'var café = "x";',
        '</script>',
        '<script>var browser = 1;</script>',
        '<script runat="server">Write(café);</script>',
    ].join('\r\n');

    it('keeps only SSJS, at the offsets of the document', () => {
        const projection = ssjsProjection(html);
        assert.equal(projection, extractScriptBodies(html, ['ssjs']).text);
        assert.equal(projection.length, html.length);
        assert.equal(projection.indexOf('var café'), html.indexOf('var café'));
        assert.equal(projection.indexOf('Write(café)'), html.indexOf('Write(café)'));
        assert.ok(!projection.includes('browser'));
        assert.ok(!projection.includes('script'));
        assert.equal(projection.split('\r\n').length, html.split('\r\n').length);
    });

    it('tells SSJS from the rest of the document, both ends of a body included', () => {
        const bodyStart = html.indexOf('>', html.indexOf('<script runat')) + 1;
        const bodyEnd = html.indexOf('</script>');
        assert.equal(isInSsjsRegion(html, bodyStart), true);
        assert.equal(isInSsjsRegion(html, html.indexOf('café')), true);
        assert.equal(isInSsjsRegion(html, bodyEnd), true);
        assert.equal(isInSsjsRegion(html, html.lastIndexOf('café')), true);
        assert.equal(isInSsjsRegion(html, bodyStart - 1), false);
        assert.equal(isInSsjsRegion(html, bodyEnd + 1), false);
        assert.equal(isInSsjsRegion(html, 3), false);
        assert.equal(isInSsjsRegion(html, html.indexOf('browser')), false);
        assert.equal(isInSsjsRegion('var x = 1;', 3), false);
    });
});

describe('memberCompletions', () => {
    const service = createSsjsTypeScriptService({ globalsDts });

    it('describes every member of Platform.Function with the catalogue entry', () => {
        const { info, members } = membersAtEnd(service, 'Platform.Function.');
        assert.equal(info.isMemberCompletion, true);
        // the size at which "TypeScript items only if 50 or fewer" used to flip
        assert.ok(info.items.length >= 50, `Expected 50 or more, got ${info.items.length}`);
        assert.deepEqual(
            members.map((item) => item.label),
            info.items.map((item) => item.label),
        );
        for (const member of members) {
            const known = catalogueItems.find(
                (item) => item.label === `Platform.Function.${member.label}`,
            );
            assert.ok(known, `No catalogue entry for ${member.label}`);
            assert.deepEqual(member.documentation, known.documentation);
            assert.ok(member.documentation.value.length > 0);
            assert.equal(member.detail, known.detail);
            assert.deepEqual(member.data, known.data);
            assert.deepEqual(member.tags, known.tags);
            assert.equal(member.insertTextFormat, SNIPPET);
            assert.ok(member.insertText.startsWith(`${member.label}(`), member.insertText);
            assert.ok(!member.insertText.includes('Platform'), member.insertText);
            assert.equal(known.insertText, `Platform.Function.${member.insertText}`);
        }
        const lookup = members.find((item) => item.label === 'Lookup');
        assert.match(lookup.insertText, /^Lookup\(\$\{1:\w+\}, /);
        assert.equal(lookup.sortText, info.items.find((item) => item.label === 'Lookup').sortText);
    });

    it('offers every member of an object with more than 50 of them', () => {
        const names = Array.from({ length: 60 }, (_, index) => `member${index}`);
        const code = `var big = { ${names.map((name) => `${name}: 1`).join(', ')} };\nbig.`;
        const { info, members } = membersAtEnd(service, code);
        assert.equal(info.isMemberCompletion, true);
        assert.equal(members.length, names.length);
        assert.deepEqual(new Set(members.map((item) => item.label)), new Set(names));
        assert.deepEqual(members, info.items);
    });

    it('has no answer for a receiver of unknown type', () => {
        for (const code of [
            'function read(input) {\n    var other = 1;\n    input.',
            'var parsed = Platform.Function.ParseJSON("{}");\nparsed.',
            'neverDeclared.',
        ]) {
            assert.equal(membersAtEnd(service, code).members, null, code);
        }
        // the names of the file, which TypeScript may list when it does not know the type
        const filler = ['other', 'input'].map((label) => ({ label, kind: KIND_TEXT }));
        assert.equal(
            memberCompletions({
                typescriptItems: filler,
                isMemberAccess: true,
                catalogueItems,
                receiver: 'input',
            }),
            null,
        );
        assert.deepEqual(
            memberCompletions({
                typescriptItems: [...filler, { label: 'real', kind: KIND_METHOD }],
                isMemberAccess: true,
                catalogueItems,
                receiver: 'input',
            }),
            [{ label: 'real', kind: KIND_METHOD }],
        );
    });

    it('has no answer outside a member access', () => {
        service.updateDocument(URI, 'Platf');
        const info = service.getCompletionInfo(URI, { line: 0, character: 5 });
        assert.ok(info.items.length > 0);
        assert.equal(
            memberCompletions({
                typescriptItems: info.items,
                isMemberAccess: info.isMemberCompletion,
                catalogueItems,
                receiver: '',
            }),
            null,
        );
    });

    it('leaves the members of an instance as TypeScript gives them', () => {
        const code = 'Platform.Load("Core", "1");\nDataExtension.Init("x").Rows.';
        const { info, members } = membersAtEnd(service, code);
        const labels = members.map((item) => item.label);
        for (const label of ['Add', 'Lookup', 'Remove', 'Retrieve']) {
            assert.ok(labels.includes(label), `Missing ${label} in ${labels}`);
        }
        assert.deepEqual(members, info.items);
        assert.ok(members.every((item) => !item.documentation && !item.insertText));
    });

    it('inserts a constructor as a call only where the document has the "new"', () => {
        const input = (code, hasNew) => {
            const { info } = membersAtEnd(service, code);
            return {
                typescriptItems: info.items,
                isMemberAccess: info.isMemberCompletion,
                catalogueItems,
                receiver: 'Script.Util',
                hasNew,
            };
        };
        const known = catalogueItems.find((item) => item.label === 'Script.Util.HttpRequest');
        assert.equal(known.insertText, 'new Script.Util.HttpRequest(${1:url})');

        const afterNew = memberCompletions(input('var a = new Script.Util.', true));
        const constructed = afterNew.find((item) => item.label === 'HttpRequest');
        assert.equal(constructed.insertText, 'HttpRequest(${1:url})');
        assert.equal(constructed.insertTextFormat, SNIPPET);

        for (const hasNew of [false, undefined]) {
            const bare = memberCompletions(input('var a = Script.Util.', hasNew));
            assert.deepEqual(
                bare.map((item) => item.label),
                afterNew.map((item) => item.label),
            );
            const plain = bare.find((item) => item.label === 'HttpRequest');
            assert.equal('insertText' in plain, false);
            assert.equal('insertTextFormat' in plain, false);
            assert.equal(plain.detail, known.detail);
            assert.deepEqual(plain.documentation, known.documentation);
            assert.deepEqual(plain.data, known.data);
        }
    });

    it('ignores "new", white space and comments in the receiver', () => {
        const { info } = membersAtEnd(service, 'var a = new Script.Util.');
        for (const receiver of [
            'new Script.Util',
            ' new\n  Script /* the */ . Util // utilities\n',
            'new /* x */ Script.Util',
        ]) {
            const members = memberCompletions({
                typescriptItems: info.items,
                isMemberAccess: true,
                catalogueItems,
                receiver,
            });
            const proxy = members.find((item) => item.label === 'WSProxy');
            assert.equal(proxy.insertText, 'WSProxy()', receiver);
            assert.ok(proxy.documentation, receiver);
        }
    });

    it('does not describe a variable by the catalogue entries of an instance placeholder', () => {
        const placeholders = catalogueItems.filter(
            (item) => item.data?.type === 'ssjs-script-util-request',
        );
        assert.ok(placeholders.some((item) => item.label === 'req.send'));
        assert.ok(placeholders.every((item) => item.label.startsWith('req.')));
        assert.ok(placeholders.every((item) => item.documentation));

        const { info, members } = membersAtEnd(service, 'var req = { send: 1, method: 2 };\nreq.');
        assert.deepEqual(new Set(members.map((item) => item.label)), new Set(['send', 'method']));
        assert.deepEqual(members, info.items);

        // the real thing is still described by TypeScript itself
        const real = membersAtEnd(
            service,
            'var req = new Script.Util.HttpRequest("https://example.com");\nreq.',
        );
        assert.ok(real.members.some((item) => item.label === 'send'));
        assert.deepEqual(real.members, real.info.items);
    });

    it('cuts the receiver out of the insert text', () => {
        const typescriptItems = [
            { label: 'WSProxy', kind: 7, sortText: '11', tags: [1] },
            { label: 'Plain', kind: KIND_METHOD },
            { label: 'Odd', kind: KIND_METHOD },
            { label: 'Unknown', kind: KIND_METHOD },
        ];
        const catalogue = [
            {
                label: 'Script.Util.WSProxy',
                kind: 4,
                detail: 'new Script.Util.WSProxy',
                insertText: 'new Script.Util.WSProxy(${1:options})',
                insertTextFormat: SNIPPET,
                filterText: 'Script.Util.WSProxy WSProxy',
                data: { name: 'WSProxy' },
            },
            // the first entry of a label is the one that counts
            { label: 'Script.Util.WSProxy', detail: 'duplicate' },
            { label: 'Script.Util.Plain', documentation: 'no insert text', tags: [1] },
            { label: 'Script.Util.Odd', insertText: 'elsewhere()', insertTextFormat: SNIPPET },
            { label: 'Other.Unknown', detail: 'another object' },
        ];
        const members = memberCompletions({
            typescriptItems,
            isMemberAccess: true,
            catalogueItems: catalogue,
            receiver: 'Script . Util',
            hasNew: true,
        });
        assert.deepEqual(members, [
            {
                label: 'WSProxy',
                kind: 7,
                sortText: '11',
                // the catalogue has no tags for it, so TypeScript's stay
                tags: [1],
                detail: 'new Script.Util.WSProxy',
                insertText: 'WSProxy(${1:options})',
                insertTextFormat: SNIPPET,
                data: { name: 'WSProxy' },
            },
            { label: 'Plain', kind: KIND_METHOD, documentation: 'no insert text', tags: [1] },
            // an insert text that does not hold the member is not taken
            { label: 'Odd', kind: KIND_METHOD },
            { label: 'Unknown', kind: KIND_METHOD },
        ]);
        assert.deepEqual(typescriptItems[0], {
            label: 'WSProxy',
            kind: 7,
            sortText: '11',
            tags: [1],
        });
    });
});

describe('CommonJS build', () => {
    it('answers like the ES module build', () => {
        const cjs = require('../dist/cjs/typescript/index.cjs');
        const answers = [createSsjsTypeScriptService, cjs.createSsjsTypeScriptService].map(
            (create, index) => {
                const service = create({ globalsDts });
                const { info } = membersAtEnd(service, 'Platform.Function.');
                const members = [memberCompletions, cjs.memberCompletions][index]({
                    typescriptItems: info.items,
                    isMemberAccess: info.isMemberCompletion,
                    catalogueItems,
                    receiver: 'Platform.Function',
                });
                service.updateDocument(URI, 'var a = missing;');
                return { members, diagnostics: service.getDiagnostics(URI) };
            },
        );
        assert.ok(answers[1].members.length >= 50);
        assert.match(
            answers[1].members.find((item) => item.label === 'Lookup').insertText,
            /^Lookup\(/,
        );
        assert.equal(answers[1].diagnostics[0].code, 2304);
        assert.deepEqual(answers[1], answers[0]);
        assert.equal(cjs.ssjsProjection('<b>x</b>'), ssjsProjection('<b>x</b>'));
        assert.equal(cjs.isInSsjsRegion('<script runat="server">x</script>', 23), true);
    });
});

describe('service instances', () => {
    it('reads a companion declaration that is removed and added again', () => {
        const service = createSsjsTypeScriptService({ globalsDts });
        const messages = () => service.getDiagnostics(URI).map((diagnostic) => diagnostic.message);

        service.updateDocument(URI, '/* global A */\nA; B;');
        assert.deepEqual(messages(), ["Cannot find name 'B'."]);
        service.updateDocument(URI, 'A; B;');
        service.updateDocument(URI, '/* global B */\nA; B;');
        assert.deepEqual(messages(), ["Cannot find name 'A'."]);

        const use = 'var a = "x".first(); var b = "x".second();';
        const first = 'String.prototype.first = function () { return 1; };\n';
        const second = 'String.prototype.second = function () { return 1; };\n';
        service.updateDocument(URI, first + use);
        assert.deepEqual(messages(), [`Property 'second' does not exist on type '"x"'.`]);
        service.updateDocument(URI, use);
        service.updateDocument(URI, second + use);
        assert.deepEqual(messages(), [`Property 'first' does not exist on type '"x"'.`]);
    });

    it('does not read unchanged text again', () => {
        const service = createSsjsTypeScriptService({ globalsDts });
        const code = '/* global DEBUG */\nString.prototype.twice = function () {};\nvar x = DEBUG;';
        service.updateDocument(URI, code);
        assert.deepEqual(service.getDiagnostics(URI), []);

        // a snapshot is made exactly when a virtual file gets a new version to check
        const { fromString } = ts.ScriptSnapshot;
        let snapshots = 0;
        ts.ScriptSnapshot.fromString = (text) => {
            snapshots += 1;
            return fromString(text);
        };
        try {
            service.updateDocument(URI, code);
            assert.deepEqual(service.getDiagnostics(URI), []);
            service.updateDocument(URI, code);
            assert.equal(service.getHover(URI, { line: 2, character: 4 }).range.start.line, 2);
            assert.equal(snapshots, 0);

            // the document changes, its two companion files do not
            service.updateDocument(URI, code + '\nvar y = missing;');
            assert.equal(snapshots, 1);
            assert.deepEqual(
                service.getDiagnostics(URI).map((diagnostic) => diagnostic.code),
                [2304],
            );
        } finally {
            ts.ScriptSnapshot.fromString = fromString;
        }
    });

    it('share no documents, companion files or globals', () => {
        const first = createSsjsTypeScriptService({ globalsDts });
        const second = createSsjsTypeScriptService({
            globalsDts: globalsDts + '\ndeclare var onlyInSecond: number;\n',
        });
        const end = { line: 1, character: 20 };

        first.updateDocument(URI, '/* global SHARED */\nvar a = SHARED; a = onlyInSecond;');
        assert.deepEqual(second.getCompletions(URI, end), []);
        assert.deepEqual(second.getDiagnostics(URI), []);
        assert.equal(second.getHover(URI, { line: 1, character: 4 }), undefined);

        // the same name of the document, different text
        second.updateDocument(URI, 'var a = SHARED; a = onlyInSecond;');
        assert.deepEqual(
            first.getDiagnostics(URI).map((diagnostic) => diagnostic.message),
            ["Cannot find name 'onlyInSecond'."],
        );
        assert.deepEqual(
            second.getDiagnostics(URI).map((diagnostic) => diagnostic.message),
            ["Cannot find name 'SHARED'."],
        );

        second.removeDocument(URI);
        assert.deepEqual(second.getDiagnostics(URI), []);
        assert.equal(first.getDiagnostics(URI).length, 1);
    });
});

describe('import graph of the built package', () => {
    const dist = fileURLToPath(new URL('../dist/', import.meta.url));
    const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;

    /**
     * Follows the relative imports of a built file and collects what it finds.
     * @param {string} entry - path of the file to start from, relative to dist
     * @returns {{files: string[], packages: string[]}} files reached, relative to dist, and packages imported
     */
    function walk(entry) {
        const files = new Set();
        const packages = new Set();
        const pending = [path.join(dist, entry)];
        while (pending.length > 0) {
            const file = pending.pop();
            if (files.has(file)) continue;
            assert.ok(existsSync(file), `Missing ${file}`);
            files.add(file);
            for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
                const specifier = match[2];
                if (specifier.startsWith('.')) {
                    pending.push(path.resolve(path.dirname(file), specifier));
                } else {
                    packages.add(specifier);
                }
            }
        }
        return {
            files: Array.from(files, (file) => path.relative(dist, file).replaceAll('\\', '/')),
            packages: [...packages],
        };
    }

    for (const entry of ['esm/index.js', 'cjs/index.cjs']) {
        it(`${entry} never reaches TypeScript`, () => {
            const { files, packages } = walk(entry);
            assert.ok(files.length > 20, `Walked only ${files.length} files`);
            assert.ok(packages.includes('ssjs-data'));
            assert.deepEqual(
                packages.filter((name) => name.split('/', 1)[0] === 'typescript'),
                [],
            );
            assert.deepEqual(
                files.filter((file) => file.split('/').includes('typescript')),
                [],
            );
        });
    }

    for (const [format, extension] of [
        ['esm', 'js'],
        ['cjs', 'cjs'],
    ]) {
        it(`${format}: the subpath loads TypeScript, and neither the main entry nor the catalogue`, () => {
            const { files, packages } = walk(`${format}/typescript/index.${extension}`);
            assert.deepEqual(
                new Set(files),
                new Set([
                    `${format}/typescript/index.${extension}`,
                    `${format}/typescript/orchestration.${extension}`,
                    `${format}/typescript/service.${extension}`,
                    `${format}/typescript/source-analysis.${extension}`,
                    `${format}/utils/regions.${extension}`,
                ]),
            );
            assert.deepEqual(
                new Set(packages),
                new Set(['typescript', 'vscode-languageserver-types']),
            );

            const helpers = walk(`${format}/typescript/orchestration.${extension}`);
            assert.deepEqual(helpers.packages, ['vscode-languageserver-types']);
            assert.equal(helpers.files.length, 2);
        });
    }

    it('the subpath is not part of the main entry', async () => {
        const exported = Object.keys(await import('../dist/esm/index.js'));
        assert.ok(exported.includes('sfmcLanguageService'));
        for (const name of [
            'createSsjsTypeScriptService',
            'ssjsProjection',
            'isInSsjsRegion',
            'memberCompletions',
        ]) {
            assert.equal(exported.includes(name), false, name);
        }
    });
});
