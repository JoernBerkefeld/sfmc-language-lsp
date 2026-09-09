# sfmc/amp-no-nested-ampscript-delimiter

## Trigger and why it matters

Reports an **error** for a `%%[` or `%%=` opener inside an already recognized AMPscript region. Delimiters enter AMPscript from surrounding content; they are not needed to nest a statement or expression in existing AMPscript code.

## Examples and fix

Invalid delimiters inside a tag-based block:

```html
<script runat="server" language="ampscript">
  %%[
  /* Choose the display label. */
  SET @label = "Ready"
  ]%%
</script>
```

Valid:

```html
<script runat="server" language="ampscript">
  /* Choose the display label. */
  SET @label = "Ready"
</script>
```

Another invalid form is a block inside a block:

```ampscript
%%[
/* Choose the display label. */
%%[ SET @label = "Ready" ]%%
]%%
```

Remove the inner delimiter pair, retaining one outer block:

```ampscript
%%[
/* Choose the display label. */
SET @label = "Ready"
]%%
```

## Variants and quick fixes

- `ampscript/nested-delimiter-in-script`: an opener in the body of a complete AMPscript script element.
- `ampscript/nested-delimiter`: an opener inside a complete `%%[ ... ]%%` block or `%%= ... =%%` inline expression. Both nested opener forms are checked in either region.

For either variant, **Remove redundant %%[ delimiter** or **Remove redundant %%= delimiter** removes only the flagged opener and is not preferred. If a later corresponding closer exists, the preferred **Remove %%[...]%% delimiter pair** action or **Remove %%=...=%% delimiter pair** removes that opener and the first subsequent matching closer.

The pair action searches forward for the first `]%%` or `=%%`; it does not parse nested structure. Review which closer it removes. Removing only an opener can leave an unmatched closer. Removing inline delimiters also does not convert a bare expression into an output statement, so a manual semantic correction may be needed.

The region scans use raw text, not the comment/string-masked text used by many other AMPscript checks. Delimiter-like text inside a string or comment can therefore be flagged. Region matching stops at the first closer and does not establish full nesting correctness.

## Platform applicability

These checks run under both Engagement and Next targets. Tag-based examples illustrate Engagement syntax; passing the check is not certification that a Next content surface supports a given embedding form.

## Suppression and ESLint distinction

Both variants overlap `sfmc/amp-no-nested-ampscript-delimiter` and are suppressed by the shared service when `disableLspDiagnosticsForEslintRules` is `true`. The direct validator still emits them. There is no inline per-rule LSP suppression; ESLint disable comments apply only to ESLint. This text-based LSP scan and its pair-removal action are not a promise of identical ESLint behavior.

## Related rules

- [Balanced delimiters](balanced-delimiters.md)
- [Nested script tags](no-nested-script-tag.md)
