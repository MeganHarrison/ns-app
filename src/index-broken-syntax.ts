import { KeapClient } from '../workers/keap-client';
import { KeapXMLRPCClient, formatDateForKeap } from '../workers/keap-xmlrpc-client';
import { SupabaseService, SupabaseOrder } from './supabase-client';
import { CacheService, CacheKeys, CacheTTL } from './cache-service-stub';
import { DataSync, DashboardAnalytics, WebhookHandler, WebhookPayload } from './stubs';

// Fixed Nutrition Solutions Worker - Includes both analytics AND original keap-orders endpoint
export interface Env {
  DB01: D1Database;
  CACHE: KVNamespace;
  KEAP_SERVICE_ACCOUNT_KEY: string;
  KEAP_APP_ID?: string;
  HYPERDRIVE: Hyperdrive;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

interface KeapOrder {
  id: number;
  order_date: string;
  order_total: number;
  contact_id: number;
  order_title: string;
  order_type: string;
  payment_status: string;
  lead_affiliate_id?: number;
  order_items?: Array<{
    product_id: number;
    product_name: string;
    quantity: number;
    price: number;
  }>;
}

// Keap API Client
class KeapAPIClient {
  private baseUrl = 'https://api.infusionsoft.com/crm/rest/v1';
  private serviceAccountKey: string;

  constructor(serviceAccountKey: string) {
    this.serviceAccountKey = serviceAccountKey;
  }

  async fetchOrders(limit: number = 1000): Promise<KeapOrder[]> {
    try {
      const url = `${this.baseUrl}/orders?limit=${limit}`;
      console.log('Fetching from:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.serviceAccountKey}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Keap API Error:', errorText);
        throw new Error(`Keap API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log('Raw API response keys:', Object.keys(data));
      
      // Keap returns orders in different possible structures
      const orders = data.orders || data.results || data || [];
      console.log(`Found ${orders.length} orders`);
      
      return orders;
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  }
}

// Analytics class (simplified for now)
class FastAnalytics {
  constructor(private db: D1Database) {}

  async getBasicMetrics() {
    try {
      // Check if orders table exists
      const tableCheck = await this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='orders'
      `).first();

      if (!tableCheck) {
        return {
          message: "No orders table found. Run sync first.",
          tables_available: await this.getAvailableTables()
        };
      }

      // First check if we have any orders at all
      const orderCount = await this.db.prepare(`
        SELECT COUNT(*) as count FROM orders
      `).first();
      
      console.log('Total orders in database:', orderCount?.count || 0);
      
      // Get all unique statuses to debug
      const statuses = await this.db.prepare(`
        SELECT DISTINCT status FROM orders LIMIT 10
      `).all();
      
      console.log('Order statuses found:', statuses.results.map(s => s.status));
      
      const metrics = await this.db.prepare(`
        SELECT 
          COUNT(*) as total_orders,
          SUM(total_amount) as total_revenue,
          AVG(total_amount) as avg_order_value,
          COUNT(DISTINCT contact_id) as unique_customers
        FROM orders
        WHERE status IN ('paid', 'completed', 'Paid', 'PAID', 'Completed', 'COMPLETED')
      `).first();

      // Get additional metrics from new tables
      const contactCount = await this.db.prepare(`
        SELECT COUNT(*) as total_contacts FROM contacts
      `).first();

      const productCount = await this.db.prepare(`
        SELECT COUNT(*) as total_products FROM products
      `).first();

      const subscriptionMetrics = await this.db.prepare(`
        SELECT 
          COUNT(*) as active_subscriptions,
          SUM(billing_amount) as monthly_recurring_revenue
        FROM subscriptions
        WHERE status = 'active'
      `).first();

      return {
        orders: metrics,
        contacts: contactCount,
        products: productCount,
        subscriptions: subscriptionMetrics,
        summary: {
          total_revenue: metrics?.total_revenue || 0,
          total_customers: contactCount?.total_contacts || 0,
          mrr: subscriptionMetrics?.monthly_recurring_revenue || 0
        }
      };
    } catch (error) {
      console.error('Analytics error:', error);
      return { error: error.message };
    }
  }

