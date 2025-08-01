# R2 Image Worker

A Cloudflare Worker that provides secure access to the `mkh-images` R2 bucket for image storage and retrieval.

## Features

- **Image Upload**: Upload images with proper validation
- **Image Download**: Public read access for images
- **Image Deletion**: Authorized deletion of images
- **Image Listing**: List images with pagination and search
- **Security**: Authorization required for write operations
- **CORS Support**: Cross-origin requests supported
- **Content Type Validation**: Only image files allowed

## Supported Image Types

- JPG/JPEG
- PNG
- GIF
- WebP
- SVG
- BMP
- TIFF

## API Endpoints

### GET /
Returns API information and available endpoints.

### PUT /{filename}
Upload an image to the bucket.

**Headers Required:**
- `X-Custom-Auth-Key`: Your secret auth key
- `Content-Type`: image/* (optional, auto-detected)

**Example:**
```bash
curl -X PUT "https://your-worker.dev/my-image.jpg" \
  -H "X-Custom-Auth-Key: YOUR_SECRET_KEY" \
  -H "Content-Type: image/jpeg" \
  --data-binary @image.jpg
```

### GET /{filename}
Download an image from the bucket. Public access.

**Example:**
```bash
curl "https://your-worker.dev/my-image.jpg"
```

### DELETE /{filename}
Delete an image from the bucket.

**Headers Required:**
- `X-Custom-Auth-Key`: Your secret auth key

**Example:**
```bash
curl -X DELETE "https://your-worker.dev/my-image.jpg" \
  -H "X-Custom-Auth-Key: YOUR_SECRET_KEY"
```

### POST /list
List images in the bucket with optional filtering and pagination.

**Headers Required:**
- `X-Custom-Auth-Key`: Your secret auth key

**Body (JSON):**
```json
{
  "prefix": "folder/",
  "limit": 100,
  "cursor": "optional_pagination_cursor"
}
```

**Example:**
```bash
curl -X POST "https://your-worker.dev/list" \
  -H "X-Custom-Auth-Key: YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "limit": 50}'
```

## Security

- **Write Operations**: Require `X-Custom-Auth-Key` header
- **Read Operations**: Public access for valid image files
- **File Type Validation**: Only image files are allowed
- **CORS**: Configured for cross-origin requests

## Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Deploy to Cloudflare:**
   ```bash
   npm run deploy
   ```

## Configuration

The worker is configured to use the `mkh-images` R2 bucket. The binding is set up in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = 'MY_BUCKET'
bucket_name = 'mkh-images'
```

## Environment Variables

- `AUTH_KEY_SECRET`: Secret key for authorization (set via `wrangler secret put`)
- `BUCKET_NAME`: Name of the R2 bucket (mkh-images)
- `MAX_FILE_SIZE`: Maximum file size in bytes (10MB)
- `ALLOWED_ORIGINS`: CORS allowed origins (*)

## Error Handling

The worker includes comprehensive error handling and returns appropriate HTTP status codes:

- `200`: Success
- `400`: Bad request (invalid file type, etc.)
- `403`: Forbidden (missing/invalid auth)
- `404`: Not found
- `405`: Method not allowed
- `500`: Internal server error

All error responses include JSON with error details and timestamps.