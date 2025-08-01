#!/bin/bash

# Script to create Supabase subscriptions table via Hyperdrive worker

echo "Creating Supabase subscriptions table..."

# Read the SQL file
SQL_CONTENT=$(cat supabase-subscriptions-schema.sql)

# Escape the SQL for JSON
ESCAPED_SQL=$(echo "$SQL_CONTENT" | jq -Rs .)

# Execute via Hyperdrive worker
curl -X POST https://new-hyperdrive-worker.megan-d14.workers.dev/query \
  -H "Content-Type: application/json" \
  -d "{\"query\": $ESCAPED_SQL}" \
  | jq .

echo "Done!"