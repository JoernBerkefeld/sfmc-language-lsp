# sfmc/ssjs-no-cross-block-forward-reference

## Trigger and rationale

Reports an **Error** on a bare function call in a server script block when that function is declared at top level only in a later server script block. The document must contain at least two recognized `<script runat="server">` blocks.

MCE executes server blocks in document order in a shared global scope. Hoisting within one block does not make a declaration in a later block available to an earlier block. Calling it before its block executes can fail with an object-expected error. Move the declaration to the same or an earlier block, or move the call later.

## Invalid example

```html
<script runat="server">
  // Incorrectly call a function declared only in the next block.
  var state = makeState();
</script>
<script runat="server">
  /**
   * Create a state record.
   * @returns {object} A state record.
   */
  function makeState() {
    return { ready: true };
  }
</script>
```

## Valid example

```html
<script runat="server">
  /**
   * Create a state record.
   * @returns {object} A state record.
   */
  function makeState() {
    return { ready: true };
  }
</script>
<script runat="server">
  // Call a function that an earlier block has already declared.
  var state = makeState();
</script>
```

## Quick fix and variant

Internal/legacy variant: `ssjs/cross-block-forward-reference`. There is no rule-specific payload or automatic quick fix. Moving declarations or calls can change side effects and ordering; the validator leaves those edits to the author.

## Platform, suppression, and limits

- This check runs for MCE and is skipped for a Next target, where SSJS is unsupported.
- **LSP-only:** `eslintRuleId` is null and `suppressWithEslint` is false in the registry. `disableLspDiagnosticsForEslintRules` does not suppress it. ESLint sees individual blocks and its disable comments do not control this whole-document LSP check. No inline per-rule suppression is implemented here.
- A declaration in the same block or an earlier block satisfies this check. Unknown names that are never declared anywhere are not reported by this rule; other diagnostics may cover them.
- Recognition requires quoted `runat="server"` or `runat='server'` attributes and closing tags, with case and attribute-order tolerance. A document without recognized tags is treated as one implicit block, so a pure SSJS file cannot trigger it.
- Only top-level named function declarations contribute to the available-name sets. The scan does not resolve lexical bindings, function-expression assignments, aliases, or actual invocation time. It can flag calls inside deferred function bodies even if those bodies execute later. Hosts must provide the full document to detect cross-block ordering; validating isolated snippets loses that context.
- These examples were statically validated, not executed on a CloudPage. Reordering code still requires reviewing its runtime dependencies.

## Implementation

See [validator](../../../src/validators/ssjs.ts) (`findServerScriptBlocks`, `collectBlockFunctionNames`, `collectCrossBlockForwardRefDiagnostics`, `collectBlockForwardRefDiagnostics`), [actions](../../../src/codeActions/ssjs.ts) (no handler for this variant), and [registry](../../../src/diagnostic-rules.ts).
