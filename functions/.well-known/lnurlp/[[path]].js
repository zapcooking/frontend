const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const url = new URL(context.request.url);
  // Preserve the full path including /.well-known/lnurlp prefix
  const targetUrl = `https://breez.tips${url.pathname}${url.search}`;
  
  // Debug logging (visible in Cloudflare dashboard)
  console.log(`[LNURL Proxy] Proxying ${context.request.method} ${url.pathname} to ${targetUrl}`);
  
  try {
    // Forward all headers from the original request (important for auth)
    const requestHeaders = new Headers(context.request.headers);
    // Remove host header (will be set by fetch)
    requestHeaders.delete('host');
    
    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers: requestHeaders,
      body: context.request.method !== 'GET' && context.request.method !== 'HEAD' 
        ? await context.request.clone().arrayBuffer().then(buf => buf.byteLength > 0 ? buf : undefined)
        : undefined,
    });
    
    // Get response body
    const responseBody = await response.arrayBuffer();
    
    // Log response for debugging
    console.log(`[LNURL Proxy] Response from breez.tips: ${response.status} ${response.statusText}`);
    
    // Clone response headers and add CORS
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });
    
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[LNURL Proxy] Error:', error.message);
    return new Response(JSON.stringify({ error: 'Proxy error', message: error.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
}
