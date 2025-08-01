# Nutrition Solutions Implementation Roadmap

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Reference @/Users/meganharrison/Documents/github/ns/ns-app/.claude/PLANNING.md for project structure and task checklist

Reference @/Users/meganharrison/Documents/github/ns/ns-app/.claude/PLANNING.md

## Rules

### When writing code for Cloudflare Workers, reference the  @/Users/meganharrison/Documents/github/next-starter-template/.claude/CLOUDFLARE_WORKERS.md

### MANDATORY: TEST BEFORE CLAIMING ANYTHING WORKS
**ABSOLUTE REQUIREMENT**: You MUST test EVERY feature, deployment, or functionality BEFORE saying it works. No exceptions.

1. **NEVER say "it's working" without testing first**
2. **NEVER say "successfully deployed" without verifying the deployment**
3. **NEVER say "the functionality is ready" without running actual tests**
4. **ALWAYS test with real data/files, not just checking if commands succeed**
5. **If you cannot test something, explicitly say "I implemented this but have NOT tested it"**

Testing means:
- For web pages: Actually visiting the URL and verifying it loads correctly
- For APIs: Making real requests and checking responses
- For functionality: Running it end-to-end with test data
- For deployments: Accessing the live URL and confirming it works

This rule exists because untested claims waste time with unnecessary back-and-forth.

### Task Completion Rule
NEVER say "I've completed [task]" or mark a task as done without:
1. Actually running tests using Playwright MCP server
2. Verifying the functionality works in the browser
3. Confirming no errors occur during testing

If testing fails or you cannot test, you must say "I've implemented [task] but need to test it" instead of claiming completion.

### Use Cloudflare Workers MCP anytime you need information on things such as R2 Bucket Files, D1 database information, Agents, ect.

### Be proactive
If you have the ability to complete an action or fix something, do it. Don't ask me to do something that you could have done. 

The goal is to streamline and make the coding process as efficient as possible. It's just a waste of time for you to tell me to do something and then wait for me to do it rather than just doing it yourself.

Again, remember to always test after new code is created to ensure it's working as intended and update documentation in CLAUDE.md and README.md.


## Keap Resources

- Keap REST API `https://developer.infusionsoft.com/docs/restv2/`
- Keap SDK	`https://github.com/infusionsoft/keap-sdk.git`
- Keap API Sample Code	https://github.com/infusionsoft/API-Sample-Code.git
- Keap Postman Collection	https://documenter.getpostman.com/view/2915979/UVByKWEZ
- Keap Personal Access Token & Service Account Keys	https://developer.infusionsoft.com/pat-and-sak/
- Keap: Making OAuth Requests without User Authorization	https://developer.infusionsoft.com/tutorials/making-oauth-requests-without-user-authorization/

## Phase-by-Phase Execution Plan


## PHASE 1: FOUNDATION SPRINT (Week 1)
**Goal: Get immediate performance wins and data foundation**

### Day 1-2: Database Schema Setup
**Priority: Set up core tables in Supabase**

```sql
-- Core Tables Schema
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  keap_app_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  keap_contact_id TEXT UNIQUE,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  tags JSONB DEFAULT '[]',
  custom_fields JSONB DEFAULT '{}',
  lifecycle_stage TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  keap_product_id TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  category TEXT,
  sku TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  keap_order_id TEXT UNIQUE,
  contact_id UUID REFERENCES contacts(id),
  total_amount DECIMAL(10,2),
  status TEXT,
  order_date TIMESTAMP WITH TIME ZONE,
  products JSONB DEFAULT '[]',
  shipping_address JSONB DEFAULT '{}',
  billing_address JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  keap_subscription_id TEXT UNIQUE,
  contact_id UUID REFERENCES contacts(id),
  product_id UUID REFERENCES products(id),
  status TEXT,
  billing_amount DECIMAL(10,2),
  billing_cycle TEXT,
  start_date TIMESTAMP WITH TIME ZONE,
  next_billing_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  records_processed INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX idx_contacts_keap_id ON contacts(keap_contact_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_orders_contact_id ON orders(contact_id);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_orders_keap_id ON orders(keap_order_id);
CREATE INDEX idx_subscriptions_contact_id ON subscriptions(contact_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### Day 3-4: Keap API Integration Layer
**Priority: Create robust API client with proper error handling**

```javascript
// keap-client.js - Cloudflare Worker
export class KeapClient {
  constructor(config) {
    this.appId = config.appId;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.serviceAccountKey = config.serviceAccountKey;
    this.baseUrl = 'https://api.infusionsoft.com/crm/rest/v1';
    this.accessToken = null;
  }

