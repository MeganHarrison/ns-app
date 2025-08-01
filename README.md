# Nutrition Solutions Analytics Platform

A high-performance analytics platform built on Cloudflare Workers that integrates with Keap CRM to provide real-time business intelligence and replace expensive third-party solutions like Grow.com.

## 🚀 Overview

This platform provides:
- **Real-time Keap CRM integration** for orders, contacts, products, and subscriptions
- **Lightning-fast analytics** using Cloudflare D1 and intelligent caching
- **Cost savings of $3,380/month** (Grow.com: $3,400/month → This platform: ~$20/month)
- **Sub-second dashboard loading** with optimized data delivery
- **Automatic hourly data synchronization** via cron jobs

## 🏗️ Architecture

```
Keap CRM API → Cloudflare Worker → D1 Database → KV Cache → Frontend Dashboard
                        ↓
                  Supabase (via Hyperdrive)
```

### Core Components:
- **Main Worker**: `d1-starter-sessions-api` at https://d1-starter-sessions-api.megan-d14.workers.dev
- **D1 Database**: Local SQLite for fast queries
- **KV Storage**: Intelligent caching layer
- **Hyperdrive**: Optimized PostgreSQL connections to Supabase
- **Cron Triggers**: Automatic hourly data sync

## 📁 Project Structure

```
/ns-app/
├── src/index.ts               # Main worker code with all API endpoints
├── workers/keap-client.ts     # Keap API v2 client implementation
├── wrangler.toml             # Cloudflare deployment configuration
├── public/                   # Static HTML files
│   ├── index.html           # Main dashboard
│   ├── keap-orders.html     # Orders management UI
│   ├── dashboard-v2.html    # Analytics dashboard
│   └── debug.html           # Debug interface
└── package.json             # Dependencies and scripts
```

## 🔌 API Endpoints

### Analytics & Dashboard
- `GET /` - Main dashboard interface
- `GET /api/metrics` - Business metrics with caching
- `GET /api/dashboard` - Comprehensive dashboard data

### Keap Integration
- `GET /keap-orders` - Live orders from Keap API
- `POST /api/sync-orders` - Sync orders from Keap to D1 ✅
- `POST /api/sync/contacts` - Sync contacts (TODO)
- `POST /api/sync/products` - Sync products (TODO)
- `POST /api/sync/subscriptions` - Sync subscriptions (TODO)

### Database Management
- `POST /api/migrate` - Run database migration
- `GET /api/tables` - List all database tables
- `GET /api/debug/db-status` - Database status

### Webhooks
- `POST /api/webhooks/keap` - Receive real-time updates
- `GET /api/webhooks/register` - Get webhook setup info

## 🗄️ Database Schema

The platform uses the following tables:
- `companies` - Company/account information
- `contacts` - Customer contact details
- `products` - Product catalog
- `orders` - Order transactions
- `subscriptions` - Recurring subscriptions
- `sync_logs` - Synchronization history

## 🚀 Deployment

### Prerequisites
- Cloudflare account with Workers enabled
- Keap CRM account with API access
- Node.js 18+ installed locally

### Initial Setup

1. **Clone and install dependencies**
   ```bash
   git clone <repo>
   cd ns-app
   npm install
   ```

2. **Create KV namespaces**
   ```bash
   wrangler kv namespace create "SYNC_STATE"
   wrangler kv namespace create "CACHE"
   ```

3. **Set secrets**
   ```bash
   wrangler secret put KEAP_SERVICE_ACCOUNT_KEY
   wrangler secret put KEAP_SECRET
   ```

4. **Deploy the worker**
   ```bash
   npm run deploy
   ```

### Environment Configuration

Update `wrangler.toml` with your IDs:
```toml
name = "d1-starter-sessions-api"
compatibility_date = "2025-03-17"
account_id = "YOUR_ACCOUNT_ID"

[[kv_namespaces]]
binding = "SYNC_STATE"
id = "YOUR_KV_ID"

[[d1_databases]]
binding = "DB01"
database_name = "d1-starter-sessions-api"
database_id = "YOUR_D1_ID"
```

## 🔧 Recent Updates (July 2025)

### Fixed Issues:
1. **Authentication**: Properly configured Keap Service Account Key as a secret
2. **Import Paths**: Fixed KeapClient import from `../workers/keap-client`
3. **API Integration**: Updated to use correct KeapClient constructor with config object
4. **Database Schema**: Aligned sync-orders with existing `orders` table structure
5. **Performance**: Implemented batch inserts for efficient data loading
6. **Configuration**: Fixed duplicate triggers and invalid Hyperdrive IDs in wrangler.toml

### Key Changes:
```javascript
// Before (broken):
const keapClient = new KeapClient(env.KEAP_SERVICE_ACCOUNT_KEY);

// After (fixed):
const keapClient = new KeapClient({ serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY });
```

## 🛠️ Local Development

1. **Start dev server**
   ```bash
   npm run dev
   ```

2. **View local site**
   - Main: http://localhost:8787
   - Orders: http://localhost:8787/keap-orders.html

3. **Run tests**
   ```bash
   npm test
   ```

## 💰 Cost Analysis

| Service | Grow.com | This Platform |
|---------|----------|---------------|
| Monthly Cost | $3,400 | ~$20 |
| Annual Savings | - | $40,560 |
| Performance | Slow | Sub-second |
| Customization | Limited | Unlimited |

## 🔮 Roadmap

- [ ] Complete contact and subscription sync endpoints
- [ ] Add AI-powered customer insights
- [ ] Implement predictive analytics
- [ ] Build mobile-responsive dashboard
- [ ] Add real-time notifications