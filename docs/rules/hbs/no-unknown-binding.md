# sfmc/hbs-no-unknown-binding

## Trigger and why it matters

Reports a **warning** when a built-in token in the `{!$...}` form is not in the Marketing Cloud Next (MCN) binding catalog. These tokens identify reserved platform-provided values, not Handlebars helper calls or arbitrary custom field references. A typo can prevent the intended platform value from being selected.

The internal variant and legacy code are `handlebars/unknown-binding`. The equivalent ESLint rule is `sfmc/hbs-no-unknown-binding`.

## Invalid example

The organization address binding is misspelled:

```handlebars
{!$organization.Adress}
```

## Valid example and fix

Use the catalogued token:

```handlebars
{!$organization.Address}
```

The catalog also includes `{!$link.EmailAddressOptOutUrl}` and `{!$link.PreferenceCenterUrl}`. Choose the token for the intended value; a nearby spelling is only a suggestion, not evidence that it has the same meaning.

## Scope and variants

All unknown built-in tokens use the same diagnostic variant. The validator matches a complete `{!$...}` token whose name contains only ASCII letters, digits, underscores, or dots. A malformed token outside that pattern may not be reported by this rule. Ordinary mustache data references and custom field availability are outside its scope.

The scan runs over sanitized text after a successful Handlebars parse. The parser treats these binding tokens as literal content, so the validator checks them separately with a regular expression. AMPscript regions are blanked before this scan; this is not an HTML-aware attribute or comment filter. A [syntax error](syntax-error.md) prevents the binding scan from running. Reports respect the shared problem budget.

## Quick fixes

When a nearby catalog name exists, the provider offers a preferred replacement action, for example **Replace '{!$organization.Adress}' with '{!$organization.Address}'**. It replaces the complete offending binding token and leaves surrounding text intact. If no suggestion is attached, no binding replacement action is available. Revalidate after applying a correction.

## Platform and suppression

The shared service runs this check for `targetPlatform: 'next'`, not Engagement. `SfmcLanguageService.validate` filters it out when `disableLspDiagnosticsForEslintRules: true`, because it overlaps the named ESLint rule. The low-level validator does not apply that service-level filter. ESLint configuration and disable comments control ESLint separately; they do not suppress this shared LSP check or make an unknown binding valid.