  async authenticate() {
    const response = await fetch('https://api.infusionsoft.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'full'
      })
    });

    const data = await response.json();
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  async makeRequest(endpoint, options = {}) {
    if (!this.accessToken) {
      await this.authenticate();
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (response.status === 401) {
      // Token expired, refresh and retry
      await this.authenticate();
      return this.makeRequest(endpoint, options);
    }

    return response.json();
  }

  // Core API methods
  async getContacts(limit = 1000, offset = 0) {
    return this.makeRequest(`/contacts?limit=${limit}&offset=${offset}`);
  }

  async getOrders(since = null, limit = 1000, offset = 0) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString()
    });
    
    if (since) {
      params.append('since', since);
    }
    
    return this.makeRequest(`/orders?${params}`);
  }

  async getProducts(limit = 1000, offset = 0) {
    return this.makeRequest(`/products?limit=${limit}&offset=${offset}`);
  }

  async getSubscriptions(limit = 1000, offset = 0) {
    return this.makeRequest(`/subscriptions?limit=${limit}&offset=${offset}`);
  }

  async updateSubscription(subscriptionId, updates) {
    return this.makeRequest(`/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  }
}
```

### Day 5-7: Initial Data Sync System
**Priority: Batch import historical data efficiently**

```javascript
// data-sync-worker.js
import { KeapClient } from './keap-client.js';
import { createClient } from '@supabase/supabase-js';

export default {
  async fetch(request, env) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const keap = new KeapClient({
      appId: env.KEAP_APP_ID,
      clientId: env.KEAP_CLIENT_ID,
      clientSecret: env.KEAP_SECRET,
      serviceAccountKey: env.KEAP_SERVICE_ACCOUNT_KEY
    });

    const url = new URL(request.url);
    const syncType = url.pathname.split('/').pop();

    try {
      switch (syncType) {
        case 'contacts':
          return await syncContacts(keap, supabase);
        case 'orders':
          return await syncOrders(keap, supabase);
        case 'products':
          return await syncProducts(keap, supabase);
        case 'subscriptions':
          return await syncSubscriptions(keap, supabase);
        default:
          return new Response('Invalid sync type', { status: 400 });
      }
    } catch (error) {
      console.error('Sync error:', error);
      return new Response(`Sync failed: ${error.message}`, { status: 500 });
    }
  }
};

async function syncContacts(keap, supabase) {
  let offset = 0;
  let totalSynced = 0;
  const batchSize = 1000;

  while (true) {
    const response = await keap.getContacts(batchSize, offset);
    
    if (!response.contacts || response.contacts.length === 0) {
      break;
    }

    const contacts = response.contacts.map(contact => ({
      keap_contact_id: contact.id.toString(),
      email: contact.email_addresses?.[0]?.email,
      first_name: contact.given_name,
      last_name: contact.family_name,
      phone: contact.phone_numbers?.[0]?.number,
      tags: contact.tag_ids || [],
      custom_fields: contact.custom_fields || {},
      company_id: '00000000-0000-0000-0000-000000000000' // Default company
    }));

    const { error } = await supabase
      .from('contacts')
      .upsert(contacts, { 
        onConflict: 'keap_contact_id',
        ignoreDuplicates: false 
      });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    totalSynced += contacts.length;
    offset += batchSize;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return new Response(JSON.stringify({ 
    success: true, 
    totalSynced,
    type: 'contacts' 
  }));
}

async function syncOrders(keap, supabase) {
  // Similar implementation for orders
  let offset = 0;
  let totalSynced = 0;
  const batchSize = 1000;

  while (true) {
    const response = await keap.getOrders(null, batchSize, offset);
    
    if (!response.orders || response.orders.length === 0) {
      break;
    }

    const orders = response.orders.map(order => ({
      keap_order_id: order.id.toString(),
      contact_id: order.contact_id ? order.contact_id.toString() : null,
      total_amount: order.total,
      status: order.status,
      order_date: order.creation_date,
      products: order.order_items || [],
      shipping_address: order.shipping_address || {},
      billing_address: order.billing_address || {},
      company_id: '00000000-0000-0000-0000-000000000000'
    }));

    const { error } = await supabase
      .from('orders')
      .upsert(orders, { 
        onConflict: 'keap_order_id',
        ignoreDuplicates: false 
      });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    totalSynced += orders.length;
    offset += batchSize;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return new Response(JSON.stringify({ 
    success: true, 
    totalSynced,
    type: 'orders' 
  }));
}
```

---

## PHASE 2: DASHBOARD CORE (Week 2)
**Goal: Replace Grow.com with lightning-fast analytics**

### Day 8-10: Analytics Engine
```javascript
// analytics-engine.js
export class AnalyticsEngine {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async getRevenueMetrics(startDate, endDate) {
    const { data, error } = await this.supabase
      .from('orders')
      .select('total_amount, order_date, status')
      .gte('order_date', startDate)
      .lte('order_date', endDate)
      .eq('status', 'paid');

    if (error) throw error;

    return {
      totalRevenue: data.reduce((sum, order) => sum + parseFloat(order.total_amount), 0),
      orderCount: data.length,
      averageOrderValue: data.length > 0 ? 
        data.reduce((sum, order) => sum + parseFloat(order.total_amount), 0) / data.length : 0,
      dailyRevenue: this.groupByDate(data, 'order_date', 'total_amount')
    };
  }

  async getCustomerMetrics() {
    // Customer acquisition, retention, churn calculations
    const { data: contacts } = await this.supabase
      .from('contacts')
      .select('created_at, id');

    const { data: orders } = await this.supabase
      .from('orders')
      .select('contact_id, order_date, total_amount')
      .order('order_date');

    return {
      totalCustomers: contacts.length,
      newCustomersThisMonth: this.getNewCustomersThisMonth(contacts),
      customerLifetimeValue: this.calculateCLV(orders),
      retentionRate: this.calculateRetentionRate(orders)
    };
  }

  async getSubscriptionMetrics() {
    const { data } = await this.supabase
      .from('subscriptions')
      .select('status, billing_amount, start_date, end_date');

    return {
      activeSubscriptions: data.filter(s => s.status === 'active').length,
      monthlyRecurringRevenue: data
        .filter(s => s.status === 'active')
        .reduce((sum, s) => sum + parseFloat(s.billing_amount), 0),
      churnRate: this.calculateChurnRate(data),
      subscriptionGrowth: this.calculateSubscriptionGrowth(data)
    };
  }

  groupByDate(data, dateField, valueField) {
    const grouped = {};
    data.forEach(item => {
      const date = new Date(item[dateField]).toISOString().split('T')[0];
      if (!grouped[date]) grouped[date] = 0;
      grouped[date] += parseFloat(item[valueField]);
    });
    return grouped;
  }

  calculateCLV(orders) {
    // Customer Lifetime Value calculation
    const customerOrders = {};
    orders.forEach(order => {
      if (!customerOrders[order.contact_id]) {
        customerOrders[order.contact_id] = [];
      }
      customerOrders[order.contact_id].push(order);
    });

    const lifetimeValues = Object.values(customerOrders).map(customerOrderList => 
      customerOrderList.reduce((sum, order) => sum + parseFloat(order.total_amount), 0)
    );

    return lifetimeValues.reduce((sum, clv) => sum + clv, 0) / lifetimeValues.length;
  }
}
```

### Day 11-14: React Dashboard Frontend
```jsx
// Dashboard.jsx
import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [metrics, setMetrics] = useState({});
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    loadDashboardData();
  }, [dateRange]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard/metrics?start=${dateRange.start}&end=${dateRange.end}`);
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading dashboard...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Nutrition Solutions Dashboard</h1>
        <div className="flex space-x-4">
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="border rounded px-3 py-2"
          />
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="border rounded px-3 py-2"
          />
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard
          title="Total Revenue"
          value={`$${(metrics.revenue?.totalRevenue || 0).toLocaleString()}`}
          change="+12.5%"
          changeType="positive"
        />
        <MetricCard
          title="Orders"
          value={metrics.revenue?.orderCount || 0}
          change="+8.2%"
          changeType="positive"
        />
        <MetricCard
          title="Avg Order Value"
          value={`$${(metrics.revenue?.averageOrderValue || 0).toFixed(2)}`}
          change="+4.1%"
          changeType="positive"
        />
        <MetricCard
          title="Active Subscriptions"
          value={metrics.subscriptions?.activeSubscriptions || 0}
          change="+15.3%"
          changeType="positive"
        />
      </div>

      {/* Revenue Chart */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Daily Revenue</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formatChartData(metrics.revenue?.dailyRevenue)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip formatter={(value) => [`$${value}`, 'Revenue']} />
            <Line type="monotone" dataKey="value" stroke="#8884d8" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Customer Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Customer Metrics</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span>Total Customers</span>
              <span className="font-semibold">{metrics.customers?.totalCustomers || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>New This Month</span>
              <span className="font-semibold">{metrics.customers?.newCustomersThisMonth || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Customer LTV</span>
              <span className="font-semibold">${(metrics.customers?.customerLifetimeValue || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Subscription Metrics</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span>Monthly Recurring Revenue</span>
              <span className="font-semibold">${(metrics.subscriptions?.monthlyRecurringRevenue || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Churn Rate</span>
              <span className="font-semibold">{(metrics.subscriptions?.churnRate || 0).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, change, changeType }) {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <div className="mt-2">
        <div className="text-3xl font-bold text-gray-900">{value}</div>
        <div className={`text-sm ${changeType === 'positive' ? 'text-green-600' : 'text-red-600'}`}>
          {change}
        </div>
      </div>
    </div>
  );
}

function formatChartData(dailyRevenue) {
  if (!dailyRevenue) return [];
  return Object.entries(dailyRevenue).map(([date, value]) => ({
    date: new Date(date).toLocaleDateString(),
    value: parseFloat(value)
  }));
}
```

---

## OPTIMIZED DATA DELIVERY ARCHITECTURE
**Goal: Sub-second load times with intelligent caching and real-time updates**

### Data Layer Strategy: The "Speed Hierarchy"

Think of this like a restaurant kitchen with different stations:
- **KV Store** = Hot food ready to serve (instant delivery)
- **D1 Database** = Prep station (fast cooking for common requests)
- **Supabase** = Walk-in cooler (bulk storage and complex queries)
- **Keap API** = Grocery store (only when you need fresh ingredients)

```javascript
// data-optimization-strategy.js
export class OptimizedDataDelivery {
  constructor(env) {
    this.kv = env.NUTRITION_KV;
    this.d1 = env.DB;
    this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    this.keap = new KeapClient(env);
  }

  async getOrdersOptimized(filters = {}) {
    const cacheKey = `orders:${JSON.stringify(filters)}`;
    
    // Level 1: KV Cache (instant - <5ms)
    let cachedData = await this.kv.get(cacheKey, { type: 'json' });
    if (cachedData && this.isCacheValid(cachedData.timestamp)) {
      return {
        data: cachedData.data,
        source: 'cache',
        loadTime: '<5ms'
      };
    }

    // Level 2: D1 Hot Data (fast - <50ms)
    const hotData = await this.getHotOrders(filters);
    if (hotData.length > 0) {
      // Cache for next request
      await this.kv.put(cacheKey, JSON.stringify({
        data: hotData,
        timestamp: Date.now()
      }), { expirationTtl: 300 }); // 5 min cache
      
      return {
        data: hotData,
        source: 'hot-storage',
        loadTime: '<50ms'
      };
    }

    // Level 3: Supabase Cold Data (slower - <200ms)
    const coldData = await this.getColdOrders(filters);
    
    // Warm up D1 and KV for next time
    await this.warmUpData(coldData, filters);
    
    return {
      data: coldData,
      source: 'cold-storage',
      loadTime: '<200ms'
    };
  }

  async getHotOrders(filters) {
    // D1 contains last 90 days of orders for fast access
    const stmt = this.d1.prepare(`
      SELECT o.*, c.first_name, c.last_name, c.email
      FROM orders o
      LEFT JOIN contacts c ON o.contact_id = c.id
      WHERE o.order_date >= datetime('now', '-90 days')
      ORDER BY o.order_date DESC
      LIMIT 1000
    `);
    
    const { results } = await stmt.all();
    return results;
  }

  async getColdOrders(filters) {
    // Supabase for historical data and complex queries
    const { data } = await this.supabase
      .from('orders')
      .select(`
        *,
        contacts(first_name, last_name, email),
        products(name, category)
      `)
      .order('order_date', { ascending: false })
      .limit(1000);
    
    return data;
  }
}
```

### Real-Time Data Sync Strategy

```javascript
// real-time-sync-worker.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case '/webhook/keap/order-created':
        return await handleNewOrder(request, env);
      case '/webhook/keap/order-updated':
        return await handleOrderUpdate(request, env);
      case '/sync/incremental':
        return await handleIncrementalSync(env);
      default:
        return new Response('Not found', { status: 404 });
    }
  }
};

async function handleNewOrder(request, env) {
  const orderData = await request.json();
  
  // 1. Store in Supabase (source of truth)
  await storeInSupabase(orderData, env);
  
  // 2. Update D1 hot storage
  await updateD1HotStorage(orderData, env);
  
  // 3. Invalidate relevant KV caches
  await invalidateOrderCaches(env);
  
  // 4. Update real-time dashboard
  await pushToRealtimeClients(orderData, env);
  
  // 5. Trigger AI analysis for fraud/anomaly detection
  await triggerAIAnalysis(orderData, env);
  
  return new Response('Order processed', { status: 200 });
}

async function updateD1HotStorage(orderData, env) {
  const stmt = env.DB.prepare(`
    INSERT OR REPLACE INTO orders_hot 
    (keap_order_id, contact_id, total_amount, status, order_date, products)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  await stmt.bind(
    orderData.id,
    orderData.contact_id,
    orderData.total,
    orderData.status,
    orderData.order_date,
    JSON.stringify(orderData.order_items)
  ).run();
}

async function invalidateOrderCaches(env) {
  // Clear all order-related KV cache entries
  const cacheKeys = [
    'orders:{}',
    'dashboard:revenue:today',
    'dashboard:metrics:summary',
    'analytics:orders:recent'
  ];
  
  await Promise.all(
    cacheKeys.map(key => env.NUTRITION_KV.delete(key))
  );
}
```

### Intelligent Caching Strategy

```javascript
// cache-strategy.js
export class IntelligentCache {
  constructor(env) {
    this.kv = env.NUTRITION_KV;
    this.d1 = env.DB;
  }

  async get(key, options = {}) {
    const cacheKey = this.buildCacheKey(key, options);
    
    // Check KV first
    const cached = await this.kv.get(cacheKey, { type: 'json' });
    
    if (cached) {
      // Check if cache is still valid based on data type
      const ttl = this.getTTLForDataType(options.dataType);
      const age = Date.now() - cached.timestamp;
      
      if (age < ttl) {
        return {
          data: cached.data,
          hit: true,
          age: age,
          source: 'kv-cache'
        };
      }
    }
    
    return { hit: false };
  }

  async set(key, data, options = {}) {
    const cacheKey = this.buildCacheKey(key, options);
    const ttl = this.getTTLForDataType(options.dataType);
    
    const cacheData = {
      data: data,
      timestamp: Date.now(),
      version: options.version || 1
    };
    
    await this.kv.put(cacheKey, JSON.stringify(cacheData), {
      expirationTtl: Math.floor(ttl / 1000) // KV expects seconds
    });
  }

  getTTLForDataType(dataType) {
    const ttlMap = {
      'historical-orders': 24 * 60 * 60 * 1000,    // 24 hours - never changes
      'recent-orders': 5 * 60 * 1000,              // 5 minutes - might update
      'live-metrics': 30 * 1000,                   // 30 seconds - real-time
      'customer-profiles': 60 * 60 * 1000,         // 1 hour - updates occasionally
      'product-catalog': 12 * 60 * 60 * 1000,      // 12 hours - rarely changes
      'analytics-reports': 15 * 60 * 1000,         // 15 minutes - business intelligence
      'ai-insights': 60 * 60 * 1000                // 1 hour - AI-generated content
    };
    
    return ttlMap[dataType] || 5 * 60 * 1000; // Default 5 minutes
  }

  buildCacheKey(key, options) {
    const parts = [key];
    
    if (options.userId) parts.push(`user:${options.userId}`);
    if (options.dateRange) parts.push(`range:${options.dateRange}`);
    if (options.filters) parts.push(`filters:${JSON.stringify(options.filters)}`);
    
    return parts.join(':');
  }
}
```

### Vector Database for AI Context

```javascript
// vector-knowledge-system.js
export class VectorKnowledgeSystem {
  constructor(env) {
    this.vectorDB = env.VECTORIZE_INDEX;
    this.kv = env.NUTRITION_KV;
  }

  async indexBusinessData() {
    // Index different types of business knowledge
    const dataTypes = [
      'customer-service-protocols',
      'product-information',
      'sales-processes',
      'competitive-analysis',
      'nutrition-guidelines',
      'subscription-policies'
    ];

    for (const type of dataTypes) {
      await this.indexDataType(type);
    }
  }

  async indexDataType(type) {
    const data = await this.getDataForType(type);
    
    for (const item of data) {
      const embedding = await this.generateEmbedding(item.content);
      
      await this.vectorDB.upsert([{
        id: `${type}:${item.id}`,
        values: embedding,
        metadata: {
          type: type,
          content: item.content,
          title: item.title,
          lastUpdated: Date.now()
        }
      }]);
    }
  }

  async queryContext(question, contextType = null) {
    const questionEmbedding = await this.generateEmbedding(question);
    
    const filter = contextType ? { type: contextType } : {};
    
    const results = await this.vectorDB.query({
      vector: questionEmbedding,
      topK: 5,
      includeMetadata: true,
      filter: filter
    });

    return results.matches.map(match => ({
      content: match.metadata.content,
      title: match.metadata.title,
      relevanceScore: match.score,
      type: match.metadata.type
    }));
  }

  async generateEmbedding(text) {
    // Use Cloudflare Workers AI for embeddings
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/baai/bge-base-en-v1.5`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: [text]
      })
    });

    const result = await response.json();
    return result.result.data[0];
  }
}
```

### Auto-RAG Implementation

```javascript
// auto-rag-system.js
export class AutoRAGSystem {
  constructor(env) {
    this.vectorKnowledge = new VectorKnowledgeSystem(env);
    this.cache = new IntelligentCache(env);
    this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }

