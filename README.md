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
