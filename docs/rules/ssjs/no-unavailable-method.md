# sfmc/ssjs-no-unavailable-method

## What triggers this diagnostic?

The SSJS validator recognizes an ECMAScript member that the Engagement engine cannot use safely and for which the catalog supplies an actionable remedy. One public rule deliberately covers two distinct variants:

- `ssjs/polyfill-required` is an **error** for an absent or broken member with a verified polyfill. It carries `{ owner, method, polyfill }`.
- `ssjs/replace-with-platform-function` is a **warning** for a static member with a direct Platform replacement and no polyfill. It carries `{ owner, member, replacement }`.

Canonical diagnostics preserve these objects under `data.sfmc.payload`, with the internal variant under `data.sfmc.variant`. Do not choose a fix from the public rule ID alone: the two variants require different edits. Legacy variant codes and their original payloads remain readable by the code-action provider; a canonical ID without an explicit variant is ambiguous and gets no action.

## Why it matters and how to fix it

Ordinary JavaScript availability is not evidence of SSJS support. Install the supplied verified polyfill before calling a polyfillable member, or use the recommended Platform API. Check the replacement's input and return semantics rather than assuming it is a complete JavaScript substitute.

### Invalid: unavailable JSON API

This is an intentionally unsupported example, not code to deploy:

```javascript
// Attempt to parse structured data using an unavailable namespace.
var record = JSON.parse('{"active":true}');
```

### Valid: Platform replacement

```javascript
// Parse a JSON object using the supported Platform API.
var record = Platform.Function.ParseJSON('{"active":true}');
```

`ParseJSON` does not require Core loading. Its handling of invalid input and scalar JSON differs from native JavaScript parsing; this example deliberately uses an object document.

### Invalid: missing polyfill

This deliberately omits the required polyfill:

```javascript
// Attempt array detection before installing the required helper.
var isList = Array.isArray([]);
```

### Valid: install the catalogued polyfill first

```javascript
// Initialize Core before application helpers.
Platform.Load('core', '1.1.5');

/**
 * Detect arrays using their explicit object tag.
 * @param {*} value - Value to classify.
 * @returns {boolean} Whether the value has the array tag.
 */
Array.isArray =
  Array.isArray ||
  function (value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  };

// Call the member after its implementation is available.
var isList = Array.isArray([]);
```

## Quick fixes

**Insert polyfill for Owner.method** inserts the payload's implementation at the document start, or immediately after a leading single-line `/* global ... */` directive. It leaves the call unchanged. The current action does not search for `Platform.Load`; review placement in the complete script and keep initialization and helper execution in the required order, as in the example above. An exact existing marker prevents a duplicate insertion action.

**Replace Owner.member with Platform.Function.member** replaces only the diagnostic's member-expression range, retaining the existing arguments. It does not insert a polyfill or rewrite surrounding error handling. Both actions are preferred quick fixes when their variant and payload are valid and the diagnostic source is `ssjs`.

## Scope and limitations

Static checks recognize explicit owner/member expressions. Prototype checks recognize call-shaped member uses by name, not full receiver type inference. Members also valid on strings are excluded from the ambiguous prototype lookup to avoid flagging supported string operations. This is a text-based LSP check; the ESLint counterpart uses an AST and need not diagnose precisely the same expressions.

A recognized polyfill assignment suppresses the polyfill diagnostic, including some minified and unguarded forms. Presence detection does not prove the helper body is correct or executes before the call. Unavailable members with neither a polyfill nor a Platform replacement are left to other diagnostics, including the host's TypeScript service.

These remedies target Marketing Cloud Engagement. The member checks may also appear when validating a Next-targeted document, but SSJS itself is unsupported there; see [no-mcn-unsupported](no-mcn-unsupported.md).

## Suppression

The service's `disableLspDiagnosticsForEslintRules` option suppresses both overlapping variants when delegating checks to ESLint's `sfmc/ssjs-no-unavailable-method`. The raw validator does not interpret ESLint disable comments as per-line LSP suppression. Configure ESLint separately if using its rule; hiding the LSP diagnostic also removes the diagnostic that drives its quick fix. Prefer fixing the runtime incompatibility rather than suppressing it.
