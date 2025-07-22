# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keap Resources

- Keap REST API `https://developer.infusionsoft.com/docs/restv2/`
- Keap SDK	`https://github.com/infusionsoft/keap-sdk.git`
- Keap API Sample Code	https://github.com/infusionsoft/API-Sample-Code.git
- Keap Postman Collection	https://documenter.getpostman.com/view/2915979/UVByKWEZ
- Keap Personal Access Token & Service Account Keys	https://developer.infusionsoft.com/pat-and-sak/
- Keap: Making OAuth Requests without User Authorization	https://developer.infusionsoft.com/tutorials/making-oauth-requests-without-user-authorization/

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

