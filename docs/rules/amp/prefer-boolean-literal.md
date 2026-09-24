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

This LSP-only warning applies wherever the catalog exposes the eight-value boolean-like enum. It has no quick fix and is not suppressed by `disableLspDiagnosticsForEslintRules` because there is no matching ESLint diagnostic.
