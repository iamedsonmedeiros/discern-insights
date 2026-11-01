import { Redis } from '@upstash/redis';
import { pageKey } from '@/lib/url-key';

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn('Upstash Redis environment variables are missing. Caching will be disabled.');
}

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

/**
 * Normalizes a URL to be used as a cache key.
 * Same page identity as the queue: tracking parameters do not make a new page.
 */
export function normalizeUrlForCache(url: string): string {
  return pageKey(url);
}

/**
 * Checks if redis is available/configured
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
