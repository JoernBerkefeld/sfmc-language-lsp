# sfmc/hbs-syntax-error

## Trigger and why it matters

Reports an **error** when the Marketing Cloud Next (MCN) Handlebars parser cannot parse the template. Examples include missing block endings, mismatched opening and closing names, or malformed expressions. The parser supplies the diagnostic message and location; that location can be where parsing stopped rather than where the mistake began.

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

Check nearby delimiters, quotes, and enclosing block names before editing the reported token. Repair the earliest syntax problem first: after a parse failure this validator returns without checking helpers, unsupported constructs, or built-in bindings. Additional diagnostics can therefore appear after the syntax is repaired.

A successful parse is not a guarantee of platform support. For example, a partial can parse successfully but still trigger [no-unsupported-construct](no-unsupported-construct.md).

## Platform and scope

The shared service runs this check for `targetPlatform: 'next'`. For Marketing Cloud Engagement (MCE), it instead uses the narrower [GTL block-balance check](../gtl/balanced-blocks.md). AMPscript regions are blanked while preserving offsets before Handlebars parsing. Validation is subject to the shared problem budget.

## Quick fixes and suppression

There is **no dedicated syntax-repair quick fix**. Correct the template manually; the available Handlebars replacement actions apply only to suggested helper or binding corrections.

`disableLspDiagnosticsForEslintRules` does **not** suppress this diagnostic. It has no equivalent ESLint rule ID, and ESLint parser failures are not ordinary named rule diagnostics. An ESLint disable comment does not repair parsing or suppress this shared LSP check. Do not change the target platform merely to hide invalid template syntax.
