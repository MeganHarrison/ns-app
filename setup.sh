#!/bin/bash

set -e

echo "🚀 Setting up Nutrition Solutions BI Infrastructure..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI not found. Please install it first:${NC}"
    echo "npm install -g wrangler"
    exit 1
fi

# Login to Cloudflare (if not already logged in)
echo -e "${YELLOW}🔐 Checking Cloudflare authentication...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo "Please login to Cloudflare:"
    wrangler login
fi

# Create D1 database
echo -e "${YELLOW}📊 Creating D1 database...${NC}"
DB_OUTPUT=$(wrangler d1 create nutrition-solutions-db)
DB_ID=$(echo "$DB_OUTPUT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2)
echo -e "${GREEN}✅ D1 Database created with ID: $DB_ID${NC}"

# Create KV namespace
echo -e "${YELLOW}🗄️ Creating KV namespace...${NC}"
KV_OUTPUT=$(wrangler kv:namespace create "KEAP_CACHE")
KV_ID=$(echo "$KV_OUTPUT" | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
echo -e "${GREEN}✅ KV Namespace created with ID: $KV_ID${NC}"

# Create preview KV namespace for development
KV_PREVIEW_OUTPUT=$(wrangler kv:namespace create "KEAP_CACHE" --preview)
KV_PREVIEW_ID=$(echo "$KV_PREVIEW_OUTPUT" | grep -o 'preview_id = "[^"]*"' | cut -d'"' -f2)
echo -e "${GREEN}✅ KV Preview Namespace created with ID: $KV_PREVIEW_ID${NC}"

# Create Queue
echo -e "${YELLOW}⚡ Creating Queue...${NC}"
wrangler queues create keap-sync-queue
echo -e "${GREEN}✅ Queue created: keap-sync-queue${NC}"

# Create R2 bucket (optional, for backups)
echo -e "${YELLOW}🪣 Creating R2 bucket...${NC}"
wrangler r2 bucket create nutrition-solutions-backups
echo -e "${GREEN}✅ R2 Bucket created: nutrition-solutions-backups${NC}"

# Update wrangler.toml with the created resource IDs
echo -e "${YELLOW}📝 Updating wrangler.toml configuration...${NC}"

# Create updated wrangler.toml
cat > wrangler.toml << WRANGLER_EOF
name = "nutrition-solutions-bi"
main = "src/index.ts"
compatibility_date = "2024-08-01"

[env.production.vars]
KEAP_CLIENT_ID = "q97htu3Rn9eW0tSPh5WNIWeN5bUVn57sIWiAZctwx3O8kov6"
KEAP_APP_ID = "f3758888-5b87-4228-b394-669991d857f8"

[[env.production.d1_databases]]
binding = "DB"
database_name = "nutrition-solutions-db"
database_id = "$DB_ID"

[[env.production.kv_namespaces]]
binding = "KEAP_CACHE"
id = "$KV_ID"
preview_id = "$KV_PREVIEW_ID"

[[env.production.queues.producers]]
binding = "KEAP_QUEUE"
queue = "keap-sync-queue"

[[env.production.queues.consumers]]
queue = "keap-sync-queue"
max_batch_size = 10
max_batch_timeout = 30

[env.production.triggers]
crons = ["0 */6 * * *"]

[[r2_buckets]]
binding = "BACKUP_BUCKET"
bucket_name = "nutrition-solutions-backups"

[analytics_engine_datasets]
binding = "AE"
WRANGLER_EOF

echo -e "${GREEN}✅ Configuration updated${NC}"

# Set secrets
echo -e "${YELLOW}🔐 Setting up secrets...${NC}"
echo "Please enter your Keap credentials:"

read -s -p "KEAP Secret: " KEAP_SECRET
echo
wrangler secret put KEAP_SECRET --env production <<< "$KEAP_SECRET"

read -s -p "KEAP Service Account Key: " KEAP_SAK
echo
wrangler secret put KEAP_SERVICE_ACCOUNT_KEY --env production <<< "$KEAP_SAK"

echo -e "${GREEN}✅ Secrets configured${NC}"

# Initialize database schema
echo -e "${YELLOW}🗃️ Initializing database schema...${NC}"
cat > schema.sql << SCHEMA_EOF
-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    contact_id INTEGER,
    creation_date TEXT,
    modification_date TEXT,
    order_title TEXT,
    order_status TEXT,
    total REAL,
    lead_affiliate_id INTEGER,
    promo_codes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Order items table
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER,
    product_id INTEGER,
    product_name TEXT,
    quantity INTEGER,
    price REAL,
    notes TEXT,
    FOREIGN KEY (order_id) REFERENCES orders (id)
);

-- Contacts table (for future use)
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    created_date TEXT,
    last_updated TEXT
);

