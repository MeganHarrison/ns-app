#\!/bin/bash

# Test subscription pause functionality
echo "Testing subscription pause with XML-RPC..."

# Test fetching subscription details first
echo -e "\n1. Fetching subscription details for ID 195557:"
curl -s "https://d1-starter-sessions-api.megan-d14.workers.dev/api/subscription/debug?id=195557" | jq .

# Test pausing subscription for 7 days
echo -e "\n2. Pausing subscription for 7 days:"
curl -s -X POST "https://d1-starter-sessions-api.megan-d14.workers.dev/api/subscription/pause" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "195557",
    "pauseDays": 7,
    "reason": "Testing XML-RPC pause functionality"
  }' | jq .

# Check updated subscription details
echo -e "\n3. Checking updated subscription details:"
curl -s "https://d1-starter-sessions-api.megan-d14.workers.dev/api/subscription/debug?id=195557" | jq .
EOF < /dev/null