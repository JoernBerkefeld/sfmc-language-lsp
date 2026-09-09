# sfmc/amp-arg-types

## What triggers this rule

After a known call passes argument-count checks, the validator compares its arguments with available catalog parameter metadata. It reports errors on the affected arguments for two kinds of mismatch:

- **Type mismatch:** a recognizable literal has a type outside the parameter's allowed union. It also checks inferred variable types when the parameter requires a non-primitive `rowset`, `row`, or `object`.
- **Enum mismatch:** a static string, number, or boolean is not among the parameter's enumerated values. Enum membership is case-insensitive. Variables and expressions whose values are not statically known are skipped.

For an enum parameter, the enum branch takes precedence over the ordinary type branch. The check is not full runtime evaluation: unknown variable values, every conversion, and all semantic constraints are not proven safe just because there is no diagnostic. Parameters without corresponding metadata are not checked.

## Examples and correction

Reported:

```ampscript
%%[
/* Wrong literal type. */
SET @part = Substring("Sample", true)
/* Unsupported enum member. */
SET @days = DateDiff("2026-09-08", "2026-09-09", "W")
]%%
```

Corrected:

```ampscript
%%[
/* Supply a supported start-position type. */
SET @part = Substring("Sample", 1)
/* Count day boundaries using an accepted unit. */
SET @days = DateDiff("2026-09-08", "2026-09-09", "D")
]%%
```

Read the parameter name and accepted values in the error. A union such as `string|number` permits either listed type; it does not mean that every string is a sensible numeric position. Similarly, a variable passed as a rowset must actually originate from a rowset-producing operation, not merely have a plausible name.

## Variants, platform, and quick fixes

Both `ampscript/arg-type` and `ampscript/enum-value` intentionally share the public ID `sfmc/amp-arg-types`. The namespaced diagnostic data retains the exact internal variant and original payload. Consumers must not infer an ambiguous variant from the public ID alone.

Both checks apply on Engagement and Next, independently of whether Next supports the called function. Argument counts are covered separately by [function-arity](function-arity.md).

Neither variant has an LSP quick fix. The service does not guess a replacement literal, conversion, or enum member.

## Suppression and ESLint

Both variants overlap ESLint's `sfmc/amp-arg-types` and are suppressed by the language-service setting `disableLspDiagnosticsForEslintRules: true`. This is one public rule with two checks, not a separate enum rule to disable. Confirm the corresponding ESLint rule is enabled when delegating reports. The LSP does not implement per-rule AMPscript inline disable comments.
