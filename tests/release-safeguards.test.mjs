import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import * as api from '../dist/esm/diagnostic-rules.js';
import {
    validateDocumentation,
    validateReleaseTag,
} from '../scripts/validate-release-documentation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const readDocument = (document) => readFileSync(path.join(root, document), 'utf8');

test('package metadata preserves intended UTF-8 text', () => {
    assert.equal(metadata.author, 'Jörn Berkefeld');
    assert.equal(
        metadata.description,
        'Protocol-agnostic, browser-compatible language service for Salesforce Marketing Cloud — AMPscript, SSJS, and GTL. Provides validation, completions, hover, signature help, and code actions.',
    );
});

test('release identity rejects missing/wrong tags and another checkout', () => {
    validateReleaseTag(`v${metadata.version}`, metadata.version, 'commit-a', 'commit-a');
    for (const tag of [undefined, metadata.version, 'v0.0.0', 'main']) {
        assert.throws(() => validateReleaseTag(tag, metadata.version, 'commit-a', 'commit-a'));
    }
    assert.throws(() =>
        validateReleaseTag(`v${metadata.version}`, metadata.version, 'commit-a', 'commit-b'),
    );
});

test('all 51 variants point to 39 substantive indexed local rule pages', () => {
    assert.equal(validateDocumentation(api, metadata, readDocument).length, 39);
    assert.throws(() =>
        validateDocumentation(api, { ...metadata, version: '0.0.0' }, readDocument),
    );
    assert.throws(() =>
        validateDocumentation(api, metadata, (document) =>
            document === api.DIAGNOSTIC_RULES[0].documentationPath ? '' : readDocument(document),
        ),
    );
    assert.throws(() =>
        validateDocumentation(api, metadata, (document) =>
            document === 'docs/rules/README.md' ? '' : readDocument(document),
        ),
    );
    assert.throws(() =>
        validateDocumentation(
            { ...api, getDiagnosticDocumentationUrl: () => 'https://example.com/main/rule.md' },
            metadata,
            readDocument,
        ),
    );
    for (const link of [
        'missing.md',
        'https://github.com/JoernBerkefeld/sfmc-language-lsp/blob/main/docs/rules/amp/arg-types.md',
        'arg-types.md#unverified',
    ]) {
        assert.throws(() =>
            validateDocumentation(
                api,
                metadata,
                (document) => readDocument(document) + `\n[Bad link](${link})\n`,
            ),
        );
    }
});

test('release workflow gates both tagged jobs and gates publishing after build', () => {
    const workflow = readDocument('.github/workflows/npm-publish.yml');
    const jobs = workflow.split('    publish-npm:');
    assert.equal(jobs.length, 2);
    for (const job of jobs) {
        assert.ok(job.includes('ref: ${{ github.event.release.tag_name }}'));
        assert.ok(job.includes('fetch-depth: 0'));
        assert.ok(job.includes('RELEASE_TAG: ${{ github.event.release.tag_name }}'));
        assert.ok(
            job.indexOf('npm run build') < job.indexOf('npm run validate:release-documentation'),
        );
        assert.ok(job.includes('npm run validate:release-documentation'));
    }
    assert.ok(
        jobs[1].indexOf('npm run validate:release-documentation') < jobs[1].indexOf('npm publish'),
    );
    assert.ok(jobs[1].indexOf('npm run test:release-safeguards') < jobs[1].indexOf('npm publish'));
    assert.equal(
        metadata.scripts['validate:release-documentation'],
        'node scripts/validate-release-documentation.mjs',
    );
    assert.ok(metadata.scripts.test.includes('tests/*.test.mjs'));
});

