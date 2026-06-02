/**
 * Markdown documentation builders for AMPscript functions, SSJS functions,
 * ECMAScript built-ins, and file-local SSJS function declarations.
 */

import type { AmpscriptFunction } from '../data/ampscript.js';
import type { SsjsFunction, EcmascriptBuiltin } from '../data/ssjs.js';

export interface LocalSsjsFunction {
    name: string;
    params: string[];
    description: string;
    paramDocs: Map<string, { type: string; description: string }>;
    returnType: string;
    startOffset: number;
}

/**
 * Build typed-signature Markdown for an AMPscript function.
 * @param fn - AMPscript function descriptor.
 * @param links - Optional documentation URLs to render below the description.
 * @param links.docUrl
 * @param links.guideUrl
 * @returns Markdown string with signature, description, params, and example.
 */
export function buildFunctionMarkdown(
    fn: AmpscriptFunction,
    links?: { docUrl?: string; guideUrl?: string },
): string {
    const lines: string[] = [];

    const paramParts = fn.params.map((p) => {
        const opt = p.optional ? '?' : '';
        const type = p.type ?? 'any';
        return `${p.name}${opt}: ${type}`;
    });
    const returnType = fn.returnType ?? 'void';
    const sig = `(function) ${fn.name}(${paramParts.join(', ')}): ${returnType}`;

    lines.push('```typescript', sig, '```', '', fn.description);

    if (links?.docUrl || links?.guideUrl) {
        const parts: string[] = [];
        if (links.docUrl) parts.push(`[Salesforce Developers](${links.docUrl})`);
        if (links.guideUrl) parts.push(`[ampscript.guide reference](${links.guideUrl})`);
        lines.push('', parts.join(' / '));
    }

    if (fn.params.length > 0) {
        lines.push('');
        for (const p of fn.params) {
            const opt = p.optional ? ' *(optional)*' : '';
            lines.push(`*@param* \`${p.name}\`${opt} — ${p.description}\n`);
        }
    }

    if (fn.returnType && fn.returnType !== 'void') {
        lines.push(`*@return* \`${fn.returnType}\``);
    }

    if (fn.example) {
        lines.push('', '**Example:**', '```ampscript', fn.example, '```');
    }

    return lines.join('\n');
}

/**
 * Build typed-signature Markdown for an SSJS function or method.
 * @param fn - SSJS function descriptor.
 * @returns Markdown string with signature, description, params, and example.
 */
export function buildSsjsFunctionMarkdown(fn: SsjsFunction): string {
    const prefix = fn.prefix ? `${fn.prefix}.` : '';
    const lines: string[] = [];

    if (fn.params && fn.params.length > 0) {
        const paramParts = fn.params.map((p) => {
            const opt = p.optional ? '?' : '';
            const type = p.type ?? 'any';
            return `${p.name}${opt}: ${type}`;
        });
        const returnType = fn.returnType ?? 'void';
        const sig = `(function) ${prefix}${fn.name}(${paramParts.join(', ')}): ${returnType}`;

        lines.push('```typescript', sig, '```', '', fn.description, '');

        for (const p of fn.params) {
            const opt = p.optional ? ' *(optional)*' : '';
            const type = p.type ? ` *(${p.type})*` : '';
            lines.push(`*@param* \`${p.name}\`${type}${opt} — ${p.description}\n`);
        }

        if (fn.returnType && fn.returnType !== 'void') {
            lines.push(`*@return* \`${fn.returnType}\``);
        }
    } else {
        const returnType = fn.returnType ?? 'void';
        const sig = `(function) ${prefix}${fn.name}(): ${returnType}`;
        lines.push('```typescript', sig, '```', '', fn.description);
        if (fn.returnType && fn.returnType !== 'void') {
            lines.push('', `*@return* \`${fn.returnType}\``);
        }
    }

    if (fn.example) {
        lines.push('', '**Example:**', '```javascript', fn.example, '```');
    }

    return lines.join('\n');
}

