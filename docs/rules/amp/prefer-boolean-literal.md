# sfmc/amp-prefer-boolean-literal

## What triggers this rule

A boolean-like AMPscript enum parameter uses an accepted numeric or quoted alternative instead of a bare boolean. The catalog may permit `1`, `0`, `"true"`, `"false"`, `"1"`, or `"0"`; these values remain valid and do not produce an enum error.

Bare `true` and `false` do not trigger this warning. Quoted matching remains case-insensitive.

## Examples and correction

Reported:

```ampscript
%%[ RaiseError("stop", true, "", 0, "1") ]%%
```

Preferred:

```ampscript
%%[ RaiseError("stop", true, "", 0, true) ]%%
```

The warning message identifies the corresponding bare boolean.

## Platform, quick fixes, and suppression

This warning applies wherever the catalog exposes the complete eight-value boolean-like enum. Its quick-fix titles are **Replace with `true`** and **Replace with `false`**. Each action replaces only the flagged static literal.

The diagnostic overlaps ESLint's `sfmc/amp-prefer-boolean-literal` rule. When `disableLspDiagnosticsForEslintRules` is enabled, both the warning and its quick fix are suppressed so ESLint can provide the feedback without duplication.
