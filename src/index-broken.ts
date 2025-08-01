// Modern Nutrition Solutions Worker - Clean D1 Architecture
// Replaces complex hybrid system with streamlined approach

interface Env {
  DB: D1Database;
  SYNC_STATE: KVNamespace;
  KEAP_CLIENT_ID: string;
  KEAP_SECRET: string;
  KEAP_SERVICE_ACCOUNT_KEY: string;
}

interface KeapOrder {
  id: number;
  contact_id: number;
  status: string;
  total: string | number;
  creation_date: string;
  modification_date: string;
  order_items?: KeapOrderItem[];
  shipping_address?: any;
  billing_address?: any;
  payment_status?: string;
  tracking_number?: string;
  promo_codes?: string[];
  lead_affiliate_id?: number;
}

interface KeapOrderItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  price: number;
  notes?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS headers for dashboard access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response: Response;
      
      switch (url.pathname) {
        case '/':
          response = new Response(generateMainDashboard(), {
            headers: { 'Content-Type': 'text/html' }
          });
          break;
          
        case '/sync-orders':
          response = await handleOrdersSync(request, env);
          break;
          
        case '/orders':
          response = await getOrders(request, env);
          break;
          
        case '/dashboard-data':
          response = await getDashboardData(request, env);
          break;
          
        case '/sync-status':
          response = await getSyncStatus(env);
          break;
          
        case '/health':
          response = new Response(JSON.stringify({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            version: '2.0-modern'
          }));
          break;
          
        default:
          response = new Response(JSON.stringify({
            error: 'Not Found',
            availableEndpoints: [
              '/',
              '/sync-orders?full_sync=true',
              '/orders',
              '/dashboard-data',
              '/sync-status',
              '/health'
            ]
          }), { status: 404 });
      }

      // Add CORS headers to all responses
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },

  // Scheduled task for automatic syncing
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Starting scheduled sync...');
    ctx.waitUntil(syncIncrementalOrders(env));
  }
};

