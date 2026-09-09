# sfmc/ssjs-no-invalid-property-access

## Trigger and rationale

Checks property access against the `access` metadata in `ssjs-data`:

- Reading a **write-only** property is an Error: the missing getter can throw and abort execution if uncaught.
- Reading a **write-only-opaque** property is a Warning: the value returned is an opaque CLR value rather than the value you assigned.
- Assigning to a **read-only** property is an Error: the assignment has no effect.

The validator recognizes literal `Platform.Request` and `Platform.Response` member paths and variables assigned from `Script.Util.HttpRequest(...)` or `Script.Util.HttpGet(...)`. For outbound data, retain the original value yourself instead of reading it back from the request handler.

## Invalid example

```js
// Attempt to read a write-only request property.
var req = new Script.Util.HttpRequest('https://example.com/status');
var sentBody = req.postData;
```

## Valid example

```js
// Keep the body locally and write it to the request handler.
var req = new Script.Util.HttpRequest('https://example.com/status');
var sentBody = 'hello';
req.postData = sentBody;
```

This example demonstrates the permitted access direction only; it is not a complete request configuration. For an opaque write-only property, likewise retain a local copy. For a read-only property, remove the assignment and change the actual input or configuration that determines its value.

## Quick fixes and variant

Internal/legacy variant: `ssjs/invalid-property-access`. The diagnostic has no rule-specific payload or automatic quick fix. The validator cannot safely introduce application variables or decide how a read-only value should be changed.

## Platform, suppression, and limits

- This documents MCE runtime property behavior. The pass still runs for a Next target; resolving it does not make SSJS available in Next.
- With `disableLspDiagnosticsForEslintRules: true`, the language service suppresses this overlap in favor of ESLint's `sfmc/ssjs-no-invalid-property-access`. ESLint comments alone do not suppress this LSP check.
- A plain `=` immediately after the member is classified as a write; comparisons are reads. Compound assignments and increments are not modeled as full read/write operations. Call-shaped reads are skipped here to avoid duplicating property-call diagnostics.
- The scan is textual and does not fully track scopes, aliases, computed access, or runtime objects. The snippets were statically checked, not executed against MCE; no diagnostic is not proof of runtime safety.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`propertyAccessMessage`, `collectInvalidPropertyAccessDiagnostics`), [actions](../../../src/codeActions/ssjs.ts) (no handler for this variant), and [registry](../../../src/diagnostic-rules.ts). Related: [HTTP property values](http-property-value.md).
