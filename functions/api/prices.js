/**
 * /api/prices — serve cached price data from Cloudflare KV
 *
 * Written by GitHub Actions price-sync cron (every 15min during IST market hours).
 * Clients call this endpoint to pre-populate window._mktPrices without waiting
 * for live Yahoo Finance fetches — works even when the browser tab was closed.
 */

export async function onRequest(context) {
  const { env } = context;
  const kv = env.STOCKSENSE_KV;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured', ts: 0, prices: {} }), {
      status: 503,
      headers: corsHeaders,
    });
  }

  try {
    const raw = await kv.get('priceCache');
    if (!raw) {
      return new Response(JSON.stringify({ ts: 0, prices: {} }), {
        headers: { ...corsHeaders, 'Cache-Control': 'no-cache' },
      });
    }
    return new Response(raw, {
      headers: {
        ...corsHeaders,
        // Cache for 60s at the CDN edge; stale-while-revalidate so the client
        // never waits even if the cache is slightly old
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ts: 0, prices: {} }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
