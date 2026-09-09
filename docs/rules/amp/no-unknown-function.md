# sfmc/amp-no-unknown-function

## What triggers this rule

The validator finds an identifier followed by `(` in sanitized AMPscript code and cannot match it to a catalogued function, language keyword, or recognized control-flow construct. The result is an error on the identifier. Names are matched case-insensitively; changing only capitalization does not fix an unknown function.

AMPscript does not support user-defined functions. JavaScript method names and invented helper names do not become callable AMPscript functions merely because they look like a call.

## Examples and correction

Reported:

```ampscript
%%[
/* The function name is misspelled. */
SET @part = Substrng("Sample", 1, 3)
]%%
```

Corrected:

```ampscript
%%[
/* Extract the first three characters with the catalogued function. */
SET @part = Substring("Sample", 1, 3)
]%%
```

Check the function hover or catalog for the intended operation and signature. If the name came from another language, rewrite the operation rather than just renaming it. Known calls then undergo separate argument checks; unknown calls skip those checks because no signature is available.

## Variants, platform, and quick fixes

The internal variant is `ampscript/unknown-function`. It applies on Engagement and Next. A known Engagement-only function is not unknown: Next reports it under [no-mcn-unsupported](no-mcn-unsupported.md). Unknown identifiers are excluded from that known-function compatibility scan.

There is no spelling-replacement quick fix in the LSP AMPscript code-action provider. The suggested spelling above is a manual correction.

## Suppression and ESLint

The equivalent ESLint ID is `sfmc/amp-no-unknown-function`. Use `disableLspDiagnosticsForEslintRules: true` at the language-service level only when deliberately handing overlapping reports to ESLint. This does not validate a custom function or change runtime support. The LSP has no inline comment suppression for this rule.
