// Cloudflare Pages Functions: safe upstream diagnostics for /api
const ALLOWED_ACTIONS = new Set([
  'getDashboardData', 'simpanLimitConfig', 'simpanTagihanRutin',
  'bayarTagihanRutinSekarang', 'toggleTagihanRutin', 'hapusTagihanRutin',
  'tambahWalletBaru', 'hapusWallet', 'transferAntarWallet',
  'prosesTransaksi', 'simpanTransaksiManual', 'editTransaksi',
  'hapusTransaksi', 'analisisKeuanganAI'
]);
const json = (obj, status = 200) => Response.json(obj, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

export function onRequestGet() {
  return json({ success: false, message: 'Method not allowed', version: 'diagnostic-502-v3' }, 405);
}

export async function onRequestPost({ request, env }) {
  const missing = [
    !env.APPS_SCRIPT_URL && 'APPS_SCRIPT_URL',
    !env.CLOUDFLARE_API_SECRET && 'CLOUDFLARE_API_SECRET'
  ].filter(Boolean);
  if (missing.length) return json({ success: false, diagnostic: 'MISSING_CONFIG', missingVariables: missing }, 503);

  let url;
  try { url = new URL(env.APPS_SCRIPT_URL); }
  catch { return json({ success: false, diagnostic: 'INVALID_URL', message: 'APPS_SCRIPT_URL bukan URL valid' }, 503); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !url.pathname.endsWith('/exec')) {
    return json({ success: false, diagnostic: 'INVALID_URL', message: 'Gunakan URL https://script.google.com/macros/s/.../exec' }, 503);
  }
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 6_000_000) return json({ success: false, diagnostic: 'REQUEST_TOO_LARGE' }, 413);
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, diagnostic: 'INVALID_REQUEST_JSON' }, 400); }
  if (!body || !ALLOWED_ACTIONS.has(body.action) || !Array.isArray(body.args) || body.args.length > 3) {
    return json({ success: false, diagnostic: 'ACTION_NOT_ALLOWED' }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        __cloudflareApi: true,
        secret: env.CLOUDFLARE_API_SECRET,
        action: body.action,
        args: body.args
      }),
      redirect: 'follow'
    });
  } catch (err) {
    console.error('Backend network error', String(err));
    return json({ success: false, diagnostic: 'NETWORK_FAILURE', message: 'Koneksi ke Apps Script gagal sebelum respons HTTP' }, 502);
  }

  const status = upstream.status;
  const finalHost = (() => { try { return new URL(upstream.url).hostname; } catch { return 'unknown'; } })();
  const contentType = (upstream.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const metadata = { upstreamStatus: status, finalHost, contentType };
  // Never return URL, headers, HTML bodies or response snippets: can contain private info.
  if (!upstream.ok) {
    console.error('Backend returned non-2xx', metadata);
    return json({ success: false, diagnostic: 'UPSTREAM_HTTP_ERROR', ...metadata }, 502);
  }
  let result;
  try { result = await upstream.json(); }
  catch {
    console.error('Backend non-JSON response', metadata);
    return json({ success: false, diagnostic: 'UPSTREAM_NOT_JSON', ...metadata }, 502);
  }
  if (typeof result !== 'object' || result === null) {
    return json({ success: false, diagnostic: 'UNEXPECTED_RESPONSE_TYPE' }, 502);
  }
  return json(result);
}
