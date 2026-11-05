import { env } from '../../config/env';

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

export class CacheService {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries = 5000;
  private hits = 0;
  private misses = 0;

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    if (this.store.size >= this.maxEntries) {
      // Evict oldest key
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  getStats(): {
    provider: string;
    activeKeys: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      provider: env.REDIS_URL ? 'redis_configured_hybrid' : 'in_memory_ttl',
      activeKeys: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Number((this.hits / total).toFixed(4)) : 0,
    };
  }
}

export const cacheService = new CacheService();

