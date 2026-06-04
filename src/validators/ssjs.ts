import { DiagnosticSeverity } from '../types.js';
import type { Diagnostic } from '../types.js';
import type { SfmcSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import { buildCommentRanges, isInCommentRange } from '../utils/comments.js';
import { offsetToPosition } from '../utils/positions.js';
import {
    httpHeaderMethods,
    dateTimeTimezoneMethods,
    errorUtilMethods,
    requiresCoreLoadGlobals,
} from '../data/ssjs.js';

/**
 * Validate an SSJS document and return LSP Diagnostics.
 * @param text - Full document text.
 * @param settings - Validation settings.
 * @returns Array of LSP Diagnostic objects.
 */
export function validateSsjs(
    text: string,
    settings: SfmcSettings = DEFAULT_SETTINGS,
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    let problems = 0;
    const max = settings.maxNumberOfProblems;

    // Build comment ranges once here so every section below can skip them.
    const commentRanges = buildCommentRanges(text);

    // Find the character offset of the first real (non-comment) Platform.Load call.
    // Infinity means no load call exists anywhere in the document.
    const plCheckPat = /Platform\s*\.\s*Load\s*\(\s*["']core["']/gi;
    let plm: RegExpExecArray | null;
    let platformLoadOffset = Infinity;
    while ((plm = plCheckPat.exec(text)) !== null) {
        if (!isInCommentRange(plm.index, commentRanges)) {
            platformLoadOffset = plm.index;
            break;
        }
    }

    // 1. Core library usage without Platform.Load
    const coreObjectPattern =
        /\b(DataExtension|Subscriber|Email|TriggeredSend|List|ContentArea|Folder|QueryDefinition|Send|Template|DeliveryProfile|SenderProfile|SendClassification|FilterDefinition|Account|AccountUser|Portfolio|BounceEvent|ClickEvent|ForwardedEmailEvent|ForwardedEmailOptInEvent|NotSentEvent|OpenEvent|SentEvent|SurveyEvent|UnsubEvent)\s*\.\s*(Init|Retrieve)\s*\(/g;
    let coreMatch: RegExpExecArray | null;
    while ((coreMatch = coreObjectPattern.exec(text)) !== null && problems < max) {
        if (isInCommentRange(coreMatch.index, commentRanges)) continue;
        if (coreMatch.index < platformLoadOffset) {
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, coreMatch.index),
                    end: offsetToPosition(text, coreMatch.index + coreMatch[0].length - 1),
                },
                message: `Platform.Load("core", "1.1.5") must be called before using ${coreMatch[1]}.Init(). Without it, this call will fail at runtime.`,
                source: 'ssjs',
            });
        }
    }

    // 1b. requiresCoreLoad methods used without a preceding Platform.Load
    const requiresCoreLoadEntries: Array<{ prefix: string; name: string }> = [
        ...httpHeaderMethods,
        ...dateTimeTimezoneMethods,
        ...errorUtilMethods,
    ]
        .filter((m) => m.requiresCoreLoad)
        .map((m) => ({ prefix: m.prefix ?? '', name: m.name }));

    for (const entry of requiresCoreLoadEntries) {
        const callPattern = new RegExp(
            String.raw`\b${entry.prefix.replaceAll('.', String.raw`\.`)}\s*\.\s*${entry.name}\s*\(`,
            'g',
        );
        let reqMatch: RegExpExecArray | null;
        while ((reqMatch = callPattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(reqMatch.index, commentRanges)) continue;
            if (reqMatch.index < platformLoadOffset) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, reqMatch.index),
                        end: offsetToPosition(text, reqMatch.index + reqMatch[0].length - 1),
                    },
                    message: `Platform.Load("core", "1.1.5") must be called before using ${entry.prefix}.${entry.name}(). Without it, this call will fail at runtime.`,
                    source: 'ssjs',
                });
            }
        }
    }

    // 1c. Bare-name globals that require Platform.Load (e.g. Stringify, Now, GUID)
    // Use negative lookbehind for '.' so Platform.Function.Now() is NOT flagged —
    // only genuine bare calls like Now() are.
    if (requiresCoreLoadGlobals.size > 0) {
        const bareNames = [...requiresCoreLoadGlobals]
            .map((n) => n.replaceAll('.', String.raw`\.`))
            .join('|');
        const barePattern = new RegExp(String.raw`(?<!\.)(\b(?:${bareNames}))\s*\(`, 'g');
        let bareMatch: RegExpExecArray | null;
        while ((bareMatch = barePattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(bareMatch.index, commentRanges)) continue;
            if (bareMatch.index < platformLoadOffset) {
                problems++;
                const name = bareMatch[1];
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: offsetToPosition(text, bareMatch.index),
                        end: offsetToPosition(text, bareMatch.index + name.length),
                    },
                    message: `Platform.Load("core", "1.1.5") must be called before using ${name}(). Without it, this call will fail at runtime.`,
                    source: 'ssjs',
                });
            }
        }
    }

    // 2. Wrong Platform.Load version
    const platformLoadVersionPattern =
        /Platform\s*\.\s*Load\s*\(\s*["']core["']\s*,\s*["']([^"']*)["']\s*\)/gi;
    let versionMatch: RegExpExecArray | null;
    while ((versionMatch = platformLoadVersionPattern.exec(text)) !== null && problems < max) {
        if (isInCommentRange(versionMatch.index, commentRanges)) continue;
        const actualVersion = versionMatch[1];
        if (actualVersion !== '1.1.5') {
            problems++;
            const versionStart = versionMatch.index + versionMatch[0].lastIndexOf(actualVersion);
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, versionStart - 1),
                    end: offsetToPosition(text, versionStart + actualVersion.length + 1),
                },
                message: `Platform.Load("Core", "${actualVersion}") should use version "1.1.5" to get the latest bug-fixes.`,
                source: 'ssjs',
            });
        }
    }

    // 3. ES6+ patterns not supported in SFMC SSJS
    const es6Patterns: { pattern: RegExp; message: string }[] = [
        {
            pattern: /\b(let|const)\s+/g,
            message:
                "'let'/'const' declarations are not supported in SFMC SSJS. Use 'var' instead.",
        },
        {
            pattern: /=>\s*[{(]/g,
            message:
                'Arrow functions are not supported in SFMC SSJS. Use a regular function expression.',
        },
        {
            pattern: /`[^`]*`/g,
            message: 'Template literals are not supported in SFMC SSJS. Use string concatenation.',
        },
        {
            pattern: /\bclass\s+\w+/g,
            message:
                'Class declarations are not supported in SFMC SSJS. Use constructor functions.',
        },
        {
            pattern: /\basync\s+function/g,
            message: 'Async functions are not supported in SFMC SSJS.',
        },
        { pattern: /\bawait\s+/g, message: 'Await expressions are not supported in SFMC SSJS.' },
        {
            pattern: /\bfor\s*\(\s*(?:var\s+)?\w+\s+of\s+/g,
            message: "'for...of' loops are not supported in SFMC SSJS. Use a regular for loop.",
        },
        {
            pattern: /\bfunction\s*\*/g,
            message: 'Generator functions are not supported in SFMC SSJS.',
        },
        {
            pattern: /\.{3}/g,
            message: 'Spread operator (...) is not supported in SFMC SSJS.',
        },
        {
            pattern: /\bvar\s*\{/g,
            message:
                'Object destructuring is not supported in SFMC SSJS. Assign properties individually.',
        },
        {
            pattern: /\bvar\s*\[/g,
            message: 'Array destructuring is not supported in SFMC SSJS. Use index access instead.',
        },
    ];

    for (const { pattern, message } of es6Patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(match.index, commentRanges)) continue;
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: offsetToPosition(text, match.index),
                    end: offsetToPosition(text, match.index + match[0].length),
                },
                message,
                source: 'ssjs',
            });
        }
    }

    // MCN compatibility — SSJS is not supported in Marketing Cloud Next.
    // Emit one document-level diagnostic covering the first non-empty line.
    if (settings.targetPlatform === 'next' && problems < max) {
        const lines = text.split('\n');
        const firstNonBlankLine = lines.findIndex((l) => l.trim().length > 0);
        const lineIndex = Math.max(0, firstNonBlankLine);
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: lineIndex, character: 0 },
                end: { line: lineIndex, character: lines[lineIndex]?.length ?? 0 },
            },
            message:
                'SSJS is not supported in Marketing Cloud Next. Rewrite this code in AMPscript.',
            source: 'ssjs',
            code: 'ssjs/mcn-not-supported',
        });
    }

    return diagnostics;
}
