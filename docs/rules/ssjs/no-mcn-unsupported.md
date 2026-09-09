# sfmc/ssjs-no-mcn-unsupported

## What triggers this diagnostic?

When the SSJS validator receives `targetPlatform: 'next'`, it emits a document-level **error**: SSJS is not supported in Marketing Cloud Next. The internal variant is `ssjs/mcn-not-supported`; there is no fix-specific payload.

The range covers the first nonblank line, not every incompatible statement. The check runs after other checks and only if the diagnostic budget has room, so earlier errors can consume that budget. Even an empty document passed directly to the Next SSJS validator receives a zero-width diagnostic on its first line.

## Why it matters

A script can use perfectly valid Engagement syntax and still have no SSJS execution environment in Next. Changing a function name, loading Core, or adding a polyfill cannot enable the language there.

## Invalid for Next

The following is shown only as an unsupported migration input, not as a Next implementation:

```javascript
// Store a flag using SSJS syntax.
var active = true;
```

With the Next target, even this otherwise simple snippet produces the platform error.

## Valid alternative

If this is genuinely Engagement content, the same snippet is valid for this rule when the service is configured with `targetPlatform: 'engagement'`. Correct a mistakenly selected target; do not select Engagement merely to hide a real Next incompatibility.

For an actual Next project, remove the SSJS and implement the requirement in a supported language or platform feature. The diagnostic recommends AMPscript, but each needed operation must be checked for Next support. For this particular example, deleting an unused flag leaves no SSJS requirement; there is no valid Next SSJS rewrite to show. Removing a script from content is different from asking the raw SSJS validator to validate an empty string as a Next script.

## Quick fixes and variants

There is no SSJS code action for this rule. Migration is not a mechanical substitution, so the provider does not offer an automatic rewrite or a target-changing action. Canonical transport records `ssjs/mcn-not-supported` in `data.sfmc.variant`; legacy diagnostics use that value as their code.

Other SSJS findings may appear alongside this one. Their Engagement-oriented recommendations do not make SSJS supported in Next.

## Suppression and ESLint overlap

The service's `disableLspDiagnosticsForEslintRules` setting suppresses this overlapping LSP check when delegating diagnostics to ESLint. The corresponding `sfmc/ssjs-no-mcn-unsupported` rule is enabled in the appropriate Next ESLint configurations. Ensure the ESLint target configuration is correct before relying on duplicate suppression.

ESLint disable comments do not provide per-line suppression to the raw SSJS validator. Suppression does not change the destination platform's capabilities.
