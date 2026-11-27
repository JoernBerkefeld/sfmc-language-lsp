# sfmc/hbs-syntax-error

## Trigger and why it matters

Reports an **error** when the Marketing Cloud Next (MCN) Handlebars parser cannot parse the template. Examples include missing block endings, mismatched opening and closing names, or malformed expressions. Block-structure mistakes are explained in plain words on the tag that causes them: a closing tag that does not match the open block (for example `{{/each}} does not close {{#if}} (opened on line 2). Expected {{/if}}.`), a closing tag without an open block, and an unclosed block (`Unclosed {{#if}} block. Expected a matching closing tag.`). For other mistakes the parser explains what is wrong in one line, for example `Empty expression: write a helper or a value between the braces.` or `Unclosed expression {{upp: expected '}}'.`, at the place where parsing stopped, which can come after the mistake.

The internal variant and legacy code are `handlebars/syntax-error`. This is a parser-level LSP diagnostic, not an ESLint rule.

## Invalid example

The conditional has no closing tag:

```handlebars
{{#if true}}Ready
```

## Valid example and fix

Close the conditional with the same helper name:

```handlebars
{{#if true}}Ready{{/if}}
```

Check nearby delimiters, quotes, and enclosing block names before editing the reported token. Repair the syntax problem first. After a parse failure the validator still checks what it can: it parses the template again without its block tags and empty expressions, checks the remaining helper calls and the block helper names, and scans built-in bindings. Arguments inside block tags are only checked once the syntax is repaired, so more diagnostics can appear then.

A successful parse is not a guarantee of platform support. For example, a partial can parse successfully but still trigger [no-unsupported-construct](no-unsupported-construct.md).

## Platform and scope

The shared service runs this check for `targetPlatform: 'next'`. For Marketing Cloud Engagement (MCE), it instead uses the narrower [GTL block-balance check](../gtl/balanced-blocks.md). AMPscript regions are blanked while preserving offsets before Handlebars parsing. Validation is subject to the shared problem budget.

## Quick fixes and suppression

There is **no dedicated syntax-repair quick fix**. Correct the template manually; the available Handlebars replacement actions apply only to suggested helper or binding corrections.

`disableLspDiagnosticsForEslintRules` does **not** suppress this diagnostic. It has no equivalent ESLint rule ID, and ESLint parser failures are not ordinary named rule diagnostics. An ESLint disable comment does not repair parsing or suppress this shared LSP check. Do not change the target platform merely to hide invalid template syntax.
