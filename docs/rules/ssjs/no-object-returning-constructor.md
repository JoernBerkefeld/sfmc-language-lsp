# sfmc/ssjs-no-object-returning-constructor

## Trigger and rationale

Reports a **Warning** at `new Name(...)` when the document contains a user-defined function of that name with a direct object-literal return in its own body. Both named declarations and functions assigned to identifiers can be recognized.

In MCE SSJS, constructing such a function does not replace the constructed `this` with its returned object literal. Members that exist only on the returned object are therefore missing. Use the function as a factory without `new`, or write constructor members onto `this` instead of returning a separate object.

## Invalid example

```js
/**
 * Create a state record.
 * @returns {object} A state record.
 */
function makeState() {
  return { ready: true };
}
// Incorrectly construct a function intended to return a record.
var record = new makeState();
```

## Valid example

```js
/**
 * Create a state record.
 * @returns {object} A state record.
 */
function makeState() {
  return { ready: true };
}
// Call the factory normally to retain its returned object.
var record = makeState();
```

Do not remove `new` indiscriminately from genuine constructors that initialize `this`; choose the factory or constructor design deliberately.

## Quick fix and variant

Internal/legacy variant: `ssjs/new-object-returning-constructor`. No rule-specific payload or automatic quick fix is offered. The diagnostic message suggests a normal function call or initialization through `this`, but neither is an automatically applied edit.

## Platform, suppression, and limits

- This MCE check is skipped for `targetPlatform: 'next'`; SSJS itself is unsupported in Next.
- **LSP-only:** the registry sets `eslintRuleId` to null and `suppressWithEslint` to false. `disableLspDiagnosticsForEslintRules` does not hide it, and ESLint disable comments do not suppress it. There is no per-rule inline LSP suppression implemented here.
- Detection uses a document-wide name set, not lexical binding or control-flow resolution. Only `return` immediately followed by an object literal at the function body's first brace depth is recognized. Returns inside nested blocks/functions, parenthesized returns, aliases, and dotted constructor paths are not comprehensively covered.
- Built-in constructor names are excluded even if a local function shadows one. No warning is not a guarantee that a constructor is safe.
- Examples were statically validated only; the runtime explanation comes from the implemented check and its documented engine limitation, not a new CloudPage execution during documentation work.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`bodyReturnsObjectLiteral`, `collectObjectReturningFunctionNames`, `collectNewObjectReturnDiagnostics`, `NEW_SAFE_BUILTINS`), [actions](../../../src/codeActions/ssjs.ts) (no handler for this variant), and [registry](../../../src/diagnostic-rules.ts).
