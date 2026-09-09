# sfmc/hbs-no-unknown-helper

## Trigger and why it matters

Reports a **warning** when a simple helper invocation is absent from the Marketing Cloud Next (MCN) helper catalog. MCN cannot register a custom helper just because a template uses its name. Check for a spelling mistake or replace the operation with a supported helper.

The internal variant and legacy code are `handlebars/unknown-helper`. The equivalent ESLint rule is `sfmc/hbs-no-unknown-helper`.

## Invocation variants

The validator examines these forms after a successful parse:

- A mustache expression with positional arguments or hash arguments.
- A subexpression, even when it has no arguments.
- A block helper, even when it has no arguments. Its message identifies an unknown **block helper**.

It only treats a simple, single-part path as a candidate. A bare mustache with no arguments is treated as a data reference, not an unknown helper. Property paths, parent-context paths, data variables, and `this` are not checked as simple helper names. This rule does not prove those references exist, and it does not check helper arity or parameter types. Explicitly unsupported constructs have their [own diagnostic](no-unsupported-construct.md).

## Invalid example

The helper name is misspelled:

```handlebars
{{upercase 'hello'}}
```

## Valid example and fix

Use the catalogued string helper:

```handlebars
{{uppercase 'hello'}}
```

Review the helper signature and intended operation before accepting a suggestion. If there is no catalogued replacement, rewrite the template using supported operations; removing arguments solely to avoid the warning changes a helper call into a data reference rather than fixing it.

## Quick fixes

When the closest-match search finds a suggestion, the diagnostic carries a replacement payload and the provider offers a preferred quick fix such as **Replace 'upercase' with 'uppercase'**. It replaces the first occurrence of the typed name inside the diagnostic range, not the entire expression.

No suggestion means no replacement action. For a misspelled block helper, the current action only changes the first name occurrence; it does **not** also rename the closing tag. Correct both ends manually and revalidate to avoid introducing a [syntax error](syntax-error.md).

## Platform and suppression

This check runs for `targetPlatform: 'next'` in the shared service, not Engagement. AMPscript regions are blanked before parsing, parser errors stop the later checks, and the shared problem budget limits reports.

`SfmcLanguageService.validate` suppresses this overlapping diagnostic when `disableLspDiagnosticsForEslintRules: true`. The low-level validator does not apply that filter. Configure the matching ESLint rule separately if ESLint should report the problem. ESLint disable comments are not LSP suppression directives, and suppressing a warning does not register the helper in MCN.
