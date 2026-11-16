/**
 * `sfmc-language-lsp/typescript` — TypeScript-based SSJS intelligence.
 *
 * A separate entry of the package: it needs the optional peer dependency `typescript`, which the
 * main entry never loads.
 */
export { createSsjsTypeScriptService } from './service.js';
export type {
    SsjsCompletionInfo,
    SsjsTypeScriptService,
    SsjsTypeScriptServiceOptions,
} from './service.js';
export { ssjsProjection, isInSsjsRegion, memberCompletions } from './orchestration.js';
export type { MemberCompletionsInput } from './orchestration.js';
