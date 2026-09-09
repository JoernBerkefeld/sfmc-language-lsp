import { LSP_PACKAGE_VERSION } from './package-version.js';
import type { Diagnostic } from './types.js';

/**
Explicit variant identities, including names reserved for formerly unnamed sites.
 */
const definitions = [
    ['ampscript/html-wrapped-comment', 'amp-no-html-comment', true, true],
    ['ampscript/html-comment', 'amp-no-html-comment', true, true],
    ['ampscript/js-line-comment', 'amp-no-js-line-comment', true, true],
    ['ampscript/nested-script-tag', 'amp-no-nested-script-tag', true, true],
    ['ampscript/nested-delimiter-in-script', 'amp-no-nested-ampscript-delimiter', true, true],
    ['ampscript/nested-delimiter', 'amp-no-nested-ampscript-delimiter', true, true],
    ['ampscript/deprecated-function', 'amp-no-deprecated-function', true, true],
    ['ampscript/nonfunctional-function', 'amp-no-nonfunctional-function', true, true],
    ['ampscript/unknown-function', 'amp-no-unknown-function', true, true],
    ['ampscript/function-arity', 'amp-function-arity', true, true],
    ['ampscript/arg-type', 'amp-arg-types', true, true],
    ['ampscript/enum-value', 'amp-arg-types', true, true],
    ['ampscript/smart-quotes', 'amp-no-smart-quotes', true, true],
    ['ampscript/set-no-target', 'amp-set-requires-target', true, true],
    ['ampscript/mcn-unsupported-function', 'amp-no-mcn-unsupported', true, true],
    ['ampscript/unclosed-block', 'amp-balanced-delimiters', false, false],
    ['ampscript/unexpected-block-close', 'amp-balanced-delimiters', false, false],
    ['ampscript/unclosed-inline', 'amp-balanced-delimiters', false, false],
    ['ampscript/unexpected-inline-close', 'amp-balanced-delimiters', false, false],
    ['ampscript/unmatched-endif', 'amp-balanced-control-flow', false, false],
    ['ampscript/unmatched-next', 'amp-balanced-control-flow', false, false],
    ['ampscript/unclosed-if', 'amp-balanced-control-flow', false, false],
    ['ampscript/unclosed-for', 'amp-balanced-control-flow', false, false],
    ['ampscript/prefer-attribute-value', 'amp-prefer-attribute-value', true, false],
    ['ssjs/polyfill-required', 'ssjs-no-unavailable-method', true, true],
    ['ssjs/replace-with-platform-function', 'ssjs-no-unavailable-method', true, true],
    ['ssjs/mcn-not-supported', 'ssjs-no-mcn-unsupported', true, true],
    ['ssjs/require-platform-load', 'ssjs-require-platform-load', true, true],
    ['ssjs/platform-load-version', 'ssjs-prefer-platform-load-version', true, true],
    ['ssjs/unsupported-syntax', 'ssjs-no-unsupported-syntax', true, true],
    ['ssjs/clr-header-access', 'ssjs-no-clr-header-access', true, true],
    ['ssjs/clr-content-access', 'ssjs-require-string-clr-content', true, true],
    ['ssjs/invalid-http-property-value', 'ssjs-http-property-value', true, true],
    ['ssjs/invalid-property-access', 'ssjs-no-invalid-property-access', true, true],
    ['ssjs/nonexistent-global', 'ssjs-no-nonexistent-global', true, true],
    ['ssjs/deprecated', 'ssjs-no-deprecated-function', true, true],
    ['ssjs/invalid-arity', 'ssjs-platform-function-arity', true, true],
    ['ssjs/nonfunctional-method', 'ssjs-no-nonfunctional-method', true, true],
    ['ssjs/switch-fallthrough', 'ssjs-no-switch-fallthrough', true, true],
    ['ssjs/new-object-returning-constructor', 'ssjs-no-object-returning-constructor', false, true],
    ['ssjs/cross-block-forward-reference', 'ssjs-no-cross-block-forward-reference', false, true],
    ['handlebars/syntax-error', 'hbs-syntax-error', false, true],
    ['handlebars/unsupported-construct', 'hbs-no-unsupported-construct', true, true],
    ['handlebars/unknown-helper', 'hbs-no-unknown-helper', true, true],
    ['handlebars/unknown-binding', 'hbs-no-unknown-binding', true, true],
    ['gtl/unexpected-close', 'gtl-balanced-blocks', false, false],
    ['gtl/unclosed-block', 'gtl-balanced-blocks', false, false],
] as const;

export type DiagnosticVariant = (typeof definitions)[number][0];
export type DiagnosticRuleId = `sfmc/${(typeof definitions)[number][1]}`;

/**
One row per internal variant, not per public rule (which may be many-to-one).
 */
export interface DiagnosticRule {
    readonly variant: DiagnosticVariant;
    readonly ruleId: DiagnosticRuleId;
    readonly documentationPath: string;
    /**
    Null for previously unnamed emissions; never match those by message text.
     */
    readonly legacyCode: DiagnosticVariant | null;
    /**
    Null means LSP-only, even if an ESLint rule has a superficially similar name.
     */
    readonly eslintRuleId: DiagnosticRuleId | null;
    /**
    Includes the intentional AttributeValue correction, applied upon validator migration.
     */
    readonly suppressWithEslint: boolean;
}

