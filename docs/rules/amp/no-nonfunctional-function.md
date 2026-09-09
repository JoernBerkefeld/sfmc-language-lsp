# sfmc/amp-no-nonfunctional-function

## What triggers this rule

A known function whose canonical catalog entry has `nonFunctionalAtRuntime` produces an error on its name. These entries remain available to hover and completions so legacy code can be understood, but tested invocations have no known working runtime form. The diagnostic may include a short evidence note from the catalog.

This is stronger than [deprecation](no-deprecated-function.md). Correct spelling and argument count do not make the operation usable, and a call may produce both reports when both flags are set. The check scans call sites; it does not prove that a branch will execute.

## Examples and correction

Reported in Marketing Cloud Engagement:

```ampscript
%%[
/* This retired portfolio operation has no known working invocation. */
SET @content = GetPortfolioItem("retired-banner")
]%%
```

If the requirement is now only to provide static fallback content, remove the retired operation:

```ampscript
%%[
/* Supply a deliberate fallback instead of querying retired storage. */
SET @content = "Replacement content"
]%%
```

The second example avoids the failing API; it does not retrieve equivalent portfolio metadata. For a real migration, identify what the old call supplied and redesign that dependency using supported storage or content access. Do not repeatedly vary arguments to a function specifically marked nonfunctional.

## Variants, platform, and quick fixes

The internal variant is `ampscript/nonfunctional-function`. The check runs for both Engagement and Next. Next compatibility is a separate check and may add another error.

No LSP quick fix is provided: there is no general safe replacement for retired functionality.

## Suppression and ESLint

The overlap is ESLint's `sfmc/amp-no-nonfunctional-function`. The service option `disableLspDiagnosticsForEslintRules: true` hides the LSP duplicate, not the runtime failure. Keep the ESLint rule enabled if delegating diagnostics to it. AMPscript inline disable comments are not interpreted by this LSP check.
