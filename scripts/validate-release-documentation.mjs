import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function validateReleaseTag(tag, version, head, taggedCommit) {
    assert.equal(tag, `v${version}`, 'Release tag must match package.json version');
    assert.equal(head, taggedCommit, 'Checkout must be the actual release tag commit');
}

export function validateDocumentation(api, metadata, readDocument) {
    assert.equal(metadata.name, 'sfmc-language-lsp');
    assert.equal(api.LSP_PACKAGE_VERSION, metadata.version);
    assert.equal(api.DIAGNOSTIC_RULES.length, 47, 'Review variant coverage when adding rules');
    const documents = new Set();
    const index = readDocument('docs/rules/README.md');
    for (const rule of api.DIAGNOSTIC_RULES) {
        assert.match(rule.ruleId, /^sfmc\/(?:amp|ssjs|hbs|gtl)-[a-z0-9-]+$/);
        const expectedPath = `docs/rules/${rule.ruleId.slice(5).replace('-', '/')}.md`;
        assert.equal(rule.documentationPath, expectedPath);
        assert.equal(
            api.getDiagnosticDocumentationUrl(rule.variant),
            `https://github.com/JoernBerkefeld/sfmc-language-lsp/blob/v${metadata.version}/${expectedPath}`,
            'Documentation URLs must target the owning release page without unverified anchors',
        );
        const content = readDocument(expectedPath);
        assert.ok(content.startsWith(`# ${rule.ruleId}\n`), `Wrong heading: ${expectedPath}`);
        assert.ok(content.length > 700, `Non-substantive page: ${expectedPath}`);
        assert.ok((content.match(/^## /gm) ?? []).length >= 3, `Missing guidance: ${expectedPath}`);
        assert.ok(content.includes('```'), `Missing examples: ${expectedPath}`);
        assert.ok(
            index.includes(`](${expectedPath.slice('docs/rules/'.length)})`),
            `Missing index entry: ${expectedPath}`,
        );
        // Relative links stay inside this tagged checkout; reject moving self-repository links.
        for (const [, target] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
            assert.ok(
                !target.startsWith('https://github.com/JoernBerkefeld/sfmc-language-lsp/'),
                `Use tag-relative cross-links: ${target}`,
            );
            if (!/^[a-z]+:/i.test(target)) {
                assert.ok(
                    !target.includes('#'),
                    `Rule cross-link anchors need explicit validation: ${target}`,
                );
                const resolved = path.posix.normalize(
                    path.posix.join(path.posix.dirname(expectedPath), target),
                );
                assert.ok(
                    !resolved.startsWith('../') && !path.posix.isAbsolute(resolved),
                    `Cross-link escapes repository: ${target}`,
                );
                assert.ok(readDocument(resolved).trim(), `Missing linked document: ${resolved}`);
            }
        }
        documents.add(expectedPath);
    }
    assert.equal(documents.size, 36, 'Review public rule coverage when adding rules');
    return [...documents];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const tag = process.env.RELEASE_TAG;
    assert.equal(tag, `v${metadata.version}`, 'Release tag must match package.json version');
    const git = (...arguments_) =>
        execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
    const reference = `refs/tags/${tag}`;
    validateReleaseTag(
        tag,
        metadata.version,
        git('rev-parse', 'HEAD'),
        git('rev-parse', reference + '^{commit}'),
    );
    assert.equal(JSON.parse(git('show', `${reference}:package.json`)).version, metadata.version);
    const api = await import('../dist/esm/diagnostic-rules.js');
    // Read the tag objects, never untracked or modified documentation in the working tree.
    const documents = validateDocumentation(
        api,
        metadata,
        (document) => git('show', `${reference}:${document}`) + '\n',
    );
    process.stdout.write(`Validated ${documents.length} tagged rule pages for ${tag}\n`);
}
