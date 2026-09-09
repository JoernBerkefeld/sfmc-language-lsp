# sfmc/ssjs-no-clr-header-access

## Trigger and rationale

Reports an **Error** for indexed access to a tracked HTTP response's `headers`, or calls to its `headers.Get(...)` or `headers.Item(...)`. The response must be assigned from a tracked request's `send()` call; requests are recognized through assignments from `Script.Util.HttpRequest(...)` or `Script.Util.HttpGet(...)`, with or without `new`.

These response headers are CLR-backed, not a normal JavaScript map. Direct lookup can throw a CLR-access exception. Enumerate the header keys instead of indexing the original object. The catalog records that HttpGet header enumeration is empty; use HttpRequest when headers are needed.

## Invalid example

```js
// Create a request and incorrectly index its CLR-backed headers.
var req = new Script.Util.HttpRequest('https://example.com/status');
var resp = req.send();
var header = resp.headers['content-type'];
```

## Valid example

```js
// Retrieve the response.
var req = new Script.Util.HttpRequest('https://example.com/status');
var resp = req.send();
// Collect enumeration keys without reading CLR header values.
var headerEntries = [];
for (var key in resp.headers) {
  headerEntries[headerEntries.length] = String(key);
}
```

This example collects the encoded entries, not a ready-made name/value map. For individual values, parse the enumeration keys or use the supplied helper action. The helper removes enclosing brackets, splits at the first comma-space, and lowercases header names.

## Quick fix and variant

Internal/legacy variant: `ssjs/clr-header-access`. The preserved payload contains `respName` and `keyText`. The preferred action, **Read header via getHeaderMap(resp)**, replaces the flagged expression with `getHeaderMap(resp)[keyText]` and inserts the helper unless the document already contains `function getHeaderMap(`. The original key expression is retained: use a lowercase lookup key because the helper normalizes names. Insertion is at the document start, or after a leading single-line `/* global ... */` directive; inspect placement in embedded HTML and keep the helper inside a server script block.

## Platform, suppression, and limits

- Intended for Marketing Cloud Engagement (MCE). The check is not gated off for a Next target, so it can accompany the separate SSJS-not-supported diagnostic. Fixing headers does not enable SSJS in Next.
- `disableLspDiagnosticsForEslintRules: true` suppresses this overlapping LSP diagnostic through the language service. The ESLint counterpart is `sfmc/ssjs-no-clr-header-access`. ESLint disable comments control ESLint, not this validator directly.
- Recognition is a text-based assignment scan, not scope-aware or alias-aware data flow. A missing warning is not proof that other header-access forms work. Examples are static checks, not live HTTP tests; handle network errors separately.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`collectClrHeaderAccessDiagnostics`), [actions](../../../src/codeActions/ssjs.ts) (`HEADER_MAP_HELPER`, `getSsjsCodeActions`), and [registry](../../../src/diagnostic-rules.ts). Related: [response content conversion](require-string-clr-content.md).
