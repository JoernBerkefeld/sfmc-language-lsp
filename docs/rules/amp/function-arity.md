# sfmc/amp-function-arity

## What triggers this rule

A known AMPscript function call produces an error when its top-level argument count is below the catalog's minimum, above its maximum, or fails the catalog's repeating-group model. The error highlights the function name.

Optional parameters do not count toward the minimum. Variadic does not mean arbitrary: functions with repeating pairs or groups must receive complete groups. For count-controlled search/update families, the count and the remaining pairs must agree. If a call's argument count cannot be determined, this check does not invent a count.

## Examples and correction

Too few arguments:

```ampscript
%%[
/* Substring needs both input and a starting position. */
SET @part = Substring("Sample")
]%%
```

Valid:

```ampscript
%%[
/* The optional length limits the extracted text. */
SET @part = Substring("Sample", 1, 3)
]%%
```

`Substring("Sample", 1)` is also valid: omitting its optional third argument means taking the remainder. A fourth argument exceeds its maximum. For repeating-group errors, read the relevant function signature and supply each required name/value pair rather than appending arbitrary placeholders.

Correct argument count does not establish correct argument values. Type and enum validation follows when the call passes arity checks; see [arg-types](arg-types.md).

## Variants, platform, and quick fixes

Too few, too many, and incomplete repeat groups share the internal variant `ampscript/function-arity` and public ID above. This check runs on both Engagement and Next; support for the function itself is checked separately on Next.

No LSP quick fix inserts, removes, or guesses arguments for this rule.

## Suppression and ESLint

This overlaps ESLint's `sfmc/amp-function-arity`. `disableLspDiagnosticsForEslintRules: true` suppresses the service's duplicate report. Make sure the matching ESLint check is active if using that option. There is no LSP per-rule inline suppression syntax for AMPscript arity checks.
