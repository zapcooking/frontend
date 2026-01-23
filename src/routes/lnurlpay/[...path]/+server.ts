/**
 * Proxy LNURL-pay API requests to breez.tips
 * Handles: /lnurlpay/{path} (e.g., /lnurlpay/available/{username}, /lnurlpay/{pubkey}/metadata)
 */

import { json, type RequestHandler } from '@sveltejs/kit';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

export const GET: RequestHandler = async ({ params, url, request }) => {
  const path = params.path || '';
  const targetUrl = `https://breez.tips/lnurlpay/${path}${url.search}`;
  
  console.log(`[LNURL Proxy] Proxying GET /lnurlpay/${path} to ${targetUrl}`);
  
  try {
    // Forward ALL headers from the original request (important for auth)
    const requestHeaders: HeadersInit = {};
    request.headers.forEach((value, key) => {
      // Skip host header (will be set by fetch)
      if (key.toLowerCase() !== 'host') {
        requestHeaders[key] = value;
      }
    });
    
    // Log headers for debugging (but redact sensitive ones)
    const headerLog: Record<string, string> = {};
    Object.entries(requestHeaders).forEach(([key, value]) => {
      if (key.toLowerCase().includes('authorization') || key.toLowerCase().includes('cookie')) {
        headerLog[key] = '[REDACTED]';
      } else {
        headerLog[key] = value as string;
      }
    });
    console.log(`[LNURL Proxy] Request headers:`, JSON.stringify(headerLog));
    
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: requestHeaders,
    });
    
    const responseBody = await response.arrayBuffer();
    
    console.log(`[LNURL Proxy] Response from breez.tips: ${response.status} ${response.statusText}`);
    
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });
    
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error('[LNURL Proxy] Error:', error.message);
    return json(
      { error: 'Proxy error', message: error.message },
      {
        status: 502,
        headers: corsHeaders,
      }
    );
  }
};

export const POST: RequestHandler = async ({ params, url, request }) => {
  const path = params.path || '';
  const targetUrl = `https://breez.tips/lnurlpay/${path}${url.search}`;
  
  console.log(`[LNURL Proxy] Proxying POST /lnurlpay/${path} to ${targetUrl}`);
  
  try {
    const body = await request.arrayBuffer();
    
    // Forward ALL headers from the original request (important for auth)
    const requestHeaders: HeadersInit = {};
    request.headers.forEach((value, key) => {
      // Skip host header (will be set by fetch)
      if (key.toLowerCase() !== 'host') {
        requestHeaders[key] = value;
      }
    });
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: body.byteLength > 0 ? body : undefined,
    });
    
    const responseBody = await response.arrayBuffer();
    
    console.log(`[LNURL Proxy] Response from breez.tips: ${response.status} ${response.statusText}`);
    
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });
    
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error('[LNURL Proxy] Error:', error.message);
    return json(
      { error: 'Proxy error', message: error.message },
      {
        status: 502,
        headers: corsHeaders,
      }
    );
  }
};