  async getAvailableTables() {
    try {
      const tables = await this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table'
      `).all();
      return tables.results.map(t => t.name);
    } catch (error) {
      return [];
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const keapClient = new KeapAPIClient(env.KEAP_SERVICE_ACCOUNT_KEY);
    const analytics = new FastAnalytics(env.DB01);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      switch (url.pathname) {
        case '/':
          return new Response(generateMainDashboard(), {
            headers: { ...corsHeaders, 'Content-Type': 'text/html' }
          });

        case '/keap-orders':
          // Original endpoint - fetch live from Keap API
          const orders = await keapClient.fetchOrders(100); // Limit for speed
          return new Response(JSON.stringify({
            orders: orders,
            count: orders.length,
            fetched_at: new Date().toISOString()
          }, null, 2), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        case '/api/metrics':
          try {
            const cache = new CacheService(env.CACHE);
            const cacheKey = CacheKeys.metrics();
            
            // Try to get from cache first
            const cachedMetrics = await cache.get(cacheKey);
            if (cachedMetrics) {
              return new Response(JSON.stringify({
                ...cachedMetrics,
                _cached: true,
                _cachedAt: new Date().toISOString()
              }, null, 2), {
                headers: { 
                  ...corsHeaders, 
                  'Content-Type': 'application/json',
                  'X-Cache': 'HIT'
                }
              });
            }
            
            // Get fresh metrics
            const metrics = await analytics.getBasicMetrics();
            
            // Cache for 5 minutes
            await cache.set(cacheKey, metrics, { ttl: CacheTTL.MEDIUM });
            
            return new Response(JSON.stringify({
              ...metrics,
              _cached: false
            }, null, 2), {
              headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json',
                'X-Cache': 'MISS'
              }
            });
          } catch (error) {
            console.error('Metrics error:', error);
            // Fallback to non-cached version
            const metrics = await analytics.getBasicMetrics();
            return new Response(JSON.stringify(metrics, null, 2), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/sync-orders':
          // Sync orders from Keap using the new sync system
          try {
            const keapClientV2 = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const dataSync = new DataSync(keapClientV2, env.DB01);
            
            const result = await dataSync.syncOrders();
            
            return new Response(JSON.stringify({
              success: true,
              message: `Synced ${result.synced} orders to database`,
              ...result
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Order sync error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/tables':
          // List all tables in the database
          const tableList = await env.DB01.prepare(`
            SELECT name, sql FROM sqlite_master WHERE type='table'
          `).all();
          
          return new Response(JSON.stringify({
            tables: tableList.results,
            count: tableList.results.length
          }, null, 2), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        case '/api/migrate':
          // Migrate to new database schema
          try {
            // First check current state
            const checkTables = await env.DB01.prepare(`
              SELECT name FROM sqlite_master WHERE type='table'
            `).all();
            
            const currentTables = checkTables.results.map(t => t.name);
            
            // Determine migration status
            const hasNewSchema = currentTables.includes('companies');
            const hasOrdersNew = currentTables.includes('orders_new');
            const hasOrdersLower = currentTables.includes('orders');
            const hasOrdersUpper = currentTables.includes('Orders');
            
            // If migration is complete, return success
            if (hasNewSchema && hasOrdersLower && !hasOrdersNew && !hasOrdersUpper) {
              return new Response(JSON.stringify({ 
                success: true, 
                message: 'Migration already completed',
                tables: currentTables
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // If we need to complete the migration (have orders_new)
            if (hasNewSchema && hasOrdersNew) {
              // Drop any existing orders tables
              if (hasOrdersUpper) {
                await env.DB01.prepare('DROP TABLE Orders').run();
              }
              if (hasOrdersLower) {
                await env.DB01.prepare('DROP TABLE orders').run();
              }
              
              // Rename orders_new to orders
              await env.DB01.prepare('ALTER TABLE orders_new RENAME TO orders').run();
              
              return new Response(JSON.stringify({ 
                success: true, 
                message: 'Migration completed - renamed orders_new to orders',
                previousTables: currentTables
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Otherwise, create schema from scratch
            const schemaSQL = `
              CREATE TABLE IF NOT EXISTS companies (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                name TEXT NOT NULL,
                keap_app_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              );

              CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT REFERENCES companies(id),
                keap_contact_id TEXT UNIQUE,
                email TEXT,
                first_name TEXT,
                last_name TEXT,
                phone TEXT,
                tags TEXT DEFAULT '[]',
                custom_fields TEXT DEFAULT '{}',
                lifecycle_stage TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              );

              CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT REFERENCES companies(id),
                keap_product_id TEXT UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                price DECIMAL(10,2),
                category TEXT,
                sku TEXT,
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              );

