// Nutrition Solutions BI - Adaptive Schema Version
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response;
      
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
            version: 'adaptive-schema'
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
  }
};

// Schema detection helper
async function detectSchema(db) {
  const schemaCheck = await db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'
  `).first();
  
  if (!schemaCheck) {
    return {
      exists: false
    };
  }
  
  const sql = schemaCheck.sql.toLowerCase();
  
  return {
    exists: true,
    hasCreationDate: sql.includes('creation_date'),
    hasKeapId: sql.includes('keap_id') && !sql.includes('keap_order_id'),
    hasTotal: sql.includes(' total ') && !sql.includes('total_amount'),
    dateField: sql.includes('creation_date') ? 'creation_date' : 'order_date',
    idField: sql.includes('keap_id') && !sql.includes('keap_order_id') ? 'keap_id' : 'keap_order_id',
    totalField: sql.includes(' total ') && !sql.includes('total_amount') ? 'total' : 'total_amount'
  };
}

// Flexible order sync handler
async function handleOrdersSync(request, env) {
  const db = env.DB || env.DB01;
  if (!db) {
    return new Response('No database binding found', { status: 500 });
  }
  
  // For now, return a message about the existing data
  const schema = await detectSchema(db);
  
  if (!schema.exists) {
    return new Response(JSON.stringify({
      error: 'No orders table found',
      message: 'Database needs to be initialized first'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const orderCount = await db.prepare('SELECT COUNT(*) as count FROM orders').first();
  
  return new Response(JSON.stringify({
    success: true,
    message: 'Orders table already exists with data',
    current_orders: orderCount?.count || 0,
    schema_info: schema
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Adaptive orders endpoint
async function getOrders(request, env) {
  const db = env.DB || env.DB01;
  if (!db) {
    throw new Error('No database binding found');
  }
  
  const schema = await detectSchema(db);
  if (!schema.exists) {
    return new Response(JSON.stringify({
      error: 'No orders table found'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 1000);
  const status = searchParams.get('status');
  const offset = (page - 1) * limit;
  
  let query = 'SELECT * FROM orders';
  let countQuery = 'SELECT COUNT(*) as total FROM orders';
  const params = [];

  if (status) {
    query += ' WHERE status = ?';
    countQuery += ' WHERE status = ?';
    params.push(status);
  }

  query += ` ORDER BY ${schema.dateField} DESC LIMIT ? OFFSET ?`;

  const [ordersResult, countResult] = await Promise.all([
    db.prepare(query).bind(...params, limit, offset).all(),
    db.prepare(countQuery).bind(...params).first()
  ]);

  return new Response(JSON.stringify({
    orders: ordersResult.results,
    pagination: {
      page,
      limit,
      total: countResult?.total || 0,
      pages: Math.ceil((countResult?.total || 0) / limit)
    },
    schema_info: schema
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Adaptive dashboard data
async function getDashboardData(request, env) {
  const db = env.DB || env.DB01;
  if (!db) {
    throw new Error('No database binding found');
  }
  
  const schema = await detectSchema(db);
  if (!schema.exists) {
    return new Response(JSON.stringify({
      error: 'No orders table found'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30');
  const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

  try {
    const [
      totalRevenue,
      orderCount, 
      avgOrderValue,
      statusBreakdown,
      dailySales
    ] = await Promise.all([
      db.prepare(`SELECT SUM(${schema.totalField}) as revenue FROM orders WHERE ${schema.dateField} >= ?`).bind(startDate).first(),
      db.prepare(`SELECT COUNT(*) as count FROM orders WHERE ${schema.dateField} >= ?`).bind(startDate).first(),
      db.prepare(`SELECT AVG(${schema.totalField}) as avg_value FROM orders WHERE ${schema.dateField} >= ?`).bind(startDate).first(),
      db.prepare(`
        SELECT status, COUNT(*) as count, SUM(${schema.totalField}) as revenue 
        FROM orders 
        WHERE ${schema.dateField} >= ? 
        GROUP BY status
      `).bind(startDate).all(),
      db.prepare(`
        SELECT 
          DATE(${schema.dateField}) as date,
          COUNT(*) as orders,
          SUM(${schema.totalField}) as revenue
        FROM orders 
        WHERE ${schema.dateField} >= ? 
        GROUP BY DATE(${schema.dateField})
        ORDER BY date
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
      period_days: days,
      timestamp: new Date().toISOString(),
      schema_info: schema
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Dashboard data error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch dashboard data',
      message: error instanceof Error ? error.message : 'Unknown error',
      schema_info: schema
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Sync status
async function getSyncStatus(env) {
  const db = env.DB || env.DB01;
  if (!db) {
    throw new Error('No database binding found');
  }
  
  const schema = await detectSchema(db);
  const lastSync = await env.SYNC_STATE.get('last_order_sync');
  const totalOrders = await db.prepare('SELECT COUNT(*) as count FROM orders').first();
  
  return new Response(JSON.stringify({
    last_sync: lastSync,
    total_orders: totalOrders?.count || 0,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    schema_info: schema
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function generateMainDashboard() {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Nutrition Solutions BI - Adaptive Schema</title>
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
            <p><strong>Adaptive Schema Version</strong> - Works with any database schema!</p>
            <div class="status">✅ Automatically detects and adapts to your database structure</div>
        </div>
        
        <div class="endpoints">
            <div class="endpoint">
                <h3>📊 Dashboard Data</h3>
                <p>Analytics API that adapts to your schema</p>
                <a href="/dashboard-data" class="btn">View Data</a>
            </div>
            
            <div class="endpoint">
                <h3>📋 Orders API</h3>
                <p>Browse orders with automatic field mapping</p>
                <a href="/orders" class="btn">View Orders</a>
            </div>
            
            <div class="endpoint">
                <h3>📈 Sync Status</h3>
                <p>Check database status and schema info</p>
                <a href="/sync-status" class="btn">Check Status</a>
            </div>
            
            <div class="endpoint">
                <h3>🔧 Health Check</h3>
                <p>Service health status</p>
                <a href="/health" class="btn">Check Health</a>
            </div>
        </div>
    </div>
</body>
</html>
  `;
}