  async answerQuestion(question, context = {}) {
    // 1. Check if we have a cached answer
    const cacheKey = `rag-answer:${question}`;
    const cached = await this.cache.get(cacheKey, { 
      dataType: 'ai-insights' 
    });
    
    if (cached.hit) {
      return cached.data;
    }

    // 2. Determine question type and fetch relevant context
    const questionType = await this.classifyQuestion(question);
    const relevantContext = await this.gatherContext(question, questionType, context);

    // 3. Generate answer using AI with context
    const answer = await this.generateAnswer(question, relevantContext);

    // 4. Cache the answer
    await this.cache.set(cacheKey, answer, { 
      dataType: 'ai-insights' 
    });

    return answer;
  }

  async gatherContext(question, questionType, userContext) {
    const context = {
      vectorContext: await this.vectorKnowledge.queryContext(question, questionType),
      businessData: await this.getBusinessContext(questionType, userContext),
      userHistory: await this.getUserHistory(userContext.userId),
      realTimeData: await this.getRealTimeContext(questionType)
    };

    return context;
  }

  async getBusinessContext(questionType, userContext) {
    switch (questionType) {
      case 'customer-support':
        return await this.getCustomerSupportContext(userContext);
      case 'sales-inquiry':
        return await this.getSalesContext(userContext);
      case 'analytics-question':
        return await this.getAnalyticsContext(userContext);
      default:
        return {};
    }
  }

