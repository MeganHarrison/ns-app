// TODO: These imports need to be implemented or removed
import { KeapClient } from '../../../../workers/keap-client';
import { KeapXMLRPCClient, formatDateForKeap } from '../../../../workers/keap-xmlrpc-client';
import { SupabaseService, SupabaseOrder } from '../../supabase-client';
// import { DataSync } from './sync/data-sync';
// import { DashboardAnalytics } from './dashboard/analytics/dashboard-data';
// import { CacheService, CacheKeys, CacheTTL } from './cache/cache-service';
// import { WebhookHandler, WebhookPayload } from '../webhooks/webhook-handler';

// Fixed Nutrition Solutions Worker - Includes both analytics AND original keap-orders endpoint
export interface Env {
  DB01: D1Database;
  CACHE: KVNamespace;
  KEAP_SERVICE_ACCOUNT_KEY: string;
  KEAP_APP_ID?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_AUTH_TOKEN?: string;
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
            // TODO: Implement caching when CacheService is available
            
            // Get fresh metrics from the database
            const metrics = await analytics.getBasicMetrics();
            
            return new Response(JSON.stringify({
              ...metrics,
              _cached: false,
              _timestamp: new Date().toISOString()
            }, null, 2), {
              headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json'
              }
            });
          } catch (error) {
            console.error('Metrics error:', error);
            return new Response(JSON.stringify({ 
              error: error.message,
              stack: error.stack 
            }, null, 2), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 500
            });
          }

        case '/api/sync-orders':
          // Sync orders from Keap to Supabase
          try {
            // Initialize clients
            const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const supabase = new SupabaseService({
              url: env.SUPABASE_URL,
              serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
            });
            
            const defaultCompanyId = 'nutrition-solutions';
            
            // Get the latest order date from Supabase to sync only new orders
            const latestOrderDate = await supabase.getLatestOrderDate(defaultCompanyId);
            console.log('Latest order in Supabase:', latestOrderDate?.toISOString() || 'No orders found');
            
            // Fetch orders from Keap
            // If we have existing orders, get only newer ones
            // Otherwise, get last 90 days for initial sync
            const syncStartDate = latestOrderDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            
            const { orders, count } = await keapClient.getOrders(100, 0, {
              since: syncStartDate.toISOString()
            });
            
            console.log(`Found ${orders.length} orders to sync since ${syncStartDate.toISOString()}. Total available: ${count}`);
            
            if (orders.length === 0) {
              return new Response(JSON.stringify({
                success: true,
                message: 'No new orders to sync',
                synced: 0,
                latestOrderDate: latestOrderDate?.toISOString()
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Transform Keap orders to Supabase format
            const supabaseOrders: SupabaseOrder[] = orders.map(order => ({
              company_id: defaultCompanyId,
              keap_order_id: order.id.toString(),
              contact_id: order.contact_id?.toString() || null,
              total_amount: order.total?.amount || 0,
              status: order.status || 'unknown',
              order_date: order.order_time || order.creation_time || new Date().toISOString(),
              products: order.order_items || [],
              shipping_address: order.shipping_information || {},
              billing_address: order.payment_plan || {}
            }));
            
            // Sync to Supabase
            const syncResult = await supabase.syncOrders(supabaseOrders);
            
            // Also sync to D1 for local analytics (keep existing functionality)
            if (syncResult.success && env.DB01) {
              try {
                const stmt = env.DB01.prepare(`
                  INSERT OR REPLACE INTO orders (
                    id, company_id, keap_order_id, contact_id, 
                    total_amount, status, order_date, products,
                    shipping_address, billing_address
                  ) VALUES (
                    lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?
                  )
                `);
                
                const batch = supabaseOrders.map(order => stmt.bind(
                  order.company_id,
                  order.keap_order_id,
                  order.contact_id,
                  order.total_amount,
                  order.status,
                  order.order_date,
                  JSON.stringify(order.products),
                  JSON.stringify(order.shipping_address),
                  JSON.stringify(order.billing_address)
                ));
                
                if (batch.length > 0) {
                  await env.DB01.batch(batch);
                }
              } catch (d1Error) {
                console.error('D1 sync error (non-critical):', d1Error);
              }
            }
            
            const currentOrderCount = await supabase.getOrderCount(defaultCompanyId);
            
            return new Response(JSON.stringify({
              success: syncResult.success,
              message: `Synced ${syncResult.synced} orders to Supabase`,
              synced: syncResult.synced,
              total: orders.length,
              totalOrdersInSupabase: currentOrderCount,
              errors: syncResult.errors,
              dateRange: {
                from: syncStartDate.toISOString(),
                to: new Date().toISOString()
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Order sync error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message,
              stack: error.stack
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/orders/date-range':
          // Get the date range of orders in the database
          try {
            const dateRange = await env.DB01.prepare(`
              SELECT 
                MIN(order_date) as first_order,
                MAX(order_date) as last_order,
                COUNT(*) as total_orders
              FROM orders
            `).first();
            
            return new Response(JSON.stringify({
              dateRange: dateRange,
              message: "Use these dates for dashboard filtering"
            }, null, 2), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
        case '/api/subscriptions':
          // Get subscriptions from Supabase
          try {
            const url = new URL(request.url);
            const status = url.searchParams.get('status');
            const limit = parseInt(url.searchParams.get('limit') || '1000');
            const offset = parseInt(url.searchParams.get('offset') || '0');
            
            // Fetch from Supabase via Hyperdrive
            const hyperdriveUrl = 'https://new-hyperdrive-worker.megan-d14.workers.dev/query';
            
            let query = `
              SELECT * FROM subscriptions 
              WHERE 1=1
            `;
            const params = [];
            
            if (status) {
              query += ` AND status = $${params.length + 1}`;
              params.push(status);
            }
            
            query += ` ORDER BY next_bill_date ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limit, offset);
            
            // Fetch subscriptions
            const subscriptionsResponse = await fetch(hyperdriveUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                query: query,
                params: params 
              })
            });
            
            if (!subscriptionsResponse.ok) {
              throw new Error(`Hyperdrive error: ${await subscriptionsResponse.text()}`);
            }
            
            const subscriptionsData = await subscriptionsResponse.json();
            
            // Get total count
            let countQuery = `SELECT COUNT(*) as count FROM subscriptions WHERE 1=1`;
            const countParams = [];
            if (status) {
              countQuery += ` AND status = $1`;
              countParams.push(status);
            }
            
            const countResponse = await fetch(hyperdriveUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                query: countQuery,
                params: countParams 
              })
            });
            
            if (!countResponse.ok) {
              throw new Error(`Hyperdrive count error: ${await countResponse.text()}`);
            }
            
            const countData = await countResponse.json();
            const totalCount = countData.rows?.[0]?.count || 0;
            
            return new Response(JSON.stringify({
              subscriptions: subscriptionsData.rows || [],
              total: totalCount,
              limit,
              offset
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Error fetching subscriptions:', error);
            return new Response(JSON.stringify({ 
              error: 'Failed to fetch subscriptions',
              details: error.message 
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/subscription/debug':
          // Debug endpoint to fetch subscription details
          if (request.method !== 'GET') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
              status: 405,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          try {
            const url = new URL(request.url);
            const subscriptionId = url.searchParams.get('id');
            
            if (!subscriptionId) {
              return new Response(JSON.stringify({ 
                error: 'Subscription ID is required as query parameter (?id=123)' 
              }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Create Keap client
            const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            
            // Fetch subscription details
            const subscription = await keapClient.getSubscription(subscriptionId);
            
            return new Response(JSON.stringify({
              success: true,
              subscription: subscription,
              debug: {
                id: subscription.id,
                currentNextBillDate: subscription.next_bill_date,
                status: subscription.status,
                billingAmount: subscription.billing_amount,
                billingCycle: subscription.billing_cycle,
                startDate: subscription.start_date,
                endDate: subscription.end_date
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
            
          } catch (error) {
            console.error('Subscription debug error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message,
              details: error.stack
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
        case '/api/tables':
          // List all tables in the database
          const tables = await env.DB01.prepare(`
            SELECT name, sql FROM sqlite_master WHERE type='table'
          `).all();
          
          return new Response(JSON.stringify({
            tables: tables.results,
            count: tables.results.length
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
          // Sync contacts from Keap - TODO: Implement without DataSync
          return new Response(JSON.stringify({
            success: false,
            error: 'Contact sync not implemented yet'
          }), {
            status: 501,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        case '/api/sync/products':
          // Sync products from Keap - TODO: Implement without DataSync
          return new Response(JSON.stringify({
            success: false,
            error: 'Product sync not implemented yet'
          }), {
            status: 501,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        case '/api/sync/subscriptions':
          // Sync subscriptions from Keap
          if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
              status: 405,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          try {
            // Check for simple auth token
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return new Response(JSON.stringify({ error: 'Authorization required' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            const token = authHeader.split(' ')[1];
            if (token !== env.WORKER_AUTH_TOKEN) {
              return new Response(JSON.stringify({ error: 'Invalid auth token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            // Create Keap client
            const keapClient = new KeapClient({
              serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY
            });

            // Fetch all subscriptions from Keap
            console.log('Fetching subscriptions from Keap API...');
            const subscriptions = await keapClient.getAllSubscriptions();
            console.log(`Fetched ${subscriptions.length} subscriptions from Keap`);

            // Get contacts to match email addresses
            const contactIds = [...new Set(subscriptions.map(sub => sub.contact_id))];
            const contacts = new Map();
            
            // Batch fetch contact details
            for (const contactId of contactIds) {
              try {
                const contact = await keapClient.getContact(contactId);
                contacts.set(contactId, contact);
              } catch (error) {
                console.error(`Failed to fetch contact ${contactId}:`, error);
              }
            }

            // Prepare subscriptions for database
            const processedSubscriptions = subscriptions.map(sub => {
              const contact = contacts.get(sub.contact_id) || {};
              return {
                keap_subscription_id: sub.id,
                contact_id: sub.contact_id,
                contact_email: contact.email || null,
                contact_name: `${contact.given_name || ''} ${contact.family_name || ''}`.trim(),
                product_id: sub.product_id,
                product_name: sub.product_name || null,
                status: sub.status,
                billing_amount: sub.billing_amount,
                billing_cycle: sub.billing_cycle,
                start_date: sub.start_date,
                next_bill_date: sub.next_bill_date,
                end_date: sub.end_date,
                last_payment_date: sub.last_payment_date || null,
                payment_method: sub.payment_method || null
              };
            });

            // Sync to Supabase via Hyperdrive
            let syncedCount = 0;
            const hyperdriveUrl = 'https://new-hyperdrive-worker.megan-d14.workers.dev/query';
            
            for (const subscription of processedSubscriptions) {
              try {
                const query = `
                  INSERT INTO subscriptions (
                    keap_subscription_id, contact_id, contact_email, contact_name,
                    product_id, product_name, status, billing_amount, billing_cycle,
                    start_date, next_bill_date, end_date, last_payment_date, payment_method,
                    last_synced
                  ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
                  )
                  ON CONFLICT (keap_subscription_id) 
                  DO UPDATE SET
                    contact_email = EXCLUDED.contact_email,
                    contact_name = EXCLUDED.contact_name,
                    product_name = EXCLUDED.product_name,
                    status = EXCLUDED.status,
                    billing_amount = EXCLUDED.billing_amount,
                    billing_cycle = EXCLUDED.billing_cycle,
                    next_bill_date = EXCLUDED.next_bill_date,
                    end_date = EXCLUDED.end_date,
                    last_payment_date = EXCLUDED.last_payment_date,
                    payment_method = EXCLUDED.payment_method,
                    updated_at = NOW(),
                    last_synced = NOW()
                `;
                
                const params = [
                  subscription.keap_subscription_id,
                  subscription.contact_id,
                  subscription.contact_email,
                  subscription.contact_name,
                  subscription.product_id,
                  subscription.product_name,
                  subscription.status,
                  subscription.billing_amount,
                  subscription.billing_cycle,
                  subscription.start_date,
                  subscription.next_bill_date,
                  subscription.end_date,
                  subscription.last_payment_date,
                  subscription.payment_method
                ];
                
                const response = await fetch(hyperdriveUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    query: query,
                    params: params 
                  })
                });
                
                if (!response.ok) {
                  const error = await response.text();
                  console.error('Failed to sync subscription:', subscription.keap_subscription_id, error);
                } else {
                  syncedCount++;
                }
              } catch (error) {
                console.error('Error syncing subscription:', subscription.keap_subscription_id, error);
              }
            }

            // Cache invalidation
            if (env.CACHE) {
              const cache = new CacheService(env.CACHE);
              await cache.delete('subscriptions:all');
            }

            return new Response(JSON.stringify({
              success: true,
              message: `Successfully synced ${syncedCount} subscriptions`,
              totalFetched: subscriptions.length,
              totalSynced: syncedCount
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

          } catch (error) {
            console.error('Subscription sync error:', error);
            return new Response(JSON.stringify({ 
              error: 'Failed to sync subscriptions',
              details: error.message 
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
        case '/api/subscription/get':
          // Get subscription details for debugging
          if (request.method !== 'GET') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
              status: 405,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          try {
            const url = new URL(request.url);
            const subscriptionId = url.searchParams.get('id');
            
            if (!subscriptionId) {
              return new Response(JSON.stringify({ 
                error: 'subscriptionId parameter is required' 
              }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Create Keap client
            const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            
            // Get the subscription
            const subscription = await keapClient.getSubscription(subscriptionId);
            
            return new Response(JSON.stringify({
              success: true,
              subscription: subscription,
              fields: Object.keys(subscription),
              next_bill_date: subscription.next_bill_date,
              status: subscription.status
            }, null, 2), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
            
          } catch (error) {
            console.error('Get subscription error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message,
              details: error.toString()
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
        case '/api/subscription/pause':
          // Pause a subscription by pushing next_bill_date forward
          if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
              status: 405,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          try {
            const body = await request.json();
            const { subscriptionId, pauseWeeks = 1, customerId, reason } = body;
            
            if (!subscriptionId) {
              return new Response(JSON.stringify({ 
                error: 'subscriptionId is required' 
              }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Convert subscriptionId to number if it's a string
            const subscriptionIdNum = typeof subscriptionId === 'string' ? parseInt(subscriptionId) : subscriptionId;
            
            // Create XML-RPC client
            const xmlrpcClient = new KeapXMLRPCClient(env.KEAP_SERVICE_ACCOUNT_KEY);
            
            // First, get the current subscription details using XML-RPC
            let currentSubscription;
            try {
              currentSubscription = await xmlrpcClient.getRecurringOrder(subscriptionIdNum);
              console.log('Current subscription details:', currentSubscription);
            } catch (error) {
              console.error('Failed to get subscription details:', error);
              // If XML-RPC fails, fall back to REST API to get current details
              const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
              const restSubscription = await keapClient.getSubscription(subscriptionId.toString());
              currentSubscription = {
                NextBillDate: restSubscription.next_bill_date ? new Date(restSubscription.next_bill_date) : new Date()
              };
            }
            
            // Calculate the new billing date
            const currentNextBillDate = currentSubscription.NextBillDate ? new Date(currentSubscription.NextBillDate) : new Date();
            const newNextBillDate = new Date(currentNextBillDate);
            newNextBillDate.setDate(newNextBillDate.getDate() + (pauseWeeks * 7));
            
            // Format the date for Keap (midnight UTC)
            const formattedNewDate = formatDateForKeap(newNextBillDate);
            
            console.log(`Updating subscription ${subscriptionIdNum} next bill date from ${currentNextBillDate.toISOString()} to ${formattedNewDate.toISOString()}`);
            
            // Update the subscription's next bill date using XML-RPC
            const updateResult = await xmlrpcClient.updateSubscriptionNextBillDate(subscriptionIdNum, formattedNewDate);
            
            if (updateResult) {
              // Success! Get updated subscription details to confirm
              let updatedSubscription;
              try {
                updatedSubscription = await xmlrpcClient.getRecurringOrder(subscriptionIdNum);
              } catch (error) {
                // Fall back to basic response if we can't get updated details
                updatedSubscription = { NextBillDate: formattedNewDate };
              }
              
              return new Response(JSON.stringify({
                success: true,
                message: `Successfully paused subscription for ${pauseWeeks} week(s)`,
                data: {
                  subscriptionId: subscriptionIdNum,
                  previousNextBillDate: currentNextBillDate.toISOString(),
                  newNextBillDate: formattedNewDate.toISOString(),
                  pauseWeeks: pauseWeeks,
                  customerId: customerId,
                  reason: reason,
                  updatedSubscription: updatedSubscription
                }
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else {
              throw new Error('Failed to update subscription next bill date - API returned false');
            }
            
          } catch (error) {
            console.error('Subscription pause error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message,
              details: error.stack,
              note: 'XML-RPC API call failed. Ensure the service account key has proper permissions for the RecurringOrderService.'
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/debug/db-status':
          // Debug endpoint to check database status
          const dbTables = await env.DB01.prepare(`
            SELECT name FROM sqlite_master WHERE type='table'
          `).all();
          
          const tableStatus = {};
          for (const table of dbTables.results) {
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

        case '/api/sync/all-orders':
          // Sync ALL historical orders from Keap to Supabase
          try {
            // Check for auth token
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return new Response(JSON.stringify({ error: 'Authorization required' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            const token = authHeader.split(' ')[1];
            if (token !== env.WORKER_AUTH_TOKEN) {
              return new Response(JSON.stringify({ error: 'Invalid auth token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            // Initialize clients
            const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
            const supabase = new SupabaseService({
              url: env.SUPABASE_URL,
              serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
            });
            
            const defaultCompanyId = 'nutrition-solutions';
            let totalSynced = 0;
            let totalErrors = 0;
            const batchSize = 1000; // Keap max limit
            let offset = 0;
            let hasMore = true;
            const syncErrors = [];
            
            console.log('Starting full historical order sync...');
            
            while (hasMore) {
              try {
                // Fetch batch of orders from Keap
                const { orders, count } = await keapClient.getOrders(batchSize, offset);
                
                console.log(`Fetched ${orders.length} orders (offset: ${offset}, total: ${count})`);
                
                if (orders.length === 0) {
                  hasMore = false;
                  break;
                }
                
                // Transform to Supabase format
                const supabaseOrders: SupabaseOrder[] = orders.map(order => ({
                  company_id: defaultCompanyId,
                  keap_order_id: order.id.toString(),
                  contact_id: order.contact_id?.toString() || null,
                  total_amount: order.total?.amount || 0,
                  status: order.status || 'unknown',
                  order_date: order.order_time || order.creation_time || new Date().toISOString(),
                  products: order.order_items || [],
                  shipping_address: order.shipping_information || {},
                  billing_address: order.payment_plan || {}
                }));
                
                // Sync batch to Supabase
                const syncResult = await supabase.syncOrders(supabaseOrders);
                
                if (syncResult.success) {
                  totalSynced += syncResult.synced;
                } else {
                  totalErrors += orders.length;
                  syncErrors.push(...syncResult.errors);
                }
                
                // Check if we've synced all orders
                offset += batchSize;
                if (offset >= count) {
                  hasMore = false;
                }
                
                // Add a small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
                
              } catch (batchError) {
                console.error(`Error syncing batch at offset ${offset}:`, batchError);
                syncErrors.push({ offset, error: batchError.message });
                totalErrors += batchSize;
                offset += batchSize; // Continue to next batch
              }
            }
            
            const finalOrderCount = await supabase.getOrderCount(defaultCompanyId);
            
            return new Response(JSON.stringify({
              success: totalErrors === 0,
              message: `Full sync completed. Synced ${totalSynced} orders`,
              totalSynced,
              totalErrors,
              totalOrdersInSupabase: finalOrderCount,
              errors: syncErrors.slice(0, 10), // Limit errors in response
              executionTime: new Date().toISOString()
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('Full sync error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message,
              stack: error.stack
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

        case '/api/sync/all':
          // Sync all data from Keap (legacy endpoint - keeping for compatibility)
          try {
            return new Response(JSON.stringify({
              message: 'Please use specific sync endpoints: /api/sync/all-orders, /api/sync/contacts, etc.',
              endpoints: {
                orders: '/api/sync/all-orders',
                recentOrders: '/api/sync-orders',
                contacts: '/api/sync/contacts',
                products: '/api/sync/products',
                subscriptions: '/api/sync/subscriptions'
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
            const { searchParams } = new URL(request.url);
            const startDate = searchParams.get('start');
            const endDate = searchParams.get('end');
            
            // Default to last 30 days if no date range provided
            const endDateObj = endDate ? new Date(endDate) : new Date();
            const startDateObj = startDate ? new Date(startDate) : new Date(endDateObj.getTime() - 30 * 24 * 60 * 60 * 1000);
            
            // Revenue metrics
            const revenueData = await env.DB01.prepare(`
              SELECT 
                COUNT(*) as total_orders,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_order_value,
                COUNT(DISTINCT contact_id) as unique_customers,
                MIN(order_date) as first_order_date,
                MAX(order_date) as last_order_date
              FROM orders
              WHERE order_date >= ? AND order_date <= ?
            `).bind(startDateObj.toISOString(), endDateObj.toISOString()).first();
            
            // Daily revenue for chart
            const dailyRevenue = await env.DB01.prepare(`
              SELECT 
                DATE(order_date) as date,
                COUNT(*) as orders,
                SUM(total_amount) as revenue
              FROM orders
              WHERE order_date >= ? AND order_date <= ?
              GROUP BY DATE(order_date)
              ORDER BY date DESC
              LIMIT 30
            `).bind(startDateObj.toISOString(), endDateObj.toISOString()).all();
            
            // Top products
            const topProducts = await env.DB01.prepare(`
              SELECT 
                products,
                COUNT(*) as order_count,
                SUM(total_amount) as revenue
              FROM orders
              WHERE order_date >= ? AND order_date <= ?
                AND products IS NOT NULL
              GROUP BY products
              ORDER BY revenue DESC
              LIMIT 10
            `).bind(startDateObj.toISOString(), endDateObj.toISOString()).all();
            
            // Customer metrics
            const customerMetrics = await env.DB01.prepare(`
              SELECT 
                COUNT(DISTINCT contact_id) as total_customers,
                COUNT(CASE WHEN order_count = 1 THEN 1 END) as new_customers,
                COUNT(CASE WHEN order_count > 1 THEN 1 END) as repeat_customers
              FROM (
                SELECT contact_id, COUNT(*) as order_count
                FROM orders
                WHERE order_date >= ? AND order_date <= ?
                GROUP BY contact_id
              )
            `).bind(startDateObj.toISOString(), endDateObj.toISOString()).first();
            
            const dashboardData = {
              dateRange: {
                start: startDateObj.toISOString(),
                end: endDateObj.toISOString()
              },
              revenue: {
                total: revenueData?.total_revenue || 0,
                orderCount: revenueData?.total_orders || 0,
                averageOrderValue: revenueData?.avg_order_value || 0,
                uniqueCustomers: revenueData?.unique_customers || 0
              },
              dailyRevenue: dailyRevenue?.results || [],
              topProducts: topProducts?.results || [],
              customers: {
                total: customerMetrics?.total_customers || 0,
                new: customerMetrics?.new_customers || 0,
                returning: customerMetrics?.repeat_customers || 0
              },
              _timestamp: new Date().toISOString()
            };
            
            return new Response(JSON.stringify(dashboardData, null, 2), {
              headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json'
              }
            });
          } catch (error) {
            console.error('Dashboard data error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: error.message,
              stack: error.stack
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

        case '/api/webhooks/keap':
          // Handle Keap webhooks for real-time updates
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { 
              status: 405,
              headers: corsHeaders 
            });
          }
          
          try {
            const payload = await request.json();
            
            // Verify webhook signature (if provided by Keap)
            // const signature = request.headers.get('X-Keap-Signature');
            // Add signature verification here when available
            
            console.log('Received webhook:', payload.event_type || payload.hook_event_id);
            
            // Handle order-related webhooks
            if (payload.event_type === 'order.add' || payload.event_type === 'order.update') {
              const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
              const supabase = new SupabaseService({
                url: env.SUPABASE_URL,
                serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
              });
              
              // Get the order ID from the webhook payload
              const orderId = payload.object_key || payload.order_id;
              
              if (orderId) {
                // Fetch the full order details from Keap
                const order = await keapClient.getOrder(orderId.toString());
                
                if (order) {
                  // Transform and sync to Supabase
                  const supabaseOrder: SupabaseOrder = {
                    company_id: 'nutrition-solutions',
                    keap_order_id: order.id.toString(),
                    contact_id: order.contact_id?.toString() || null,
                    total_amount: order.total?.amount || 0,
                    status: order.status || 'unknown',
                    order_date: order.order_time || order.creation_time || new Date().toISOString(),
                    products: order.order_items || [],
                    shipping_address: order.shipping_information || {},
                    billing_address: order.payment_plan || {}
                  };
                  
                  const synced = await supabase.syncSingleOrder(supabaseOrder);
                  
                  console.log(`Order ${orderId} ${synced ? 'synced' : 'failed to sync'} via webhook`);
                  
                  // Also sync to D1 for local analytics
                  if (env.DB01) {
                    try {
                      await env.DB01.prepare(`
                        INSERT OR REPLACE INTO orders (
                          id, company_id, keap_order_id, contact_id, 
                          total_amount, status, order_date, products,
                          shipping_address, billing_address
                        ) VALUES (
                          lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?
                        )
                      `).bind(
                        supabaseOrder.company_id,
                        supabaseOrder.keap_order_id,
                        supabaseOrder.contact_id,
                        supabaseOrder.total_amount,
                        supabaseOrder.status,
                        supabaseOrder.order_date,
                        JSON.stringify(supabaseOrder.products),
                        JSON.stringify(supabaseOrder.shipping_address),
                        JSON.stringify(supabaseOrder.billing_address)
                      ).run();
                    } catch (d1Error) {
                      console.error('D1 sync error (non-critical):', d1Error);
                    }
                  }
                }
              }
            }
            
            // Log webhook processing
            if (env.DB01) {
              await env.DB01.prepare(`
                INSERT INTO sync_logs (company_id, sync_type, status, records_processed, completed_at)
                VALUES ('nutrition-solutions', ?, 'completed', 1, CURRENT_TIMESTAMP)
              `).bind(`webhook:${payload.event_type || 'unknown'}`).run();
            }
            
            return new Response('OK', { 
              status: 200,
              headers: corsHeaders 
            });
          } catch (error) {
            console.error('Webhook error:', error);
            return new Response('Webhook processing failed', { 
              status: 500,
              headers: corsHeaders 
            });
          }

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

        default:
          return new Response(JSON.stringify({ error: 'Not Found', available_endpoints: [
            '/',
            '/dashboard',
            '/keap-orders',
            '/api/metrics', 
            '/api/sync-orders',
            '/api/sync/all-orders',
            '/api/migrate',
            '/api/tables',
            '/api/sync/contacts',
            '/api/sync/products',
            '/api/sync/subscriptions',
            '/api/sync/all',
            '/api/dashboard',
            '/api/webhooks/keap',
            '/api/webhooks/register',
            '/api/subscription/pause',
            '/api/subscription/get',
            '/api/subscription/debug'
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
    <meta charset="UTF-8">
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