# sfmc/amp-set-requires-target

## What triggers this rule

An error is emitted when sanitized AMPscript contains `SET` followed by optional whitespace and `=` without a target in between. Matching is case-insensitive, and the diagnostic highlights the `SET` through `=` span.

Assignment requires a destination variable. Without one, the expression cannot be assigned as intended. This check specifically detects the missing-target form; it is not a complete grammar validator for every malformed assignment or variable name.

## Examples and correction

Reported:

```ampscript
%%[
/* This assignment has no destination. */
SET = "Sample"
]%%
```

Corrected:

```ampscript
%%[
/* Store the value in the intended AMPscript variable. */
SET @text = "Sample"
]%%
```

Choose the variable that later code is meant to read, including its `@` prefix. Inserting a random variable can hide the syntax symptom while leaving the program's data flow wrong. If assignment was not intended, rewrite the statement to express the actual operation instead.

## Variants, platform, and quick fixes

The internal variant is `ampscript/set-no-target`. Whitespace and letter-case differences use the same diagnostic. The rule applies to both Engagement and Next.

There is no LSP quick fix because the missing variable name cannot be inferred safely.

## Suppression and ESLint

This overlaps ESLint's `sfmc/amp-set-requires-target`. The language-service option `disableLspDiagnosticsForEslintRules: true` suppresses the overlapping LSP diagnostic, not the invalid assignment. Use it only as duplicate-report management with corresponding ESLint coverage. Inline disable comments are not supported by this LSP rule.
