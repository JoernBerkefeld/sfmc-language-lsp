# sfmc/ssjs-no-nonfunctional-method

## What triggers this diagnostic?

An **error** reports a recognized Core Library method call whose catalog entry has `nonFunctionalAtRuntime` set: the method exists, but no tested invocation is known to work. The internal variant is `ssjs/nonfunctional-method`, preserved as `data.sfmc.variant` in canonical diagnostics.

`collectNonFunctionalMethodDiagnostics` recognizes direct Core object paths and instance variables assigned from a recognized `Class.Init(...)` call. It resolves nested member paths and checks the catalog's `isStatic` flag before reporting. A static-only method called through an instance, or an instance-only method called directly on the class, is skipped by this check because it is not the known call style. That does not make the incorrect style valid.

The highlighted range covers the method identifier. The message can append a short runtime note from the catalog. Methods remain in hover and completion data because existence and successful invocation are different questions.

## Why it matters and how to fix it

A function-valued member is not proof of a usable operation. Repeatedly changing arguments, adding Core loading, or wrapping the call in a catch block does not supply a missing working implementation. Replace the operation with a separately verified management path or remove it from the SSJS workflow.

### Invalid: nonfunctional filter write

This is intentionally a failing example, not deployment code:

```javascript
// Initialize Core before using a Core Library object.
Platform.Load('core', '1.1.5');

// Bind an existing definition, then attempt its nonfunctional update method.
var filter = FilterDefinition.Init('example-filter');
filter.Update({ Name: 'Updated filter' });
```

The supported read/binding path does not make `Update` work. FilterDefinition write methods have no known working invocation in the catalogued runtime tests.

### Valid: remove the failing operation

```javascript
// Retain the identifier while managing filter changes outside this script.
var filterKey = 'example-filter';
```

This deliberately removes the update; it is **not** a functionally equivalent implementation. Perform the required change through a verified management workflow before running code that depends on it. The [FilterDefinition reference](https://ssjs.guide/core-library/filterdefinition.html) describes the runtime evidence and alternative management paths. Validate the chosen path's permissions and request contract independently; this diagnostic does not provide a generic replacement call.

## Quick fixes

The shared SSJS code-action provider has **no automatic fix** for this variant. No polyfill or replacement payload is emitted. The polyfill/replacement actions documented by [no-unavailable-method](no-unavailable-method.md) apply to different diagnostics and cannot repair this call.

## Scope and limitations

This check runs only when the target is **not `next`**. Its intended runtime is Marketing Cloud Engagement. For Next, SSJS is unsupported as a language; see [no-mcn-unsupported](no-mcn-unsupported.md).

Resolution is textual and catalog-driven. Recognized comments are skipped, but strings are not generally excluded. The initialization map is collected across the whole document, without lexical scope, execution order, reassignment, arbitrary aliases, or computed-property analysis. A supported method with the same short name on another object is not inherently nonfunctional: the receiver must resolve to a catalogued Core path and the call style must match.

This is distinct from [no-deprecated-function](no-deprecated-function.md), which generally warns about retired but callable APIs, and [no-nonexistent-global](no-nonexistent-global.md), which reports globals that do not exist. No diagnostic is a guarantee of runtime success; untested methods and unresolved call shapes can be outside this check.

## Suppression

The service's `disableLspDiagnosticsForEslintRules` setting suppresses this overlap with ESLint's `sfmc/ssjs-no-nonfunctional-method`. ESLint disable comments do not provide per-line suppression in the raw LSP validator. Configure ESLint separately if delegating checks. Suppression does not make the operation functional.

## Implementation reference

See `collectNonFunctionalMethodDiagnostics` and its target-platform guard in [the SSJS validator](../../../src/validators/ssjs.ts). See [the diagnostic registry](../../../src/diagnostic-rules.ts) for the public/internal identity mapping.
