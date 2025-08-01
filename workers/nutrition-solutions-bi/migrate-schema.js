// Migration script to adapt existing schema to nutrition-solutions-bi worker expectations

export default {
  async fetch(request, env) {
    const db = env.DB || env.DB01;
    if (!db) {
      return new Response('No database binding found', { status: 500 });
    }

    try {
      // Check if Orders table exists (capital O)
      const tables = await db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Orders', 'orders')
      `).all();

      console.log('Found tables:', tables.results);

      if (tables.results.some(t => t.name === 'Orders')) {
        // We have the old schema, need to migrate
        console.log('Migrating from Orders to orders table...');

        // Create new orders table with correct schema
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS orders (
            keap_id INTEGER PRIMARY KEY,
            customer_id INTEGER,
            title TEXT,
            status TEXT,
            total REAL,
            total_paid REAL,
            total_due REAL,
            refund_total REAL,
            order_type TEXT,
            creation_date TEXT,
            modification_date TEXT,
            order_date TEXT,
            order_items TEXT,
            shipping_information TEXT,
            payment_plan TEXT,
            lead_affiliate_id INTEGER,
            sales_affiliate_id INTEGER,
            notes TEXT,
            raw_data TEXT
          )
        `).run();

        // Copy data from Orders to orders with field mapping
        const copyResult = await db.prepare(`
          INSERT OR IGNORE INTO orders (
            keap_id,
            customer_id,
            title,
            status,
            total,
            order_date,
            creation_date,
            modification_date,
            order_items
          )
          SELECT 
            orderId as keap_id,
            customerId as customer_id,
            title,
            status,
            total,
            orderDate as order_date,
            orderDate as creation_date,
            lastSynced as modification_date,
            orderItems as order_items
          FROM Orders
        `).run();

        console.log('Migrated rows:', copyResult.meta.changes);

        // Create order_items table
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS order_items (
            keap_order_item_id INTEGER PRIMARY KEY,
            order_id INTEGER,
            product_id INTEGER,
            product_name TEXT,
            description TEXT,
            type TEXT,
            quantity INTEGER,
            price REAL,
            cost REAL,
            notes TEXT,
            FOREIGN KEY (order_id) REFERENCES orders(keap_id)
          )
        `).run();

        // Create indices
        await db.prepare(`
          CREATE INDEX IF NOT EXISTS idx_orders_creation_date ON orders(creation_date)
        `).run();

        await db.prepare(`
          CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)
        `).run();

        return new Response(JSON.stringify({
          success: true,
          message: 'Migration completed',
          migrated_rows: copyResult.meta.changes
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        // Check if the schema is already correct
        const schemaCheck = await db.prepare(`
          SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'
        `).first();

        return new Response(JSON.stringify({
          success: true,
          message: 'Schema check complete',
          current_schema: schemaCheck
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Migration error:', error);
      return new Response(JSON.stringify({
        error: 'Migration failed',
        message: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};