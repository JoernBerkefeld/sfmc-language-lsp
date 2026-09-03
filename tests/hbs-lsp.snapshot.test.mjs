/**
 * Before/after parity gate for the Handlebars parser swap
 * (`@handlebars/parser` -> `sfmc-handlebars-parser`).
 *
 * Records, per corpus file, the LSP surfaces that must stay byte-for-byte
 * identical across the swap:
 *   - diagnostics (code / severity / range for ALL; message for every code
 *     EXCEPT `handlebars/syntax-error`, whose raw parser wording is
 *     intentionally excluded so the gate is message-wording-independent),
 *   - block-scope tracking (`buildHandlebarsScopes` output: each scope's
 *     start/end plus a sorted `locals[]` of `{ name, kind }`),
 *   - completion `label`s and hover `contents.value` at a fixed list of probe
 *     positions.
 *
 * The serializer is deterministic (sorted object keys, 2-space indent, LF line
 * endings, trailing newline) and the test asserts STRING equality against the
 * committed golden, so any key-order or whitespace drift is caught.
 *
 * `UPDATE_SNAPSHOTS=1` rewrites the golden; absent, the test compares.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SfmcLanguageService, buildHandlebarsScopes } from '../dist/esm/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(HERE, 'golden', 'hbs-lsp.snapshot.json');

const service = new SfmcLanguageService();
const NEXT_SETTINGS = { maxNumberOfProblems: 100, targetPlatform: 'next' };
const SYNTAX_ERROR_CODE = 'handlebars/syntax-error';

/**
 * Read a committed plugin fixture by path relative to this test file.
 * Referencing (not copying) the plugin corpus keeps the LSP gate and the
 * plugin gate from silently diverging.
 * @param {string} relPath - Path relative to this test's directory.
 * @returns {string} The fixture contents with CRLF normalised to LF.
 */
const readFixture = (relPath) =>
    readFileSync(path.join(HERE, relPath), 'utf8').replaceAll('\r\n', '\n');

/**
 * Corpus of documents whose LSP output must be parser-neutral.
 *
 * `probes` are fixed cursor positions used to capture completions + hover.
 * They are chosen to sit one inside each block and one right after a `{{`.
 * @type {Array<{ name: string, text: string, probes: Array<{ line: number, character: number }> }>}
 */
const CORPUS = [
    // ── Referenced plugin fixtures (shared corpus, no-copy) ────────────────
    {
        name: 'plugin/next/test-standalone.hbs',
        text: readFixture('../../eslint-plugin-sfmc/testFixture/next/test-standalone.hbs'),
        probes: [
            { line: 13, character: 5 },
            { line: 16, character: 6 },
        ],
    },
    {
        name: 'plugin/next/test-handlebars.html',
        text: readFixture('../../eslint-plugin-sfmc/testFixture/next/test-handlebars.html'),
        probes: [
            { line: 18, character: 9 },
            { line: 20, character: 8 },
        ],
    },
    {
        name: 'plugin/next-apiversion/test-handlebars-apiversion.html',
        text: readFixture(
            '../../eslint-plugin-sfmc/testFixture/next-apiversion/test-handlebars-apiversion.html',
        ),
        probes: [{ line: 0, character: 0 }],
    },

    // ── Node-kind coverage (walker path/name/hash/program/inverse) ─────────
    {
        name: 'inline/partial',
        text: '{{> myPartial}}\n',
        probes: [{ line: 0, character: 3 }],
    },
    {
        name: 'inline/partial-block',
        text: '{{#> myPartial}}fallback{{/myPartial}}\n',
        probes: [{ line: 0, character: 5 }],
    },
    {
        name: 'inline/decorator',
        text: '{{* inline "x"}}\n',
        probes: [{ line: 0, character: 4 }],
    },
    {
        name: 'inline/decorator-block',
        text: '{{#* inline "x"}}body{{/inline}}\n',
        probes: [{ line: 0, character: 5 }],
    },
    {
        name: 'inline/raw-block',
        text: '{{{{raw}}}}{{escaped}}{{{{/raw}}}}\n',
        probes: [{ line: 0, character: 6 }],
    },
    {
        name: 'inline/subexpression',
        text: '{{uppercase (lowercase firstName)}}\n',
        probes: [{ line: 0, character: 14 }],
    },
    {
        name: 'inline/segment-literal',
        text: '{{[segment with spaces]}}\n',
        probes: [{ line: 0, character: 4 }],
    },
    {
        name: 'inline/hash-pairs',
        text: '{{add price tax scale=2 label="net"}}\n',
        probes: [{ line: 0, character: 3 }],
    },

    // ── LSP-specific scope / offset paths ──────────────────────────────────
    {
        name: 'inline/nested-each-with-block-params',
        text: '{{#each rows as |row r|}}\n{{#with row as |cell|}}\n{{cell}}{{r}}\n{{/with}}\n{{/each}}\n',
        probes: [
            { line: 2, character: 2 },
            { line: 2, character: 9 },
        ],
    },
    {
        name: 'inline/else-if-chain',
        text: '{{#if a}}A{{else if b}}B{{else}}C{{/if}}\n',
        probes: [
            { line: 0, character: 4 },
            { line: 0, character: 17 },
        ],
    },
    {
        name: 'inline/index-key-data-vars',
        text: '{{#each items}}\n{{@index}}:{{@key}}={{this}}\n{{/each}}\n',
        probes: [{ line: 1, character: 3 }],
    },
    {
        name: 'inline/ampscript-mixed-html',
        text: '<p>{!$organization.Address}</p>\n%%[ set @x = 1 ]%%\n{{#each items}}<li>{{this}}</li>{{/each}}\n',
        probes: [
            { line: 0, character: 6 },
            { line: 2, character: 8 },
        ],
    },
    {
        name: 'inline/empty-body-block-with-params',
        text: '{{#each x as |a|}}{{/each}}\n',
        probes: [{ line: 0, character: 6 }],
    },
    {
        // must-fix 2: block whose {{#...}}/{{/...}} start and end MID-LINE
        // (non-zero columns), exercising astLocToRange -> positionToOffset.
        name: 'inline/mid-line-block',
        text: '<li>{{#each xs}}<b>{{this}}</b>{{/each}}</li>\n',
        probes: [{ line: 0, character: 20 }],
    },
    {
        // must-fix 2: block AFTER an AMPscript-mixed region in the same doc, so
        // scope offsets round-trip through the sanitized-vs-original mapping at
        // a non-trivial offset (where a C4 column/line off-by-one would show).
        name: 'inline/block-after-ampscript-region',
        text: 'Hello %%[ set @name = "world" ]%% and more\n<ul>{{#each people as |p|}}<li>{{p}}</li>{{/each}}</ul>\n',
        probes: [{ line: 1, character: 32 }],
    },

    // ── Syntax-error RANGE paths (message excluded per must-fix 1) ──────────
    {
        // Jison-class error: unclosed block. Exercises the hash.loc -> range path.
        name: 'inline/error-jison-unclosed-block',
        text: '{{#a}}x\n',
        probes: [{ line: 0, character: 3 }],
    },
    {
        // Exception-class error: close-tag mismatch. No hash.loc -> whole-doc
        // range fallback.
        name: 'inline/error-exception-close-mismatch',
        text: '{{#a}}{{/b}}\n',
        probes: [{ line: 0, character: 3 }],
    },
];

