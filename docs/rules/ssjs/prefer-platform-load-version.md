# sfmc/ssjs-prefer-platform-load-version

## What triggers this diagnostic?

This **warning** reports a recognized `Platform.Load('core', '<version>')` call whose quoted version is not exactly `1.1.5`. It highlights the quoted version argument. The internal variant is `ssjs/platform-load-version`, with no fix-specific payload.

The textual matcher is case-insensitive for the library and method spelling, tolerates whitespace and either quote style, and skips calls in comments. It only recognizes a quoted version followed by the closing parenthesis. Missing, numeric, computed, or variable version arguments are outside this particular check; absence of this warning does not validate those calls.

## Why it matters and how to fix it

The rule recommends the package's chosen Core baseline so scripts consistently use its expected fixes. It is a recommendation, not an assertion that every other version fails to load, nor a live lookup of the newest server version.

Use the recommended version for new code. When upgrading older code, review APIs whose availability depends on a specific Core version rather than blindly replacing the string. In particular, older error utilities can disappear on newer versions and require a code change as well.

## Invalid for this recommendation

```javascript
// Load an older Core revision.
Platform.Load('core', '1');
```

## Valid

```javascript
// Load the Core revision recommended by this rule.
Platform.Load('core', '1.1.5');
```

A version such as `1.1.6` also differs from the rule's exact recommendation and is warned about, even if the engine accepts it. This rule does not compare semantic-version ordering.

## Platform applicability and related checks

This recommendation concerns Marketing Cloud Engagement SSJS. It can also appear during Next-targeted validation, but changing the version does not fix [Next's lack of SSJS support](no-mcn-unsupported.md).

A recognized load satisfies the textual initialization check regardless of whether this version warning appears. Conversely, using the recommended version after a Core-dependent call does not fix [require-platform-load](require-platform-load.md).

## Quick fixes and suppression

The shared SSJS code-action provider has no action for this variant. Edit the version manually after checking compatibility. Canonical diagnostics retain `ssjs/platform-load-version` under `data.sfmc.variant`, while legacy diagnostics use that variant as their code.

The service's `disableLspDiagnosticsForEslintRules` setting suppresses this overlapping LSP rule when delegating to ESLint's `sfmc/ssjs-prefer-platform-load-version`. The raw validator does not interpret ESLint disable comments or apply the service's duplicate filter. For intentionally version-pinned legacy code, review and configure the ESLint rule separately rather than assuming an ESLint comment suppresses the LSP warning.
