/**
 * Redis/Valkey cache layer (uses Render Key Value when REDIS_HOST is set).
 * Optional: if Redis is unavailable, cache ops are no-ops.
 */

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const DEFAULT_TTL_SEC = 300; // 5 min for fact cache

let client = null;

async function ensureClient() {
  if (!REDIS_HOST) return null;
  if (client) return client;
  try {
    const { default: Redis } = await import('ioredis');
    client = new Redis({
      host: REDIS_HOST,
      port: Number(REDIS_PORT),
      maxRetriesPerRequest: 2,
      retryStrategy: () => null
    });
    client.on('error', () => {});
    return client;
  } catch {
    return null;
  }
}

/**
 * Get cached value. Returns null on miss or Redis error.
 */
export async function get(key) {
  const c = await ensureClient();
  if (!c) return null;
  try {
    const v = await c.get(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/**
 * Set value with optional TTL (seconds). Default 5 min.
 */
export async function set(key, value, ttlSec = DEFAULT_TTL_SEC) {
  const c = await ensureClient();
  if (!c) return;
  try {
    const s = JSON.stringify(value);
    if (ttlSec > 0) {
      await c.setex(key, ttlSec, s);
    } else {
      await c.set(key, s);
    }
  } catch {
    // Ignore cache write failures
  }
}

/**
 * Delete a key (for invalidation).
 */
export async function del(key) {
  const c = await ensureClient();
  if (!c) return;
  try {
    await c.del(key);
  } catch {
    // Ignore
  }
}
