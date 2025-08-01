// Cloudflare Worker for syncing Keap orders to Supabase
// This worker handles both initial sync and incremental updates

export default {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      
      // Route handling
      switch (url.pathname) {
        case '/sync-orders':
          return handleOrdersSync(request, env);
        case '/orders':
          return getOrders(request, env);
        case '/dashboard-data':
          return getDashboardData(request, env);
        default:
          return new Response('Not Found', { status: 404 });
      }
    },
  
    // Scheduled task to run incremental sync every hour
    async scheduled(event, env, ctx) {
      ctx.waitUntil(syncIncrementalOrders(env));
    }
  };
  
  // Main orders sync handler
  async function handleOrdersSync(request, env) {
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
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // Full sync - for initial data import
  async function syncAllOrders(env) {
    const accessToken = await getKeapAccessToken(env);
    let allOrders = [];
    let page = 0;
    let hasMore = true;
  
    console.log('Starting full orders sync...');
  
    while (hasMore) {
      const orders = await fetchKeapOrders(accessToken, page * 1000, 1000);
      
      if (orders && orders.length > 0) {
        allOrders = allOrders.concat(orders);
        page++;
        console.log(`Fetched page ${page}, total orders: ${allOrders.length}`);
        
        // Batch insert every 500 orders to avoid memory issues
        if (allOrders.length >= 500 || orders.length < 1000) {
          await batchInsertOrders(env, allOrders);
          allOrders = []; // Clear the batch
        }
      } else {
        hasMore = false;
      }
    }
  
    // Insert any remaining orders
    if (allOrders.length > 0) {
      await batchInsertOrders(env, allOrders);
    }
  
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Full sync completed',
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Incremental sync - for ongoing updates
  async function syncIncrementalOrders(env) {
    const accessToken = await getKeapAccessToken(env);
    
    // Get the last sync timestamp from KV storage
    const lastSyncTime = await env.SYNC_STATE.get('last_order_sync') || 
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Default to 24 hours ago
  
    console.log(`Starting incremental sync from: ${lastSyncTime}`);
  
    // Keap API filter for orders modified since last sync
    const sinceDate = new Date(lastSyncTime).toISOString().split('T')[0];
    const orders = await fetchKeapOrdersSince(accessToken, sinceDate);
  
    if (orders && orders.length > 0) {
      await upsertOrders(env, orders);
      console.log(`Synced ${orders.length} updated orders`);
    }
  
    // Update last sync timestamp
    await env.SYNC_STATE.put('last_order_sync', new Date().toISOString());
  
    return new Response(JSON.stringify({ 
      success: true, 
      synced_count: orders?.length || 0,
      last_sync: lastSyncTime
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Get Keap access token
  async function getKeapAccessToken(env) {
    // Check if we have a cached token
    const cachedToken = await env.SYNC_STATE.get('keap_access_token');
    if (cachedToken) {
      const tokenData = JSON.parse(cachedToken);
      if (tokenData.expires_at > Date.now()) {
        return tokenData.access_token;
      }
    }
  
    // Refresh or get new token
    const tokenResponse = await fetch('https://api.infusionsoft.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.KEAP_CLIENT_ID,
        client_secret: env.KEAP_SECRET,
        scope: 'full'
      })
    });
  
    const tokenData = await tokenResponse.json();
    
    // Cache the token with expiration
    const cacheData = {
      access_token: tokenData.access_token,
      expires_at: Date.now() + (tokenData.expires_in * 1000) - 60000 // 1 minute buffer
    };
    
    await env.SYNC_STATE.put('keap_access_token', JSON.stringify(cacheData));
    return tokenData.access_token;
  }
  
  // Fetch orders from Keap API
  async function fetchKeapOrders(accessToken, offset = 0, limit = 1000) {
    const response = await fetch(`https://api.infusionsoft.com/crm/rest/v1/orders?limit=${limit}&offset=${offset}`, {
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
  
  // Fetch orders modified since a specific date
  async function fetchKeapOrdersSince(accessToken, sinceDate) {
    const response = await fetch(
      `https://api.infusionsoft.com/crm/rest/v1/orders?since=${sinceDate}&limit=1000`, 
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Keap-API-Version': '1.0'
        }
      }
    );
  
    if (!response.ok) {
      throw new Error(`Keap API error: ${response.status} ${response.statusText}`);
    }
  
    const data = await response.json();
    return data.orders || [];
  }
  
  // Batch insert orders into Supabase
  async function batchInsertOrders(env, orders) {
    const transformedOrders = orders.map(transformOrder);
    
    const query = `
      INSERT INTO orders (
        keap_id, customer_id, status, total, creation_date, 
        modification_date, order_items, shipping_address, billing_address,
        payment_status, tracking_number, raw_data
      ) VALUES ${transformedOrders.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
      ON CONFLICT (keap_id) DO UPDATE SET
        status = EXCLUDED.status,
        total = EXCLUDED.total,
        modification_date = EXCLUDED.modification_date,
        order_items = EXCLUDED.order_items,
        payment_status = EXCLUDED.payment_status,
        tracking_number = EXCLUDED.tracking_number,
        raw_data = EXCLUDED.raw_data
    `;
  
    const params = transformedOrders.flatMap(order => [
      order.keap_id,
      order.customer_id,
      order.status,
      order.total,
      order.creation_date,
      order.modification_date,
      JSON.stringify(order.order_items),
      JSON.stringify(order.shipping_address),
      JSON.stringify(order.billing_address),
      order.payment_status,
      order.tracking_number,
      JSON.stringify(order.raw_data)
    ]);
  
    const stmt = env.HYPERDRIVE.prepare(query).bind(...params);
    await stmt.run();
  }
  
  // Upsert orders (for incremental sync)
  async function upsertOrders(env, orders) {
    for (const order of orders) {
      const transformedOrder = transformOrder(order);
      
      const stmt = env.HYPERDRIVE.prepare(`
        INSERT INTO orders (
          keap_id, customer_id, status, total, creation_date, 
          modification_date, order_items, shipping_address, billing_address,
          payment_status, tracking_number, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (keap_id) DO UPDATE SET
          status = ?,
          total = ?,
          modification_date = ?,
          order_items = ?,
          payment_status = ?,
          tracking_number = ?,
          raw_data = ?
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
        JSON.stringify(transformedOrder.raw_data),
        // UPDATE values
        transformedOrder.status,
        transformedOrder.total,
        transformedOrder.modification_date,
        JSON.stringify(transformedOrder.order_items),
        transformedOrder.payment_status,
        transformedOrder.tracking_number,
        JSON.stringify(transformedOrder.raw_data)
      );
      
      await stmt.run();
    }
  }
  
  // Transform Keap order to our schema
  function transformOrder(keapOrder) {
    return {
      keap_id: keapOrder.id,
      customer_id: keapOrder.contact_id,
      status: keapOrder.status,
      total: parseFloat(keapOrder.total) || 0,
      creation_date: keapOrder.creation_date,
      modification_date: keapOrder.modification_date,
      order_items: keapOrder.order_items || [],
      shipping_address: keapOrder.shipping_address || {},
      billing_address: keapOrder.billing_address || {},
      payment_status: keapOrder.payment_status,
      tracking_number: keapOrder.tracking_number,
      raw_data: keapOrder
    };
  }
  
  // Get orders from Supabase (fast!)
  async function getOrders(request, env) {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');
    const offset = (page - 1) * limit;
  
    let query = 'SELECT * FROM orders';
    let params = [];
    
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY creation_date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
  
    const stmt = env.HYPERDRIVE.prepare(query).bind(...params);
    const result = await stmt.all();
  
    return new Response(JSON.stringify({
      orders: result.results,
      page,
      limit,
      total: result.results.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Get dashboard analytics data
  async function getDashboardData(request, env) {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  
    // Get multiple metrics in parallel
    const [totalRevenue, orderCount, avgOrderValue, statusBreakdown, dailySales] = await Promise.all([
      // Total revenue
      env.HYPERDRIVE.prepare('SELECT SUM(total) as revenue FROM orders WHERE creation_date >= ?')
        .bind(startDate).first(),
      
      // Order count
      env.HYPERDRIVE.prepare('SELECT COUNT(*) as count FROM orders WHERE creation_date >= ?')
        .bind(startDate).first(),
      
      // Average order value
      env.HYPERDRIVE.prepare('SELECT AVG(total) as avg_value FROM orders WHERE creation_date >= ?')
        .bind(startDate).first(),
      
      // Status breakdown
      env.HYPERDRIVE.prepare(`
        SELECT status, COUNT(*) as count, SUM(total) as revenue 
        FROM orders 
        WHERE creation_date >= ? 
        GROUP BY status
      `).bind(startDate).all(),
      
      // Daily sales for chart
      env.HYPERDRIVE.prepare(`
        SELECT 
          DATE(creation_date) as date,
          COUNT(*) as orders,
          SUM(total) as revenue
        FROM orders 
        WHERE creation_date >= ? 
        GROUP BY DATE(creation_date)
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
      period_days: days
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  