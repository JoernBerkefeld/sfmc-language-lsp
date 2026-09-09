# sfmc/amp-no-js-line-comment

## Trigger and why it matters

Reports a **warning** when sanitized AMPscript code contains `//` not immediately preceded by `:`. The match extends to the end of that scanned line. AMPscript uses `/* ... */`, not JavaScript-style line comments, even when embedded in an HTML script tag.

The scan operates inside recognized AMPscript regions after masking strings and AMPscript block comments. Text outside those regions is ignored. The colon exception avoids treating a protocol separator as a comment; it does not make an unquoted URL valid AMPscript.

## Examples and fix

Invalid:

```ampscript
%%[
// Choose the display label.
SET @label = "Ready"
]%%
```

Valid:

```ampscript
%%[
/* Choose the display label. */
SET @label = "Ready"
]%%
```

For a comment beside a statement, replace only its comment portion with a block comment. Keep comments in block or tag-based code rather than adding them inside an inline output expression.

## Variant and quick fix

The internal variant is `ampscript/js-line-comment`.

**Convert to AMPscript block comment** is the preferred quick fix. It replaces the diagnostic range with `/* text */`, using the preserved comment-text payload when present, otherwise stripping `//` and trimming the original range. It does not rewrite the surrounding statement.

Inspect the edit preview if the line contains quotes or AMPscript comment markers: the payload comes from sanitized text, so some original content may have been blanked. A comment body containing `*/` also requires a manual rewrite to avoid closing the replacement early.

## Platform applicability

The check runs for both Marketing Cloud Engagement and Marketing Cloud Next targets. It checks AMPscript, not SSJS or browser JavaScript, where `//` has a different meaning. Running the check in Next mode does not certify support for the containing content surface.

## Suppression and ESLint distinction

With `disableLspDiagnosticsForEslintRules: true`, the shared service suppresses this overlapping diagnostic in favor of ESLint's `sfmc/amp-no-js-line-comment`. The low-level validator itself still emits it. ESLint disable comments do not suppress this LSP scan, and it implements no per-rule inline suppression directive. Correct the comment syntax when possible.

The LSP uses a sanitized-text pattern; ESLint's parser-backed coverage and fixes need not be identical.

## Related rules

- [HTML comments](no-html-comment.md)
- [Nested script tags](no-nested-script-tag.md)
