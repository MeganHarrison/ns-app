// Nutrition Solutions BI - Fixed Production Version
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
      return new Response(JSON.stringify({
        error: 'No database binding found'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      let response;
      
      switch (url.pathname) {
        case '/':
          response = new Response(generateMainDashboard(), {
            headers: { 'Content-Type': 'text/html' }
          });
          break;
          
        case '/dashboard':
          response = new Response(generateVisualDashboard(), {
            headers: { 'Content-Type': 'text/html' }
          });
          break;
          
        case '/orders':
          response = await getOrders(request, db);
          break;
          
        case '/dashboard-data':
          response = await getDashboardData(request, db);
          break;
          
        case '/sync-status':
          response = await getSyncStatus(env, db);
          break;
          
        case '/health':
          response = new Response(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: 'production-fixed'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
          break;
          
        case '/test-keap':
          response = await testKeapAPI(env);
          break;
          
        case '/sync-recent-orders':
          response = await syncRecentOrders(env, db);
          break;
          
        default:
          response = new Response(JSON.stringify({
            error: 'Not Found',
            availableEndpoints: [
              '/',
              '/dashboard',
              '/orders',
              '/dashboard-data',
              '/sync-status',
              '/health'
            ]
          }), { 
            status: 404,
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
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// Get orders with pagination
async function getOrders(request, db) {
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

  query += ' ORDER BY order_date DESC LIMIT ? OFFSET ?';

  const [ordersResult, countResult] = await Promise.all([
    db.prepare(query).bind(...params, limit, offset).all(),
    db.prepare(countQuery).bind(...params).first()
  ]);

  // Convert amounts from cents to dollars for display
  const ordersWithFormattedAmounts = ordersResult.results.map(order => ({
    ...order,
    total_amount_cents: order.total_amount,
    total_amount: order.total_amount / 100 // Convert to dollars
  }));

  return new Response(JSON.stringify({
    orders: ordersWithFormattedAmounts,
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

// Get dashboard analytics data
async function getDashboardData(request, db) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || 'all');
  
  try {
    let dateFilter = '';
    let dateParam = null;
    
    // Only apply date filter if days is specified and not 'all'
    if (days && days !== 'all' && !isNaN(days)) {
      const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
      dateFilter = ' AND order_date >= ?';
      dateParam = startDate;
    }

    // Get overall metrics
    const metricsQuery = `
      SELECT 
        COUNT(*) as order_count,
        SUM(CAST(total_amount AS REAL)) / 100 as total_revenue,
        AVG(CAST(total_amount AS REAL)) / 100 as avg_order_value
      FROM orders
      WHERE status = 'PAID'${dateFilter}
    `;
    
    const metrics = dateParam 
      ? await db.prepare(metricsQuery).bind(dateParam).first()
      : await db.prepare(metricsQuery).first();

    // Get status breakdown
    const statusQuery = `
      SELECT 
        status, 
        COUNT(*) as count, 
        SUM(CAST(total_amount AS REAL)) / 100 as revenue 
      FROM orders 
      WHERE 1=1${dateFilter}
      GROUP BY status
    `;
    
    const statusBreakdown = dateParam
      ? await db.prepare(statusQuery).bind(dateParam).all()
      : await db.prepare(statusQuery).all();

    // Get daily sales (last 30 days of available data)
    const dailySales = await db.prepare(`
      SELECT 
        DATE(order_date) as date,
        COUNT(*) as orders,
        SUM(CAST(total_amount AS REAL)) / 100 as revenue
      FROM orders
      WHERE status = 'PAID'
      GROUP BY DATE(order_date)
      ORDER BY date DESC
      LIMIT 30
    `).all();

    // Get recent orders
    const recentOrders = await db.prepare(`
      SELECT 
        keap_order_id,
        order_date,
        CAST(total_amount AS REAL) / 100 as total_amount,
        status
      FROM orders
      ORDER BY order_date DESC
      LIMIT 10
    `).all();

    // Get date range info
    const dateRange = await db.prepare(`
      SELECT 
        MIN(order_date) as earliest_date,
        MAX(order_date) as latest_date
      FROM orders
    `).first();

    return new Response(JSON.stringify({
      metrics: {
        total_revenue: metrics?.total_revenue || 0,
        order_count: metrics?.order_count || 0,
        avg_order_value: metrics?.avg_order_value || 0
      },
      status_breakdown: statusBreakdown.results,
      daily_sales: dailySales.results.reverse(), // Show oldest to newest
      recent_orders: recentOrders.results,
      date_range: dateRange,
      period: days === 'all' ? 'all_time' : `last_${days}_days`,
      timestamp: new Date().toISOString()
    }, null, 2), {
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

// Get sync status
async function getSyncStatus(env, db) {
  const lastSync = await env.SYNC_STATE.get('last_order_sync');
  const totalOrders = await db.prepare('SELECT COUNT(*) as count FROM orders').first();
  const dateRange = await db.prepare(`
    SELECT 
      MIN(order_date) as earliest_date,
      MAX(order_date) as latest_date
    FROM orders
  `).first();
  
  return new Response(JSON.stringify({
    last_sync: lastSync,
    total_orders: totalOrders?.count || 0,
    date_range: dateRange,
    status: 'healthy',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function generateMainDashboard() {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Nutrition Solutions BI Dashboard</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            margin: 0; 
            padding: 0;
            background: #f5f7fa;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 2rem;
        }
        .endpoints { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 1.5rem;
            margin-top: 2rem;
        }
        .endpoint { 
            background: white;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .endpoint:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .endpoint h3 { 
            margin: 0 0 1rem 0;
            color: #333;
        }
        .endpoint p { 
            color: #666;
            margin-bottom: 1.5rem;
            line-height: 1.6;
        }
        .btn { 
            background: #667eea;
            color: white;
            padding: 0.75rem 1.5rem;
            text-decoration: none;
            border-radius: 6px;
            display: inline-block;
            transition: background 0.2s;
        }
        .btn:hover { 
            background: #5a67d8;
        }
        .status { 
            display: inline-block;
            padding: 0.25rem 0.75rem;
            background: #48bb78;
            color: white;
            border-radius: 20px;
            font-size: 0.875rem;
            margin-top: 1rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="container">
            <h1>🚀 Nutrition Solutions BI Dashboard</h1>
            <p style="margin: 0; opacity: 0.9;">Real-time analytics and insights for your meal delivery business</p>
        </div>
    </div>
    
    <div class="container">
        <div class="endpoints">
            <div class="endpoint">
                <h3>📊 Visual Dashboard</h3>
                <p>Interactive dashboard with charts, graphs, and real-time metrics.</p>
                <a href="/dashboard" class="btn">Open Dashboard</a>
                <div class="status">Live Analytics</div>
            </div>
            
            <div class="endpoint">
                <h3>📊 Dashboard API</h3>
                <p>Raw analytics data for integration with other tools.</p>
                <a href="/dashboard-data" class="btn">View API Data</a>
                <div class="status">JSON API</div>
            </div>
            
            <div class="endpoint">
                <h3>📋 Order Management</h3>
                <p>Browse and filter through all orders with pagination support.</p>
                <a href="/orders" class="btn">View Orders</a>
            </div>
            
            <div class="endpoint">
                <h3>📈 System Status</h3>
                <p>Check database health and synchronization status.</p>
                <a href="/sync-status" class="btn">Check Status</a>
            </div>
        </div>
        
        <div style="margin-top: 3rem; padding: 2rem; background: #f8f9fa; border-radius: 10px;">
            <h3 style="margin-top: 0;">API Endpoints</h3>
            <ul style="color: #666; line-height: 2;">
                <li><code>GET /dashboard-data</code> - Analytics data (optional: ?days=30)</li>
                <li><code>GET /orders</code> - Paginated orders (optional: ?page=1&limit=50&status=PAID)</li>
                <li><code>GET /sync-status</code> - Database and sync status</li>
                <li><code>GET /health</code> - Service health check</li>
            </ul>
        </div>
    </div>
</body>
</html>
  `;
}

function generateVisualDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nutrition Solutions Analytics Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f7fa;
            color: #333;
            line-height: 1.6;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.5rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .header h1 {
            font-size: 1.75rem;
            font-weight: 600;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .metric-card {
            background: white;
            padding: 1.5rem;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .metric-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }

        .metric-label {
            color: #666;
            font-size: 0.875rem;
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .metric-value {
            font-size: 2rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 0.5rem;
        }

        .metric-change {
            font-size: 0.875rem;
            font-weight: 500;
        }

        .metric-change.positive {
            color: #48bb78;
        }

        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .chart-card {
            background: white;
            padding: 1.5rem;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }

        .chart-card h3 {
            margin-bottom: 1rem;
            color: #333;
            font-size: 1.25rem;
        }

        .chart-container {
            position: relative;
            height: 300px;
        }

        .table-card {
            background: white;
            padding: 1.5rem;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }

        .table-card h3 {
            margin-bottom: 1rem;
            color: #333;
            font-size: 1.25rem;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th, td {
            text-align: left;
            padding: 0.75rem;
            border-bottom: 1px solid #e2e8f0;
        }

        th {
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.5px;
        }

        tr:hover {
            background: #f8f9fa;
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 200px;
            color: #666;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
            .charts-grid {
                grid-template-columns: 1fr;
            }
            
            .header-content {
                flex-direction: column;
                gap: 1rem;
            }
        }

        .status-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 500;
            text-transform: uppercase;
        }

        .status-badge.paid {
            background: #d4f4dd;
            color: #22543d;
        }

        .status-badge.pending {
            background: #fef3c7;
            color: #92400e;
        }

        .status-badge.failed {
            background: #fed7d7;
            color: #742a2a;
        }

        .date-range-selector {
            display: flex;
            gap: 0.5rem;
        }

        .date-range-btn {
            padding: 0.5rem 1rem;
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
            font: inherit;
        }

        .date-range-btn:hover,
        .date-range-btn.active {
            background: rgba(255,255,255,0.3);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div>
                <h1>Nutrition Solutions Analytics</h1>
                <p style="opacity: 0.9; margin-top: 0.25rem;">Real-time business insights</p>
            </div>
            <div class="date-range-selector">
                <button class="date-range-btn active" onclick="loadDashboard('all')">All Time</button>
                <button class="date-range-btn" onclick="loadDashboard(30)">30 Days</button>
                <button class="date-range-btn" onclick="loadDashboard(7)">7 Days</button>
            </div>
        </div>
    </div>

    <div class="container">
        <div class="metrics-grid" id="metrics">
            <div class="loading"><div class="spinner"></div></div>
        </div>

        <div class="charts-grid">
            <div class="chart-card">
                <h3>Daily Revenue Trend</h3>
                <div class="chart-container">
                    <canvas id="revenueChart"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <h3>Order Status Breakdown</h3>
                <div class="chart-container">
                    <canvas id="statusChart"></canvas>
                </div>
            </div>
        </div>

        <div class="table-card">
            <h3>Recent Orders</h3>
            <div id="ordersTable">
                <div class="loading"><div class="spinner"></div></div>
            </div>
        </div>
    </div>

    <script>
        let revenueChart, statusChart;
        
        function formatCurrency(amount) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
            }).format(amount);
        }

        function formatDate(dateString) {
            return new Date(dateString).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }

        async function loadDashboard(days = 'all') {
            try {
                document.querySelectorAll('.date-range-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                if (event && event.target) {
                    event.target.classList.add('active');
                }

                const response = await fetch(\`/dashboard-data?days=\${days}\`);
                const data = await response.json();

                updateMetrics(data.metrics);
                updateRevenueChart(data.daily_sales);
                updateStatusChart(data.status_breakdown);
                updateOrdersTable(data.recent_orders);

            } catch (error) {
                console.error('Error loading dashboard:', error);
            }
        }

        function updateMetrics(metrics) {
            const metricsHtml = \`
                <div class="metric-card">
                    <div class="metric-label">Total Revenue</div>
                    <div class="metric-value">\${formatCurrency(metrics.total_revenue)}</div>
                    <div class="metric-change positive">All time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Total Orders</div>
                    <div class="metric-value">\${metrics.order_count.toLocaleString()}</div>
                    <div class="metric-change positive">All time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Average Order Value</div>
                    <div class="metric-value">\${formatCurrency(metrics.avg_order_value)}</div>
                    <div class="metric-change positive">Per order</div>
                </div>
            \`;
            document.getElementById('metrics').innerHTML = metricsHtml;
        }

        function updateRevenueChart(dailySales) {
            const ctx = document.getElementById('revenueChart').getContext('2d');
            
            if (revenueChart) {
                revenueChart.destroy();
            }

            const recentData = dailySales.slice(-30);

            revenueChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: recentData.map(d => formatDate(d.date)),
                    datasets: [{
                        label: 'Daily Revenue',
                        data: recentData.map(d => d.revenue),
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return formatCurrency(context.parsed.y);
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return formatCurrency(value);
                                }
                            }
                        }
                    }
                }
            });
        }

        function updateStatusChart(statusBreakdown) {
            const ctx = document.getElementById('statusChart').getContext('2d');
            
            if (statusChart) {
                statusChart.destroy();
            }

            statusChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: statusBreakdown.map(s => s.status),
                    datasets: [{
                        data: statusBreakdown.map(s => s.revenue),
                        backgroundColor: [
                            '#48bb78',
                            '#f6ad55',
                            '#fc8181',
                            '#90cdf4',
                            '#b794f4'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = formatCurrency(context.parsed);
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((context.parsed / total) * 100).toFixed(1);
                                    return \`\${label}: \${value} (\${percentage}%)\`;
                                }
                            }
                        }
                    }
                }
            });
        }

        function updateOrdersTable(orders) {
            const tableHtml = \`
                <table>
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${orders.map(order => \`
                            <tr>
                                <td>#\${order.keap_order_id}</td>
                                <td>\${formatDate(order.order_date)}</td>
                                <td>\${formatCurrency(order.total_amount)}</td>
                                <td><span class="status-badge \${order.status.toLowerCase()}">\${order.status}</span></td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;
            document.getElementById('ordersTable').innerHTML = tableHtml;
        }

        loadDashboard('all');
    </script>
</body>
</html>`;
}

// Test Keap API credentials
async function testKeapAPI(env) {
  const results = {
    timestamp: new Date().toISOString(),
    credentials: {
      hasServiceAccountKey: !!env.KEAP_SERVICE_ACCOUNT_KEY,
      hasClientId: !!env.KEAP_CLIENT_ID,
      hasClientSecret: !!env.KEAP_SECRET,
      serviceAccountKeyLength: env.KEAP_SERVICE_ACCOUNT_KEY?.length || 0
    },
    tests: []
  };

  // Test with Service Account Key
  if (env.KEAP_SERVICE_ACCOUNT_KEY) {
    try {
      // Test 1: Account Profile
      const profileResponse = await fetch('https://api.infusionsoft.com/crm/rest/v1/account/profile', {
        headers: {
          'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
          'Accept': 'application/json'
        }
      });

      results.tests.push({
        test: 'Account Profile',
        status: profileResponse.status,
        success: profileResponse.ok,
        data: profileResponse.ok ? await profileResponse.json() : await profileResponse.text()
      });

      // Test 2: Get Orders
      const ordersResponse = await fetch('https://api.infusionsoft.com/crm/rest/v1/orders?limit=5&order=order_date&order_direction=descending', {
        headers: {
          'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
          'Accept': 'application/json'
        }
      });

      const ordersData = ordersResponse.ok ? await ordersResponse.json() : null;
      
      results.tests.push({
        test: 'Recent Orders',
        status: ordersResponse.status,
        success: ordersResponse.ok,
        orderCount: ordersData?.orders?.length || 0,
        latestOrder: ordersData?.orders?.[0] ? {
          id: ordersData.orders[0].id,
          date: ordersData.orders[0].order_date,
          total: ordersData.orders[0].total
        } : null,
        error: !ordersResponse.ok ? await ordersResponse.text() : null
      });

      // Test 3: Get Contacts
      const contactsResponse = await fetch('https://api.infusionsoft.com/crm/rest/v1/contacts?limit=1', {
        headers: {
          'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
          'Accept': 'application/json'
        }
      });

      results.tests.push({
        test: 'Contacts',
        status: contactsResponse.status,
        success: contactsResponse.ok,
        data: contactsResponse.ok ? 'Can access contacts' : await contactsResponse.text()
      });

    } catch (error) {
      results.tests.push({
        test: 'Service Account Key',
        error: error.message
      });
    }
  } else {
    results.tests.push({
      test: 'Service Account Key',
      error: 'No service account key provided'
    });
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Sync recent orders from Keap
async function syncRecentOrders(env, db) {
  if (!env.KEAP_SERVICE_ACCOUNT_KEY) {
    return new Response(JSON.stringify({
      error: 'No Keap service account key configured'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get recent orders from Keap (last 30 days)
    // Keap expects ISO 8601 format with timezone
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ordersResponse = await fetch(
      `https://api.infusionsoft.com/crm/rest/v1/orders?since=${since}&limit=1000&order=order_date&order_direction=descending`,
      {
        headers: {
          'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!ordersResponse.ok) {
      throw new Error(`Keap API error: ${ordersResponse.status} ${await ordersResponse.text()}`);
    }

    const data = await ordersResponse.json();
    const orders = data.orders || [];
    
    // Sync each order to database
    let synced = 0;
    let failed = 0;
    const errors = [];

    for (const order of orders) {
      try {
        // Get contact info if available
        let contactEmail = null;
        if (order.contact?.id) {
          try {
            const contactResponse = await fetch(
              `https://api.infusionsoft.com/crm/rest/v1/contacts/${order.contact.id}`,
              {
                headers: {
                  'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
                  'Accept': 'application/json'
                }
              }
            );
            if (contactResponse.ok) {
              const contact = await contactResponse.json();
              contactEmail = contact.email_addresses?.[0]?.email || null;
            }
          } catch (e) {
            console.error('Error fetching contact:', e);
          }
        }

        // Insert or update order
        await db.prepare(`
          INSERT OR REPLACE INTO orders (
            keap_order_id,
            order_date,
            total_amount,
            status,
            products,
            company_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          order.id.toString(),
          order.order_date || order.creation_date,
          Math.round((order.total || 0) * 100), // Convert to cents
          order.status || 'UNKNOWN',
          JSON.stringify(order.order_items || []),
          'default-company'
        ).run();

        synced++;
      } catch (error) {
        failed++;
        errors.push({
          orderId: order.id,
          error: error.message
        });
      }
    }

    // Update last sync time
    await env.SYNC_STATE.put('last_order_sync', new Date().toISOString());

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${synced} orders from Keap`,
      stats: {
        total_from_keap: orders.length,
        synced: synced,
        failed: failed,
        since: since,
        latest_order: orders[0] ? {
          id: orders[0].id,
          date: orders[0].order_date,
          total: orders[0].total
        } : null
      },
      errors: errors.length > 0 ? errors : undefined
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({
      error: 'Sync failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}