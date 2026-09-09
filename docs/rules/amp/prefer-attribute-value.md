# sfmc/amp-prefer-attribute-value

## What triggers this rule

The validator emits an informational recommendation when a `SET @variable = ...` assignment starts its right-hand side with one of these bare attribute names, case-insensitively: `FirstName`, `LastName`, `EmailAddress`, `Email_Address`, or `FullName`.

This is a small heuristic, not a complete inventory of account attributes or all direct-access syntax. It does not inspect a tenant schema, and a different bare field name can pass without a recommendation. The highlighted range covers the assignment prefix through the matched attribute name.

## Why and how to correct it

In Engagement, explicit `AttributeValue` access makes the attribute lookup intentional and handles missing attributes more safely. It does not create missing data or select a fallback greeting for you.

Reported recommendation (the input is not inherently a syntax error):

```ampscript
%%[
/* Direct access relies on the attribute being available. */
SET @name = FirstName
]%%
```

Preferred in Engagement:

```ampscript
%%[
/* Read the named attribute through the null-safe accessor. */
SET @name = AttributeValue("FirstName")
]%%
```

Keep the original attribute name inside quotes, and add application-specific missing-value handling where required. Do not replace a literal string or a variable reference merely because its spelling resembles an attribute name.

## Variants, platform, and quick fixes

The internal variant is `ampscript/prefer-attribute-value`. Older LSP versions emitted this recommendation without a diagnostic code. The stable public ID names that existing check; it does not broaden its attribute list.

The heuristic currently runs for both target platforms, but its recommendation is only applicable to Engagement: `AttributeValue` is not supported in Next and would trigger [no-mcn-unsupported](no-mcn-unsupported.md). For Next, choose appropriate Next data binding instead of applying the Engagement recommendation mechanically.

No LSP quick fix wraps the attribute automatically.

## Suppression and ESLint

The registry contract classifies this recommendation as overlapping ESLint's `sfmc/amp-prefer-attribute-value`. Accordingly, `disableLspDiagnosticsForEslintRules: true` suppresses it along with other overlapping LSP reports. This is an intentional correction to the old unnamed diagnostic, which escaped code-based duplicate suppression. It does not change which assignments trigger the recommendation.

Configure the matching ESLint rule when delegating reporting. The language-service setting is not an inline directive, and this LSP check has no per-rule AMPscript comment suppression.
