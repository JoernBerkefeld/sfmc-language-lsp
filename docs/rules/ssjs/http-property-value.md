# sfmc/ssjs-http-property-value

## Trigger and rationale

Reports an **Error** when a recognized HTTP request property receives a literal that violates its `ssjs-data` value constraint. Requests are tracked through assignments from `Script.Util.HttpRequest(...)` or `Script.Util.HttpGet(...)`, optionally preceded by `new`. The diagnostic highlights the right-hand value, not the whole statement.

Constraints can require a listed enum value, a numeric value, a safe integer, or a minimum. For example, the current method constraint accepts `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`; a misspelling is not a custom verb. Retry values must satisfy the catalog's numeric constraints. This diagnostic follows the catalog used by the installed LSP, not every verb listed by external HTTP documentation.

## Invalid example

```js
// Assign an unrecognized method and a fractional retry count.
var req = new Script.Util.HttpRequest('https://example.com/status');
req.method = 'POT';
req.retries = -2.5;
```

## Valid example

```js
// Use a catalogued method and a nonnegative whole retry count.
var req = new Script.Util.HttpRequest('https://example.com/status');
req.method = 'GET';
req.retries = 2;
```

## Quick fixes and variant

Internal/legacy variant: `ssjs/invalid-http-property-value`. Its payload contains `propName` and `suggestions`, each carrying source-ready `code` and an optional meaning `label`.

For an enum violation, **Replace with ...** actions offer each allowed value and replace only the invalid literal. The first suggestion is marked preferred; that ordering does not mean it matches your application's intent. Numeric constraints provide no replacement actions because the validator cannot choose the intended retry count for you.

## Platform, suppression, and limits

- The constraints describe MCE behavior. This pass is not disabled for a Next target, but SSJS itself remains unsupported there.
- `disableLspDiagnosticsForEslintRules: true` suppresses this overlapping LSP diagnostic at the language-service boundary. ESLint can report `sfmc/ssjs-http-property-value` instead. An ESLint disable comment does not directly control LSP validation.
- Only plain string, decimal-number, or boolean literals on a single-line assignment RHS are checked. Variables, arithmetic, template strings, and other expressions are skipped, not certified as valid.
- Tracking uses textual variable names rather than scope/alias analysis. The check does not send a request or prove the remote endpoint accepts the chosen method. The examples are static illustrations, not runtime tests.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`parseLiteralValue`, `checkValueConstraint`, `constraintSuggestions`, `collectInvalidHttpPropertyDiagnostics`), [actions](../../../src/codeActions/ssjs.ts), and [registry](../../../src/diagnostic-rules.ts). Related: [property access direction](no-invalid-property-access.md).
