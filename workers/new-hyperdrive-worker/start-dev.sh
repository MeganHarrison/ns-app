#!/bin/bash

echo "🚀 Starting Hyperdrive Worker Development Server"
echo "=============================================="

# Export the connection string directly
export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://postgres.ulyrnuemxucoglbcwzig:mandypupiloveyou2025@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

echo "✅ Connection string loaded"
echo "📡 Starting server on http://localhost:8787"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start wrangler with explicit settings
npx wrangler dev --port 8787 --local true --live-reload true