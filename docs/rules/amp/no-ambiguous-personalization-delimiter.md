# sfmc/amp-no-ambiguous-personalization-delimiter

## What triggers this rule

The LSP reports a **warning** when a personalization string such as `%%emailaddr%%` is immediately followed by `[` or `=`, with no character in between. The closing `%%` of the string and that character then read as `%%[` or `%%=`, the two AMPscript opening delimiters. The marked range runs from the start of the personalization string through the `[` or `=`.

Marketing Cloud replaces a personalization string whose name it can resolve before it parses AMPscript. Once replaced, the `%%` is gone and the following text is output as written. A name it cannot resolve is left in place, and the trailing `%%` plus the next character does open AMPscript. The same source text can therefore produce two different results.

## Examples and correction

Reported:

```ampscript
<a href="https://example.com/?subscriber=%%emailaddr%%=1">Open</a>
<td>%%First Name%%[optional]</td>
```

Corrected, when the following text is meant literally:

```ampscript
<a href="https://example.com/?subscriber=%%emailaddr%%&flag=1">Open</a>
<td>%%First Name%% [optional]</td>
```

Corrected, when AMPscript was intended:

```ampscript
<td>%%First Name%% %%=v(@label)=%%</td>
```

Put a space or another character between the personalization string and the `[` or `=`, or move the AMPscript away from the string. Only the trailing side is checked: `=%%emailaddr%%` and `]%%emailaddr%%`, the usual form of a URL parameter value, are not reported.

## Variants, platform, and quick fixes

- `ampscript/system-personalization-before-delimiter`: the name is a known system personalization string. It always resolves, so the following text never starts AMPscript.
- `ampscript/personalization-before-delimiter`: any other name. Whether it resolves depends on the account and on where the content runs: a profile attribute or a sendable data extension field resolves in a send, and often does not on a CloudPage. The LSP cannot know which applies.

Both variants are warnings and run for Engagement and Next targets. The check applies only outside `%%[ ... ]%%` blocks, `%%= ... =%%` inline expressions and server-side JavaScript script bodies. Because the text may open AMPscript at runtime, the first matching `]%%` or `=%%` after a reported string is not reported as an unexpected closer by the balanced-delimiters rule.

No quick fix is offered; the intended reading has to be chosen manually.

## Suppression and ESLint

Both variants overlap ESLint's `sfmc/amp-no-ambiguous-personalization-delimiter`, so the service setting `disableLspDiagnosticsForEslintRules: true` suppresses the LSP report. The direct validator still emits them. Confirm ESLint coverage if delegating the check. There is no per-rule inline AMPscript disable directive in the LSP.

## Related rules

- [Balanced delimiters](balanced-delimiters.md)
- [Nested AMPscript delimiters](no-nested-ampscript-delimiter.md)
