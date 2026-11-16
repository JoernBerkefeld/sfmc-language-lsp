/**
 * Shared rules for combining the TypeScript-based SSJS service with the SFMC catalogue in mixed
 * HTML documents. These helpers are pure: catalogue results are handed in by the caller, so this
 * module does not load the catalogue or the language data.
 */
import { CompletionItemKind } from 'vscode-languageserver-types';
import type { CompletionItem } from 'vscode-languageserver-types';
import { extractScriptBodies, getScriptRegions } from '../utils/regions.js';

/**
 * Keep only the SSJS of a mixed document. Everything else becomes spaces (line breaks stay), so
 * every offset and position of the result is one of the document.
 * @param text - full mixed document
 * @returns text of the same length holding only the bodies of server-side scripts
 */
export function ssjsProjection(text: string): string {
    return extractScriptBodies(text, ['ssjs']).text;
}

/**
 * Tell whether an offset lies in the body of a server-side script. Both ends count, so a cursor
 * right before the closing tag is still inside.
 * @param text - full mixed document
 * @param offset - zero-based UTF-16 offset
 * @returns true if the offset is inside SSJS
 */
export function isInSsjsRegion(text: string, offset: number): boolean {
    return getScriptRegions(text).some(
        (region) =>
            region.kind === 'ssjs' && offset >= region.bodyStart && offset <= region.bodyEnd,
    );
}

/**
 * Input of {@link memberCompletions}.
 */
export interface MemberCompletionsInput {
    /**
     * What the TypeScript service offers at the cursor.
     */
    typescriptItems: readonly CompletionItem[];
    /**
     * Whether the cursor follows a member access, like `Platform.Function.` or `rows.`.
     */
    isMemberAccess: boolean;
    /**
     * The catalogue's SSJS completions, whose labels carry their objects: `Platform.Function.Lookup`.
     */
    catalogueItems: readonly CompletionItem[];
    /**
     * Source text of the expression in front of the member's dot, like `Platform.Function`.
     * White space, comments and a leading `new` are ignored.
     */
    receiver: string;
    /**
     * Whether `new` precedes the receiver in the document, as in `new Script.Util.`. Without it,
     * the catalogue's insert text of a constructor is not taken, as it would lack the `new`. A
     * receiver that itself starts with `new` counts as well.
     */
    hasNew?: boolean;
}

/**
 * `data.type` of the catalogue's entries whose receiver stands for an instance (`req.send`), not
 * for a global. A variable that happens to have that name must not be described by them.
 */
const INSTANCE_PLACEHOLDER_TYPES = new Set(['ssjs-script-util-request']);

const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const LEADING_NEW = /^\s*new\s+/;

/**
 * Cut the catalogue's insert text down to the member, as the receiver is in the document already.
 * @param insertText - what the catalogue inserts, like `Platform.Function.Lookup(${1:name})`
 * @param qualified - receiver and member, like `Platform.Function.Lookup`
 * @param member - the member's own name
 * @returns insert text that starts with the member, or undefined if the catalogue's cannot be cut
 */
function memberInsertText(
    insertText: string,
    qualified: string,
    member: string,
): string | undefined {
    const index = insertText.indexOf(qualified);
    if (index !== -1) return insertText.slice(index + qualified.length - member.length);
    return insertText.startsWith(member) ? insertText : undefined;
}

/**
 * The completions after a member access in SSJS. TypeScript decides which members exist; the
 * catalogue describes those it knows.
 *
 * TypeScript's items are taken without its "unknown type" filler: for a receiver of type `any` it
 * lists the names used in the file, as items of kind `Text`. Each remaining member is looked up in
 * the catalogue as `<receiver>.<member>`. A match contributes `detail`, `documentation`,
 * `insertText` (cut down to the member), `insertTextFormat`, `tags` and `data`; the member keeps
 * its short label, which is what is shown and filtered by. The insert text of a constructor is
 * left out where the document has no `new` in front of the receiver.
 * @param input - TypeScript's items, the catalogue's items and the receiver
 * @returns the members, or null if TypeScript knows none and the caller should use its own path
 */
export function memberCompletions(input: MemberCompletionsInput): CompletionItem[] | null {
    if (!input.isMemberAccess) return null;
    const members = input.typescriptItems.filter((item) => item.kind !== CompletionItemKind.Text);
    if (members.length === 0) return null;

    const receiver = input.receiver.replaceAll(COMMENTS, ' ');
    const hasNew = input.hasNew === true || LEADING_NEW.test(receiver);
    const prefix = receiver.replace(LEADING_NEW, '').replaceAll(/\s+/g, '') + '.';
    const catalogue = new Map<string, CompletionItem>();
    for (const item of input.catalogueItems) {
        if (
            item.label.startsWith(prefix) &&
            !catalogue.has(item.label) &&
            !INSTANCE_PLACEHOLDER_TYPES.has(
                (item.data as { type?: unknown } | undefined)?.type as string,
            )
        ) {
            catalogue.set(item.label, item);
        }
    }

    return members.map((member) => {
        const known = catalogue.get(prefix + member.label);
        if (!known) return member;
        const enriched: CompletionItem = { ...member };
        if (known.detail !== undefined) enriched.detail = known.detail;
        if (known.documentation !== undefined) enriched.documentation = known.documentation;
        if (known.tags !== undefined) enriched.tags = known.tags;
        if (known.data !== undefined) enriched.data = known.data;
        // a constructor's insert text starts with `new`, which only fits where the document has it
        const insertText =
            known.insertText === undefined || (!hasNew && LEADING_NEW.test(known.insertText))
                ? undefined
                : memberInsertText(known.insertText, known.label, member.label);
        if (insertText !== undefined) {
            enriched.insertText = insertText;
            if (known.insertTextFormat !== undefined) {
                enriched.insertTextFormat = known.insertTextFormat;
            }
        }
        return enriched;
    });
}
