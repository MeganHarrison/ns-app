#!/bin/bash

# Development script for Hyperdrive worker with local PostgreSQL connection

echo "🚀 Starting Hyperdrive Worker in development mode..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your PostgreSQL connection string"
    exit 1
fi

# Load environment variables from .env
export $(cat .env | grep -v '^#' | xargs)

# Check if connection string is set
if [ -z "$WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE" ]; then
    echo "❌ Error: WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE not set!"
    echo "Please add your PostgreSQL connection string to .env file"
    exit 1
fi

echo "✅ Using local connection string: ${WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:0:30}..."

# Start wrangler dev
npx wrangler dev