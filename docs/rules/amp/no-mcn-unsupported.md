# sfmc/amp-no-mcn-unsupported

## What triggers this rule

With `targetPlatform: 'next'`, the validator reports an error on each known AMPscript function call that the canonical catalog does not mark as supported in Marketing Cloud Next. With an Engagement target this compatibility check does not run.

A familiar Engagement function is not automatically available in Next. This is a platform check, not a spelling or signature check: unknown names are handled by [no-unknown-function](no-unknown-function.md), and known names may additionally fail arity or type validation.

## Examples and correction

Reported for Next:

```ampscript
%%[
/* Engagement attribute access is not supported on Next. */
SET @attribute = AttributeValue("FirstName")
]%%
```

An example of supported Next AMPscript:

```ampscript
%%[
/* This expression has no subscriber-context lookup. */
SET @part = Substring("Sample", 1, 3)
]%%
```

The second example is a compatibility contrast, not an equivalent replacement for personalized attribute access. To preserve that requirement, redesign the data binding using the Next context and supported templating features available to your content. Check the target-platform catalog rather than assuming an Engagement API has a direct Next substitute.

If the document is actually for Engagement, correct the host's target-platform configuration instead of rewriting working Engagement code. Do not change the target merely to hide a real Next deployment problem.

## Variants, platform, and quick fixes

The internal variant is `ampscript/mcn-unsupported-function`. It is Next-only and checks the catalog's supported-function set; it does not independently select a Salesforce API version or verify tenant feature availability.

No LSP quick fix is provided for platform migration.

## Suppression and ESLint

The equivalent ESLint rule is `sfmc/amp-no-mcn-unsupported`, available in the Next configurations. The service setting `disableLspDiagnosticsForEslintRules: true` suppresses this LSP duplicate. Ensure the Next ESLint rule is actually active before relying on it. The LSP does not accept an AMPscript inline directive to allow an unsupported function.
