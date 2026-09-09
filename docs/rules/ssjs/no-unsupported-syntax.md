# sfmc/ssjs-no-unsupported-syntax

## What triggers this diagnostic?

An **error** reports a text pattern associated with syntax that Marketing Cloud Engagement's SSJS engine does not support. The internal variant is `ssjs/unsupported-syntax`; canonical transport preserves it in `data.sfmc.variant`.

The current checks cover:

- `let` and `const` followed by whitespace.
- Arrow tokens followed by optional whitespace and `{` or `(`.
- Backtick-delimited template literals.
- Named class declarations, `async function`, and `await` followed by whitespace.
- Simple `for...of` headers with a bare loop variable or a `var` declaration.
- Generator declarations with `function` and `*` on the same line.
- Three consecutive dots, covering spread/rest-shaped syntax.
- Object or array destructuring starting with `var {` or `var [` (including intervening whitespace).

## Why it matters and how to fix it

Syntax accepted by a modern JavaScript editor may fail before an SSJS script can execute. Rewrite declarations with `var`, templates with concatenation, destructuring with explicit property/index access, and iteration with a traditional loop. Replace arrow functions with ordinary functions after reviewing their binding semantics. Async functions, generators, and classes need a design-level rewrite, not just removal of the highlighted token. Loading Core or inserting a method polyfill cannot add parser syntax support.

### Invalid

This intentionally demonstrates unsupported syntax:

```javascript
// Declare a counter using syntax unavailable in SSJS.
const count = 1;
```

### Valid

```javascript
// Declare the counter using legacy SSJS syntax.
var count = 1;
```

Changing a block-scoped declaration to `var` is not always behavior-preserving: review variable scope, loop captures, and reassignment before applying that change throughout a script.

## Quick fixes

The shared SSJS code-action provider has **no automatic fix** for this variant. The message's rewrite advice is manual guidance, not an available editor action. Actions offered by a separate ESLint integration are independent.

## Scope and limitations

This is a regular-expression scan, not a complete JavaScript parser or runtime compatibility proof. It skips matches beginning inside recognized comments, but does not generally exclude string contents. Unsupported forms outside the listed patterns can go unreported; for example, an arrow whose expression body starts with an identifier is not covered by the arrow pattern. A clean result does not establish that all syntax or built-ins work in SSJS.

These checks concern Engagement compatibility and also run on Next-targeted SSJS documents. Next does not support SSJS at all; see [no-mcn-unsupported](no-mcn-unsupported.md). Converting individual syntax tokens does not make a script Next-compatible.

## Suppression

The language service's `disableLspDiagnosticsForEslintRules` setting suppresses this overlapping rule when checks are delegated to ESLint's `sfmc/ssjs-no-unsupported-syntax`. The raw validator does not interpret ESLint disable comments as per-line LSP suppression. Configure the ESLint rule separately if needed. Suppression hides the report, not the runtime failure.

## Implementation reference

The patterns and severity are defined by `es6Patterns` and `collectEs6PatternDiagnostics` in [the SSJS validator](../../../src/validators/ssjs.ts). The public/internal identity mapping is in [the diagnostic registry](../../../src/diagnostic-rules.ts).
