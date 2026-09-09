# Diagnostic rule reference

These pages document the diagnostics owned by `sfmc-language-lsp`: 36 public rule IDs covering 47 internal variants. Follow the rule shown in `Diagnostic.code`; variants preserve distinct quick fixes when several checks share a public ID.

Links within this index are relative so opening it at a release tag keeps navigation on that same release. Diagnostic URLs use the **LSP package version**, not the editor extension version, an installed language-data version, or a dependency range. Development URLs are prospective until the corresponding new release tag contains these pages. There is no fallback to `main`, and old tags must not be rewritten.

## AMPscript

- [Argument types and enum values](amp/arg-types.md)
- [Balanced control flow](amp/balanced-control-flow.md)
- [Balanced delimiters](amp/balanced-delimiters.md)
- [Function arity](amp/function-arity.md)
- [Deprecated functions](amp/no-deprecated-function.md)
- [HTML comments](amp/no-html-comment.md)
- [JavaScript line comments](amp/no-js-line-comment.md)
- [Next-unsupported functions](amp/no-mcn-unsupported.md)
- [Nested AMPscript delimiters](amp/no-nested-ampscript-delimiter.md)
- [Nested script tags](amp/no-nested-script-tag.md)
- [Nonfunctional functions](amp/no-nonfunctional-function.md)
- [Smart quotes](amp/no-smart-quotes.md)
- [Unknown functions](amp/no-unknown-function.md)
- [AttributeValue recommendation](amp/prefer-attribute-value.md)
- [SET target requirement](amp/set-requires-target.md)

## SSJS

- [HTTP property values](ssjs/http-property-value.md)
- [CLR header access](ssjs/no-clr-header-access.md)
- [Cross-block forward references](ssjs/no-cross-block-forward-reference.md)
- [Deprecated functions](ssjs/no-deprecated-function.md)
- [Invalid property access](ssjs/no-invalid-property-access.md)
- [Next-unsupported SSJS](ssjs/no-mcn-unsupported.md)
- [Nonexistent globals](ssjs/no-nonexistent-global.md)
- [Nonfunctional methods](ssjs/no-nonfunctional-method.md)
- [Object-returning constructors](ssjs/no-object-returning-constructor.md)
- [Switch fallthrough](ssjs/no-switch-fallthrough.md)
- [Unavailable methods](ssjs/no-unavailable-method.md)
- [Unsupported syntax](ssjs/no-unsupported-syntax.md)
- [Platform function arity](ssjs/platform-function-arity.md)
- [Core library version preference](ssjs/prefer-platform-load-version.md)
- [Core library loading](ssjs/require-platform-load.md)
- [CLR content conversion](ssjs/require-string-clr-content.md)

## Handlebars

- [Unknown bindings](hbs/no-unknown-binding.md)
- [Unknown helpers](hbs/no-unknown-helper.md)
- [Unsupported constructs](hbs/no-unsupported-construct.md)
- [Syntax errors](hbs/syntax-error.md)

## GTL

- [Balanced blocks](gtl/balanced-blocks.md)

## Consumer compatibility and suppression

See the [package migration notes](../../README.md#diagnostic-identities-and-documentation) before comparing diagnostic codes or reading quick-fix data. Each rule page identifies its platforms, variants, quick fixes, and ESLint overlap. `disableLspDiagnosticsForEslintRules` applies only to classified overlapping checks, not every diagnostic with a similar ESLint name. In particular, the newly named AttributeValue recommendation is now included in overlap suppression.
