# sfmc/amp-no-html-comment

## Trigger and why it matters

Reports a **warning** for a complete `<!-- ... -->` comment found in sanitized AMPscript code. HTML comment syntax is not an AMPscript comment: use `/* ... */` inside an AMPscript block instead. Ordinary HTML comments outside AMPscript regions are not the target of this check. Strings and AMPscript block comments are masked before scanning.

## Examples and fix

Invalid inside an AMPscript block:

```ampscript
%%[
<!-- Choose the display label. -->
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

Keep comments in block or tag-based AMPscript, not inside an inline output expression. If the comment belongs to the surrounding HTML rather than the program, move it outside the AMPscript region.

## Variants and quick fixes

- `ampscript/html-comment`: **Convert to AMPscript block comment** is the preferred action. It strips the HTML delimiters, trims the enclosed text, and replaces the diagnostic range with `/* text */`.
- `ampscript/html-wrapped-comment`: **Remove HTML comment wrapper** is the preferred action. It replaces the range with the preserved inner AMPscript comment. This variant recognizes the exact adjacent wrapper shape `<!--/* ... */-->` in the scanned text.

The wrapped-comment branch has an important current limitation: sanitization removes `/* ... */` before the HTML-comment scan. Consequently, source containing `<!--/* Preserve the display label. */-->` can receive the ordinary `html-comment` variant rather than the dedicated wrapper variant. Manually remove only `<!--` and `-->` in that case; do not assume the offered conversion is equivalent. Always inspect the edit preview, especially for nested comment markers. An unterminated HTML comment is outside this complete-comment pattern.

The public rule groups both variants; integrations must preserve the diagnostic variant and payload to select the intended action.

## Platform applicability

The LSP runs this syntax check for both Marketing Cloud Engagement and Marketing Cloud Next targets. The examples use Engagement block syntax; this check does not establish whether a particular Next content surface accepts that embedding form.

## Suppression and ESLint distinction

The shared service suppresses both variants when `disableLspDiagnosticsForEslintRules` is `true`, allowing the overlapping ESLint rule `sfmc/amp-no-html-comment` to report instead. Direct low-level validator calls still return their diagnostics. ESLint configuration and disable comments control ESLint, not this LSP scan; no per-rule inline suppression directive is implemented here. Prefer fixing the syntax rather than hiding the warning.

This page describes the LSP's text-based scan and quick fixes, not a guarantee that ESLint's parser-backed reporting or fixes are identical.

## Related rules

- [JavaScript line comments](no-js-line-comment.md)
- [Balanced delimiters](balanced-delimiters.md)
