# Subscription Pause Integration

## Overview

This document describes the implementation of the subscription pause functionality using Keap's XML-RPC API to modify subscription billing dates.

## Implementation Details

### Endpoint

`POST /api/subscription/pause`

### Request Body

```json
{
  "subscriptionId": "195557",  // Required: Keap subscription ID
  "pauseWeeks": 1,            // Optional: Number of weeks to pause (default: 1)
  "customerId": "customer123", // Optional: Customer ID for tracking
  "reason": "Vacation hold"    // Optional: Reason for pause
}
```

### Response

**Success Response:**
```json
{
  "success": true,
  "message": "Successfully paused subscription for 1 week(s)",
  "data": {
    "subscriptionId": 195557,
    "previousNextBillDate": "2024-01-15T00:00:00.000Z",
    "newNextBillDate": "2024-01-22T00:00:00.000Z",
    "pauseWeeks": 1,
    "customerId": "customer123",
    "reason": "Vacation hold",
    "updatedSubscription": {
      // Full subscription details from XML-RPC
    }
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message",
  "details": "Stack trace",
  "note": "XML-RPC API call failed. Ensure the service account key has proper permissions for the RecurringOrderService."
}
```

## Technical Implementation

### 1. XML-RPC Client (`keap-xmlrpc-client.ts`)

The implementation uses Keap's legacy XML-RPC API which supports direct billing date modifications:

- **Method**: `RecurringOrderService.updateSubscriptionNextBillDate`
- **Authentication**: Service Account Key (same as REST API)
- **Parameters**: 
  - `apiKey`: Service account key
  - `subscriptionId`: Integer subscription ID
  - `nextBillDate`: Date object (formatted to midnight UTC)

### 2. Process Flow

1. Parse request body and validate subscription ID
2. Convert subscription ID to number (XML-RPC requires integer)
3. Create XML-RPC client instance
4. Fetch current subscription details using `getRecurringOrder`
5. Calculate new billing date (current date + pause weeks * 7)
6. Format date to midnight UTC using `formatDateForKeap`
7. Call `updateSubscriptionNextBillDate` with new date
8. Return success response with old and new dates

### 3. Error Handling

- Falls back to REST API for fetching details if XML-RPC fails
- Provides detailed error messages for debugging
- Handles both string and number subscription IDs

## Testing

### Test Script

A test script is provided at `/test-subscription-pause.sh`:

```bash
# Make it executable
chmod +x test-subscription-pause.sh

# Run the test
./test-subscription-pause.sh
```

The script will:
1. Get current subscription details
2. Pause the subscription for 1 week
3. Verify the change
4. Optionally test a 2-week pause

### Manual Testing with cURL

```bash
# Pause subscription for 1 week
curl -X POST https://d1-starter-sessions-api.megan-d14.workers.dev/api/subscription/pause \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "195557",
    "pauseWeeks": 1,
    "reason": "Customer requested pause"
  }'

# Get subscription details
curl https://d1-starter-sessions-api.megan-d14.workers.dev/api/subscription/get?id=195557
```

## Important Notes

1. **XML-RPC vs REST API**: The Keap REST API v2 does not support direct billing date modifications. This implementation uses the legacy XML-RPC API which does support this functionality.

2. **Date Formatting**: Dates are formatted to midnight UTC to match Keap's expectations.

3. **Permissions**: The service account key must have permissions for the `RecurringOrderService` methods.

4. **Subscription ID Type**: The XML-RPC API requires subscription IDs as integers, while the REST API uses strings. The implementation handles both formats.

## Alternative Approaches

If XML-RPC is not suitable, alternatives include:

1. **Credit System**: Add credits to the customer's account equal to the pause period
2. **Cancel and Recreate**: Cancel the subscription and create a new one with the desired start date (current workaround)
3. **Manual Process**: Update dates through Keap's web interface

## Deployment

After making changes:

1. Deploy the worker: `npm run deploy`
2. Test the endpoint using the provided test script
3. Monitor logs for any XML-RPC errors

## Related Files

- `/src/index.ts` - Main worker with pause endpoint
- `/workers/keap-xmlrpc-client.ts` - XML-RPC client implementation
- `/test-subscription-pause.sh` - Test script
- `/public/subscription-pause.html` - Frontend interface (if implemented)