  async getCustomerSupportContext(userContext) {
    if (!userContext.customerId) return {};

    // Get customer's order history, subscription status, recent interactions
    const { data: customer } = await this.supabase
      .from('contacts')
      .select(`
        *,
        orders(*),
        subscriptions(*)
      `)
      .eq('id', userContext.customerId)
      .single();

    return {
      customerProfile: customer,
      recentOrders: customer.orders?.slice(-5) || [],
      activeSubscriptions: customer.subscriptions?.filter(s => s.status === 'active') || [],
      customerTags: customer.tags || []
    };
  }

  async generateAnswer(question, context) {
    const prompt = this.buildPrompt(question, context);
    
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/meta/llama-2-7b-chat-int8`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant for Nutrition Solutions, a meal delivery company. Use the provided context to answer questions accurately and helpfully.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const result = await response.json();
    return {
      answer: result.result.response,
      confidence: this.calculateConfidence(context),
      sources: this.extractSources(context),
      timestamp: Date.now()
    };
  }
}
```

### Frontend Data Loading Strategy

```jsx
// OptimizedDataProvider.jsx
import React, { createContext, useContext, useEffect, useState } from 'react';

const DataContext = createContext();

export function OptimizedDataProvider({ children }) {
  const [cache, setCache] = useState(new Map());
  const [loading, setLoading] = useState(new Set());
  const [realTimeData, setRealTimeData] = useState({});

  useEffect(() => {
    // Set up real-time subscription for live data
    const eventSource = new EventSource('/api/stream/dashboard');
    
    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data);
      handleRealTimeUpdate(update);
    };

    return () => eventSource.close();
  }, []);

  const fetchData = async (endpoint, options = {}) => {
    const cacheKey = `${endpoint}:${JSON.stringify(options)}`;
    
    // Return cached data if available and fresh
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      const maxAge = getMaxAge(options.dataType);
      
      if (age < maxAge) {
        return cached.data;
      }
    }

    // Prevent duplicate requests
    if (loading.has(cacheKey)) {
      return new Promise((resolve) => {
        const checkCache = () => {
          if (cache.has(cacheKey)) {
            resolve(cache.get(cacheKey).data);
          } else {
            setTimeout(checkCache, 100);
          }
        };
        checkCache();
      });
    }

    setLoading(prev => new Set(prev).add(cacheKey));

    try {
      const response = await fetch(`/api${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      const data = await response.json();
      
      // Cache the result
      setCache(prev => new Map(prev).set(cacheKey, {
        data,
        timestamp: Date.now()
      }));

      return data;
    } finally {
      setLoading(prev => {
        const newSet = new Set(prev);
        newSet.delete(cacheKey);
        return newSet;
      });
    }
  };

