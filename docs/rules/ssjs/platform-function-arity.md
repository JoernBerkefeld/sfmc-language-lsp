# sfmc/ssjs-platform-function-arity

## Trigger and rationale

Reports an **Error** for a `Platform.Function` call whose argument count is inside the catalogued minimum/maximum range but is not in the function's explicit `validArities` list. Optional-looking trailing parameters may belong to an all-or-nothing overload rather than independent optional arguments.

For example, `Platform.Function.HTTPGet` accepts one or six arguments. Counts from two through five can fail at runtime even though they fall between the minimum and maximum. Only functions declaring a nonempty `validArities` list participate in this LSP check.

## Invalid example

```js
// Supply only part of the extended HTTPGet overload.
var text = Platform.Function.HTTPGet('https://example.com/status', true);
```

## Valid example

```js
// Use the supported single-argument overload.
var text = Platform.Function.HTTPGet('https://example.com/status');
```

If extended behavior is needed, supply the complete supported overload with correctly typed values instead. Removing arguments is not automatically equivalent to the original intent.

## Quick fixes and variant

Internal/legacy variant: `ssjs/invalid-arity`. No rule-specific payload or automatic quick fix is supplied. Choosing an overload requires deciding which behavior the application needs.

## Platform, suppression, and limits

- Applies to MCE Platform functions. The pass also runs with a Next target, alongside the separate SSJS-not-supported diagnostic. A valid argument count does not enable SSJS in Next.
- The language service suppresses this overlap when `disableLspDiagnosticsForEslintRules` is true; the ESLint counterpart is `sfmc/ssjs-platform-function-arity`. ESLint disable comments do not directly suppress this validator.
- This LSP variant specifically checks gaps **within** the minimum/maximum range. It is not the complete min/max or argument-type validation performed by other tooling; do not infer that an out-of-range call is valid because this variant is absent.
- Matching recognizes the `Platform.Function` path with whitespace and case tolerance, not arbitrary aliases. Argument counting blanks strings/comments and accounts for nested delimiters. It does not execute a request or validate response contents. The examples were statically checked only.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`collectPlatformFunctionArityDiagnostics`, `countFunctionArguments`), [actions](../../../src/codeActions/ssjs.ts) (no handler for this variant), and [registry](../../../src/diagnostic-rules.ts).
