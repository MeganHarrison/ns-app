# Hyperdrive Worker

A Cloudflare Worker that provides PostgreSQL database access through Hyperdrive.

## Features

- Direct PostgreSQL access via Hyperdrive
- Query execution with parameterized queries
- Table listing and database exploration
- Keap API resource testing

## Endpoints

- `GET /` - Health check
- `GET /test` - Database connection test
- `GET /tables` - List all public tables
- `POST /query` - Execute custom SQL queries
- `GET /keap-resources` - Test Keap API resources

## Setup for Local Development

### Prerequisites

You need a PostgreSQL connection string. You have several options:

1. **Use your Supabase database** (Recommended)
2. Install PostgreSQL locally
3. Use Docker
4. Use a free PostgreSQL service

### Quick Start

1. **Run the setup script:**
   ```bash
   npm run setup
   ```

2. **Create your .env file:**
   ```bash
   cp .env.example .env
   ```

3. **Edit .env and add your PostgreSQL connection string:**
   
   For Supabase (your project: ulyrnuemxucoglbcwzig):
   - Go to https://supabase.com/dashboard/project/ulyrnuemxucoglbcwzig/settings/database
   - Copy the connection string
   - Add it to .env

4. **Run the development server:**
   ```bash
   npm run dev:local
   ```

### Manual Setup

If you prefer to set up manually:

```bash
# Set the environment variable
export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://user:password@host:5432/database"

# Run wrangler dev
npm run dev
```

### Installing PostgreSQL Locally (Optional)

If you want to use a local PostgreSQL instance:

```bash
# Install PostgreSQL
brew install postgresql@16

# Start PostgreSQL
brew services start postgresql@16

# Create a database
createdb hyperdrive_dev

# Use local connection string
export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://localhost:5432/hyperdrive_dev"
```

## Production Deployment

```bash
npm run deploy
```

## Query Examples

### Simple Query
```bash
curl -X POST https://new-hyperdrive-worker.megan-d14.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT NOW() as current_time"}'
```

### Parameterized Query
```bash
curl -X POST https://new-hyperdrive-worker.megan-d14.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT * FROM users WHERE id = $1",
    "params": [123]
  }'
```

## Environment Variables

- `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` - PostgreSQL connection string for local development
- `KEAP_SERVICE_ACCOUNT_KEY` - Keap API service account key

## Troubleshooting

### Error: "When developing locally, you should use a local Postgres connection string"

This means you haven't set up the local connection string. Follow the setup instructions above.

### Can't connect to database

1. Check your connection string is correct
2. Ensure your database is accessible from your network
3. For Supabase, make sure your password is correct

## Contributing

1. Create a feature branch
2. Make your changes
3. Test locally with `npm run dev:local`
4. Submit a pull request