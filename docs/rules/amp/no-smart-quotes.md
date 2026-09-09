# sfmc/amp-no-smart-quotes

## What triggers this rule

The LSP reports an error for each recognized typographic quote character inside an AMPscript region. It scans the original text, not just parsed string delimiters. The matched characters are U+2018, U+2019, U+201C, U+201D, U+201A, U+201E, U+2039, and U+203A.

Rich-text editors often replace ordinary quotes during copying. Those replacement characters cannot delimit AMPscript strings. The scan is intentionally broader than that syntax error: it can also report matched characters inside comments or otherwise valid string contents. It does not report ordinary prose outside AMPscript regions.

## Examples and correction

Reported:

```ampscript
%%[
/* Typographic quotes cannot delimit this string. */
SET @text = “Sample”
]%%
```

Corrected:

```ampscript
%%[
/* Straight ASCII quotes delimit this string. */
SET @text = "Sample"
]%%
```

Use ASCII single or double quotes for string boundaries. Check both the opening and closing character. If the marked character is intentional displayed punctuation rather than a delimiter, distinguish that broader scanner warning from a parser failure; do not blindly replace every typographic character throughout the surrounding HTML.

## Variants, platform, and quick fixes

The internal variant is `ampscript/smart-quotes`; all eight matched character forms share the same public ID. The rule runs for both Engagement and Next.

The LSP does not offer a quick fix for quote replacement. The correction above is manual.

## Suppression and ESLint

This is classified as overlapping ESLint's `sfmc/amp-no-smart-quotes`, although the LSP's raw-text scan is not an AST-level check. The service setting `disableLspDiagnosticsForEslintRules: true` suppresses its LSP report. Confirm ESLint coverage if delegating it. There is no per-rule inline AMPscript disable directive in the LSP.
