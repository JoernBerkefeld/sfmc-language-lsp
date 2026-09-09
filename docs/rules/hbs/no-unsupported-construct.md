# sfmc/hbs-no-unsupported-construct

## Trigger and why it matters

Reports an **error** for a parsed construct that the Marketing Cloud Next (MCN) catalog explicitly marks unsupported. MCN does not allow a template author to register arbitrary partials or decorators, so syntax accepted by a general Handlebars parser is not necessarily usable in MCN.

The internal variant and legacy code are `handlebars/unsupported-construct`. Its equivalent ESLint rule is `sfmc/hbs-no-unsupported-construct`.

## Covered constructs

The validator checks AST node types for partials, partial blocks, decorators, and decorator blocks (including inline partial declarations). It also checks a mustache statement whose simple helper name is `log`. These are cases of the same diagnostic variant, not separate public rule IDs. This is a catalog-driven check, not a blanket rejection of every unfamiliar expression; other invocations can trigger [no-unknown-helper](no-unknown-helper.md).

## Invalid example

A partial reference requires functionality unavailable in this engine:

```handlebars
{{> footer}}
```

## Valid example and fix

For a small static footer, replace the partial reference with the actual content:

```html
<p>Thank you for reading.</p>
```

For more complex templates, restructure the content using supported MCN features rather than assuming that a JavaScript partial-registration API is available. Remove debugging-only `log` statements instead of expecting them to print in the rendered message. There is no universal mechanical rewrite for a partial or decorator.

## Platform and scope

This check runs in the shared service for `targetPlatform: 'next'`, not Engagement. It runs after a successful Handlebars parse, with AMPscript regions blanked before parsing, and respects the shared problem budget. A [syntax error](syntax-error.md) stops this validator before construct checks can run.

## Quick fixes and suppression

There is **no dedicated quick fix** for unsupported constructs. The Handlebars quick-fix provider handles suggested helper and built-in binding replacements only.

When using `SfmcLanguageService.validate`, setting `disableLspDiagnosticsForEslintRules: true` suppresses this overlapping LSP diagnostic so an appropriately configured ESLint rule can own the report. The low-level validator itself does not apply that service-level filter. ESLint rule configuration and disable comments affect ESLint, not this shared LSP validator. Suppression does not make the construct supported in MCN.
