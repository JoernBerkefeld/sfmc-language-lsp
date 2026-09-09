# sfmc/amp-balanced-control-flow

## Trigger and why it matters

Reports a **warning** when recognized AMPscript contains an `IF` without an `ENDIF`, a `FOR` without a `NEXT`, or a closing keyword without a corresponding opener. Incomplete control flow leaves the intended conditional or repeated content unclear and can prevent successful execution.

## Examples and fix

Invalid conditional without its closer:

```ampscript
%%[
/* Choose a label when the condition holds. */
IF 1 == 1 THEN
  SET @label = "Ready"
]%%
```

Valid:

```ampscript
%%[
/* Choose a label when the condition holds. */
IF 1 == 1 THEN
  SET @label = "Ready"
ENDIF
]%%
```

Invalid loop without its closer:

```ampscript
%%[
/* Assign a label on each pass. */
FOR @index = 1 TO 2 DO
  SET @label = "Ready"
]%%
```

Valid:

```ampscript
%%[
/* Assign a label on each pass. */
FOR @index = 1 TO 2 DO
  SET @label = "Ready"
NEXT @index
]%%
```

For an unexpected `ENDIF` or `NEXT`, remove a redundant closer or restore the missing opening statement. Put the closer where the intended conditional or loop actually ends, rather than simply at the next AMPscript delimiter. Control flow may legitimately span separate AMPscript blocks around intervening content.

## Variants and limitations

- `ampscript/unmatched-endif`: `ENDIF` with no available `IF`.
- `ampscript/unmatched-next`: `NEXT` with no available `FOR`.
- `ampscript/unclosed-if`: an `IF` remains open after the scan.
- `ampscript/unclosed-for`: a `FOR` remains open after the scan.

The LSP scans sanitized text from complete AMPscript regions, ignoring strings, AMPscript block comments, and surrounding content. It tracks conditionals and loops separately across the document, not per AMPscript block. Missing region delimiters can prevent code from reaching this scan; fix delimiter diagnostics first.

This is a keyword-balance heuristic, not full grammar validation. It counts opening keywords before closing keywords on each scanned line, so it cannot establish their true same-line ordering. Separate stacks do not validate mixed `IF`/`FOR` nesting order, and the check does not validate `THEN`, `DO`, branch placement, loop bounds, or the variable after `NEXT`. A clean result is therefore not proof of valid control flow.

## Quick fixes

No AMPscript quick fix is implemented for these variants. Adding or deleting a keyword requires choosing the intended control-flow boundary, so make the correction manually and validate again.

## Platform applicability

The check runs for both Marketing Cloud Engagement and Marketing Cloud Next targets. The examples illustrate Engagement block syntax. This diagnostic is not a compatibility check for a particular Next content surface or its supported statements.

## Suppression and LSP-only distinction

This is an **LSP-only** rule: the registry does not map it to an overlapping ESLint rule. It remains visible with `disableLspDiagnosticsForEslintRules: true`. ESLint may separately reject malformed control flow through its parser; that is not this named LSP warning. ESLint disable comments do not affect this scan, and no per-rule inline LSP suppression is implemented. Fix the structure or use a host-level validation control if one is available.

## Related rules

- [Balanced delimiters](balanced-delimiters.md)
- [Nested AMPscript delimiters](no-nested-ampscript-delimiter.md)
