import { D1Database } from '@cloudflare/workers-types';
import fs from 'fs';
import path from 'path';

export async function migrateDatabase(db: D1Database, env: any) {
  console.log('Starting database migration...');
  
  try {
    // Step 1: Create default company
    const defaultCompanyId = 'default-company';
    await db.prepare(`
      INSERT OR IGNORE INTO companies (id, name, keap_app_id) 
      VALUES (?, 'Nutrition Solutions', ?)
    `).bind(defaultCompanyId, env.KEAP_APP_ID || 'default').run();
    
    // Step 2: Check if we need to migrate from old Orders table
    const tableCheck = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='Orders'
    `).first();
    
    if (tableCheck) {
      console.log('Migrating existing Orders table data...');
      
      // Step 3: Migrate existing orders to new schema
      const existingOrders = await db.prepare('SELECT * FROM Orders').all();
      
      for (const order of existingOrders.results) {
        // First, create or update the contact
        const contactId = crypto.randomUUID();
        await db.prepare(`
          INSERT OR IGNORE INTO contacts (
            id, company_id, keap_contact_id, email, 
            first_name, last_name
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          contactId,
          defaultCompanyId,
          order.customerId,
          order.customerEmail,
          order.customerName?.split(' ')[0] || '',
          order.customerName?.split(' ').slice(1).join(' ') || ''
        ).run();
        
        // Get the actual contact ID (in case it already existed)
        const contact = await db.prepare(`
          SELECT id FROM contacts WHERE keap_contact_id = ?
        `).bind(order.customerId).first();
        
        // Then insert the order with new schema
        await db.prepare(`
          INSERT OR IGNORE INTO orders_new (
            company_id, keap_order_id, contact_id, 
            total_amount, status, order_date, products
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          defaultCompanyId,
          order.orderId,
          contact?.id || contactId,
          order.total,
          order.status,
          order.orderDate,
          order.orderItems || '[]'
        ).run();
      }
      
      console.log(`Migrated ${existingOrders.results.length} orders`);
      
      // Step 4: Drop old Orders table
      await db.prepare('DROP TABLE IF EXISTS Orders').run();
      
      // Step 5: Rename orders_new to orders
      await db.prepare('ALTER TABLE orders_new RENAME TO orders').run();
    } else {
      // No old table, just rename orders_new to orders
      await db.prepare('ALTER TABLE orders_new RENAME TO orders').run();
    }
    
    console.log('Database migration completed successfully');
    
    // Log the migration
    await db.prepare(`
      INSERT INTO sync_logs (company_id, sync_type, status, records_processed)
      VALUES (?, 'database_migration', 'completed', ?)
    `).bind(
      defaultCompanyId, 
      existingOrders?.results.length || 0
    ).run();
    
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
}

// Function to apply schema from SQL file
export async function applySchema(db: D1Database) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  
  // Split by semicolon and execute each statement
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  for (const statement of statements) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      console.error(`Error executing statement: ${statement.substring(0, 50)}...`);
      throw error;
    }
  }
  
  console.log('Schema applied successfully');
}