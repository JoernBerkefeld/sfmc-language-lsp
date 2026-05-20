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

    const commentRanges = buildCommentRanges(text);

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

    // 4. Type-check literal arguments for known SSJS function calls
    // Build separate lookups to avoid name collisions across different prefixes
    // (e.g. WSProxy.retrieve vs DateTime.TimeZone.Retrieve are different functions).
    const ssjsKnownPrefixes = new Set<string>();
    const ssjsQualifiedLookup = new Map<string, SsjsFunction>(); // prefix.name → fn
    const ssjsBareNameLookup = new Map<string, SsjsFunction>(); // name → fn (no-prefix globals)
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
        if (fn.prefix) {
            ssjsKnownPrefixes.add(fn.prefix.toLowerCase());
            ssjsQualifiedLookup.set(`${fn.prefix.toLowerCase()}.${fn.name.toLowerCase()}`, fn);
        } else {
            ssjsBareNameLookup.set(fn.name.toLowerCase(), fn);
        }
    }

    // Capture the full dotted call path (e.g. "Platform.Function.Now") so we can
    // distinguish "WSProxy.retrieve" from a user variable named "api.retrieve".
    const ssjsCallPattern = /((?:\w+\.)*\w+)\s*\(/g;
    let ssjsCallMatch: RegExpExecArray | null;
    while ((ssjsCallMatch = ssjsCallPattern.exec(text)) !== null && problems < max) {
        const fullName = ssjsCallMatch[1];
        const lastDot = fullName.lastIndexOf('.');
        const funcName = lastDot === -1 ? fullName : fullName.slice(lastDot + 1);
        const callPrefix = lastDot >= 0 ? fullName.slice(0, lastDot) : '';
        let fn: SsjsFunction | undefined;
        if (callPrefix) {
            // Skip calls where the prefix is not a known SFMC namespace (user variable).
            if (!ssjsKnownPrefixes.has(callPrefix.toLowerCase())) continue;
            fn = ssjsQualifiedLookup.get(`${callPrefix.toLowerCase()}.${funcName.toLowerCase()}`);
        } else {
            fn = ssjsBareNameLookup.get(funcName.toLowerCase());
        }
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
                    message: `Argument '${param.name}' of '${funcName}' expects a ${param.type} but received a ${inferredType}.`,
                    source: 'ssjs',
                });
            }
        }
    }

    return diagnostics;
}
