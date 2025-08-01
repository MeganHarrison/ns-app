#!/bin/bash

echo "Testing Dashboard API Endpoints..."
echo "================================="

BASE_URL="http://localhost:51515"

echo -e "\n1. Testing revenue endpoint..."
curl -s "$BASE_URL/api/dashboard/revenue?start=2025-01-01&end=2025-07-30" | jq .

echo -e "\n2. Testing orders endpoint..."
curl -s "$BASE_URL/api/dashboard/orders" | jq .

echo -e "\n3. Testing customers endpoint..."
curl -s "$BASE_URL/api/dashboard/customers?days=7" | jq .

echo -e "\n4. Testing products endpoint..."
curl -s "$BASE_URL/api/dashboard/products" | jq .

echo -e "\n5. Testing subscriptions endpoint..."
curl -s "$BASE_URL/api/dashboard/subscriptions" | jq .

echo -e "\n6. Testing metrics endpoint..."
curl -s "$BASE_URL/api/metrics" | jq .

echo -e "\nDone! Visit http://localhost:51515/dashboard-v2.html to see the dashboard."