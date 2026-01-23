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
  const targetUrl = `https://breez.tips${url.pathname}${url.search}`;
  
  try {
    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: context.request.method !== 'GET' && context.request.method !== 'HEAD' 
        ? context.request.body 
        : undefined,
    });
    
    // Clone response and add CORS headers
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });
    
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy error', message: error.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
}
