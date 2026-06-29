/**
 * Small closest-match helper used to power "Did you mean …?" quick fixes.
 *
 * Implements an iterative Levenshtein edit distance and a conservative
 * suggestion threshold so that only genuinely close typos are offered.
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 * @param a - First string.
 * @param b - Second string.
 * @returns The minimum number of single-character edits to turn `a` into `b`.
 */
export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    const curr: number[] = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        prev = curr.slice();
    }
    return prev[b.length];
}

/**
 * Return the candidate closest to `word` (case-insensitive) when it is within a
 * conservative typo threshold, or null when nothing is close enough.
 *
 * The threshold scales with the word length: very short words allow at most one
 * edit, longer words up to two. This avoids suggesting unrelated names.
 * @param word - The unknown word typed by the user.
 * @param candidates - Known valid names to match against.
 * @returns The closest candidate (in its original casing), or null.
 */
export function closestMatch(word: string, candidates: Iterable<string>): string | null {
    const lowerWord = word.toLowerCase();
    const maxDistance = lowerWord.length <= 4 ? 1 : 2;

    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const distance = levenshtein(lowerWord, candidate.toLowerCase());
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }

    if (best !== null && bestDistance > 0 && bestDistance <= maxDistance) {
        return best;
    }
    return null;
}