async function handleOrdersSync(request: Request, env: Env): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const full_sync = searchParams.get('full_sync') === 'true';
    
    if (full_sync) {
      return await syncAllOrders(env);
    } else {
      return await syncIncrementalOrders(env);
    }
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({ 
      error: 'Sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function syncAllOrders(env: Env): Promise<Response> {
  const accessToken = await getKeapAccessToken(env);
  let totalSynced = 0;
  let offset = 0;
  const limit = 200;
  
  console.log('Starting full orders sync...');
  
  try {
    // Initialize database if needed
    await initializeDatabase(env);
    
    while (true) {
      const orders = await fetchKeapOrders(accessToken, offset, limit);
      
      if (!orders || orders.length === 0) {
        break;
      }
      
      await batchInsertOrders(env, orders);
      totalSynced += orders.length;
      offset += limit;
      
      console.log(`Synced ${totalSynced} orders so far...`);
      
      // Rate limiting
      if (totalSynced % 500 === 0) {
        await sleep(2000);
      }
      
      if (orders.length < limit) {
        break;
      }
    }
    
    await env.SYNC_STATE.put('last_order_sync', new Date().toISOString());
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Full sync completed',
      total_synced: totalSynced,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Full sync error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Full sync failed',
      synced_before_error: totalSynced,
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function syncIncrementalOrders(env: Env): Promise<Response> {
  const accessToken = await getKeapAccessToken(env);
  const lastSyncTime = await env.SYNC_STATE.get('last_order_sync') || 
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  console.log(`Starting incremental sync from: ${lastSyncTime}`);
  
  try {
    const orders = await fetchKeapOrdersModifiedSince(accessToken, lastSyncTime);
    
    if (orders && orders.length > 0) {
      await batchInsertOrders(env, orders);
      console.log(`Synced ${orders.length} updated orders`);
    }
    
    await env.SYNC_STATE.put('last_order_sync', new Date().toISOString());
    
    return new Response(JSON.stringify({
      success: true,
      synced_count: orders?.length || 0,
      last_sync: lastSyncTime,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Incremental sync error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Incremental sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function getKeapAccessToken(env: Env): Promise<string> {
  if (env.KEAP_SERVICE_ACCOUNT_KEY) {
    return env.KEAP_SERVICE_ACCOUNT_KEY;
  }
  
  const cachedToken = await env.SYNC_STATE.get('keap_access_token');
  if (cachedToken) {
    const tokenData = JSON.parse(cachedToken);
    if (tokenData.expires_at > Date.now()) {
      return tokenData.access_token;
    }
  }
  
  const tokenResponse = await fetch('https://api.infusionsoft.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.KEAP_CLIENT_ID,
      client_secret: env.KEAP_SECRET,
      scope: 'full'
    })
  });
  
  if (!tokenResponse.ok) {
    throw new Error(`Token request failed: ${tokenResponse.status}`);
  }
  
  const tokenData = await tokenResponse.json();
  const cacheData = {
    access_token: tokenData.access_token,
    expires_at: Date.now() + (tokenData.expires_in * 1000) - 60000
  };
  
  await env.SYNC_STATE.put('keap_access_token', JSON.stringify(cacheData));
  return tokenData.access_token;
}

async function fetchKeapOrders(accessToken: string, offset = 0, limit = 200): Promise<KeapOrder[]> {
  const url = `https://api.infusionsoft.com/crm/rest/v1/orders?limit=${limit}&offset=${offset}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Keap-API-Version': '1.0'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Keap API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.orders || [];
}

async function fetchKeapOrdersModifiedSince(accessToken: string, sinceDate: string): Promise<KeapOrder[]> {
  const formattedDate = new Date(sinceDate).toISOString().split('T')[0];
  const url = `https://api.infusionsoft.com/crm/rest/v1/orders?since=${formattedDate}&limit=1000`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Keap-API-Version': '1.0'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Keap API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.orders || [];
}

async function initializeDatabase(env: Env): Promise<void> {
  try {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        keap_id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        total REAL NOT NULL DEFAULT 0.0,
        creation_date TEXT NOT NULL,
        modification_date TEXT NOT NULL,
        order_items TEXT,
        shipping_address TEXT,
        billing_address TEXT,
        payment_status TEXT DEFAULT 'pending',
        tracking_number TEXT,
        promo_codes TEXT,
        lead_affiliate_id INTEGER,
        raw_data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        keap_order_item_id INTEGER,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        price REAL NOT NULL DEFAULT 0.0,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders (keap_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_orders_creation_date ON orders(creation_date);
      CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    `);
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

async function batchInsertOrders(env: Env, orders: KeapOrder[]): Promise<void> {
  const statements = [];
  
  for (const order of orders) {
    const transformedOrder = transformOrder(order);
    
    statements.push(
      env.DB.prepare(`
        INSERT OR REPLACE INTO orders (
          keap_id, customer_id, status, total, creation_date, 
          modification_date, order_items, shipping_address, billing_address,
          payment_status, tracking_number, promo_codes, lead_affiliate_id, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        transformedOrder.keap_id,
        transformedOrder.customer_id,
        transformedOrder.status,
        transformedOrder.total,
        transformedOrder.creation_date,
        transformedOrder.modification_date,
        JSON.stringify(transformedOrder.order_items),
        JSON.stringify(transformedOrder.shipping_address),
        JSON.stringify(transformedOrder.billing_address),
        transformedOrder.payment_status,
        transformedOrder.tracking_number,
        JSON.stringify(transformedOrder.promo_codes || []),
        transformedOrder.lead_affiliate_id,
        JSON.stringify(transformedOrder.raw_data)
      )
    );
    
    for (const item of transformedOrder.order_items || []) {
      statements.push(
        env.DB.prepare(`
          INSERT OR REPLACE INTO order_items 
          (keap_order_item_id, order_id, product_id, product_name, quantity, price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          transformedOrder.keap_id,
          item.product_id,
          item.product_name,
          item.quantity,
          item.price,
          item.notes || null
        )
      );
    }
  }
  
  const batchSize = 20;
  for (let i = 0; i < statements.length; i += batchSize) {
    const batch = statements.slice(i, i + batchSize);
    await env.DB.batch(batch);
  }
}

function transformOrder(keapOrder: KeapOrder): any {
  return {
    keap_id: keapOrder.id,
    customer_id: keapOrder.contact_id,
    status: keapOrder.status || 'pending',
    total: parseFloat(String(keapOrder.total)) || 0,
    creation_date: keapOrder.creation_date,
    modification_date: keapOrder.modification_date,
    order_items: keapOrder.order_items || [],
    shipping_address: keapOrder.shipping_address || {},
    billing_address: keapOrder.billing_address || {},
    payment_status: keapOrder.payment_status || 'pending',
    tracking_number: keapOrder.tracking_number || null,
    promo_codes: keapOrder.promo_codes || [],
    lead_affiliate_id: keapOrder.lead_affiliate_id || null,
    raw_data: keapOrder
  };
}

async function getOrders(request: Request, env: Env): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 1000);
  const status = searchParams.get('status');
  const offset = (page - 1) * limit;
  
  let query = 'SELECT * FROM orders';
  let countQuery = 'SELECT COUNT(*) as total FROM orders';
  const params: any[] = [];
  
  if (status) {
    query += ' WHERE status = ?';
    countQuery += ' WHERE status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY creation_date DESC LIMIT ? OFFSET ?';
  
  const [ordersResult, countResult] = await Promise.all([
    env.DB.prepare(query).bind(...params, limit, offset).all(),
    env.DB.prepare(countQuery).bind(...params).first()
  ]);
  
  return new Response(JSON.stringify({
    orders: ordersResult.results,
    pagination: {
      page,
      limit,
      total: countResult?.total || 0,
      pages: Math.ceil((countResult?.total || 0) / limit)
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getDashboardData(request: Request, env: Env): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30');
  const metric = searchParams.get('metric');
  
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  
  try {
    if (metric) {
      return await getSpecificMetric(env, metric, startDate);
    }
    
    const [totalRevenue, orderCount, avgOrderValue, statusBreakdown, dailySales, topProducts] = await Promise.all([
      env.DB.prepare('SELECT SUM(total) as revenue FROM orders WHERE creation_date >= ?').bind(startDate).first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM orders WHERE creation_date >= ?').bind(startDate).first(),
      env.DB.prepare('SELECT AVG(total) as avg_value FROM orders WHERE creation_date >= ?').bind(startDate).first(),
      env.DB.prepare(`
        SELECT status, COUNT(*) as count, SUM(total) as revenue 
        FROM orders 
        WHERE creation_date >= ? 
        GROUP BY status
      `).bind(startDate).all(),
      env.DB.prepare(`
        SELECT 
          DATE(creation_date) as date,
          COUNT(*) as orders,
          SUM(total) as revenue
        FROM orders 
        WHERE creation_date >= ? 
        GROUP BY DATE(creation_date)
        ORDER BY date
      `).bind(startDate).all(),
      env.DB.prepare(`
        SELECT 
          oi.product_name,
          COUNT(*) as order_count,
          SUM(oi.quantity * oi.price) as revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.keap_id
        WHERE o.creation_date >= ?
        GROUP BY oi.product_name
        ORDER BY revenue DESC
        LIMIT 10
      `).bind(startDate).all()
    ]);
    
    return new Response(JSON.stringify({
      metrics: {
        total_revenue: totalRevenue?.revenue || 0,
        order_count: orderCount?.count || 0,
        avg_order_value: avgOrderValue?.avg_value || 0
      },
      status_breakdown: statusBreakdown.results,
      daily_sales: dailySales.results,
      top_products: topProducts.results,
      period_days: days,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Dashboard data error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch dashboard data',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function getSpecificMetric(env: Env, metric: string, startDate: string): Promise<Response> {
  let result;
  
  switch (metric) {
    case 'weekly_sales':
      result = await env.DB.prepare(`
        SELECT 
          DATE(creation_date) as date,
          COUNT(*) as order_count,
          SUM(total) as total_revenue
        FROM orders 
        WHERE creation_date >= ?
        GROUP BY DATE(creation_date)
        ORDER BY date DESC
      `).bind(startDate).all();
      break;
      
    case 'top_products':
      result = await env.DB.prepare(`
        SELECT 
          oi.product_name,
          COUNT(*) as order_count,
          SUM(oi.quantity * oi.price) as revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.keap_id
        WHERE o.creation_date >= ?
        GROUP BY oi.product_name
        ORDER BY revenue DESC
        LIMIT 10
      `).bind(startDate).all();
      break;
      
    default:
      return new Response(JSON.stringify({ error: 'Invalid metric' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
  }
  
  return new Response(JSON.stringify({ results: result.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getSyncStatus(env: Env): Promise<Response> {
  const lastSync = await env.SYNC_STATE.get('last_order_sync');
  const totalOrders = await env.DB.prepare('SELECT COUNT(*) as count FROM orders').first();
  
  return new Response(JSON.stringify({
    last_sync: lastSync,
    total_orders: totalOrders?.count || 0,
    status: 'healthy',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateMainDashboard(): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Nutrition Solutions BI - Modern Architecture</title>
    <style>
        body { font-family: system-ui; margin: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px; margin-bottom: 30px; backdrop-filter: blur(10px); }
        .endpoints { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .endpoint { background: rgba(255,255,255,0.15); padding: 25px; border-radius: 15px; backdrop-filter: blur(10px); }
        .endpoint h3 { margin-bottom: 15px; }
        .endpoint p { margin-bottom: 15px; opacity: 0.9; }
        .btn { background: rgba(255,255,255,0.2); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; border: 1px solid rgba(255,255,255,0.3); }
        .btn:hover { background: rgba(255,255,255,0.3); }
        .status { padding: 10px; background: rgba(76,175,80,0.3); border: 1px solid rgba(76,175,80,0.5); border-radius: 5px; margin-top: 10px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Nutrition Solutions BI</h1>
            <p><strong>Modern D1 Architecture</strong> - Lightning fast, cost-effective, AI-ready</p>
            <p>✅ Schema Migration Complete | ✅ D1 Optimized | ✅ Ready for Dashboard</p>
        </div>
        
        <div class="endpoints">
            <div class="endpoint">
                <h3>🔄 Full Sync</h3>
                <p>Import all orders from Keap to D1 database</p>
                <a href="/sync-orders?full_sync=true" class="btn">Start Full Sync</a>
                <div class="status">🎯 Run this first to populate your data</div>
            </div>
            
            <div class="endpoint">
                <h3>📊 Dashboard Data</h3>
                <p>Get analytics data for your BI dashboard</p>
                <a href="/dashboard-data" class="btn">View Data</a>
                <div class="status">💡 JSON API ready for Next.js dashboard</div>
            </div>
            
            <div class="endpoint">
                <h3>📋 Orders API</h3>
                <p>Browse paginated orders with filtering</p>
                <a href="/orders" class="btn">View Orders</a>
                <div class="status">⚡ Lightning fast D1 queries</div>
            </div>
            
            <div class="endpoint">
                <h3>📈 Sync Status</h3>
                <p>Check synchronization status and metrics</p>
                <a href="/sync-status" class="btn">Check Status</a>
                <div class="status">✅ Monitor your data pipeline</div>
            </div>
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 25px; border-radius: 15px; margin-top: 30px; backdrop-filter: blur(10px);">
            <h3>🎯 Next Steps</h3>
            <ol style="opacity: 0.9;">
                <li><strong>Sync Your Data:</strong> Click "Start Full Sync" to import orders</li>
                <li><strong>Test Dashboard API:</strong> Click "View Data" to see JSON response</li>
                <li><strong>Deploy Next.js Dashboard:</strong> Use the dashboard data endpoint</li>
                <li><strong>Save $3,400/month:</strong> Replace Grow.com with your own BI</li>
            </ol>
        </div>
    </div>
</body>
</html>
  `;
}
