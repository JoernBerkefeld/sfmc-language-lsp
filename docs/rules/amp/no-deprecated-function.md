# sfmc/amp-no-deprecated-function

## What triggers this rule

A call to a catalogued AMPscript function marked `deprecated` produces a warning on the function name. Matching is case-insensitive. The diagnostic includes a reason and replacement name when the catalog supplies them; a replacement is not guaranteed.

Deprecation identifies an API to migrate away from, not necessarily a call that always fails. A function marked both deprecated and nonfunctional can also produce [no-nonfunctional-function](no-nonfunctional-function.md).

## Examples and correction

Reported in Marketing Cloud Engagement:

```ampscript
%%[
/* Legacy content access is deprecated. */
SET @content = ContentArea(123)
]%%
```

After migrating the content into a Content Builder block:

```ampscript
%%[
/* Use the customer key of the migrated block. */
SET @content = ContentBlockByKey("current-banner")
]%%
```

The key is illustrative and the block must exist. This is a migration example, not a mechanical rename: classic content IDs are not Content Builder customer keys. Verify rendering and optional arguments against the replacement's signature.

## Variants, platform, and quick fixes

The internal variant is `ampscript/deprecated-function`. It is evaluated for both Engagement and Next targets. On Next, an unsupported call can additionally produce [no-mcn-unsupported](no-mcn-unsupported.md).

There is no LSP quick fix for this rule. Even when diagnostic data contains a replacement name, the AMPscript code-action provider does not rewrite the call.

## Suppression and ESLint

This check overlaps ESLint's `sfmc/amp-no-deprecated-function`. Setting the language-service option `disableLspDiagnosticsForEslintRules` to `true` suppresses the overlapping LSP report; ensure ESLint is configured to report it before doing so. This is service-level duplicate suppression, not an AMPscript comment directive. The LSP does not implement a per-rule inline disable directive for this check.
