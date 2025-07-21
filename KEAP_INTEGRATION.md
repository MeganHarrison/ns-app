# Keap Orders Integration

This project integrates with Keap's REST API to sync order data into a Cloudflare D1 database.

## Setup

The integration uses a Keap Service Account Key for authentication, which is configured in `wrangler.jsonc`:

```json
"vars": {
  "KEAP_SERVICE_ACCOUNT_KEY": "your-service-account-key"
}
```

## API Endpoints

### POST /api/sync-keap-orders
Syncs all orders from your Keap account to the D1 database.

**Response:**
```json
{
  "syncResult": {
    "totalOrders": 100,
    "syncedOrders": 100,
    "errors": []
  }
}
```

### GET /api/orders
Lists all orders stored in the D1 database.

### POST /api/reset
Clears all orders from the database and recreates the table.

## Database Schema

The Orders table stores:
- `orderId` - Keap order ID (primary key)
- `customerId` - Customer ID from Keap
- `customerEmail` - Customer email
- `customerName` - Customer full name
- `title` - Order title
- `status` - Order status
- `total` - Order total amount
- `orderDate` - Order date
- `orderItems` - JSON array of order items
- `lastSynced` - Timestamp of last sync

## Implementation Details

- `src/keap-client.ts` - Keap API client with Service Account Key authentication
- `src/keap-sync.ts` - Sync logic that fetches orders from Keap and upserts to D1
- `src/index.ts` - Worker endpoints and D1 session management

The integration uses D1's session API for read replication and consistency.