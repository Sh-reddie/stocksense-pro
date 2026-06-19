/**
 * StockSense Pro — GET /api/me
 * Returns the authenticated user's identity from the Cloudflare Access JWT.
 *
 * Cloudflare Access sets the following headers on every authenticated request:
 *   cf-access-authenticated-user-email  — verified user email
 *   cf-access-jwt-assertion             — signed JWT with name, sub, etc.
 *
 * No manual token verification needed — Cloudflare already verified the JWT
 * at the edge before the request reaches this function.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ request }) {
  const email = request.headers.get('cf-access-authenticated-user-email');

  if (!email) {
    // Access not configured, or running locally — return guest mode
    return Response.json(
      { ok: false, authenticated: false, error: 'Cloudflare Access not active on this domain.' },
      { status: 401, headers: CORS }
    );
  }

  // Decode JWT payload to get display name (no sig verification — CF handles that)
  let name = email.split('@')[0];
  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (jwt) {
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1]));
      if (payload.name) name = payload.name;
      else if (payload.given_name) name = payload.given_name;
    } catch { /* ignore decode errors */ }
  }

  return Response.json(
    { ok: true, authenticated: true, email, name },
    { headers: CORS }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
