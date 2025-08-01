#!/bin/bash

echo "Testing R2 Image Worker"
echo "======================"
echo ""

# Set the worker URL
WORKER_URL="https://r2-image-worker.megan-d14.workers.dev"
AUTH_KEY="your-secret-key-here"  # Replace with your actual auth key

echo "Worker URL: $WORKER_URL"
echo ""

# Test 1: Get API info
echo "1. Testing API info endpoint..."
curl -s "$WORKER_URL/" | jq .
echo ""

# Test 2: List images (requires auth)
echo "2. Testing image listing..."
curl -s -X POST "$WORKER_URL/list" \
  -H "X-Custom-Auth-Key: $AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}' | jq .
echo ""

# Test 3: Try to access a non-existent image
echo "3. Testing non-existent image access..."
curl -s "$WORKER_URL/non-existent.jpg" | head -20
echo ""

# Test 4: Try unauthorized upload
echo "4. Testing unauthorized upload..."
curl -s -X PUT "$WORKER_URL/test.jpg" \
  -H "Content-Type: image/jpeg" \
  --data-binary "fake image data" | jq .
echo ""

# Test 5: Test with wrong file extension
echo "5. Testing invalid file type..."
curl -s -X PUT "$WORKER_URL/test.txt" \
  -H "X-Custom-Auth-Key: $AUTH_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "some text" | jq .
echo ""

echo "Test complete!"
echo ""
echo "To test file upload with actual auth key:"
echo "curl -X PUT \"$WORKER_URL/my-image.jpg\" \\"
echo "  -H \"X-Custom-Auth-Key: YOUR_ACTUAL_SECRET\" \\"
echo "  -H \"Content-Type: image/jpeg\" \\"
echo "  --data-binary @your-image.jpg"