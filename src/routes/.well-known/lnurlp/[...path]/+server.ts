/**
 * Proxy LNURL-pay discovery requests to breez.tips
 * Handles: /.well-known/lnurlp/{username}
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

export const GET: RequestHandler = async ({ params, url }) => {
  const path = params.path || '';
  const targetUrl = `https://breez.tips/.well-known/lnurlp/${path}${url.search}`;
  
  console.log(`[LNURL Proxy] Proxying GET /.well-known/lnurlp/${path} to ${targetUrl}`);
  
  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
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
  const targetUrl = `https://breez.tips/.well-known/lnurlp/${path}${url.search}`;
  
  console.log(`[LNURL Proxy] Proxying POST /.well-known/lnurlp/${path} to ${targetUrl}`);
  
  try {
    const body = await request.arrayBuffer();
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/json',
        'Accept': 'application/json',
      },
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
