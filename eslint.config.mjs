import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/out/**',
            '**/coverage/**',
            '**/bundled/**',
        ],
    },
    eslint.configs.recommended,
    eslintPluginPrettierRecommended,
    jsdoc.configs['flat/recommended'],
    eslintPluginUnicorn.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.nodeBuiltin,
                Atomics: 'readonly',
                SharedArrayBuffer: 'readonly',
            },
        },
        rules: {
            'no-console': 'warn',
            // Kept off: `null` is part of exported return types (e.g.
            // inferLiteralType(): … | null) and mirrors the LSP wire protocol,
            // which distinguishes null from undefined. Switching to undefined would
            // change public signatures consumed by vscode-sfmc-language and
            // mcp-server-sfmc.
            'unicorn/no-null': 'off',
            // Kept off: source filenames like mcnHandlebars.ts are imported across
            // this package and by downstream consumers; renaming to kebab-case would
            // break those import paths.
            'unicorn/filename-case': 'off',
            // Kept off: re-enabling forces cosmetic renames of abbreviated
            // identifiers with no runtime/contract benefit.
            'unicorn/name-replacements': 'off',
            // Kept off: Iterator#toArray() is ES2025 and not available in the
            // runtimes this language server targets; the spread form is required.
            'unicorn/prefer-iterator-to-array': 'off',
            // Opinionated boolean-naming rule (unicorn v70). Disabled because it
            // would rename exported symbols (e.g. requiresCoreLoadGlobals) that
            // are consumed by vscode-sfmc-language and mcp-server-sfmc.
            'unicorn/consistent-boolean-name': 'off',
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param-type': 'off',
            'jsdoc/require-returns-type': 'off',
        },
    },
);
