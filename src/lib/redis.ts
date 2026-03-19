import { Redis } from '@upstash/redis';

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn('Upstash Redis environment variables are missing. Caching will be disabled.');
}

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

/**
 * Normalizes a URL to be used as a cache key.
 * Removes fragments and trailing slashes.
 */
export function normalizeUrlForCache(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = ''; // Remove fragment
    return parsed.toString().replace(/\/$/, ''); // Remove trailing slash
  } catch {
    return url.replace(/\/$/, '');
  }
}

/**
 * Checks if redis is available/configured
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