test('real offline npm tarball carries portable CJS, ESM and browser diagnostic metadata and the TypeScript subpath', async () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'sfmc-lsp-packed-'));
    try {
        const npm =
            process.env.npm_execpath ??
            path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
        const output = execFileSync(
            process.execPath,
            [
                npm,
                'pack',
                '--json',
                '--ignore-scripts',
                '--offline',
                '--no-workspaces',
                '--pack-destination',
                temporary,
            ],
            { cwd: root, encoding: 'utf8' },
        );
        const [packed] = JSON.parse(output);
        // A relative archive avoids GNU tar interpreting a Windows drive as a remote host.
        execFileSync('tar', ['-xzf', packed.filename], { cwd: temporary });
        const relocated = path.join(temporary, 'relocated package');
        renameSync(path.join(temporary, 'package'), relocated);
        const packedMetadata = JSON.parse(
            readFileSync(path.join(relocated, 'package.json'), 'utf8'),
        );
        assert.equal(packedMetadata.version, metadata.version);
        assert.equal(packedMetadata.name, metadata.name);
        for (const entry of [packedMetadata.main, packedMetadata.module, packedMetadata.types]) {
            const content = readFileSync(path.join(relocated, entry), 'utf8');
            assert.ok(
                content.includes('diagnostic-rules'),
                `Missing public diagnostic exports: ${entry}`,
            );
            assert.ok(!content.includes(root));
        }
        // Neither Git nor the owning manifest is available at runtime after relocation.
        rmSync(path.join(relocated, 'package.json'));
        writeFileSync(
            path.join(relocated, 'package.json'),
            '{"type":"module","version":"0.0.0"}\n',
        );
        const require = createRequire(import.meta.url);
        const cjs = require(path.join(relocated, 'dist/cjs/diagnostic-rules.cjs'));
        const esm = await import(
            pathToFileURL(path.join(relocated, 'dist/esm/diagnostic-rules.js')).href
        );
        for (const artifact of [cjs, esm]) {
            assert.equal(validateDocumentation(artifact, packedMetadata, readDocument).length, 39);
            for (const rule of artifact.DIAGNOSTIC_RULES) {
                const diagnostic = artifact.createDiagnostic(rule.variant, {
                    message: 'Artifact acceptance',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    data: 'opaque',
                });
                assert.equal(diagnostic.code, rule.ruleId);
                assert.equal(
                    diagnostic.codeDescription.href,
                    api.getDiagnosticDocumentationUrl(rule.variant),
                );
                assert.equal(diagnostic.data.sfmc.payload, 'opaque');
            }
        }
        // A browser-like VM has no process, require, filesystem, or runtime package lookup.
        // Only relative imports inside the packed registry graph are permitted by the linker.
        const browserProbe = `
            import assert from 'node:assert/strict';
            import { readFileSync } from 'node:fs';
            import vm from 'node:vm';
            import { pathToFileURL } from 'node:url';
            const context = vm.createContext({});
            const modules = new Map();
            async function load(url) {
                if (modules.has(url.href)) return modules.get(url.href);
                const source = readFileSync(url, 'utf8');
                const module = new vm.SourceTextModule(source, { context, identifier: url.href });
                modules.set(url.href, module);
                await module.link((specifier, importer) => {
                    assert.ok(specifier.startsWith('./'), 'Runtime dependency: ' + specifier);
                    return load(new URL(specifier, importer.identifier));
                });
                return module;
            }
            const entry = await load(pathToFileURL(process.argv[1]));
            await entry.evaluate();
            const api = entry.namespace;
            assert.equal(api.LSP_PACKAGE_VERSION, process.argv[2]);
            assert.equal(api.DIAGNOSTIC_RULES.length, 51);
            for (const rule of api.DIAGNOSTIC_RULES) {
                const diagnostic = api.createDiagnostic(rule.variant, { message: 'Browser acceptance', data: 'opaque' });
                assert.equal(diagnostic.codeDescription.href, 'https://github.com/JoernBerkefeld/sfmc-language-lsp/blob/v' + process.argv[2] + '/' + rule.documentationPath);
                assert.equal(diagnostic.code, rule.ruleId);
                assert.equal(diagnostic.data.sfmc.payload, 'opaque');
            }
            assert.equal(vm.runInContext('typeof process + ":" + typeof require', context), 'undefined:undefined');
        `;
        execFileSync(
            process.execPath,
            [
                '--experimental-vm-modules',
                '--input-type=module',
                '-e',
                browserProbe,
                path.join(relocated, 'dist/esm/diagnostic-rules.js'),
                metadata.version,
            ],
            { cwd: temporary, encoding: 'utf8' },
        );

        // The TypeScript subpath: every target of its exports is packed, the main entry keeps
        // its own, and both builds answer from the tarball.
        assert.deepEqual(packedMetadata.exports, {
            '.': {
                import: './dist/esm/index.js',
                require: './dist/cjs/index.cjs',
                types: './dist/types/index.d.ts',
            },
            './typescript': {
                import: './dist/esm/typescript/index.js',
                require: './dist/cjs/typescript/index.cjs',
                types: './dist/types/typescript/index.d.ts',
            },
        });
        assert.deepEqual(packedMetadata.peerDependencies, { typescript: '^6' });
        assert.deepEqual(packedMetadata.peerDependenciesMeta, { typescript: { optional: true } });
        assert.equal(packedMetadata.dependencies.typescript, undefined);
        const subpath = packedMetadata.exports['./typescript'];
        const typesDirectory = path.dirname(path.join(relocated, subpath.types));
        assert.match(
            readFileSync(path.join(relocated, subpath.types), 'utf8'),
            /export \{ createSsjsTypeScriptService \} from '\.\/service\.js';/,
        );
        assert.match(
            readFileSync(path.join(typesDirectory, 'service.d.ts'), 'utf8'),
            /export declare function createSsjsTypeScriptService\(/,
        );
        assert.match(
            readFileSync(path.join(typesDirectory, 'orchestration.d.ts'), 'utf8'),
            /export declare function memberCompletions\(/,
        );
        for (const entry of [packedMetadata.main, packedMetadata.module, packedMetadata.types]) {
            assert.ok(!readFileSync(path.join(relocated, entry), 'utf8').includes('typescript'));
        }

        // The relocated package has no node_modules: its two packages come from this checkout.
        const globals = require.resolve('ssjs-data/sfmc-globals.d.ts');
        const marker = `${path.sep}node_modules${path.sep}`;
        const packageRoots = ['typescript', 'vscode-languageserver-types'].map((name) => {
            const resolved = require.resolve(name);
            return resolved.slice(0, resolved.lastIndexOf(marker) + marker.length - 1);
        });
        // What both probes ask of the service, as source text for either module format.
        const acceptance = String.raw`
            const service = api.createSsjsTypeScriptService({ globalsDts });
            service.updateDocument('u', 'var id = Platform.Function.GUID();\nPlatform.Function.');
            const info = service.getCompletionInfo('u', { line: 1, character: 18 });
            assert.equal(info.isMemberCompletion, true);
            const members = api.memberCompletions({
                typescriptItems: info.items,
                isMemberAccess: true,
                catalogueItems: [{ label: 'Platform.Function.Lookup', insertText: 'Platform.Function.Lookup()' }],
                receiver: 'Platform.Function',
            });
            assert.equal(members.find((item) => item.label === 'Lookup').insertText, 'Lookup()');
            assert.equal(service.getDiagnostics('u').length, 1);
            assert.ok(service.getHover('u', { line: 0, character: 5 }).contents.value.includes('id'));
            assert.equal(api.ssjsProjection('<b>x</b>'), '        ');
            assert.equal(api.isInSsjsRegion('<script runat="server">x</script>', 23), true);
        `;
        const cjsProbe = `
            const assert = require('node:assert/strict');
            const api = require(process.argv[1]);
            const globalsDts = require('node:fs').readFileSync(process.argv[2], 'utf8');
            ${acceptance}
        `;
        execFileSync(
            process.execPath,
            ['-e', cjsProbe, path.join(relocated, subpath.require), globals],
            {
                cwd: temporary,
                encoding: 'utf8',
                env: { ...process.env, NODE_PATH: packageRoots.join(path.delimiter) },
            },
        );
        // Browser-like again: no process, no require, and only relative imports besides the
        // two packages, which are handed in.
        const esmProbe = `
            import assert from 'node:assert/strict';
            import { readFileSync } from 'node:fs';
            import vm from 'node:vm';
            import { pathToFileURL } from 'node:url';
            const [entryPath, globalsPath, ...packageUrls] = process.argv.slice(1);
            const context = vm.createContext({});
            const packages = new Map();
            for (const [index, name] of ['typescript', 'vscode-languageserver-types'].entries()) {
                const namespace = await import(packageUrls[index]);
                const names = Object.keys(namespace);
                packages.set(
                    name,
                    new vm.SyntheticModule(
                        names,
                        function () {
                            for (const key of names) this.setExport(key, namespace[key]);
                        },
                        { context, identifier: name },
                    ),
                );
            }
            const modules = new Map();
            async function load(url) {
                if (modules.has(url.href)) return modules.get(url.href);
                const source = readFileSync(url, 'utf8');
                const module = new vm.SourceTextModule(source, { context, identifier: url.href });
                modules.set(url.href, module);
                await module.link((specifier, importer) => {
                    if (packages.has(specifier)) return packages.get(specifier);
                    assert.ok(specifier.startsWith('.'), 'Runtime dependency: ' + specifier);
                    return load(new URL(specifier, importer.identifier));
                });
                return module;
            }
            const entry = await load(pathToFileURL(entryPath));
            await entry.evaluate();
            const api = entry.namespace;
            const globalsDts = readFileSync(globalsPath, 'utf8');
            ${acceptance}
            assert.equal(modules.size, 5);
            assert.equal(vm.runInContext('typeof process + ":" + typeof require', context), 'undefined:undefined');
        `;
        execFileSync(
            process.execPath,
            [
                '--experimental-vm-modules',
                '--input-type=module',
                '-e',
                esmProbe,
                path.join(relocated, subpath.import),
                globals,
                import.meta.resolve('typescript'),
                import.meta.resolve('vscode-languageserver-types'),
            ],
            { cwd: temporary, encoding: 'utf8' },
        );
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});
