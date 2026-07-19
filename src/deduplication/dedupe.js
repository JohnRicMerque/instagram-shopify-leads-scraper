/**
 * Deduplication of finished lead rows.
 *
 * Rows are already unique per Instagram username (the lead store is keyed
 * by username). This pass merges *different* Instagram accounts that point
 * to the same business, using — in priority order:
 *   1. normalized final website domain
 *   2. public business email
 *   3. business name (secondary signal, only when neither row has a
 *      website domain or email to compare)
 *
 * The strongest lead (highest score, then most followers) stays as the
 * primary row; merged accounts are listed in `relatedInstagramAccounts`.
 */

function nameKey(row) {
    const name = (row.fullName ?? '').trim().toLowerCase();
    return name.length >= 4 ? name : null;
}

/**
 * @param {object[]} rows scored lead rows
 * @returns {{ rows: object[], duplicatesRemoved: number }}
 */
export function deduplicateLeads(rows) {
    const sorted = [...rows].sort((a, b) => (b.leadScore - a.leadScore)
        || ((b.followersCount ?? 0) - (a.followersCount ?? 0)));

    const byDomain = new Map();
    const byEmail = new Map();
    const byName = new Map();
    const kept = [];
    let duplicatesRemoved = 0;

    for (const row of sorted) {
        const domain = row.websiteDomain ?? null;
        const email = row.publicEmail?.toLowerCase() ?? null;

        let primary = null;
        if (domain && byDomain.has(domain)) primary = byDomain.get(domain);
        else if (email && byEmail.has(email)) primary = byEmail.get(email);
        else if (!domain && !email) {
            const key = nameKey(row);
            if (key && byName.has(key)) {
                const candidate = byName.get(key);
                // Name-only merges require the candidate to also lack domain/email.
                if (!candidate.websiteDomain && !candidate.publicEmail) primary = candidate;
            }
        }

        if (primary) {
            primary.relatedInstagramAccounts = primary.relatedInstagramAccounts ?? [];
            if (row.instagramUrl) primary.relatedInstagramAccounts.push(row.instagramUrl);
            duplicatesRemoved += 1;
            continue;
        }

        row.relatedInstagramAccounts = row.relatedInstagramAccounts ?? [];
        if (domain) byDomain.set(domain, row);
        if (email) byEmail.set(email, row);
        const key = nameKey(row);
        if (key && !byName.has(key)) byName.set(key, row);
        kept.push(row);
    }

    return { rows: kept, duplicatesRemoved };
}