/**
 * Serialize a value deterministically: object keys sorted, 2-space indent, LF
 * line endings, trailing newline.
 * @param {unknown} value - The value to serialize.
 * @returns {string} The canonical JSON string.
 */
function serialize(value) {
    /**
     * Recursively sort object keys so serialization is key-order-independent.
     * @param {unknown} node - The current value.
     * @returns {unknown} The value with all nested object keys sorted.
     */
    const sortKeys = (node) => {
        if (Array.isArray(node)) return node.map((child) => sortKeys(child));
        if (node && typeof node === 'object') {
            /**
            @type {Record<string, unknown>}
             */
            const out = {};
            const keys = Object.keys(node).toSorted((a, b) => a.localeCompare(b));
            for (const key of keys) {
                out[key] = sortKeys(/** @type {Record<string, unknown>} */ (node)[key]);
            }
            return out;
        }
        return node;
    };
    return `${JSON.stringify(sortKeys(value), null, 2).replaceAll('\r\n', '\n')}\n`;
}

/**
 * Capture the parser-neutral LSP snapshot for one corpus document.
 * @param {{ name: string, text: string, probes: Array<{ line: number, character: number }> }} entry - Corpus entry.
 * @returns {object} The recorded snapshot object for this document.
 */
function captureEntry(entry) {
    const doc = { text: entry.text, languageId: 'ampscript' };

    // Diagnostics — record code/severity/range for all; message for every code
    // except the raw parser-wording syntax error.
    const diagnostics = service.validate(doc, NEXT_SETTINGS).map((d) => {
        /**
        @type {Record<string, unknown>}
         */
        const record = {
            code: d.code ?? null,
            severity: d.severity ?? null,
            range: {
                start: { line: d.range.start.line, character: d.range.start.character },
                end: { line: d.range.end.line, character: d.range.end.character },
            },
        };
        if (d.code !== SYNTAX_ERROR_CODE) {
            record.message = d.message;
        }
        return record;
    });

    // Block-scope tracking — start/end plus a sorted locals[] of {name,kind}.
    const scopes = buildHandlebarsScopes(entry.text).map((scope) => ({
        start: scope.start,
        end: scope.end,
        locals: scope.locals
            .map((l) => ({ name: l.name, kind: l.kind }))
            .toSorted((a, b) =>
                a.name === b.name ? a.kind.localeCompare(b.kind) : a.name.localeCompare(b.name),
            ),
    }));

    // Completions + hover at each fixed probe position.
    const probes = entry.probes.map((position) => {
        const lineText = entry.text.split('\n')[position.line] ?? '';
        const completions = service
            .getCompletions(doc, position, NEXT_SETTINGS)
            .map((i) => String(i.label))
            .toSorted((a, b) => a.localeCompare(b));
        const hover = service.getHover(doc, lineText, position, NEXT_SETTINGS);
        return {
            position: { line: position.line, character: position.character },
            completions,
            hover: hover ? hover.contents.value : null,
        };
    });

    return { diagnostics, scopes, probes };
}

/**
 * Build the full snapshot object across the whole corpus.
 * @returns {object} Map of corpus name -> recorded snapshot.
 */
function captureAll() {
    /**
    @type {Record<string, object>}
     */
    const out = {};
    for (const entry of CORPUS) {
        out[entry.name] = captureEntry(entry);
    }
    return out;
}

describe('Handlebars LSP parity snapshot', () => {
    it('matches the committed golden snapshot (byte-identical)', () => {
        const current = serialize(captureAll());

        if (process.env.UPDATE_SNAPSHOTS === '1') {
            mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
            writeFileSync(GOLDEN_PATH, current, 'utf8');
            return;
        }

        const golden = readFileSync(GOLDEN_PATH, 'utf8').replaceAll('\r\n', '\n');
        assert.strictEqual(
            current,
            golden,
            'Handlebars LSP snapshot drifted. If this is an intentional behaviour change, ' +
                'rerun with UPDATE_SNAPSHOTS=1; otherwise it is a real parser-parity regression.',
        );
    });
});
