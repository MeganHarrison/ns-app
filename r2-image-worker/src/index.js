// R2 Image Worker - Manages images in mkh-images bucket
// Includes CRUD operations with proper authorization

// List of allowed image extensions
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff'];

// Check requests for a pre-shared secret
const hasValidHeader = (request, env) => {
  return request.headers.get("X-Custom-Auth-Key") === env.AUTH_KEY_SECRET;
};

// Check if file extension is allowed
const isAllowedFileType = (filename) => {
  const extension = filename.split('.').pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.includes(extension);
};

// Authorize requests based on method and file type
function authorizeRequest(request, env, key) {
  switch (request.method) {
    case "PUT":
    case "DELETE":
      // Require auth header for write operations
      return hasValidHeader(request, env) && isAllowedFileType(key);
    case "GET":
      // Allow public read access for images
      return isAllowedFileType(key);
    case "POST":
      // POST for listing/searching - require auth
      return hasValidHeader(request, env);
    default:
      return false;
  }
}

// Get content type based on file extension
function getContentType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase();
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'tiff': 'image/tiff'
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1); // Remove leading slash

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Custom-Auth-Key',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      switch (request.method) {
        case "PUT":
          // Upload image to R2
          if (!authorizeRequest(request, env, key)) {
            return new Response("Forbidden: Invalid auth or file type", { 
              status: 403,
              headers: corsHeaders
            });
          }

          // Validate content type from request
          const contentType = request.headers.get('Content-Type');
          if (contentType && !contentType.startsWith('image/')) {
            return new Response("Invalid content type. Only images allowed.", {
              status: 400,
              headers: corsHeaders
            });
          }

          const uploadMetadata = {
            uploadedAt: new Date().toISOString(),
            contentType: getContentType(key),
            size: request.headers.get('Content-Length')
          };

          await env.MY_BUCKET.put(key, request.body, {
            httpMetadata: {
              contentType: getContentType(key)
            },
            customMetadata: uploadMetadata
          });

          return new Response(JSON.stringify({
            success: true,
            message: `Successfully uploaded ${key}`,
            url: `${url.origin}/${key}`,
            metadata: uploadMetadata
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        case "GET":
          // Download image from R2
          if (!key) {
            // Return API info for root path
            return new Response(JSON.stringify({
              service: "R2 Image Worker",
              version: "1.0.0",
              bucket: "mkh-images",
              allowedTypes: ALLOWED_EXTENSIONS,
              endpoints: {
                upload: "PUT /{filename}",
                download: "GET /{filename}",
                delete: "DELETE /{filename}",
                list: "POST /list"
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          if (!authorizeRequest(request, env, key)) {
            return new Response("Forbidden: Invalid file type", { 
              status: 403,
              headers: corsHeaders
            });
          }

          const object = await env.MY_BUCKET.get(key);

          if (object === null) {
            return new Response("Image not found", { 
              status: 404,
              headers: corsHeaders
            });
          }

          const headers = new Headers(corsHeaders);
          object.writeHttpMetadata(headers);
          headers.set("etag", object.httpEtag);
          headers.set("cache-control", "public, max-age=31536000"); // Cache for 1 year

          return new Response(object.body, { headers });

        case "DELETE":
          // Delete image from R2
          if (!authorizeRequest(request, env, key)) {
            return new Response("Forbidden", { 
              status: 403,
              headers: corsHeaders
            });
          }

          // Check if object exists before deleting
          const existingObject = await env.MY_BUCKET.get(key);
          if (existingObject === null) {
            return new Response("Image not found", { 
              status: 404,
              headers: corsHeaders
            });
          }

          await env.MY_BUCKET.delete(key);
          
          return new Response(JSON.stringify({
            success: true,
            message: `Successfully deleted ${key}`
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        case "POST":
          // List images or search functionality
          if (!authorizeRequest(request, env, key)) {
            return new Response("Forbidden", { 
              status: 403,
              headers: corsHeaders
            });
          }

          const path = url.pathname;
          
          if (path === '/list') {
            // List images with pagination
            const listParams = await request.json().catch(() => ({}));
            const prefix = listParams.prefix || '';
            const limit = Math.min(listParams.limit || 100, 1000);
            const cursor = listParams.cursor;

            const listOptions = {
              prefix,
              limit,
              ...(cursor && { cursor })
            };

            const listing = await env.MY_BUCKET.list(listOptions);
            
            const images = listing.objects
              .filter(obj => isAllowedFileType(obj.key))
              .map(obj => ({
                key: obj.key,
                size: obj.size,
                uploaded: obj.uploaded,
                url: `${url.origin}/${obj.key}`,
                etag: obj.etag
              }));

            return new Response(JSON.stringify({
              success: true,
              images,
              truncated: listing.truncated,
              cursor: listing.cursor,
              total: images.length
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          return new Response("Invalid POST endpoint", { 
            status: 400,
            headers: corsHeaders
          });

        default:
          return new Response("Method Not Allowed", {
            status: 405,
            headers: {
              ...corsHeaders,
              "Allow": "GET, PUT, DELETE, POST, OPTIONS",
            },
          });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};