              CREATE TABLE IF NOT EXISTS orders_new (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT REFERENCES companies(id),
                keap_order_id TEXT UNIQUE,
                contact_id TEXT REFERENCES contacts(id),
                total_amount DECIMAL(10,2),
                status TEXT,
                order_date DATETIME,
                products TEXT DEFAULT '[]',
                shipping_address TEXT DEFAULT '{}',
                billing_address TEXT DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              );

              CREATE TABLE IF NOT EXISTS subscriptions (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT REFERENCES companies(id),
                keap_subscription_id TEXT UNIQUE,
                contact_id TEXT REFERENCES contacts(id),
                product_id TEXT REFERENCES products(id),
                status TEXT,
                billing_amount DECIMAL(10,2),
                billing_cycle TEXT,
                start_date DATETIME,
                next_billing_date DATETIME,
                end_date DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              );

              CREATE TABLE IF NOT EXISTS sync_logs (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT REFERENCES companies(id),
                sync_type TEXT NOT NULL,
                status TEXT NOT NULL,
                records_processed INTEGER DEFAULT 0,
                errors TEXT DEFAULT '[]',
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
              );
            `;

            // Create tables one by one (D1 doesn't support multi-statement exec well)
            await env.DB01.prepare(`
              CREATE TABLE IF NOT EXISTS companies (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                name TEXT NOT NULL,
                keap_app_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `).run();

            await env.DB01.prepare(`
              CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT,
                keap_contact_id TEXT UNIQUE,
                email TEXT,
                first_name TEXT,
                last_name TEXT,
                phone TEXT,
                tags TEXT DEFAULT '[]',
                custom_fields TEXT DEFAULT '{}',
                lifecycle_stage TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `).run();

            await env.DB01.prepare(`
              CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT,
                keap_product_id TEXT UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                price DECIMAL(10,2),
                category TEXT,
                sku TEXT,
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `).run();

            await env.DB01.prepare(`
              CREATE TABLE IF NOT EXISTS orders_new (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT,
                keap_order_id TEXT UNIQUE,
                contact_id TEXT,
                total_amount DECIMAL(10,2),
                status TEXT,
                order_date DATETIME,
                products TEXT DEFAULT '[]',
                shipping_address TEXT DEFAULT '{}',
                billing_address TEXT DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `).run();

            await env.DB01.prepare(`
              CREATE TABLE IF NOT EXISTS subscriptions (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT,
                keap_subscription_id TEXT UNIQUE,
                contact_id TEXT,
                product_id TEXT,
                status TEXT,
                billing_amount DECIMAL(10,2),
                billing_cycle TEXT,
                start_date DATETIME,
                next_billing_date DATETIME,
                end_date DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `).run();

            await env.DB01.prepare(`
              CREATE TABLE IF NOT EXISTS sync_logs (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                company_id TEXT,
                sync_type TEXT NOT NULL,
                status TEXT NOT NULL,
                records_processed INTEGER DEFAULT 0,
                errors TEXT DEFAULT '[]',
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
              )
            `).run();

            // Create indexes
            const indexStatements = [
              'CREATE INDEX IF NOT EXISTS idx_contacts_keap_id ON contacts(keap_contact_id)',
              'CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)',
              'CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders_new(contact_id)',
              'CREATE INDEX IF NOT EXISTS idx_orders_date ON orders_new(order_date)',
              'CREATE INDEX IF NOT EXISTS idx_orders_keap_id ON orders_new(keap_order_id)',
              'CREATE INDEX IF NOT EXISTS idx_subscriptions_contact_id ON subscriptions(contact_id)',
              'CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)',
              'CREATE INDEX IF NOT EXISTS idx_sync_logs_type_status ON sync_logs(sync_type, status)'
            ];

            for (const indexStmt of indexStatements) {
              await env.DB01.prepare(indexStmt).run();
            }

            // Create default company
            const defaultCompanyId = 'default-company';
            await env.DB01.prepare(`
              INSERT OR IGNORE INTO companies (id, name, keap_app_id) 
              VALUES (?, 'Nutrition Solutions', ?)
            `).bind(defaultCompanyId, env.KEAP_APP_ID || 'default').run();

            // Check what tables already exist
            const existingTables = await env.DB01.prepare(`
              SELECT name FROM sqlite_master WHERE type='table'
            `).all();
            
            const tableNames = existingTables.results.map(t => t.name);
            let migratedCount = 0;
            
            console.log('Existing tables:', tableNames);
            
            // Check if we need to migrate or if migration is already done
            if ((tableNames.includes('Orders') || tableNames.includes('orders')) && !tableNames.includes('companies')) {
              // Old schema exists, need to migrate
              const tableName = tableNames.includes('Orders') ? 'Orders' : 'orders';
              const existingOrders = await env.DB01.prepare(`SELECT * FROM ${tableName}`).all();
              for (const order of existingOrders.results) {
                // Create contact if needed
                const contactId = crypto.randomUUID();
                
                // Extract contact info from order
                const firstName = order.order_title?.split(' ')[0] || 'Unknown';
                const lastName = order.order_title?.split(' ').slice(1).join(' ') || '';
                
                await env.DB01.prepare(`
                  INSERT OR IGNORE INTO contacts (
                    id, company_id, keap_contact_id, first_name, last_name
                  ) VALUES (?, ?, ?, ?, ?)
                `).bind(
                  contactId,
                  defaultCompanyId,
                  order.contact_id?.toString() || 'unknown',
                  firstName,
                  lastName
                ).run();
                
                // Get actual contact ID
                const contact = await env.DB01.prepare(`
                  SELECT id FROM contacts WHERE keap_contact_id = ?
                `).bind(order.contact_id?.toString() || 'unknown').first();
                
                // Insert order into new table
                await env.DB01.prepare(`
                  INSERT OR IGNORE INTO orders_new (
                    company_id, keap_order_id, contact_id, 
                    total_amount, status, order_date, products
                  ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(
                  defaultCompanyId,
                  order.id?.toString() || crypto.randomUUID(),
                  contact?.id || contactId,
                  order.order_total || 0,
                  order.payment_status || 'unknown',
                  order.order_date || new Date().toISOString(),
                  order.order_items || '[]'
                ).run();
                
                migratedCount++;
              }
              
              // Drop old orders table and rename new one
              await env.DB01.prepare(`DROP TABLE ${tableName}`).run();
              await env.DB01.prepare('ALTER TABLE orders_new RENAME TO orders').run();
              migratedCount = existingOrders.results.length;
            } else if (tableNames.includes('companies') && tableNames.includes('orders_new') && !tableNames.includes('orders')) {
              // Migration was partially completed, just rename orders_new to orders
              await env.DB01.prepare('ALTER TABLE orders_new RENAME TO orders').run();
            } else if (tableNames.includes('companies') && tableNames.includes('orders_new') && (tableNames.includes('Orders') || tableNames.includes('orders'))) {
              // We have both old and new tables, need to complete migration
              // Check if there's a lowercase 'orders' table too
              const hasLowerOrders = tableNames.includes('orders');
              const hasUpperOrders = tableNames.includes('Orders');
              
              // Drop all conflicting tables
              if (hasUpperOrders) {
                await env.DB01.prepare(`DROP TABLE Orders`).run();
              }
              if (hasLowerOrders) {
                await env.DB01.prepare(`DROP TABLE orders`).run();
              }
              
              // Now rename orders_new to orders
              await env.DB01.prepare('ALTER TABLE orders_new RENAME TO orders').run();
            } else if (tableNames.includes('companies') && tableNames.includes('orders') && !tableNames.includes('orders_new')) {
              // Migration already completed
              return new Response(JSON.stringify({ 
                success: true, 
                message: 'Migration already completed',
                existingTables: tableNames
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            // Log migration
            await env.DB01.prepare(`
              INSERT INTO sync_logs (company_id, sync_type, status, records_processed, completed_at)
              VALUES (?, 'database_migration', 'completed', ?, CURRENT_TIMESTAMP)
            `).bind(defaultCompanyId, migratedCount).run();

            return new Response(JSON.stringify({ 
              success: true, 
              message: 'Database migration completed successfully',
              migratedOrders: migratedCount,
              tablesCreated: ['companies', 'contacts', 'products', 'orders', 'subscriptions', 'sync_logs']
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Migration error:', error);
            return new Response(JSON.stringify({ 
              success: false, 
              error: error.message,
              stack: error.stack
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/sync/contacts':
          // Sync contacts from Keap
          try {
            const keapClientV2 = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const dataSync = new DataSync(keapClientV2, env.DB01);
            const cache = new CacheService(env.CACHE);
            
            const result = await dataSync.syncContacts();
            
            // Invalidate relevant caches
            await Promise.all([
              cache.deletePattern('metrics'),
              cache.deletePattern('dashboard'),
              cache.deletePattern('contacts')
            ]);
            
            return new Response(JSON.stringify({
              success: true,
              ...result
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Contact sync error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/sync/products':
          // Sync products from Keap
          try {
            const keapClientV2 = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const dataSync = new DataSync(keapClientV2, env.DB01);
            
            const result = await dataSync.syncProducts();
            
            return new Response(JSON.stringify({
              success: true,
              ...result
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Product sync error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/sync/subscriptions':
          // Sync subscriptions from Keap
          try {
            const keapClientV2 = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const dataSync = new DataSync(keapClientV2, env.DB01);
            
            const result = await dataSync.syncSubscriptions();
            
            return new Response(JSON.stringify({
              success: true,
              ...result
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Subscription sync error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/debug/db-status':
          // Debug endpoint to check database status
          const tables = await env.DB01.prepare(`
            SELECT name FROM sqlite_master WHERE type='table'
          `).all();
          
          const tableStatus = {};
          for (const table of tables.results) {
            const count = await env.DB01.prepare(`
              SELECT COUNT(*) as count FROM ${table.name}
            `).first();
            tableStatus[table.name] = count?.count || 0;
          }
          
          return new Response(JSON.stringify({
            tables: tableStatus,
            timestamp: new Date().toISOString()
          }, null, 2), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        case '/api/sync/all':
          // Sync all data from Keap
          try {
            const keapClientV2 = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const dataSync = new DataSync(keapClientV2, env.DB01);
            const cache = new CacheService(env.CACHE);
            
            const results = await dataSync.syncAll();
            
            // Clear all caches after full sync
            await Promise.all([
              cache.deletePattern('metrics'),
              cache.deletePattern('dashboard'),
              cache.deletePattern('contacts'),
              cache.deletePattern('orders'),
              cache.deletePattern('products'),
              cache.deletePattern('subscriptions')
            ]);
            
            return new Response(JSON.stringify({
              success: true,
              results,
              summary: {
                totalSynced: results.reduce((sum, r) => sum + r.synced, 0),
                totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
                totalDuration: results.reduce((sum, r) => sum + r.duration, 0)
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Full sync error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/dashboard':
          // Get comprehensive dashboard data
          try {
            const cache = new CacheService(env.CACHE);
            const { searchParams } = new URL(request.url);
            const startDate = searchParams.get('start');
            const endDate = searchParams.get('end');
            const cacheKey = CacheKeys.dashboard(startDate || undefined, endDate || undefined);
            
            // Try cache first
            const cachedData = await cache.get(cacheKey);
            if (cachedData) {
              return new Response(JSON.stringify({
                ...cachedData,
                _cached: true,
                _cachedAt: new Date().toISOString()
              }), {
                headers: { 
                  ...corsHeaders, 
                  'Content-Type': 'application/json',
                  'X-Cache': 'HIT'
                }
              });
            }
            
            // Get fresh data
            const dashboardAnalytics = new DashboardAnalytics(env.DB01);
            const dashboardData = await dashboardAnalytics.getDashboardData(startDate, endDate);
            
            // Cache for 5 minutes
            await cache.set(cacheKey, dashboardData, { ttl: CacheTTL.MEDIUM });
            
            return new Response(JSON.stringify({
              ...dashboardData,
              _cached: false
            }), {
              headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json',
                'X-Cache': 'MISS'
              }
            });
          } catch (error) {
            console.error('Dashboard data error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/dashboard':
          // Serve the improved dashboard HTML
          return new Response(await env.DB01.prepare('SELECT 1').first() ? '' : '', {
            status: 301,
            headers: {
              ...corsHeaders,
              'Location': '/dashboard-v2.html'
            }
          });

        case '/api/webhooks/register':
          // Register webhooks with Keap
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { 
              status: 405,
              headers: corsHeaders 
            });
          }
          
          try {
            // This would use Keap's webhook registration API
            // For now, return the configuration needed
            const webhookConfig = {
              hookUrl: 'https://d1-starter-sessions-api.megan-d14.workers.dev/api/webhooks/keap',
              eventKeys: [
                'contact.add', 'contact.edit', 'contact.delete',
                'order.add', 'order.edit', 'order.delete',
                'subscription.add', 'subscription.edit', 'subscription.delete',
                'product.add', 'product.edit', 'product.delete'
              ],
              status: 'To register webhooks, use Keap API with these event keys and hook URL'
            };
            
            return new Response(JSON.stringify(webhookConfig, null, 2), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            return new Response('Failed to register webhooks', { 
              status: 500,
              headers: corsHeaders 
            });
          }

        // Real-time dashboard data endpoints using Supabase through Hyperdrive
        case '/api/dashboard/revenue':
          try {
            if (!env.HYPERDRIVE) {
              throw new Error('Hyperdrive not configured');
            }
            
            const { Client } = await import('pg');
            const client = new Client({
              connectionString: env.HYPERDRIVE.connectionString,
            });
            
            await client.connect();
            
            const { searchParams } = new URL(request.url);
            const startDate = searchParams.get('start') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const endDate = searchParams.get('end') || new Date().toISOString().split('T')[0];
            
            // Daily revenue query
            const revenueQuery = `
              SELECT 
                DATE(order_date) as date,
                SUM(total_amount) as revenue,
                COUNT(*) as order_count
              FROM orders
              WHERE order_date >= $1 AND order_date <= $2
                AND status IN ('paid', 'completed', 'Paid', 'PAID', 'Completed', 'COMPLETED')
              GROUP BY DATE(order_date)
              ORDER BY date DESC
            `;
            
            const results = await client.query(revenueQuery, [startDate, endDate]);
            await client.end();
            
            return new Response(JSON.stringify({
              success: true,
              data: results.rows || [],
              period: { start: startDate, end: endDate }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Revenue data error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/dashboard/orders':
          try {
            if (!env.HYPERDRIVE) {
              throw new Error('Hyperdrive not configured');
            }
            
            const { Client } = await import('pg');
            const client = new Client({
              connectionString: env.HYPERDRIVE.connectionString,
            });
            
            await client.connect();
            
            // Order status distribution
            const statusQuery = `
              SELECT 
                status,
                COUNT(*) as count,
                SUM(total_amount) as total_value
              FROM orders
              WHERE order_date >= NOW() - INTERVAL '30 days'
              GROUP BY status
            `;
            
            const statusResults = await client.query(statusQuery);
            
            // Recent orders
            const recentQuery = `
              SELECT 
                o.keap_order_id as id,
                o.contact_name as customer,
                o.order_date as date,
                o.total_amount as amount,
                o.status
              FROM orders o
              ORDER BY o.order_date DESC
              LIMIT 10
            `;
            
            const recentResults = await client.query(recentQuery);
            await client.end();
            
            return new Response(JSON.stringify({
              success: true,
              statusDistribution: statusResults.rows || [],
              recentOrders: recentResults.rows || []
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Orders data error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/dashboard/customers':
          try {
            if (!env.HYPERDRIVE) {
              throw new Error('Hyperdrive not configured');
            }
            
            const { Client } = await import('pg');
            const client = new Client({
              connectionString: env.HYPERDRIVE.connectionString,
            });
            
            await client.connect();
            const { searchParams } = new URL(request.url);
            const days = parseInt(searchParams.get('days') || '7');
            
            // Customer growth by day
            const growthQuery = `
              SELECT 
                DATE(created_at) as date,
                COUNT(*) as new_customers
              FROM contacts
              WHERE created_at >= NOW() - INTERVAL '${days} days'
              GROUP BY DATE(created_at)
              ORDER BY date DESC
            `;
            
            const results = await client.query(growthQuery);
            await client.end();
            
            return new Response(JSON.stringify({
              success: true,
              data: results.rows || [],
              period: days
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Customers data error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/dashboard/products':
          try {
            if (!env.HYPERDRIVE) {
              throw new Error('Hyperdrive not configured');
            }
            
            const { Client } = await import('pg');
            const client = new Client({
              connectionString: env.HYPERDRIVE.connectionString,
            });
            
            await client.connect();
            
            // Top products by revenue
            const productsQuery = `
              SELECT 
                p.name as product_name,
                COUNT(DISTINCT o.keap_order_id) as order_count,
                SUM(o.total_amount) as total_revenue
              FROM orders o
              JOIN products p ON p.keap_product_id = ANY(
                SELECT jsonb_array_elements(o.products::jsonb)->>'product_id'
              )
              WHERE o.order_date >= NOW() - INTERVAL '30 days'
                AND o.status IN ('paid', 'completed', 'Paid', 'PAID', 'Completed', 'COMPLETED')
              GROUP BY p.name
              ORDER BY total_revenue DESC
              LIMIT 10
            `;
            
            const results = await client.query(productsQuery);
            await client.end();
            
            return new Response(JSON.stringify({
              success: true,
              data: results.rows || []
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Products data error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/dashboard/subscriptions':
          try {
            if (!env.HYPERDRIVE) {
              throw new Error('Hyperdrive not configured');
            }
            
            const { Client } = await import('pg');
            const client = new Client({
              connectionString: env.HYPERDRIVE.connectionString,
            });
            
            await client.connect();
            
            // Active subscriptions and MRR
            const subsQuery = `
              SELECT 
                COUNT(*) FILTER (WHERE status = 'active') as active_count,
                SUM(billing_amount) FILTER (WHERE status = 'active') as mrr,
                COUNT(*) FILTER (WHERE status = 'paused') as paused_count,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count
              FROM subscriptions
            `;
            
            const results = await client.query(subsQuery);
            
            // Recent subscriptions
            const recentQuery = `
              SELECT 
                contact_name as customer,
                product_name as product,
                billing_amount as amount,
                billing_cycle as cycle,
                next_bill_date,
                status
              FROM subscriptions
              WHERE status = 'active'
              ORDER BY created_at DESC
              LIMIT 10
            `;
            
            const recentResults = await client.query(recentQuery);
            await client.end();
            
            return new Response(JSON.stringify({
              success: true,
              metrics: results.rows[0] || {},
              recentSubscriptions: recentResults.rows || []
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Subscriptions data error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/webhooks/keap':
          // Handle Keap webhooks for real-time updates
          if (request.method !== 'POST') {
            return new Response('Method not allowed', {
              status: 405,
              headers: corsHeaders
            });
          }

          try {
            const payload = await request.json() as WebhookPayload;
            console.log('Received webhook:', payload);

            // Initialize webhook handler
            const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const dataSync = new DataSync(keapClient, env.DB01);
            const cache = new CacheService(env.CACHE);
            const webhookHandler = new WebhookHandler(env.DB01, cache, dataSync);

            // Process webhook
            await webhookHandler.handleWebhook(payload);

            // Also trigger real-time broadcast if we have SSE clients
            // This will be implemented in the next phase
            
            return new Response(JSON.stringify({
              success: true,
              message: 'Webhook processed successfully'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Webhook error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        default:
          return new Response(JSON.stringify({ error: 'Not Found', available_endpoints: [
            '/',
            '/dashboard',
            '/keap-orders',
            '/api/metrics', 
            '/api/sync-orders',
            '/api/migrate',
            '/api/tables',
            '/api/sync/contacts',
            '/api/sync/products',
            '/api/sync/subscriptions',
            '/api/sync/all',
            '/api/webhooks/keap',
            '/api/dashboard',
            '/api/dashboard/revenue',
            '/api/dashboard/orders',
            '/api/dashboard/customers',
            '/api/dashboard/products',
            '/api/dashboard/subscriptions',
            '/api/webhooks/keap',
            '/api/webhooks/register'
          ] }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: error.message,
        stack: error.stack,
        endpoint: url.pathname
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

function generateMainDashboard(): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Nutrition Solutions Data Hub</title>
    <style>
        body { font-family: system-ui; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
        .endpoints { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .endpoint { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .endpoint h3 { color: #333; margin-bottom: 15px; }
        .endpoint p { color: #666; margin-bottom: 15px; }
        .btn { background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; }
        .btn:hover { background: #5a6fd8; }
        .status { padding: 10px; background: #e8f5e8; border: 1px solid #4caf50; border-radius: 5px; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Nutrition Solutions Data Hub</h1>
            <p>Your unified data platform - Lightning fast analytics & AI-powered insights</p>
            <div style="margin-top: 20px;">
                <a href="/dashboard" class="btn" style="background: white; color: #667eea; padding: 12px 30px; font-size: 18px; font-weight: 600; border-radius: 8px; text-decoration: none; display: inline-block;">
                    📊 View Analytics Dashboard
                </a>
            </div>
        </div>
        
        <div class="endpoints">
            <div class="endpoint">
                <h3>📊 Live Keap Orders</h3>
                <p>Real-time order data directly from Keap API</p>
                <a href="/keap-orders" class="btn">View Orders JSON</a>
                <div class="status">✅ Fixed endpoint - should work now!</div>
            </div>
            
            <div class="endpoint">
                <h3>⚡ Sync to Database</h3>
                <p>Import Keap orders into D1 for lightning-fast analytics</p>
                <a href="/api/sync-orders" class="btn">Sync Orders</a>
                <div class="status">🔄 Creates local copy for speed</div>
            </div>
            
            <div class="endpoint">
                <h3>📈 Analytics Metrics</h3>
                <p>Business intelligence from your local database</p>
                <a href="/api/metrics" class="btn">View Metrics</a>
                <div class="status">💡 Replaces Grow.com functionality</div>
            </div>
            
            <div class="endpoint">
                <h3>🔧 Database Migration</h3>
                <p>Upgrade to new schema with contacts, products & subscriptions</p>
                <a href="/api/migrate" class="btn">Run Migration</a>
                <div class="status">🆕 One-time setup for full functionality</div>
            </div>
        </div>
        
        <h2 style="margin-top: 40px; color: #333;">🔄 Data Sync Operations</h2>
        <div class="endpoints">
            <div class="endpoint">
                <h3>👥 Sync Contacts</h3>
                <p>Import all contacts from Keap CRM</p>
                <a href="/api/sync/contacts" class="btn">Sync Contacts</a>
                <div class="status">Import customer data</div>
            </div>
            
            <div class="endpoint">
                <h3>📦 Sync Products</h3>
                <p>Import product catalog from Keap</p>
                <a href="/api/sync/products" class="btn">Sync Products</a>
                <div class="status">Import product data</div>
            </div>
            
            <div class="endpoint">
                <h3>🔁 Sync Subscriptions</h3>
                <p>Import subscription data from Keap</p>
                <a href="/api/sync/subscriptions" class="btn">Sync Subscriptions</a>
                <div class="status">Import recurring revenue</div>
            </div>
            
            <div class="endpoint">
                <h3>🚀 Full Sync</h3>
                <p>Sync all data types in one operation</p>
                <a href="/api/sync/all" class="btn">Sync Everything</a>
                <div class="status">Complete data import</div>
            </div>
        </div>
        
        <div style="background: white; padding: 25px; border-radius: 10px; margin-top: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h3>🎯 Next Steps</h3>
            <ol>
                <li><strong>Test the fix:</strong> Click "View Orders JSON" above</li>
                <li><strong>Sync your data:</strong> Click "Sync Orders" to create local copy</li>
                <li><strong>View analytics:</strong> Click "View Metrics" to see your dashboard</li>
                <li><strong>Scale up:</strong> Ready to replace Grow.com and save $3,400/month</li>
            </ol>
        </div>
    </div>
</body>
</html>
  `;
}