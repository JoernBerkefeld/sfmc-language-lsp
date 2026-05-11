import { DiagnosticSeverity } from '../types.js';
import type { Diagnostic } from '../types.js';
import type { SfmcSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import { buildCommentRanges, isInCommentRange } from '../utils/comments.js';
import { extractFunctionArguments, inferLiteralType } from '../utils/text.js';
import { offsetToPosition } from '../utils/positions.js';
import type { SsjsFunction } from '../data/ssjs.js';
import {
    platformMethods,
    platformFunctions,
    ssjsGlobals,
    platformVariableMethods,
    platformResponseMethods,
    platformRequestMethods,
    platformRecipientMethods,
    wsproxyMethods,
    httpMethods,
    httpHeaderMethods,
    dateTimeTimezoneMethods,
    errorUtilMethods,
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

    const platformLoadPattern = /Platform\s*\.\s*Load\s*\(\s*["']core["']/i;
    const hasPlatformLoad = platformLoadPattern.test(text);

    // 1. Core library usage without Platform.Load
    const coreObjectPattern =
        /\b(DataExtension|Subscriber|Email|TriggeredSend|List|ContentArea|Folder|QueryDefinition|Send|Template|DeliveryProfile|SenderProfile|SendClassification|FilterDefinition|Account|AccountUser|Portfolio|BounceEvent|ClickEvent|ForwardedEmailEvent|ForwardedEmailOptInEvent|NotSentEvent|OpenEvent|SentEvent|SurveyEvent|UnsubEvent)\s*\.\s*(Init|Retrieve)\s*\(/g;
    let coreMatch: RegExpExecArray | null;
    while ((coreMatch = coreObjectPattern.exec(text)) !== null && problems < max) {
        if (!hasPlatformLoad) {
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

    // 1b. requiresCoreLoad methods used without Platform.Load
    if (!hasPlatformLoad) {
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

    // 2. Wrong Platform.Load version
    const platformLoadVersionPattern =
        /Platform\s*\.\s*Load\s*\(\s*["']core["']\s*,\s*["']([^"']*)["']\s*\)/gi;
    let versionMatch: RegExpExecArray | null;
    while ((versionMatch = platformLoadVersionPattern.exec(text)) !== null && problems < max) {
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
    ];

    const commentRanges = buildCommentRanges(text);

    for (const { pattern, message } of es6Patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null && problems < max) {
            if (isInCommentRange(match.index, commentRanges)) continue;
            problems++;
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: offsetToPosition(text, match.index),
                    end: offsetToPosition(text, match.index + match[0].length),
                },
                message,
                source: 'ssjs',
            });
        }
    }

    // 4. Type-check literal arguments for known SSJS function calls
    const ssjsFunctionLookup = new Map<string, SsjsFunction>();
    for (const fn of [
        ...platformMethods,
        ...platformFunctions,
        ...ssjsGlobals,
        ...platformVariableMethods,
        ...platformResponseMethods,
        ...platformRequestMethods,
        ...platformRecipientMethods,
        ...wsproxyMethods,
        ...httpMethods,
        ...httpHeaderMethods,
        ...dateTimeTimezoneMethods,
        ...errorUtilMethods,
    ]) {
        ssjsFunctionLookup.set(fn.name.toLowerCase(), fn);
    }

    const ssjsCallPattern = /(?:\w+\.)*(\w+)\s*\(/g;
    let ssjsCallMatch: RegExpExecArray | null;
    while ((ssjsCallMatch = ssjsCallPattern.exec(text)) !== null && problems < max) {
        const methodName = ssjsCallMatch[1];
        const fn = ssjsFunctionLookup.get(methodName.toLowerCase());
        if (!fn?.params || fn.params.length === 0) continue;

        const openParenPos = ssjsCallMatch.index + ssjsCallMatch[0].length - 1;
        const argSpans = extractFunctionArguments(text, openParenPos);
        if (!argSpans) continue;

        for (let ai = 0; ai < argSpans.length && problems < max; ai++) {
            const param = fn.params[ai];
            if (!param?.type) continue;
            const inferredType = inferLiteralType(argSpans[ai].value);
            if (inferredType && inferredType !== param.type) {
                problems++;
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: offsetToPosition(text, argSpans[ai].start),
                        end: offsetToPosition(text, argSpans[ai].end),
                    },
                    message: `Argument '${param.name}' of '${methodName}' expects a ${param.type} but received a ${inferredType}.`,
                    source: 'ssjs',
                });
            }
        }
    }

    return diagnostics;
}
