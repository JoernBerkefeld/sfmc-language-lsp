# sfmc/amp-no-nested-script-tag

## Trigger and why it matters

Reports an **error** for an AMPscript `<script>` opener encountered while another AMPscript script block remains open. This often means a missing `</script>` before the next block. Separate sibling blocks are allowed; nesting script elements is not how to organize AMPscript control flow.

The LSP recognizes case-insensitive `<script ... language="ampscript" ...>` openers with single or double quotes, and `</script>` closers. It masks complete HTML comments before tracking depth. The recognition pattern does not require `runat="server"`; production tag-based AMPscript should still include it. This is not a general HTML tag validator: every matched script closer reduces the tracked depth, and strings are not separately masked by this scan.

## Examples and fix

Invalid, with the first block left open:

```html
<script runat="server" language="ampscript">
  /* Choose the display label. */
  SET @label = "Ready"
  <script runat="server" language="ampscript">
  /* Change the display label. */
  SET @label = "Waiting"
</script>
```

Valid sibling blocks:

```html
<script runat="server" language="ampscript">
  /* Choose the display label. */
  SET @label = "Ready"
</script>
<script runat="server" language="ampscript">
  /* Change the display label. */
  SET @label = "Waiting"
</script>
```

Alternatively, merge the statements into one script element and remove the redundant opener. Choose according to the intended document structure.

## Variant and quick fix

The internal variant is `ampscript/nested-script-tag`.

**Insert missing </script> closing tag before this block** is the preferred action. It inserts exactly `</script>` followed by a newline at the beginning of the flagged opening tag; it does not remove a tag or rebalance the rest of the document. Review the resulting structure if there were already enough closing tags or several nested openers. A lone missing closing tag without a later opener does not trigger this rule.

## Platform applicability

The LSP runs the check under both Engagement and Next settings. The examples demonstrate Engagement tag-based AMPscript. A clean result in Next mode does not prove that a Next content surface supports script-tag embedding.

## Suppression and ESLint distinction

The service suppresses this diagnostic with `disableLspDiagnosticsForEslintRules: true` because it overlaps `sfmc/amp-no-nested-script-tag`. Direct validator calls still emit it. There is no per-rule inline LSP suppression, and ESLint disable comments only affect ESLint. Fixing the missing or redundant tag is preferable.

The LSP performs a depth scan rather than full HTML parsing; do not assume its edge cases or action exactly match ESLint.

## Related rules

- [Nested AMPscript delimiters](no-nested-ampscript-delimiter.md)
- [Balanced control flow](balanced-control-flow.md)
