// src/index.ts - Lightning Fast Keap Analytics Worker
export interface Env {
  ORDERS_DB: D1Database;
  KEAP_CLIENT_ID: string;
  KEAP_SECRET: string;
  KEAP_SERVICE_ACCOUNT_KEY: string;
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
  order_items: Array<{
    id: number;
    product_id: number;
    product_name: string;
    price: number;
    quantity: number;
  }>;
}

interface SyncMetadata {
  last_sync: string;
  total_orders: number;
  last_order_id: number;
}

class KeapApiClient {
  private baseUrl = 'https://api.infusionsoft.com/crm/rest/v1';
  
  constructor(private env: Env) {}
  
  private async getAccessToken(): Promise<string> {
    // Use service account key for server-to-server auth
    return this.env.KEAP_SERVICE_ACCOUNT_KEY;
  }
  
  async getOrdersSince(lastSync: string, limit = 100): Promise<KeapOrder[]> {
    const token = await this.getAccessToken();
    
    // Build efficient query - only fetch what we need
    const params = new URLSearchParams({
      limit: limit.toString(),
      order: 'id',
      since: lastSync,
      optional_properties: 'LeadAffiliateId,OrderItems'
    });
    
    const response = await fetch(`${this.baseUrl}/orders?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Keap API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.orders || [];
  }
  
  async getAllOrdersIncremental(batchSize = 200): Promise<KeapOrder[]> {
    const allOrders: KeapOrder[]= [];
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const token = await this.getAccessToken();
      const params = new URLSearchParams({
        limit: batchSize.toString(),
        offset: offset.toString(),
        order: 'id'
      });
      
      const response = await fetch(`${this.baseUrl}/orders?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      const orders = data.orders || [];
      
      allOrders.push(...orders);
      
      hasMore = orders.length === batchSize;
      offset += batchSize;
      
      // Respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return allOrders;
  }
}

class D1OrderManager {
  constructor(private db: D1Database) {}
  
  async initializeTables(): Promise<void> {
    // Optimized schema for fast analytics queries
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        order_date TEXT NOT NULL,
        order_total REAL NOT NULL,
        contact_id INTEGER NOT NULL,
        order_title TEXT,
        order_type TEXT,
        payment_status TEXT,
        lead_affiliate_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders (id)
      );
      
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Performance indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_orders_date ON orders (order_date);
      CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders (contact_id);
      CREATE INDEX IF NOT EXISTS idx_orders_total ON orders (order_total);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (payment_status);
      CREATE INDEX IF NOT EXISTS idx_items_product ON order_items (product_id);
    `);
  }
  
  async getLastSyncTimestamp(): Promise<string> {
    const result = await this.db.prepare(
      'SELECT value FROM sync_metadata WHERE key = ?'
    ).bind('last_sync').first();
    
    return result?.value || '2020-01-01T00:00:00Z';
  }
  
  async updateSyncTimestamp(timestamp: string): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).bind('last_sync', timestamp).run();
  }
  
  async batchInsertOrders(orders: KeapOrder[]): Promise<void> {
    if (orders.length === 0) return;
    
    // Use transaction for atomic batch insert
    const statements = orders.flatMap(order => {
      const orderStatement = this.db.prepare(`
        INSERT OR REPLACE INTO orders 
        (id, order_date, order_total, contact_id, order_title, order_type, payment_status, lead_affiliate_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        order.id,
        order.order_date,
        order.order_total,
        order.contact_id,
        order.order_title,
        order.order_type,
        order.payment_status,
        order.lead_affiliate_id
      );
      
