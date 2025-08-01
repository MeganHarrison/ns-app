export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Cache tags for invalidation
}

export class CacheService {
  constructor(private kv: KVNamespace) {}

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.kv.get(key, 'json');
      if (!cached) return null;

      // Check if cache has metadata
      if (cached && typeof cached === 'object' && 'data' in cached && 'metadata' in cached) {
        const { data, metadata } = cached as any;
        
        // Check if cache is expired
        if (metadata.expires && Date.now() > metadata.expires) {
          await this.delete(key);
          return null;
        }
        
        return data as T;
      }
      
      return cached as T;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    try {
      const metadata = {
        created: Date.now(),
        expires: options.ttl ? Date.now() + (options.ttl * 1000) : null,
        tags: options.tags || []
      };

      const cacheData = {
        data: value,
        metadata
      };

      await this.kv.put(key, JSON.stringify(cacheData), {
        expirationTtl: options.ttl
      });
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.kv.list({ prefix: pattern });
      
      // Delete in batches
      const batchSize = 100;
      for (let i = 0; i < keys.keys.length; i += batchSize) {
        const batch = keys.keys.slice(i, i + batchSize);
        await Promise.all(batch.map(key => this.kv.delete(key.name)));
      }
    } catch (error) {
      console.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      // This would require storing tag->key mappings
      // For now, we'll use prefix-based invalidation
      for (const tag of tags) {
        await this.deletePattern(tag);
      }
    } catch (error) {
      console.error(`Cache invalidate by tags error:`, error);
    }
  }

  /**
   * Generate cache key from parts
   */
  static generateKey(...parts: string[]): string {
    return parts.filter(p => p).join(':');
  }

  /**
   * Wrapper to cache function results
   */
  async remember<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const fresh = await fetcher();
    
    // Store in cache
    await this.set(key, fresh, options);
    
    return fresh;
  }
}

// Cache key generators for different data types
export class CacheKeys {
  static metrics(dateRange?: { start?: string; end?: string }): string {
    const parts = ['metrics'];
    if (dateRange?.start) parts.push(dateRange.start);
    if (dateRange?.end) parts.push(dateRange.end);
    return CacheService.generateKey(...parts);
  }

  static dashboard(startDate?: string, endDate?: string): string {
    const parts = ['dashboard'];
    if (startDate) parts.push(startDate);
    if (endDate) parts.push(endDate);
    return CacheService.generateKey(...parts);
  }

  static orders(status?: string, limit?: number): string {
    const parts = ['orders'];
    if (status) parts.push(status);
    if (limit) parts.push(limit.toString());
    return CacheService.generateKey(...parts);
  }

  static contacts(limit?: number, offset?: number): string {
    const parts = ['contacts'];
    if (limit) parts.push(`limit:${limit}`);
    if (offset) parts.push(`offset:${offset}`);
    return CacheService.generateKey(...parts);
  }

  static syncStatus(syncType: string): string {
    return CacheService.generateKey('sync', syncType, 'status');
  }
}

// Cache TTL presets (in seconds)
export const CacheTTL = {
  SHORT: 60,          // 1 minute - for real-time data
  MEDIUM: 300,        // 5 minutes - for frequently changing data
  LONG: 3600,         // 1 hour - for slowly changing data
  DAILY: 86400,       // 24 hours - for static data
  WEEK: 604800        // 7 days - for very static data
} as const;