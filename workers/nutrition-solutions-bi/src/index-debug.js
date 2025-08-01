// Nutrition Solutions BI - Debug Version
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

    const db = env.DB || env.DB01;
    if (!db) {
      return new Response('No database binding found', { status: 500 });
    }

    try {
      let response;
      
      switch (url.pathname) {
        case '/debug':
          response = await debugDatabase(db);
          break;
          
        case '/dashboard-data':
          response = await getDashboardData(request, db);
          break;
          
        default:
          response = new Response(JSON.stringify({
            endpoints: ['/debug', '/dashboard-data']
          }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
      }

      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error.stack
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

async function debugDatabase(db) {
  // Get sample orders to understand date format
  const sampleOrders = await db.prepare(`
    SELECT keap_order_id, order_date, total_amount, status 
    FROM orders 
    ORDER BY order_date DESC 
    LIMIT 5
  `).all();

  // Get date range
  const dateRange = await db.prepare(`
    SELECT 
      MIN(order_date) as earliest_date,
      MAX(order_date) as latest_date,
      COUNT(*) as total_orders
    FROM orders
  `).first();

  // Test different date formats
  const now = new Date();
  const testQueries = [
    {
      name: 'ISO format with time',
      date: now.toISOString(),
      query: await db.prepare(`
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE order_date >= ?
      `).bind(now.toISOString()).first()
    },
    {
      name: 'ISO date only',
      date: now.toISOString().split('T')[0],
      query: await db.prepare(`
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE order_date >= ?
      `).bind(now.toISOString().split('T')[0]).first()
    },
    {
      name: 'Unix timestamp',
      date: now.getTime(),
      query: await db.prepare(`
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE order_date >= ?
      `).bind(now.getTime()).first()
    },
    {
      name: 'String comparison - 30 days',
      date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      query: await db.prepare(`
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE order_date >= ?
      `).bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).first()
    },
    {
      name: 'All time - no filter',
      date: 'none',
      query: await db.prepare(`
        SELECT COUNT(*) as count 
        FROM orders
      `).first()
    }
  ];

  // Get totals by different methods
  const totalMethods = await Promise.all([
    db.prepare(`SELECT SUM(total_amount) as sum_total FROM orders`).first(),
    db.prepare(`SELECT SUM(CAST(total_amount AS REAL)) as sum_cast FROM orders`).first(),
    db.prepare(`SELECT total_amount FROM orders LIMIT 5`).all()
  ]);

  return new Response(JSON.stringify({
    sample_orders: sampleOrders.results,
    date_range: dateRange,
    date_format_tests: testQueries.map(t => ({
      name: t.name,
      test_date: t.date,
      count: t.query.count
    })),
    total_methods: {
      direct_sum: totalMethods[0],
      cast_sum: totalMethods[1],
      sample_values: totalMethods[2].results
    }
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getDashboardData(request, db) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30');
  
  try {
    // Get all orders (no date filter for now)
    const allOrdersData = await db.prepare(`
      SELECT 
        COUNT(*) as order_count,
        SUM(CAST(total_amount AS REAL)) as total_revenue,
        AVG(CAST(total_amount AS REAL)) as avg_order_value
      FROM orders
      WHERE status = 'PAID'
    `).first();

    // Get status breakdown
    const statusBreakdown = await db.prepare(`
      SELECT 
        status, 
        COUNT(*) as count, 
        SUM(CAST(total_amount AS REAL)) as revenue 
      FROM orders 
      GROUP BY status
    `).all();

    // Get recent orders
    const recentOrders = await db.prepare(`
      SELECT 
        keap_order_id,
        order_date,
        total_amount,
        status
      FROM orders
      ORDER BY order_date DESC
      LIMIT 10
    `).all();

    // Get daily sales (last 30 days worth of data)
    const dailySales = await db.prepare(`
      SELECT 
        DATE(order_date) as date,
        COUNT(*) as orders,
        SUM(CAST(total_amount AS REAL)) as revenue
      FROM orders
      WHERE status = 'PAID'
      GROUP BY DATE(order_date)
      ORDER BY date DESC
      LIMIT 30
    `).all();

    return new Response(JSON.stringify({
      metrics: {
        total_revenue: allOrdersData?.total_revenue || 0,
        order_count: allOrdersData?.order_count || 0,
        avg_order_value: allOrdersData?.avg_order_value || 0
      },
      status_breakdown: statusBreakdown.results,
      recent_orders: recentOrders.results,
      daily_sales: dailySales.results.reverse(), // Reverse to show oldest first
      period_days: days,
      timestamp: new Date().toISOString()
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
  });

  } catch (error) {
    console.error('Dashboard data error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch dashboard data',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}