# sfmc/ssjs-no-deprecated-function

## What triggers this diagnostic?

The internal variant `ssjs/deprecated` groups several data-driven checks under this public rule. Canonical diagnostics preserve the variant in `data.sfmc.variant`.

- Deprecated bare-name globals, such as classic Content Area helpers, produce a **warning**. When the entry supplies `aliasOf`, the message names that alternative.
- Deprecated `Platform.Function.*` calls produce a **warning** and advise using a supported alternative.
- Deprecated Core Library methods produce a **warning**, with method-specific deprecation guidance when available. The scan recognizes direct Core object paths and variables assigned from a recognized `Class.Init(...)` call, including nested member paths. It respects the catalog's static/instance distinction.
- Deprecated `ErrorUtil.*` calls normally produce a **warning**, but become an **error** when the first recognized literal Core version exceeds the catalogued maximum supported version. In that case the namespace is unavailable, so the issue is a runtime failure rather than only a retired API.

All four categories use the same internal variant; they do not have separate quick-fix variants.

## Why it matters and how to fix it

Deprecated APIs may still be callable, but new work should use maintained alternatives. Classic content APIs and their modern replacements can refer to different asset systems: migrating a function name does not migrate an asset or preserve its ID.

### Invalid: deprecated classic content lookup

```javascript
// Retrieve an existing classic Content Area through its retired API.
var content = Platform.Function.ContentArea(12345);
```

### Valid: migrated Content Builder asset

```javascript
// Render the replacement Content Builder asset by its own ID.
var content = Platform.Function.ContentBlockByID(67890);
```

The IDs are illustrative and must identify existing assets in their respective systems. First migrate the content and then use the new asset's ID. These single-argument Platform calls do not need Core loading. This example is not an automatic one-to-one conversion of optional parameters, error handling, or content behavior.

For `ErrorUtil`, inspect the operation's result status and implement explicit error handling instead of depending on the retired helper. Merely changing Core to the recommended version can turn a deprecation warning into an unavailable-method error. The validator currently describes these helpers as available only in Core `1` and absent from newer versions; do not downgrade Core simply to hide the error.

## Quick fixes

The shared SSJS code-action provider has **no automatic fix** for `ssjs/deprecated`, including its ErrorUtil error case. An alias in the message is guidance only. Asset migration, API selection, and result handling require manual review.

## Scope and limitations

These scans skip recognized comments but are text-based, not full lexical-scope or data-flow analysis. They do not generally exclude strings, resolve arbitrary aliases, understand computed member access, or track reassignment and control flow. The Core instance map is built from recognized initialization assignments across the document; it does not prove that initialization executes before a call. Incorrect static/instance call styles are skipped by this particular method check, not certified as valid.

ErrorUtil severity uses the first non-commented literal Core version found in the document, not execution-path analysis. Other rules can independently report missing Core loading or a nonrecommended version. The absence of this diagnostic does not mean a method is supported: missing and nonfunctional APIs have separate checks.

The compatibility advice targets Marketing Cloud Engagement. These deprecation scans also run in a Next-targeted document, where SSJS is unsupported entirely; see [no-mcn-unsupported](no-mcn-unsupported.md).

## Suppression

`disableLspDiagnosticsForEslintRules` suppresses this overlapping LSP rule when delegating to ESLint's `sfmc/ssjs-no-deprecated-function`. The raw validator does not interpret ESLint disable directives as per-line LSP suppression. Configure the ESLint rule separately. Suppression does not restore an unavailable ErrorUtil method or migrate retired assets.

## Implementation reference

See the deprecated-global, Platform Function, and ErrorUtil scans plus `collectDeprecatedMethodDiagnostics` in [the SSJS validator](../../../src/validators/ssjs.ts). The canonical rule and internal variant are mapped in [the diagnostic registry](../../../src/diagnostic-rules.ts).