/**
 * Build Markdown for an ECMAScript built-in method.
 * @param builtin - ECMAScript built-in descriptor.
 * @returns Markdown string with signature, description, params, and example.
 */
export function buildEcmascriptBuiltinMarkdown(builtin: EcmascriptBuiltin): string {
    const lines: string[] = [];

    if (builtin.params && builtin.params.length > 0) {
        const paramParts = builtin.params.map((p) => {
            const opt = p.optional ? '?' : '';
            const type = p.type ?? 'any';
            return `${p.name}${opt}: ${type}`;
        });
        const returnType = builtin.returnType ?? 'any';
        const sig = `(method) ${builtin.syntax ?? `${builtin.name}(${paramParts.join(', ')}): ${returnType}`}`;
        lines.push('```typescript', sig, '```', '', builtin.description, '');
        for (const p of builtin.params) {
            const opt = p.optional ? ' *(optional)*' : '';
            lines.push(`*@param* \`${p.name}\`${opt} — ${p.description}\n`);
        }
        if (builtin.returnType && builtin.returnType !== 'void') {
            lines.push(`*@return* \`${builtin.returnType}\``);
        }
    } else {
        lines.push(`**${builtin.syntax ?? builtin.name}**\n\n${builtin.description}`);
        if (builtin.returnType && builtin.returnType !== 'void') {
            lines.push(`\n*@return* \`${builtin.returnType}\``);
        }
    }

    if (builtin.example) {
        lines.push('', '**Example:**', '```javascript', builtin.example, '```');
    }

    return lines.join('\n');
}

/**
 * Build Markdown documentation for a file-local SSJS function declaration.
 * @param fn - Local SSJS function descriptor.
 * @returns Markdown string with signature and parameter documentation.
 */
export function buildLocalFunctionMarkdown(fn: LocalSsjsFunction): string {
    const lines: string[] = [];
    if (fn.params.length > 0) {
        const paramParts = fn.params.map((p) => {
            const pd = fn.paramDocs.get(p);
            return pd?.type ? `${p}: ${pd.type}` : p;
        });
        const returnType = fn.returnType || 'void';
        const sig = `(function) ${fn.name}(${paramParts.join(', ')}): ${returnType}`;
        lines.push('```typescript', sig, '```', '', fn.description, '');
        for (const p of fn.params) {
            const pd = fn.paramDocs.get(p);
            if (pd) {
                lines.push(`*@param* \`${p}\` — ${pd.description}\n`);
            }
        }
        if (fn.returnType && fn.returnType !== 'void') {
            lines.push(`*@return* \`${fn.returnType}\``);
        }
    } else {
        lines.push(`**${fn.name}**\n\n${fn.description}`);
    }
    return lines.join('\n');
}

/**
 * Build a snippet string for an AMPscript function with parameter placeholders.
 * @param fn - AMPscript function descriptor.
 * @returns VS Code snippet string with tab-stop placeholders.
 */
export function buildFunctionSnippet(fn: AmpscriptFunction): string {
    if (!fn.params || fn.params.length === 0) {
        return `${fn.name}()`;
    }
    const paramSnippets = fn.params.map((p, i) => `\${${i + 1}:${p.name}}`);
    return `${fn.name}(${paramSnippets.join(', ')})`;
}

/**
 * Build a snippet string for an SSJS function with parameter placeholders.
 * @param fn - SSJS function descriptor.
 * @returns VS Code snippet string with tab-stop placeholders.
 */
export function buildSsjsFunctionSnippet(fn: SsjsFunction): string {
    const prefix = fn.prefix ? `${fn.prefix}.` : '';
    if (!fn.params || fn.params.length === 0) {
        return `${prefix}${fn.name}()`;
    }
    const snippets = fn.params.map((p, i) => `\${${i + 1}:${p.name}}`);
    return `${prefix}${fn.name}(${snippets.join(', ')})`;
}
