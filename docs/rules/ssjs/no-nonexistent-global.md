# sfmc/ssjs-no-nonexistent-global

## What triggers this diagnostic?

An **error** reports a bare function call whose global catalog entry has `notDefinedAtRuntime` set. The internal variant is `ssjs/nonexistent-global`; canonical transport records it in `data.sfmc.variant`.

This is a data-driven check for known nonexistent globals, not a general undefined-variable detector. It matches catalogued names followed by optional whitespace and `(`, excludes matches immediately preceded by `.`, and skips recognized comments. Member calls are therefore treated differently from bare calls.

## Why it matters and how to fix it

A documented name is not necessarily an implemented global in the SSJS runtime. A call classified by this rule fails with a reference error; adding Core loading is not the remedy for a genuinely nonexistent global. Use the qualified supported API identified by the message, checking its arguments and execution context.

The message extracts a `Platform.*(...)` alternative from the entry's documentation note or description. If none is available, it gives generic alternative guidance. That text is not an executable replacement or an automatic argument conversion.

### Invalid when catalogued as nonexistent

Bare `Redirect` is the representative phantom-global example in the validator source:

```javascript
// Attempt a redirect through the bare global name.
Redirect('https://example.com/', false);
```

**Catalog qualification:** this specific call receives this diagnostic only when the installed catalog marks `Redirect` as nonexistent. Catalog versions that classify it as requiring Core can instead produce [require-platform-load](require-platform-load.md). Do not infer a universal runtime status from the example or from one installed tool version.

### Valid qualified alternative

```javascript
// Issue a temporary redirect using the supported CloudPage API.
Platform.Response.Redirect('https://example.com/', false);
```

This qualified form needs no Core loading. It is meaningful in a CloudPage response context; it is not a way to redirect a recipient from an email execution context.

## Quick fixes

The shared SSJS code-action provider has **no quick fix** for `ssjs/nonexistent-global`. Make the API replacement manually. In particular, this variant is not the replacement action used by [no-unavailable-method](no-unavailable-method.md), and does not carry that action's replacement payload.

## Scope and limitations

Matching is textual and case-sensitive against the global names. It is not scope-aware: user-defined functions with the same name are not resolved, and strings are not generally excluded. Qualified, computed, aliased, or otherwise differently shaped calls are not a comprehensive part of this check. Other diagnostics may report missing identifiers that are not in this catalog.

The runtime concern is Marketing Cloud Engagement. This scan also runs for Next-targeted documents, but SSJS is unsupported there regardless of which global is called; see [no-mcn-unsupported](no-mcn-unsupported.md).

## Suppression

The service setting `disableLspDiagnosticsForEslintRules` suppresses this overlap with ESLint's `sfmc/ssjs-no-nonexistent-global`. The raw validator does not implement per-line LSP suppression through ESLint disable comments. An ESLint configuration or directive controls ESLint's own report separately. Hiding this diagnostic does not define the missing global.

## Implementation reference

See the phantom-global scan and `phantomReplacement` in [the SSJS validator](../../../src/validators/ssjs.ts), and the canonical mapping in [the diagnostic registry](../../../src/diagnostic-rules.ts). The membership of `nonexistentGlobals`, rather than the illustrative source comment alone, determines which names are reported.
