# sfmc/ssjs-require-string-clr-content

## Trigger and rationale

Reports an **Error** on a tracked HTTP response's raw `.content` access unless the immediately preceding text identifies a `String(...)` wrapper. A request variable is recognized from an assignment using `Script.Util.HttpRequest(...)` or `Script.Util.HttpGet(...)`, optionally with `new`; a response variable is then recognized from an assignment using that request's `send()`.

The returned content is a CLR string. Convert it to a JavaScript string before storing it for string processing, concatenating it, or parsing JSON. A successful HTTP response does not make its raw content a native JavaScript string.

## Invalid example

```js
// Retrieve a response and retain the raw CLR content.
var req = new Script.Util.HttpRequest('https://example.com/status');
var resp = req.send();
var body = resp.content;
```

## Valid example

```js
// Retrieve the response and convert its content before further use.
var req = new Script.Util.HttpRequest('https://example.com/status');
var resp = req.send();
var body = String(resp.content);
```

## Quick fix and variant

Internal/legacy variant: `ssjs/clr-content-access`. The payload contains `respName` and `contentText`. The preferred **Wrap with String(resp.content)** action replaces only the flagged member expression with `String(resp.content)`. It does not insert a helper, parse JSON, check HTTP status, or catch request failures.

## Platform, suppression, and limits

- This is an MCE runtime safeguard. The check also runs with a Next target and may appear beside the SSJS-not-supported diagnostic; the conversion is not a Next compatibility workaround.
- The language service suppresses this overlapping diagnostic when `disableLspDiagnosticsForEslintRules` is true. Its ESLint counterpart is `sfmc/ssjs-require-string-clr-content`; ESLint comments do not directly suppress the LSP validator.
- Matching is textual, not scope-aware data flow. Aliases and indirect request factories are not comprehensively tracked. Wrapper recognition examines only a short preceding text window, so unusual whitespace or more complex equivalent conversions may still be flagged.
- The examples have been statically validated, not executed against an endpoint. Conversion does not establish that the response is successful or contains valid JSON.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`collectClrContentAccessDiagnostics`), [actions](../../../src/codeActions/ssjs.ts) (`getSsjsCodeActions`), and [registry](../../../src/diagnostic-rules.ts). Related: [CLR header access](no-clr-header-access.md).
