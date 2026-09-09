# sfmc/ssjs-require-platform-load

## What triggers this diagnostic?

This **error** reports recognized Core-dependent calls that occur before the first noncommented `Platform.Load('core', ...)` call in the document. The internal variant is `ssjs/require-platform-load`, with no fix-specific payload.

The validator checks its explicit list of Core objects used through `Init` or `Retrieve`, catalogued Core-dependent HTTP-header/date-time-timezone/error utility methods, and bare global calls marked as requiring Core loading. A load that occurs later does not satisfy an earlier use. A commented-out load does not count.

## Why it matters and how to fix it

Core-dependent aliases are unavailable until the library is initialized. Put the load before the first dependent operation. Where a supported `Platform.Function` equivalent exists, that form may avoid the dependency altogether; loading Core is not required for every SSJS API.

## Invalid

```javascript
// Serialize through a bare global before Core is initialized.
var serialized = Stringify({ active: true });
```

## Valid

```javascript
// Initialize Core before using its bare-name aliases.
Platform.Load('core', '1.1.5');

// Serialize after initialization.
var serialized = Stringify({ active: true });
```

A load placed after `Stringify` would still trigger the error. See [prefer-platform-load-version](prefer-platform-load-version.md) for the separate version recommendation: recognizing that a load exists and recommending its version are different checks.

## Scope and limitations

This LSP check compares textual positions and skips comments. It is not control-flow analysis: a load inside an unexecuted branch or a function body can still appear earlier in the text. Conversely, document-local validation cannot establish initialization performed elsewhere. Arrange initialization clearly rather than treating a missing diagnostic as proof of execution order.

Bare global checks exclude dotted member calls, so a qualified Platform call is not treated as an uninitialized bare alias. The explicit Core-object list and catalogued utility groups bound coverage; this is not an exhaustive check of every possible Core-dependent expression. The ESLint counterpart is AST-based and may cover different call shapes.

The runtime guidance is for Marketing Cloud Engagement. This check can also accompany the document-level [Next incompatibility error](no-mcn-unsupported.md); loading Core does not enable SSJS in Next.

## Quick fixes and suppression

The shared SSJS code-action provider does not insert a Core load for this diagnostic. Add it manually at the appropriate execution point. Canonical diagnostics preserve the internal variant in `data.sfmc.variant`; no insertion location or replacement payload is supplied.

The service's `disableLspDiagnosticsForEslintRules` setting suppresses this overlapping LSP rule when relying on ESLint's `sfmc/ssjs-require-platform-load`. ESLint disable comments are not per-line LSP suppression directives, and the raw validator does not apply the service-level duplicate filter. Prefer repairing initialization over hiding the error.
