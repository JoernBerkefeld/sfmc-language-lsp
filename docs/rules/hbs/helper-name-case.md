# sfmc/hbs-helper-name-case

## Trigger and why it matters

Reports a **warning** when a template calls a catalogued Marketing Cloud Next (MCN) helper with different letter case, for example `properCase` instead of `propercase`. Next matches helper names case-sensitively: in live tests it rejected emails using `properCase`, `jsonPath` and `timeZoneConversion` when they were saved, and accepted and rendered the same calls written `propercase`, `jsonpath` and `timezoneConversion`.

The internal variant is `handlebars/helper-name-case`. It has no legacy code and no ESLint equivalent.

## Invocation variants

The validator examines the same forms as [unknown helpers](no-unknown-helper.md): a mustache expression with arguments, a subexpression, and a block helper. A bare mustache with no arguments is a data reference and is not checked. A name that matches no helper in any case gets the unknown-helper warning instead, never both.

## Invalid example

```handlebars
{{properCase firstName}}
```

## Valid example and fix

Write the name exactly as the catalog spells it:

```handlebars
{{propercase firstName}}
```

## Quick fixes

The provider offers a preferred quick fix such as **Replace 'properCase' with 'propercase'**. For a block helper it also corrects the name in the closing tag.

## Platform and suppression

This check runs for `targetPlatform: 'next'` in the shared service, not Engagement, after a successful parse, and shares the problem budget with the other Handlebars checks. It is LSP-only, so `disableLspDiagnosticsForEslintRules` does not suppress it.
