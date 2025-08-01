-- Nutrition Solutions D1 Database Schema
-- This schema is adapted from the Supabase schema to work with Cloudflare D1

-- Companies table (for multi-tenant support if needed)
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  keap_app_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id),
  keap_contact_id TEXT UNIQUE,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  tags TEXT DEFAULT '[]', -- JSON array as TEXT
  custom_fields TEXT DEFAULT '{}', -- JSON object as TEXT
  lifecycle_stage TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products table
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

-- Enhanced Orders table (replacing the existing simple one)
CREATE TABLE IF NOT EXISTS orders_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id),
  keap_order_id TEXT UNIQUE,
  contact_id TEXT REFERENCES contacts(id),
  total_amount DECIMAL(10,2),
  status TEXT,
  order_date DATETIME,
  products TEXT DEFAULT '[]', -- JSON array as TEXT
  shipping_address TEXT DEFAULT '{}', -- JSON object as TEXT
  billing_address TEXT DEFAULT '{}', -- JSON object as TEXT
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions table
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

-- Sync logs table for tracking sync operations
CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id),
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  records_processed INTEGER DEFAULT 0,
  errors TEXT DEFAULT '[]', -- JSON array as TEXT
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_keap_id ON contacts(keap_contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders_new(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders_new(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_keap_id ON orders_new(keap_order_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_contact_id ON subscriptions(contact_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_type_status ON sync_logs(sync_type, status);

-- Migrate existing orders data to new schema
-- This will be handled in the migration script