  const handleRealTimeUpdate = (update) => {
    // Update real-time data
    setRealTimeData(prev => ({
      ...prev,
      [update.type]: update.data
    }));

    // Invalidate related cache entries
    const cacheKeysToInvalidate = getCacheKeysForUpdate(update.type);
    setCache(prev => {
      const newCache = new Map(prev);
      cacheKeysToInvalidate.forEach(key => {
        for (const [cacheKey] of newCache.entries()) {
          if (cacheKey.includes(key)) {
            newCache.delete(cacheKey);
          }
        }
      });
      return newCache;
    });
  };

  const getMaxAge = (dataType) => {
    const ageMap = {
      'historical': 24 * 60 * 60 * 1000,  // 24 hours
      'recent': 5 * 60 * 1000,            // 5 minutes
      'live': 30 * 1000,                  // 30 seconds
      'analytics': 15 * 60 * 1000         // 15 minutes
    };
    return ageMap[dataType] || 5 * 60 * 1000;
  };

  const getCacheKeysForUpdate = (updateType) => {
    const keyMap = {
      'new-order': ['orders', 'revenue', 'metrics'],
      'subscription-change': ['subscriptions', 'revenue'],
      'customer-update': ['customers', 'analytics']
    };
    return keyMap[updateType] || [];
  };