-- Products table (for future use)
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT,
    price REAL,
    category TEXT,
    sku TEXT UNIQUE,
    active BOOLEAN DEFAULT 1
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_creation_date ON orders(creation_date);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
SCHEMA_EOF

wrangler d1 execute nutrition-solutions-db --env production --file schema.sql
echo -e "${GREEN}✅ Database schema initialized${NC}"

# Create package.json if it doesn't exist
if [ ! -f package.json ]; then
    echo -e "${YELLOW}📦 Creating package.json...${NC}"
    cat > package.json << PACKAGE_EOF
{
  "name": "nutrition-solutions-bi",
  "version": "1.0.0",
  "description": "Business Intelligence Dashboard for Nutrition Solutions",
  "main": "src/index.ts",
  "scripts": {
    "dev": "wrangler dev --env development",
    "deploy": "wrangler deploy --env production",
    "deploy:dev": "wrangler deploy --env development",
    "db:migrate": "wrangler d1 execute nutrition-solutions-db --env production --file schema.sql",
    "sync:manual": "curl -X POST https://nutrition-solutions-bi.your-subdomain.workers.dev/sync-orders"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240529.0",
    "typescript": "^5.0.4",
    "wrangler": "^3.57.0"
  }
}
PACKAGE_EOF
    echo -e "${GREEN}✅ Package.json created${NC}"
fi

# Create TypeScript config
if [ ! -f tsconfig.json ]; then
    echo -e "${YELLOW}⚙️ Creating TypeScript configuration...${NC}"
    cat > tsconfig.json << TSCONFIG_EOF
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
TSCONFIG_EOF
    echo -e "${GREEN}✅ TypeScript configuration created${NC}"
fi

# Create src directory and move index.ts if needed
mkdir -p src
if [ ! -f src/index.ts ]; then
    echo "// Your worker code goes here - use the provided Keap Sync Worker code" > src/index.ts
fi

# Deploy the worker
echo -e "${YELLOW}🚀 Deploying Worker...${NC}"
wrangler deploy --env production

echo -e "${GREEN}🎉 Setup Complete!${NC}"
echo
echo -e "${YELLOW}📋 Summary:${NC}"
echo "• D1 Database ID: $DB_ID"
echo "• KV Namespace ID: $KV_ID"
echo "• Worker URL: https://nutrition-solutions-bi.your-subdomain.workers.dev"
echo
echo -e "${YELLOW}⚡ Next Steps:${NC}"
echo "1. Copy the Keap Sync Worker code into src/index.ts"
echo "2. Test the sync: curl -X POST https://your-worker-url/sync-orders"
echo "3. Set up your Next.js dashboard with the worker URL"
echo "4. Configure your domain: wrangler custom-domains add your-domain.com"
echo
echo -e "${GREEN}💡 Pro Tips:${NC}"
echo "• Monitor logs: wrangler tail"
echo "• View D1 data: wrangler d1 execute nutrition-solutions-db --command 'SELECT COUNT(*) FROM orders'"
echo "• Manual sync: npm run sync:manual"
echo
echo -e "${YELLOW}🔗 Useful Commands:${NC}"
echo "• Development: npm run dev"
echo "• Deploy: npm run deploy"
echo "• View logs: wrangler tail --env production"
