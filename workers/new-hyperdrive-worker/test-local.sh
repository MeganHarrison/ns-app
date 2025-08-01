#!/bin/bash

echo "🧪 Testing Hyperdrive Local Development"
echo "======================================"
echo ""

# Test health check
echo "1. Testing health check..."
curl -s http://localhost:8787/ || echo "❌ Server not running. Start with: npm run dev:local"
echo ""

# Test database connection
echo "2. Testing database connection..."
curl -s http://localhost:8787/test | jq . || echo "❌ Failed to connect to database"
echo ""

# Test table listing
echo "3. Listing tables..."
curl -s http://localhost:8787/tables | jq '.tables[] | .table_name' || echo "❌ Failed to list tables"
echo ""

# Test query execution
echo "4. Testing query execution..."
curl -s -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT COUNT(*) as count FROM subscriptions"}' | jq . || echo "❌ Failed to execute query"
echo ""

echo "✅ If you see results above, your local development is working!"
echo "❌ If you see errors, make sure the dev server is running: npm run dev:local"