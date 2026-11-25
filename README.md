# sfmc-language-lsp

Protocol-agnostic, browser-compatible **language service** for Salesforce Marketing Cloud — **AMPscript**, **SSJS**, and **GTL**. It provides validation, completions, hover, signature help, and code actions, with full **Marketing Cloud Next (MCN)** platform support.

Data comes from the [`ampscript-data`](https://www.npmjs.com/package/ampscript-data) and [`ssjs-data`](https://www.npmjs.com/package/ssjs-data) packages. Consumers include the [SFMC Language Service](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language) VS Code extension (bundled) and the [mcp-server-sfmc](https://www.npmjs.com/package/mcp-server-sfmc) MCP server (runtime dependency).

## Marketing Cloud Next (MCN) support

When `targetPlatform` is set to `'next'` in `SfmcSettings`, the language service:

- Flags AMPscript functions not supported on MCN as **errors**
- Offers only the AMPscript functions supported on MCN in completions
- Flags all SSJS as **unsupported** (SSJS is not available on MCN)
- Surfaces MCN API version and behavioral-difference notes in hover documentation. AMPscript support badges also show known Salesforce release names, for example `since Summer '26 / API v67.0+`; unknown versions retain the API-only badge.

MCN helper functions re-exported from `ampscript-data`:

```js
import {
  isMcnSupported,
  getMcnApiVersion,
  getMcnNotes,
  extractAmpscriptFunctionCalls,
} from 'sfmc-language-lsp';
```

## MCN Handlebars support

The combined `sfmc` language embeds the locked-down **MCN Handlebars** templating layer. When `targetPlatform` is `'next'`, `{{…}}` regions are validated for helper names, arity, block balance, and unsupported constructs (partials, decorators, and built-in helpers absent from the MCN engine). Handlebars completions, hover, signature help, and code actions are layered into the standard LSP entry points automatically.

The catalog (sourced from [`handlebars-data`](https://www.npmjs.com/package/handlebars-data)) is also exposed via `sfmcLanguageService` accessors and the corresponding types:

```js
import { sfmcLanguageService } from 'sfmc-language-lsp';

sfmcLanguageService.lookupHandlebarsHelper('uppercase'); // HandlebarsHelper | null (case-insensitive)
sfmcLanguageService.listHandlebarsHelpers(); // HandlebarsHelper[]
sfmcLanguageService.listHandlebarsBindings(); // HandlebarsBinding[]
sfmcLanguageService.listHandlebarsUnsupportedConstructs(); // HandlebarsUnsupportedConstruct[]
sfmcLanguageService.getHandlebarsCompletionCatalog(); // CompletionItem[]
```

```ts
import type {
  HandlebarsHelper,
  HandlebarsBinding,
  HandlebarsUnsupportedConstruct,
} from 'sfmc-language-lsp';
```

## Mixed-document script regions

`getScriptRegions(text)` returns script bodies in document order, classified as `ampscript`, `ssjs`, `browser-classic`, `browser-module`, or `non-js`. Each region retains opening/closing tag ranges, body ranges, and attributes. Offsets are zero-based, end-exclusive UTF-16 offsets; unfinished bodies extend to EOF and have null closing-tag offsets.

`extractScriptBodies(text, kinds)` returns `{ text, regions }`: selected bodies remain verbatim, while surrounding content is replaced with spaces without changing UTF-16 offsets or CR/LF line endings. HTML comments and raw script boundaries are respected. These helpers only classify and extract; they do not validate browser JavaScript or sanitize template interpolation.

`validateMixedDocumentSsjs(text, settings?)` validates only bodies classified as `ssjs` in a mixed document. It returns no diagnostics when there is no server JavaScript. Diagnostic ranges use the original document's zero-based lines and UTF-16 character positions, preserving surrounding markup and newline offsets. Server-block metadata is retained for cross-block checks; browser scripts cannot supply a Core load, polyfill, or declaration to suppress a server warning. AMPscript script bodies and non-JavaScript script data are excluded.

Use the unchanged `validateSsjs(text, settings?)` entry point for raw SSJS. The mixed-document entry point is not a browser JavaScript validator.

**Available since 4.3.0:** the script-region helpers and mixed-document SSJS validator are public APIs in `sfmc-language-lsp@4.3.0` and later. Consumers using these APIs must require at least version `4.3.0` and refresh their lockfiles from the npm registry.

## TypeScript-based SSJS intelligence (`sfmc-language-lsp/typescript`)

The subpath `sfmc-language-lsp/typescript` runs a TypeScript language service over SSJS, typed by the SSJS declarations that `ssjs-data` ships. It answers what the catalogue of the main entry cannot: the members of a value (`DataExtension.Init("x").Rows.`), type errors, hover and signature help for your own functions and polyfills, go to definition and find references. It is SSJS only and browser-compatible: it reads no files, and you hand it the declarations as text.

`typescript` is an **optional peer dependency** (`^6`). Only this subpath needs it; the main entry never loads it, so consumers of the main entry alone do not have to install it.

```js
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sfmcLanguageService } from 'sfmc-language-lsp';
import { createSsjsTypeScriptService, memberCompletions } from 'sfmc-language-lsp/typescript';

// In a bundle, inline this text at build time instead of reading it.
const globalsDts = readFileSync(
  createRequire(import.meta.url).resolve('ssjs-data/sfmc-globals.d.ts'),
  'utf8',
);
const service = createSsjsTypeScriptService({ globalsDts });

const uri = 'file:///example.ssjs';
const text = 'Platform.Function.';
const position = { line: 0, character: text.length };
service.updateDocument(uri, text);

const { items, isMemberCompletion } = service.getCompletionInfo(uri, position);
const members = memberCompletions({
  typescriptItems: items,
  isMemberAccess: isMemberCompletion,
  catalogueItems: sfmcLanguageService.getCompletions({ text, languageId: 'ssjs', uri }, position),
  receiver: 'Platform.Function',
});
// members: Lookup, LookupRows, … each with the catalogue's documentation and an insert
// text for the member alone; null where TypeScript does not know the receiver's type.
```

- `createSsjsTypeScriptService({ globalsDts, diagnosticUrl? })` returns an independent instance with `updateDocument`, `removeDocument`, `getCompletions`, `getCompletionInfo`, `getDiagnostics`, `getHover`, `getDefinition`, `getReferences` and `getSignatureHelp`. Results are LSP types. `diagnosticUrl(code)` may supply a documentation link per TypeScript diagnostic code.
- For a mixed HTML document, pass `ssjsProjection(text)` to `updateDocument`: it keeps only the server-side script bodies, at their original offsets. `isInSsjsRegion(text, offset)` tells whether a position belongs to SSJS.
- `memberCompletions(...)` is the shared rule for completions after a dot: TypeScript decides which members exist, and the catalogue describes those it knows. Pass `hasNew: true` when `new` precedes the receiver (`new Script.Util.`), so that a constructor is inserted as a call.

## Core-version-aware SSJS diagnostics

Some Core library members only exist up to a maximum `Platform.Load("Core", <version>)` and are `undefined` beyond it. The SSJS validator reads the `maxCoreVersion` metadata from `ssjs-data`, compares it against the Core version the document actually loads, and escalates the diagnostic accordingly:

- No `Platform.Load("Core", …)`, or a version within range → **Warning** ("deprecated")
- A version above `maxCoreVersion` → **Error** (the member is `undefined`, so the call throws a `TypeError` at runtime)

`ErrorUtil` and `ErrorUtil.ThrowWSProxyError` are the first members covered — both are limited to Core version `"1"`.

## Diagnostic identities and documentation

The [diagnostic rule reference](docs/rules/README.md) covers all 38 public rules and their 50 internal variants. First-party diagnostics carry a canonical `Diagnostic.code` such as `sfmc/amp-arg-types` and a `codeDescription.href` pointing to this repository at `blob/v<LSP package version>/docs/rules/...`. The LSP owns these URLs, even when bundled in an extension with a different version. Versions are embedded at build time; diagnostic creation needs neither the filesystem nor Git.

**Migration / semver:** canonical `sfmc/...` codes replace legacy `ampscript/...`, `ssjs/...`, and `handlebars/...` codes and name previously uncoded checks. Consumers comparing codes or reading diagnostic data must migrate. This is a breaking public diagnostic-contract change. Version `4.0.0` introduces this contract as one major step from `3.17.1`. Consumers upgrading from `3.x` must migrate; the new contract and its documentation are not part of `3.17.1`.

Boolean-like AMPscript enum parameters accept all eight catalog forms. Bare `true` and `false` are preferred; numeric and quoted alternatives remain valid but receive the `sfmc/amp-prefer-boolean-literal` warning. Hovers show one documentation link, our own guide page for the language and the platform the document targets (`targetPlatform`): an AMPscript function links its sfmc.guide Engagement page in Engagement mode (falling back to ampscript.guide when there is none) and its sfmc.guide Next page in Next mode. In Next mode a function Next does not support gets no hover; its `sfmc/amp-no-mcn-unsupported` diagnostic says why. Handlebars helpers link their sfmc.guide page first, then the Salesforce Developers page. SSJS links ssjs.guide (built-ins also MDN).

Quick-fix data now uses `{ sfmc: { variant, payload } }`. Treat `payload` as opaque: it preserves the original primitive string or object rather than flattening it. Use `decodeDiagnosticData(code, data)` to normalize old code + old payload and new code + envelope into the same variant/payload input. Existing code-action handlers accept both formats. Canonical IDs shared by multiple checks require the explicit variant; do not infer a polyfill, replacement, or delimiter fix from the public ID alone. Forward the complete diagnostic, including its data, through editor adapters.

Development builds deterministically use the package's prospective version URL. It may not resolve until **a new release tag contains both the code and documentation**. There is no fallback to `main` or an older tag, and existing tags must never be rewritten to add pages. Release this producer before rebuilding downstream consumers. The release workflow checks its own tag, version, commit, and tagged documentation; offline packed-artifact checks exercise CJS, ESM, and the browser-compatible registry graph from an actual npm tarball.

### 4.0.0 release notes

- **Breaking:** all first-party validators emit canonical public rule IDs and a namespaced, lossless diagnostic-data envelope. Consumers must migrate code comparisons and preserve explicit variants; legacy code-action inputs remain supported.
- Added 36 rule-reference pages covering 47 variants, plus version-owned documentation URLs for previously unnamed diagnostics. CJS, ESM, and type build entry points embed the same package version without runtime filesystem or Git access.
- ESLint-overlap suppression now includes the AttributeValue recommendation. Other overlap classifications remain variant-aware; similarly named checks are not assumed interchangeable.
- Added producer-tag/documentation and packed-artifact safeguards. Downstream consumers must adopt this major only after publication.
- Adopted `ssjs-data@^2.1.0`, including nine newly catalogued unavailable built-ins from tested Engagement CloudPages. They have no bundled verified polyfill. The shared SSJS validator continues to delegate such absences to consumer TypeScript checks; it does not fabricate polyfill diagnostics or actions. This is not evidence for email or every execution context.

### Pre-release consumer acceptance

From the multi-repository development workspace root, run `npm run test:diagnostic-integration`. The harness copies source, locks and fixtures into temporary staging, excludes existing installations, builds and packs this producer, and installs that tarball explicitly into both extension resolution sites and the MCP consumer. All npm installs are cache-only; a missing cached dependency is a reported blocker. Build, lint and full consumer tests remain required, including the extension host (which requires an available VS Code test runtime). The command removes staging when it finishes.

The **declared-dependency baseline** first installs the unchanged consumer locks and reports their build/test status. **Local-producer acceptance** then installs the packed prospective release with `--no-save` only inside staging, retaining lock-based resolution of unrelated dependencies. A passing local run is not registry or release-provenance evidence.

For release, publish the LSP and its tagged documentation first. Only after it is available, update the extension root/server and MCP dependency manifests to `^4.3.0`, refresh their locks, and repeat clean-install acceptance without a local override. The extension additionally runs **release-only** `npm run verify:lsp-release --no-workspaces`: it resolves the actually bundled LSP, uses `gh` to resolve that exact tag to an immutable commit, and verifies its manifest and every registry-linked rule page in that commit. Ordinary tests use offline negative fixtures; no diagnostic emission performs network or Git operations.

## Install

```bash
npm install sfmc-language-lsp
```

## Build

From this package directory:

```bash
npm ci
npm run build
npm test
```

## License

MIT — see [LICENSE](./LICENSE).
