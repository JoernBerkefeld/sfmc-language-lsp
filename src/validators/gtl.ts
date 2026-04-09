import { DiagnosticSeverity } from '../types.js';
import type { Diagnostic } from '../types.js';
import { offsetToPosition } from '../utils/positions.js';

interface GtlFrame {
    tag: string;
    offset: number;
}

function findLastMatchingOpen(stack: GtlFrame[], closeTag: string): number {
    for (let i = stack.length - 1; i >= 0; i--) {
        const openTag = stack[i].tag;
        if (openTag === closeTag || (openTag === '.datasource' && closeTag === '.datasource')) {
            return i;
        }
    }
    return -1;
}

/**
 * Validate GTL block balance ({{#each}}/{{/each}}, {{#if}}/{{/if}}, etc.)
 * and push any diagnostics into the provided array.
 * @param text
 * @param diagnostics
 * @param remainingBudget
 */
export function validateGtlBlocks(
    text: string,
    diagnostics: Diagnostic[],
    remainingBudget: number
): void {
    let problems = 0;
    const stack: GtlFrame[] = [];

    const GTL_OPEN = /\{\{([#.])(each|if|switch|datasource)\b/g;
    const GTL_CLOSE = /\{\{\/(each|if|switch|\.datasource)\s*\}\}/g;

    const opens: { tag: string; offset: number }[] = [];
    const closes: { tag: string; offset: number }[] = [];

    let m: RegExpExecArray | null;
    while ((m = GTL_OPEN.exec(text)) !== null) {
        const prefix = m[1];
        const tag = prefix === '.' ? `.${m[2]}` : m[2];
        opens.push({ tag, offset: m.index });
    }
    while ((m = GTL_CLOSE.exec(text)) !== null) {
        closes.push({ tag: m[1], offset: m.index });
    }

    const events = [
        ...opens.map((o) => ({ ...o, kind: 'open' as const })),
        ...closes.map((c) => ({ ...c, kind: 'close' as const })),
    ].toSorted((a, b) => a.offset - b.offset);

    for (const event of events) {
        if (problems >= remainingBudget) break;

        if (event.kind === 'open') {
            stack.push({ tag: event.tag, offset: event.offset });
        } else {
            const matchIndex = findLastMatchingOpen(stack, event.tag);
            if (matchIndex === -1) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: offsetToPosition(text, event.offset),
                        end: offsetToPosition(text, event.offset + event.tag.length + 5),
                    },
                    message: `Closing {{/${event.tag}}} without a matching opening tag.`,
                    source: 'gtl',
                });
            } else {
                stack.splice(matchIndex, 1);
            }
        }
    }

    for (const frame of stack) {
        if (problems >= remainingBudget) break;
        problems++;
        const tagDisplay = frame.tag.startsWith('.') ? `{{${frame.tag}}}` : `{{#${frame.tag}}}`;
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: offsetToPosition(text, frame.offset),
                end: offsetToPosition(text, frame.offset + frame.tag.length + 3),
            },
            message: `Unclosed ${tagDisplay} block. Expected a matching closing tag.`,
            source: 'gtl',
        });
    }
}