      const itemStatements = order.order_items?.map(item => 
        this.db.prepare(`
          INSERT OR REPLACE INTO order_items 
          (id, order_id, product_id, product_name, price, quantity)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          item.id,
          order.id,
          item.product_id,
          item.product_name,
          item.price,
          item.quantity
        )
      ) || [];
      
      return [orderStatement, ...itemStatements];
    });
    
    await this.db.batch(statements);
  }
  
  async getOrdersAnalytics(filters: {
    startDate?: string;
    endDate?: string;
    contactId?: number;
    status?: string;
  } = {}): Promise<any> {
    let query = `
      SELECT 
        COUNT(*) as total_orders,
        SUM(order_total) as total_revenue,
        AVG(order_total) as avg_order_value,
        DATE(order_date) as order_day,
        payment_status,
        COUNT(DISTINCT contact_id) as unique_customers
      FROM orders 
      WHERE 1=1
    `;
    
    const params: any[] = [];
    
    if (filters.startDate) {
      query += ' AND order_date >= ?';
      params.push(filters.startDate);
    }
    
    if (filters.endDate) {
      query += ' AND order_date <= ?';
      params.push(filters.endDate);
    }
    
    if (filters.contactId) {
      query += ' AND contact_id = ?';
      params.push(filters.contactId);
    }
    
    if (filters.status) {
      query += ' AND payment_status = ?';
      params.push(filters.status);
    }
    
    query += ' GROUP BY DATE(order_date), payment_status ORDER BY order_date DESC';
    
    const stmt = this.db.prepare(query);
    return await stmt.bind(...params).all();
  }
  
  async getTopProducts(limit = 10): Promise<any> {
    return await this.db.prepare(`
      SELECT 
        oi.product_name,
        oi.product_id,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.payment_status = 'paid'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY total_revenue DESC
      LIMIT ?
    `).bind(limit).all();
  }
  
  async getRevenueByMonth(): Promise<any> {
    return await this.db.prepare(`
      SELECT 
        strftime('%Y-%m', order_date) as month,
        SUM(order_total) as revenue,
        COUNT(*) as orders,
        COUNT(DISTINCT contact_id) as customers
      FROM orders 
      WHERE payment_status = 'paid'
      GROUP BY strftime('%Y-%m', order_date)
      ORDER BY month DESC
      LIMIT 12
    `).all();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // CORS headers for frontend access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    const keapClient = new KeapApiClient(env);
    const orderManager = new D1OrderManager(env.ORDERS_DB);
    
    try {
      // Initialize database on first run
      if (pathname === '/init') {
        await orderManager.initializeTables();
        return new Response(JSON.stringify({ status: 'Database initialized' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Full historical sync (run once)
      if (pathname === '/sync/full') {
        console.log('Starting full historical sync...');
        
        const allOrders = await keapClient.getAllOrdersIncremental();
        await orderManager.batchInsertOrders(allOrders);
        await orderManager.updateSyncTimestamp(new Date().toISOString());
        
        return new Response(JSON.stringify({
          status: 'Full sync completed',
          orders_synced: allOrders.length
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Incremental sync (run regularly)
      if (pathname === '/sync/incremental') {
        const lastSync = await orderManager.getLastSyncTimestamp();
        const newOrders = await keapClient.getOrdersSince(lastSync);
        
        if (newOrders.length > 0) {
          await orderManager.batchInsertOrders(newOrders);
          await orderManager.updateSyncTimestamp(new Date().toISOString());
        }
        
        return new Response(JSON.stringify({
          status: 'Incremental sync completed',
          new_orders: newOrders.length,
          last_sync: lastSync
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Lightning-fast analytics endpoints
      if (pathname === '/analytics/overview') {
        const filters = {
          startDate: url.searchParams.get('start_date'),
          endDate: url.searchParams.get('end_date'),
          status: url.searchParams.get('status')
        };
        
        const analytics = await orderManager.getOrdersAnalytics(filters);
        
        return new Response(JSON.stringify(analytics), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      if (pathname === '/analytics/products') {
        const limit = parseInt(url.searchParams.get('limit') || '10');
        const products = await orderManager.getTopProducts(limit);
        
        return new Response(JSON.stringify(products), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      if (pathname === '/analytics/revenue') {
        const revenue = await orderManager.getRevenueByMonth();
        
        return new Response(JSON.stringify(revenue), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Fast dashboard HTML
      if (pathname === '/' || pathname === '/dashboard') {
        return new Response(getDashboardHTML(), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders }
        });
      }
      
      return new Response('Not Found', { status: 404, headers: corsHeaders });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// Embedded dashboard HTML for instant loading
function getDashboardHTML(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nutrition Solutions - Analytics Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; }
        .header { background: #1e293b; color: white; padding: 1rem 2rem; }
        .header h1 { font-size: 1.5rem; font-weight: 600; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .metric-card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2rem; font-weight: bold; color: #059669; }
        .metric-label { color: #6b7280; font-size: 0.875rem; margin-top: 0.5rem; }
        .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem; }
        .chart-container { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .chart-container h3 { margin-bottom: 1rem; color: #374151; }
        .loading { text-align: center; padding: 2rem; color: #6b7280; }
        .sync-status { background: #10b981; color: white; padding: 0.5rem 1rem; border-radius: 4px; font-size: 0.875rem; margin-left: auto; }
        .sync-button { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; margin-left: 1rem; }
        .sync-button:hover { background: #2563eb; }
        .header-actions { display: flex; align-items: center; gap: 1rem; }
    </style>
</head>
<body>
    <div class="header">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <h1>🥗 Nutrition Solutions Analytics</h1>
            <div class="header-actions">
                <div class="sync-status" id="syncStatus">Data Updated: Live</div>
                <button class="sync-button" onclick="syncData()">Sync Now</button>
            </div>
        </div>
    </div>
    
    <div class="container">
        <div id="loading" class="loading">Loading lightning-fast analytics...</div>
        
        <div id="dashboard" style="display: none;">
            <div class="metrics" id="metricsContainer">
                <!-- Metrics will be populated here -->
            </div>
            
            <div class="charts">
                <div class="chart-container">
                    <h3>Revenue Trend (Last 12 Months)</h3>
                    <canvas id="revenueChart"></canvas>
                </div>
                <div class="chart-container">
                    <h3>Top Products by Revenue</h3>
                    <canvas id="productsChart"></canvas>
                </div>
            </div>
        </div>
    </div>

    <script>
        let revenueChart, productsChart;
        
        async function loadDashboard() {
            try {
                // Load all data in parallel for maximum speed
                const [analytics, products, revenue] = await Promise.all([
                    fetch('/analytics/overview').then(r => r.json()),
                    fetch('/analytics/products?limit=5').then(r => r.json()),
                    fetch('/analytics/revenue').then(r => r.json())
                ]);
                
                renderMetrics(analytics);
                renderRevenueChart(revenue.results || []);
                renderProductsChart(products.results || []);
                
                document.getElementById('loading').style.display = 'none';
                document.getElementById('dashboard').style.display = 'block';
                
            } catch (error) {
                console.error('Dashboard load error:', error);
                document.getElementById('loading').innerHTML = '❌ Failed to load dashboard';
            }
        }
        
        function renderMetrics(analytics) {
            const data = analytics.results && analytics.results[0] || {};
            
            const metrics = [
                { label: 'Total Revenue', value: formatCurrency(data.total_revenue || 0) },
                { label: 'Total Orders', value: (data.total_orders || 0).toLocaleString() },
                { label: 'Avg Order Value', value: formatCurrency(data.avg_order_value || 0) },
                { label: 'Unique Customers', value: (data.unique_customers || 0).toLocaleString() }
            ];
            
            const container = document.getElementById('metricsContainer');
            container.innerHTML = metrics.map(metric => 
                \`<div class="metric-card">
                    <div class="metric-value">\${metric.value}</div>
                    <div class="metric-label">\${metric.label}</div>
                </div>\`
            ).join('');
        }
        
        function renderRevenueChart(data) {
            const ctx = document.getElementById('revenueChart').getContext('2d');
            
            if (revenueChart) revenueChart.destroy();
            
            revenueChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.map(d => d.month),
                    datasets: [{
                        label: 'Revenue',
                        data: data.map(d => d.revenue),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: value => '$' + value.toLocaleString()
                            }
                        }
                    }
                }
            });
        }
        
        function renderProductsChart(data) {
            const ctx = document.getElementById('productsChart').getContext('2d');
            
            if (productsChart) productsChart.destroy();
            
            productsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.map(d => d.product_name),
                    datasets: [{
                        label: 'Revenue',
                        data: data.map(d => d.total_revenue),
                        backgroundColor: '#3b82f6'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: value => '$' + value.toLocaleString()
                            }
                        }
                    }
                }
            });
        }
        
        async function syncData() {
            const button = document.querySelector('.sync-button');
            const status = document.getElementById('syncStatus');
            
            button.textContent = 'Syncing...';
            button.disabled = true;
            
            try {
                const response = await fetch('/sync/incremental');
                const result = await response.json();
                
                status.textContent = \`Synced: \${result.new_orders} new orders\`;
                
                // Reload dashboard data
                await loadDashboard();
                
            } catch (error) {
                status.textContent = 'Sync failed';
                status.style.background = '#ef4444';
            }
            
            button.textContent = 'Sync Now';
            button.disabled = false;
        }
        
        function formatCurrency(value) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
            }).format(value);
        }
        
        // Auto-refresh every 5 minutes
        setInterval(loadDashboard, 5 * 60 * 1000);
        
        // Load dashboard on page load
        loadDashboard();
    </script>
</body>
</html>`;
}