  return (
    <DataContext.Provider value={{
      fetchData,
      realTimeData,
      isLoading: (endpoint, options = {}) => {
        const cacheKey = `${endpoint}:${JSON.stringify(options)}`;
        return loading.has(cacheKey);
      }
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useOptimizedData = () => useContext(DataContext);
```

### Performance Monitoring

```javascript
// performance-monitor.js
export class PerformanceMonitor {
  constructor(env) {
    this.kv = env.NUTRITION_KV;
    this.analytics = env.ANALYTICS_ENGINE;
  }

  async trackDataRequest(request, response, metadata = {}) {
    const timing = {
      endpoint: request.url,
      method: request.method,
      responseTime: Date.now() - metadata.startTime,
      cacheHit: metadata.cacheHit || false,
      dataSource: metadata.dataSource || 'unknown',
      timestamp: Date.now()
    };

    // Log to analytics
    await this.analytics.writeDataPoint({
      blobs: [JSON.stringify(timing)],
      doubles: [timing.responseTime],
      indexes: [timing.endpoint]
    });

    // Track performance trends
    await this.updatePerformanceMetrics(timing);
  }

  async updatePerformanceMetrics(timing) {
    const key = `perf:${timing.endpoint}:${timing.dataSource}`;
    const existing = await this.kv.get(key, { type: 'json' }) || {
      count: 0,
      totalTime: 0,
      avgTime: 0,
      lastUpdated: Date.now()
    };

    const updated = {
      count: existing.count + 1,
      totalTime: existing.totalTime + timing.responseTime,
      avgTime: (existing.totalTime + timing.responseTime) / (existing.count + 1),
      lastUpdated: Date.now()
    };

    await this.kv.put(key, JSON.stringify(updated), {
      expirationTtl: 24 * 60 * 60 // 24 hours
    });
  }

  async getPerformanceReport() {
    // Generate performance insights
    const keys = await this.kv.list({ prefix: 'perf:' });
    const metrics = await Promise.all(
      keys.keys.map(async (key) => {
        const data = await this.kv.get(key.name, { type: 'json' });
        return { endpoint: key.name, ...data };
      })
    );

    return {
      averageResponseTime: metrics.reduce((sum, m) => sum + m.avgTime, 0) / metrics.length,
      fastestEndpoints: metrics.sort((a, b) => a.avgTime - b.avgTime).slice(0, 5),
      slowestEndpoints: metrics.sort((a, b) => b.avgTime - a.avgTime).slice(0, 5),
      cacheEfficiency: this.calculateCacheEfficiency(metrics)
    };
  }
}
```

---

## IMMEDIATE NEXT STEPS

### This Week's Priority Actions:

1. **Set up Supabase Database**
   - Run the schema SQL above in your Supabase SQL editor
   - Verify all tables are created correctly

2. **Deploy Initial Cloudflare Worker**
   - Create new Worker project
   - Deploy the Keap client and data sync functions
   - Test authentication with your Keap credentials

3. **Run Initial Data Import**
   - Start with contacts sync (smallest dataset)
   - Monitor performance and adjust batch sizes
   - Move to orders once contacts are stable

4. **Create Basic Dashboard**
   - Deploy React frontend with the dashboard components
   - Connect to your Supabase backend
   - Verify real-time data loading

### Success Metrics for Week 1:
- ✅ All historical contacts imported (should be <1 hour)
- ✅ Dashboard loads in under 2 seconds
- ✅ Basic revenue metrics displaying correctly
- ✅ Real-time sync working for new orders

### Cost Impact Immediate:
- **Grow.com**: Cancel immediately after dashboard is live = $3,400/month saved
- **Development**: ~40 hours total implementation time
- **ROI Timeline**: 2-3 weeks to full cost recovery

This foundation gives you immediate wins while setting up the infrastructure for AI customer service and advanced analytics. Each phase builds on the previous one, so you'll see incremental improvements every few days rather than waiting months for results.

Ready to start with the database setup, or do you want me to dive deeper into any specific component first?



## Development Commands

### Core Commands
- `npm run dev` - Start development server at localhost:8787
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run check` - Type check and dry-run deployment validation
- `npm test` - Run tests with Vitest
- `npm run cf-typegen` - Generate Cloudflare types from wrangler config

### Local Development
- Visit `http://localhost:8787` for the main application
- Use `http://localhost:8787/keap-orders.html` for Keap orders management UI

## Architecture Overview

This is a **Cloudflare Workers application** that integrates with the **Keap CRM API** to sync and manage orders in a **D1 database**. The application uses **D1 Sessions API for read replication** to ensure consistency across database operations.

### Key Components

**Core Files:**
- `src/index.ts` - Main Worker entry point with request routing and D1 session management
- `src/keap-client.ts` - Keap API client with Service Account Key authentication  
- `src/keap-sync.ts` - Order synchronization logic between Keap and D1

**Configuration:**
- `wrangler.jsonc` - Cloudflare Workers configuration with D1 binding and environment variables
- `vitest.config.mts` - Test configuration using Cloudflare Workers test pool

### D1 Sessions Pattern

The application implements D1's Sessions API pattern for read replication:
1. Creates a session with a bookmark from the `x-d1-bookmark` header
2. Uses the session for all database operations in a request
3. Returns the updated bookmark in the response header for sequential consistency

### API Endpoints

- `GET /api/orders` - List orders from D1 database (read replica)
- `POST /api/sync-keap-orders` - Sync all orders from Keap to D1 (write to primary)
- `GET /api/keap-orders` - Fetch orders directly from Keap API (with pagination)
- `POST /api/reset` - Drop and recreate Orders table

### Database Schema

Orders table with Keap-specific fields:
- `orderId` (PRIMARY KEY) - Keap order ID
- Customer data: `customerId`, `customerEmail`, `customerName`
- Order data: `title`, `status`, `total`, `orderDate`
- `orderItems` - JSON array of order line items
- `lastSynced` - Timestamp for sync tracking

### Error Handling Patterns

- Uses `durable-utils` Retries for handling transient D1 errors
- Automatic table initialization on "no such table" errors
- Comprehensive error logging with request context
- Graceful API error responses with proper status codes

### Environment Requirements

- `KEAP_SERVICE_ACCOUNT_KEY` - Required for Keap API authentication
- `BASE_URL` - Base URL used by Playwright tests. Defaults to `https://d1-starter-sessions-api.megan-d14.workers.dev` if not set.
- D1 database binding `DB01` configured in wrangler.jsonc

## Testing

Tests use `@cloudflare/vitest-pool-workers` to run in the Workers runtime environment. Test files are in the `test/` directory and follow the pattern `*.spec.ts`.

