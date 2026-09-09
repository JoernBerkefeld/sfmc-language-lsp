# sfmc-language-lsp

Protocol-agnostic, browser-compatible **language service** for Salesforce Marketing Cloud — **AMPscript**, **SSJS**, and **GTL**. It provides validation, completions, hover, signature help, and code actions, with full **Marketing Cloud Next (MCN)** platform support.

Data comes from the [`ampscript-data`](https://www.npmjs.com/package/ampscript-data) and [`ssjs-data`](https://www.npmjs.com/package/ssjs-data) packages. Consumers include the [SFMC Language Service](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language) VS Code extension (bundled) and the [mcp-server-sfmc](https://www.npmjs.com/package/mcp-server-sfmc) MCP server (runtime dependency).

## Marketing Cloud Next (MCN) support

When `targetPlatform` is set to `'next'` in `SfmcSettings`, the language service:

- Flags AMPscript functions not supported on MCN as **errors**
- Flags all SSJS as **unsupported** (SSJS is not available on MCN)
- Surfaces MCN API version and behavioral-difference notes in hover documentation

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

## Core-version-aware SSJS diagnostics

Some Core library members only exist up to a maximum `Platform.Load("Core", <version>)` and are `undefined` beyond it. The SSJS validator reads the `maxCoreVersion` metadata from `ssjs-data`, compares it against the Core version the document actually loads, and escalates the diagnostic accordingly:

- No `Platform.Load("Core", …)`, or a version within range → **Warning** ("deprecated")
- A version above `maxCoreVersion` → **Error** (the member is `undefined`, so the call throws a `TypeError` at runtime)

`ErrorUtil` and `ErrorUtil.ThrowWSProxyError` are the first members covered — both are limited to Core version `"1"`.

## Diagnostic identities and documentation

The [diagnostic rule reference](docs/rules/README.md) covers all 36 public rules and their 47 internal variants. First-party diagnostics carry a canonical `Diagnostic.code` such as `sfmc/amp-arg-types` and a `codeDescription.href` pointing to this repository at `blob/v<LSP package version>/docs/rules/...`. The LSP owns these URLs, even when bundled in an extension with a different version. Versions are embedded at build time; diagnostic creation needs neither the filesystem nor Git.

**Migration / semver:** canonical `sfmc/...` codes replace legacy `ampscript/...`, `ssjs/...`, and `handlebars/...` codes and name previously uncoded checks. Consumers comparing codes or reading diagnostic data must migrate. This is a breaking public diagnostic-contract change. Version `4.0.0` introduces this contract as one major step from `3.17.1`. Consumers upgrading from `3.x` must migrate; the new contract and its documentation are not part of `3.17.1`.

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

The **declared-dependency baseline** first installs the unchanged consumer locks and reports their build/test status. Those locks still resolve released `3.17.1` and cannot satisfy the new canonical diagnostic tests; plain `npm ci` is not claimed to pass feature acceptance. **Local-producer acceptance** then installs the packed prospective `4.0.0` with `--no-save` only inside staging (retaining lock-based resolution of unrelated dependencies). A passing local run is not registry or release-provenance evidence.

For release, publish the new breaking LSP version and its tagged documentation first. Only after it is available, update the extension root/server and MCP dependency manifests to the new major range (prospectively `^4.0.0`), refresh their locks, and repeat clean-install acceptance without a local override. The extension additionally runs **release-only** `npm run verify:lsp-release --no-workspaces`: it resolves the actually bundled LSP, uses `gh` to resolve that exact tag to an immutable commit, and verifies its manifest and every registry-linked rule page in that commit. Ordinary tests use offline negative fixtures; no diagnostic emission performs network or Git operations.

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
