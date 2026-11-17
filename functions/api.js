// Pages Functions route: POST /api
// IMPORTANT: Protect the entire Pages application (including /api) with
// Cloudflare Access before connecting real personal finance data.
const ALLOWED_ACTIONS = new Set(["getDashboardData", "simpanLimitConfig", "simpanTagihanRutin", "bayarTagihanRutinSekarang", "toggleTagihanRutin", "hapusTagihanRutin", "tambahWalletBaru", "hapusWallet", "transferAntarWallet", "prosesTransaksi", "simpanTransaksiManual", "editTransaksi", "hapusTransaksi", "analisisKeuanganAI"]);

export async function onRequestPost({ request, env }) {
  const missing = [
    !env.APPS_SCRIPT_URL && 'APPS_SCRIPT_URL',
    !env.CLOUDFLARE_API_SECRET && 'CLOUDFLARE_API_SECRET'
  ].filter(Boolean);
  if (missing.length) {
    return Response.json({
      success: false,
      message: 'Missing server configuration',
      missingVariables: missing,
      deploymentBranch: env.CF_PAGES_BRANCH || 'unknown'
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 6_000_000) return Response.json({ success: false, message: 'Request too large (max 6 MB)' }, { status: 413 });
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  if (!body || !ALLOWED_ACTIONS.has(body.action) || !Array.isArray(body.args) || body.args.length > 3) {
    return Response.json({ success: false, message: 'Action not allowed' }, { status: 400 });
  }
  // Avoid caching personal financial data.
  try {
    const upstream = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ __cloudflareApi: true, secret: env.CLOUDFLARE_API_SECRET, action: body.action, args: body.args }),
      redirect: 'follow'
    });
    if (!upstream.ok) throw new Error('Backend HTTP ' + upstream.status);
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.includes('json') && !contentType.includes('text/plain')) throw new Error('Unexpected backend response');
    const response = await upstream.json();
    return Response.json(response, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (err) {
    console.error('Cloudflare upstream failure', String(err));
    return Response.json({ success: false, message: 'Apps Script tidak merespons. Periksa deployment URL dan izin Web App.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export function onRequestGet() {
  return Response.json({ success: false, message: 'Method not allowed' }, { status: 405 });
}
