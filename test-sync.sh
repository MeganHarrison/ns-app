#!/bin/bash

echo "Testing Keap to Supabase Order Sync"
echo "==================================="
echo ""

# Base URL - use local or production
if [ "$1" == "prod" ]; then
    BASE_URL="https://d1-starter-sessions-api.megan-d14.workers.dev"
else
    BASE_URL="http://localhost:8787"
fi

echo "Using base URL: $BASE_URL"
echo ""

# Test 1: Sync recent orders (last 90 days)
echo "1. Testing recent orders sync..."
curl -s -X GET "$BASE_URL/api/sync-orders" | jq .

echo ""
echo "2. Testing all orders sync (requires auth)..."
# Replace with your actual auth token
AUTH_TOKEN="${WORKER_AUTH_TOKEN:-GqmS3WJHA69Prddovzvrjmpf_IZ1kfkFrS9SrNIz}"

curl -s -X GET "$BASE_URL/api/sync/all-orders" \
  -H "Authorization: Bearer $AUTH_TOKEN" | jq .

echo ""
echo "3. Testing webhook endpoint..."
# Simulate a webhook for a new order
curl -s -X POST "$BASE_URL/api/webhooks/keap" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "order.add",
    "object_key": "123456",
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
  }' | jq .

echo ""
echo "Sync test complete!"