# sfmc/ssjs-no-switch-fallthrough

## Trigger and rationale

Reports a **Warning** for each nonfinal switch clause that is either empty or has a body without a recognized terminating statement. Both `case` and `default` clauses participate. The last clause is excluded because there is no following clause.

MCE's SSJS engine does not provide JavaScript-style switch fall-through. An empty label does not borrow the following label's body, and a nonempty clause does not cascade into the next clause. A comment saying that fall-through is intentional does not restore this behavior.

## Invalid example

```js
// Try to share one body between two labels.
var state = 'ready';
var result = '';
switch (state) {
  case 'ready':
  case 'queued':
    result = 'send';
    break;
}
```

## Valid example

```js
// Give each matching case its own complete body.
var state = 'ready';
var result = '';
switch (state) {
  case 'ready':
    result = 'send';
    break;
  case 'queued':
    result = 'send';
    break;
}
```

An `if` condition combining the alternatives is another option. For intended cascading behavior, explicitly perform every required operation in the matching branch; adding `break` alone only removes the warning, not the missing work.

## Quick fixes and variants

Internal/legacy variant: `ssjs/switch-fallthrough`. Empty-label and unterminated-body findings use the same variant but distinct messages. There is no rule-specific payload or automatic quick fix: choosing between duplication, shared helpers, and conditionals changes application structure.

## Platform, suppression, and limits

- This check runs for MCE and is skipped when `targetPlatform` is `next`, where SSJS is independently unsupported.
- The language service suppresses it with `disableLspDiagnosticsForEslintRules: true`. The overlapping ESLint rule is `sfmc/ssjs-no-switch-fallthrough`; ESLint comments do not directly suppress the LSP check.
- The text scanner blanks strings/comments and tests the body ending for `break`, `return`, `throw`, or `continue`. It is not full control-flow analysis; nested conditions and complex termination can be classified conservatively or incompletely.
- The snippets were statically validated, not run on a CloudPage. No warning is not proof that every branch implements the intended behavior.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`collectSwitchFallthroughDiagnostics`, `clauseFallthroughDiagnostics`), [actions](../../../src/codeActions/ssjs.ts) (no handler for this variant), and [registry](../../../src/diagnostic-rules.ts).
