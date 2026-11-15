# sfmc/amp-balanced-delimiters

## Trigger and why it matters

Reports an **error** for an AMPscript opening delimiter without its closing delimiter, and for a closing delimiter outside any AMPscript region. Block syntax pairs `%%[` with `]%%`; inline output syntax pairs `%%=` with `=%%`. A missing or extra delimiter can change which content is interpreted as AMPscript.

## Examples and fix

Invalid unclosed block:

```ampscript
%%[
/* Choose the display label. */
SET @label = "Ready"
```

Valid after restoring the block closer:

```ampscript
%%[
/* Choose the display label. */
SET @label = "Ready"
]%%
```

Invalid inline output with its closing delimiter missing:

```ampscript
%%=v("Ready")
```

Valid inline output:

```ampscript
%%=v("Ready")=%%
```

The inline example renders a literal label. It intentionally has no embedded comment because comments belong in block code rather than inline output syntax.

For an unexpected closer, remove a redundant `]%%` or `=%%`, or restore the opener if the enclosed content was meant to execute. Do not add a delimiter blindly: first establish where the AMPscript region should start and end.

## Variants and limitations

- `ampscript/unclosed-block`: a `%%[` opener with no following `]%%`.
- `ampscript/unexpected-block-close`: a `]%%` outside any AMPscript region.
- `ampscript/unclosed-inline`: a `%%=` opener with no following `=%%`.
- `ampscript/unexpected-inline-close`: a `=%%` outside any AMPscript region.

The check scans the raw document text from left to right. A `%%[` region ends at the first following `]%%` and a `%%=` region at the first following `=%%`, including delimiter text inside strings and comments. Personalization strings such as `%%emailaddr%%` are skipped as a whole, so neither of their `%%` pairs forms a delimiter, and the bodies of server-side JavaScript script elements are not scanned. After an unclosed opener the scan resumes right behind it, so later regions are still recognised. It is not a full parser and does not balance `<script>` tags. A closer that may belong to AMPscript opened by a [personalization string directly followed by `[` or `=`](no-ambiguous-personalization-delimiter.md) is not reported.

## Quick fixes

No AMPscript quick fix is implemented for these four variants. Correct the intended boundary manually, then validate again. The separate nested-delimiter rule can offer removals, but those are not fixes supplied by this rule.

## Platform applicability

This LSP check runs for both Marketing Cloud Engagement and Marketing Cloud Next targets. It checks textual balance, not whether a content surface supports the selected embedding form or the functions inside it.

## Suppression and LSP-only distinction

This is an **LSP-only** rule, with no overlapping ESLint rule in the registry. `disableLspDiagnosticsForEslintRules: true` does not suppress it. ESLint parser failures may independently report malformed syntax, but they are not this named diagnostic. ESLint disable comments do not suppress it, and the LSP implements no per-rule inline suppression directive. Fix the boundary or use a host-level validation control if the host exposes one; the diagnostic budget is not a per-rule suppression mechanism.

## Related rules

- [Nested AMPscript delimiters](no-nested-ampscript-delimiter.md)
- [Balanced control flow](balanced-control-flow.md)
- [Nested script tags](no-nested-script-tag.md)