export const DIAGNOSTIC_RULES: readonly DiagnosticRule[] = Object.freeze(
    definitions.map(([variant, name, overlap, legacy]) =>
        Object.freeze({
            variant,
            ruleId: `sfmc/${name}` as DiagnosticRuleId,
            documentationPath: `docs/rules/${name.replace('-', '/')}.md`,
            legacyCode: legacy ? variant : null,
            eslintRuleId: overlap ? (`sfmc/${name}` as DiagnosticRuleId) : null,
            suppressWithEslint: overlap,
        }),
    ),
);

/**
Namespaced transport data. Payload is opaque and is never flattened or coerced.
 */
export interface SfmcDiagnosticData<T = unknown> {
    sfmc: { variant: DiagnosticVariant; payload: T };
}

/**
Normalized input for existing quick-fix handlers.
 */
export interface DecodedDiagnosticData<T = unknown> {
    variant: DiagnosticVariant;
    payload: T;
}

/**
 * Resolve an internal variant without accepting inherited object properties.
 * @param variant - Internal variant identity.
 * @returns The registry row, or undefined for an unknown identity.
 */
export function getDiagnosticRule(variant: string): DiagnosticRule | undefined {
    return DIAGNOSTIC_RULES.find((rule) => rule.variant === variant);
}

/**
 * Build an owning-package release link; development tags may not exist yet.
 * @param variant - Internal variant identity.
 * @returns An HTTPS link pinned to the LSP package version.
 */
export function getDiagnosticDocumentationUrl(variant: DiagnosticVariant): string {
    const rule = getDiagnosticRule(variant);
    if (!rule) throw new Error(`Unknown diagnostic variant: ${variant}`);
    return `https://github.com/JoernBerkefeld/sfmc-language-lsp/blob/v${LSP_PACKAGE_VERSION}/${rule.documentationPath}`;
}

/**
 * Preserve primitive and object payloads under a namespaced envelope.
 * @param variant - Exact internal check identity.
 * @param payload - Original JSON-serializable diagnostic data, or undefined when absent.
 * @returns The transport envelope without mutation or cloning of the payload.
 */
export function encodeDiagnosticData<T>(
    variant: DiagnosticVariant,
    payload: T,
): SfmcDiagnosticData<T> {
    if (!getDiagnosticRule(variant)) throw new Error(`Unknown diagnostic variant: ${variant}`);
    return { sfmc: { variant, payload } };
}

/**
 * Decode legacy data or canonical envelopes into the same quick-fix input.
 * Canonical many-to-one rules always require a matching explicit variant.
 * Unnamed legacy diagnostics cannot be decoded without inventing an identity.
 * @param code - Protocol diagnostic code (numeric third-party codes are ignored).
 * @param data - Original diagnostic data or namespaced envelope.
 * @returns Normalized input, or undefined for unknown, malformed or ambiguous codes.
 */
export function decodeDiagnosticData(
    code: string | number | undefined,
    data: unknown,
): DecodedDiagnosticData | undefined {
    if (typeof code !== 'string') return undefined;
    const legacy = DIAGNOSTIC_RULES.find((rule) => rule.legacyCode === code);
    // Legacy payloads are opaque: even an object containing `sfmc` is preserved.
    if (legacy) return { variant: legacy.variant, payload: data };
    const candidates = DIAGNOSTIC_RULES.filter((rule) => rule.ruleId === code);
    if (candidates.length === 0) return undefined;
    if (typeof data === 'object' && data !== null && Object.hasOwn(data, 'sfmc')) {
        const envelope = (data as { sfmc: unknown }).sfmc;
        if (
            typeof envelope !== 'object' ||
            envelope === null ||
            !Object.hasOwn(envelope, 'variant')
        )
            return undefined;
        const { variant, payload } = envelope as { variant: unknown; payload?: unknown };
        const match = candidates.find((rule) => rule.variant === variant);
        return match ? { variant: match.variant, payload } : undefined;
    }
    // A unique canonical ID can safely normalize an unenveloped payload.
    return candidates.length === 1 ? { variant: candidates[0].variant, payload: data } : undefined;
}

/**
 * Attach the public identity and release documentation to a first-party emission.
 * @param variant - Exact internal check identity, including formerly unnamed checks.
 * @param diagnostic - Diagnostic content with the original opaque payload.
 * @returns A new diagnostic carrying canonical metadata and a lossless envelope.
 */
export function createDiagnostic(
    variant: DiagnosticVariant,
    diagnostic: Omit<Diagnostic, 'code' | 'codeDescription'>,
): Diagnostic {
    const rule = getDiagnosticRule(variant);
    if (!rule) throw new Error(`Unknown diagnostic variant: ${variant}`);
    return {
        ...diagnostic,
        code: rule.ruleId,
        codeDescription: { href: getDiagnosticDocumentationUrl(variant) },
        data: encodeDiagnosticData(variant, diagnostic.data),
    };
}

export { LSP_PACKAGE_VERSION } from './package-version.js';
