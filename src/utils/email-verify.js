/**
 * Lightweight email-deliverability signal: does the email's domain have MX
 * records? No mail is sent and no SMTP connection is made — this is a
 * single DNS lookup, cached per domain. Returns:
 *   true  -> domain accepts mail (MX records exist)
 *   false -> domain has no MX records (email will bounce)
 *   null  -> unknown (lookup failed or timed out)
 */
import { resolveMx } from 'node:dns/promises';

const defaultCache = new Map();

export async function verifyEmailDomain(email, options = {}) {
    const { resolver = resolveMx, timeoutMs = 5000, cache = defaultCache } = options;
    const domain = typeof email === 'string' ? email.split('@')[1]?.toLowerCase() : null;
    if (!domain) return null;
    if (cache.has(domain)) return cache.get(domain);

    let result = null;
    let timer;
    try {
        const records = await Promise.race([
            resolver(domain),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('MX lookup timeout')), timeoutMs);
            }),
        ]);
        result = Array.isArray(records) && records.length > 0;
    } catch (error) {
        // Definitive "no such domain / no mail service" answers are false;
        // transient failures (timeouts, DNS errors) stay unknown.
        result = ['ENOTFOUND', 'ENODATA'].includes(error?.code) ? false : null;
    } finally {
        clearTimeout(timer);
    }
    cache.set(domain, result);
    return result;
}
