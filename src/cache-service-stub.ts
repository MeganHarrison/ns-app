// Enhanced CacheService with proper pattern deletion and invalidation
export class CacheService {
  constructor(private kv: KVNamespace) {}
  
  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
  
  async deletePattern(pattern: string): Promise<void> {
    // List all keys with the given prefix/pattern
    const keysToDelete: string[] = [];
    let cursor: string | undefined;
    
    do {
      const result = await this.kv.list({ 
        prefix: pattern,
        limit: 1000,
        cursor 
      });
      
      keysToDelete.push(...result.keys.map(k => k.name));
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
    
    // Delete all matching keys in parallel
    if (keysToDelete.length > 0) {
      await Promise.all(keysToDelete.map(key => this.kv.delete(key)));
      console.log(`Deleted ${keysToDelete.length} cache keys matching pattern: ${pattern}`);
    }
  }
  
  async get(key: string): Promise<any> {
    const value = await this.kv.get(key, { type: 'json' });
    if (value) {
      console.log(`Cache HIT: ${key}`);
    } else {
      console.log(`Cache MISS: ${key}`);
    }
    return value;
  }
  
  async set(key: string, value: any, options?: { ttl?: number }): Promise<void> {
    const ttl = options?.ttl || CacheTTL.MEDIUM;
    await this.kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
    console.log(`Cache SET: ${key} (TTL: ${ttl}s)`);
  }
  
  // Invalidate all caches related to a specific data type
  async invalidateDataType(dataType: string): Promise<void> {
    const patterns = this.getInvalidationPatterns(dataType);
    await Promise.all(patterns.map(pattern => this.deletePattern(pattern)));
  }
  
  // Get patterns to invalidate based on data type
  private getInvalidationPatterns(dataType: string): string[] {
    const patternMap: Record<string, string[]> = {
      'order': [
        CacheKeys.metrics(),
        CacheKeys.dashboard(),
        CacheKeys.orders(),
        'revenue:',
        'analytics:orders:'
      ],
      'contact': [
        CacheKeys.metrics(),
        CacheKeys.dashboard(),
        CacheKeys.contacts(),
        'customers:',
        'analytics:customers:'
      ],
      'subscription': [
        CacheKeys.metrics(),
        CacheKeys.dashboard(),
        CacheKeys.subscriptions(),
        'mrr:',
        'analytics:subscriptions:'
      ],
      'product': [
        CacheKeys.products(),
        'analytics:products:'
      ]
    };
    
    return patternMap[dataType] || [CacheKeys.metrics(), CacheKeys.dashboard()];
  }
}

export const CacheKeys = {
  metrics: () => 'metrics:summary',
  dashboard: () => 'dashboard:main',
  contacts: () => 'contacts:all',
  orders: () => 'orders:all',
  products: () => 'products:all',
  subscriptions: () => 'subscriptions:all',
  
  // Specific cache keys with parameters
  ordersByDate: (date: string) => `orders:date:${date}`,
  customerById: (id: string) => `customers:id:${id}`,
  revenueByPeriod: (period: string) => `revenue:period:${period}`,
  analyticsReport: (type: string) => `analytics:${type}:report`
};

export const CacheTTL = {
  SHORT: 300,    // 5 minutes - for frequently changing data
  MEDIUM: 900,   // 15 minutes - for standard dashboard data
  LONG: 3600,    // 1 hour - for rarely changing data
  VERY_LONG: 86400 // 24 hours - for historical data
};