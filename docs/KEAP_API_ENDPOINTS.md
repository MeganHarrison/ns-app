# Keap API Endpoints and Resources

This document provides a comprehensive list of all Keap API endpoints and resources found in the Nutrition Solutions codebase.

## Base URLs

### REST API v2
- Base URL: `https://api.infusionsoft.com/crm/rest/v2`
- Authentication: Service Account Key via `X-Keap-API-Key` header

### REST API v1  
- Base URL: `https://api.infusionsoft.com/crm/rest/v1`
- Authentication: OAuth2 Bearer token or Service Account Key

### XML-RPC API
- Base URL: `https://api.infusionsoft.com/crm/xmlrpc/v1`
- Authentication: API Key passed as first parameter

## REST API v2 Endpoints (from keap-client.ts)

### Orders
- `GET /orders` - List orders with pagination
  - Query params: `limit`, `offset`, `order`, `order_direction`, `since`, `until`
- `GET /orders/{orderId}` - Get single order (implied)

### Contacts
- `GET /contacts` - List contacts with pagination  
  - Query params: `limit`, `offset`
- `GET /contacts/{contactId}` - Get single contact (implied)

### Products
- `GET /products` - List products with pagination
  - Query params: `limit`, `offset`
- `GET /products/{productId}` - Get single product (implied)

### Subscriptions
- `GET /subscriptions` - List subscriptions with pagination
  - Query params: `limit`, `offset`
- `GET /subscriptions/{subscriptionId}` - Get single subscription
- `PUT /subscriptions/{subscriptionId}` - Update subscription (attempted)
- `PATCH /subscriptions/{subscriptionId}` - Update subscription (fallback)

### Transactions
- `POST /transactions` - Create transaction (credits/debits)
  - Body: `contact_id`, `amount`, `type`, `description`, `date`

## XML-RPC API Methods (from keap-xmlrpc-client.ts)

### RecurringOrderService
- `RecurringOrderService.updateSubscriptionNextBillDate` - Update next billing date
  - Params: `apiKey`, `subscriptionId`, `nextBillDate`
- `RecurringOrderService.getRecurringOrder` - Get subscription details
  - Params: `apiKey`, `recurringOrderId`
- `RecurringOrderService.updateSubscriptionPauseResume` - Pause subscription
  - Params: `apiKey`, `subscriptionId`, `pauseUntilDate`

## Internal Application Endpoints (from src/index.ts)

### Sync Endpoints
- `POST /api/sync-orders` - Sync orders from Keap to D1 database
- `POST /api/sync/contacts` - Sync contacts (TODO - not implemented)
- `POST /api/sync/products` - Sync products (TODO - not implemented) 
- `POST /api/sync/subscriptions` - Sync subscriptions (TODO - not implemented)
- `POST /api/sync/all` - Sync all data types (TODO - not implemented)

### Data Endpoints
- `GET /api/orders` - Get orders from local D1 database
- `GET /api/orders/date-range` - Get date range of orders in database
- `GET /api/keap-orders` - Fetch orders directly from Keap API

### Analytics Endpoints
- `GET /api/metrics` - Get basic analytics metrics
- `GET /api/dashboard` - Get dashboard data
- `GET /api/products` - Get top products analytics

### Subscription Management
- `POST /api/subscription/pause` - Pause a subscription
- `POST /api/subscription/resume` - Resume a subscription  
- `POST /webhook/subscription-pause` - Webhook handler for subscription pause

### Database Management
- `POST /api/reset` - Drop and recreate orders table
- `POST /api/migrate` - Run database migrations
- `GET /api/tables` - List database tables

## Data Models

### KeapOrder
```typescript
{
  id: string;
  title: string;
  status: string;
  total: {
    amount: number;
    currency_code: string;
    formatted_amount: string;
  };
  order_time: string;
  creation_time: string;
  contact: {
    id: string;
    email: string;
    given_name: string;
    family_name: string;
  };
  order_items: Array<{
    id: string;
    name: string;
    quantity: number;
    price: {
      amount: number;
      currency_code: string;
      formatted_amount: string;
    };
    product: {
      id: string;
      name: string;
      description: string;
    };
  }>;
}
```

### KeapContact
```typescript
{
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  phone_number?: string;
  tag_ids?: number[];
  custom_fields?: Record<string, any>;
  date_created: string;
  last_updated: string;
  lifecycle_stage?: string;
}
```

### KeapProduct
```typescript
{
  id: string;
  name: string;
  description?: string;
  price: number;
  sku?: string;
  active: boolean;
  product_category?: string;
}
```

### KeapSubscription
```typescript
{
  id: string;
  contact_id: string;
  product_id: string;
  status: string;
  billing_amount: number;
  billing_cycle: string;
  start_date: string;
  next_bill_date?: string;
  end_date?: string;
}
```

## Keap API Resources (Not Yet Implemented)

Based on standard Keap REST API v2 documentation, these endpoints are available but not yet implemented in the codebase:

### Additional REST API v2 Resources
- `/affiliates` - Affiliate management
- `/appointments` - Appointment scheduling
- `/campaigns` - Marketing campaigns
- `/companies` - Company records
- `/emails` - Email records
- `/files` - File management
- `/hooks` - Webhooks configuration
- `/locales` - Localization settings
- `/merchants` - Payment processing
- `/notes` - Contact notes
- `/opportunities` - Sales opportunities
- `/settings` - Account settings
- `/tags` - Tag management
- `/tasks` - Task management
- `/users` - User management

### Additional XML-RPC Services
- `ContactService` - Contact management
- `DataService` - Data operations
- `InvoiceService` - Invoice management
- `OrderService` - Order management

## Authentication Methods

1. **Service Account Key** (REST API v2)
   - Header: `X-Keap-API-Key: {serviceAccountKey}`
   - Used in: `keap-client.ts`

2. **OAuth2 Bearer Token** (REST API v1)
   - Header: `Authorization: Bearer {accessToken}`
   - Token endpoint: `https://api.infusionsoft.com/token`
   - Used in: `CLAUDE.md` examples

3. **API Key** (XML-RPC)
   - Passed as first parameter in method calls
   - Used in: `keap-xmlrpc-client.ts`

## Notes

- The codebase primarily uses REST API v2 with Service Account Key authentication
- XML-RPC API is only used for subscription billing date modifications (not supported in REST API)
- Many standard Keap API resources are not yet implemented but are available for future use
- The application uses a local D1 database to cache Keap data for improved performance