# sfmc/gtl-balanced-blocks

## Trigger and why it matters

Reports a **warning** for a recognized Guide Template Language (GTL) block opener without a matching closer, or a recognized closer without a matching opener. Incomplete blocks can leave the intended conditional or repeated content structure unfinished.

This LSP-only rule groups two internal variants:

- `gtl/unclosed-block`: a recognized opening tag remains unmatched at the end of the scan.
- `gtl/unexpected-close`: a recognized closing tag has no matching opening tag in the current stack.

Earlier versions emitted these warnings without a diagnostic code. Both now share the public ID `sfmc/gtl-balanced-blocks`; there is no equivalent ESLint rule registered for duplicate suppression.

## Invalid example: missing closer

```handlebars
{{#if true}}Ready
```

Close the conditional:

```handlebars
{{#if true}}Ready{{/if}}
```

## Invalid example: unexpected closer

```handlebars
Ready{{/if}}
```

If the text is meant to be unconditional, remove the stray closing tag:

```html
Ready
```

If it is meant to be conditional, restore the opening conditional with the intended condition instead. Fix the structure rather than adding an unrelated opening tag merely to balance the count.

## Recognized forms and limitations

The scanner recognizes opening prefixes for `each`, `if`, `switch`, and `datasource` immediately after `{{#` or `{{.`. Recognized closers are `{{/each}}`, `{{/if}}`, `{{/switch}}`, and `{{/.datasource}}`, with optional whitespace before the final braces. Matching is case-sensitive. In particular, a dot-prefixed datasource opener is paired with the dot-prefixed datasource closer.

This is a lightweight text scan, not a full GTL parser. It does not validate conditions, datasource declarations, helper arguments, or arbitrary block names. Opening-tag detection does not establish that the opening expression is otherwise complete. It scans the provided text without an HTML-comment or embedded-language masking pass of its own.

For a closer, it removes the most recent matching opener anywhere in the stack rather than requiring that opener to be the top frame. Consequently, crossed nesting can escape this check. No warning means only that this scanner found no unmatched recognized tags within its problem budget; it does not certify the template as valid GTL.

## Platform, quick fixes, and suppression

The shared service uses this check for Marketing Cloud Engagement, not Marketing Cloud Next. For Next, [Handlebars syntax validation](../hbs/syntax-error.md) parses the template instead. Direct callers of the low-level GTL validator are responsible for platform routing.

There is **no dedicated GTL block-repair quick fix**. Add, remove, or correct tags manually and revalidate. `disableLspDiagnosticsForEslintRules` does **not** suppress these LSP-only warnings. ESLint disable comments do not suppress this text scanner. Reports are limited by the shared problem budget, so fixing one problem can reveal another.
