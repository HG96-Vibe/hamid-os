// OAuth 2.1 for the Claude connector: discovery documents, client registration, the code that the sign-in page
// (connect.html) asks for once you've signed in with your password and 2FA code, and the token exchange.
// Public clients only (PKCE with S256), and only Claude's own callback addresses (or this computer, for Claude Code).
'use strict';
const L = require('./_lib');

const SCOPE = 'hamid-os';
const CODE_SECS = 300;
// where Claude may send you back to after signing in
const okRedirect = u => {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:' && ['claude.ai', 'claude.com'].includes(x.hostname) && x.pathname === '/api/mcp/auth_callback') return true;
    if (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname)) return true; // Claude Code on this machine
    return false;
  } catch (e) { return false; }
};
const oauthError = (res, status, error, description) => L.send(res, status, { error, error_description: description });

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204);
  const op = L.queryOf(req).op;
  try {
    // where to find everything (RFC 9728 and RFC 8414)
    if (op === 'resource') return L.send(res, 200, { resource: `${L.ORIGIN}/mcp`, authorization_servers: [L.ORIGIN], bearer_methods_supported: ['header'],
      scopes_supported: [SCOPE], resource_name: 'Hamid OS' });
    if (op === 'meta') return L.send(res, 200, {
      issuer: L.ORIGIN, authorization_endpoint: `${L.ORIGIN}/oauth/authorize`, token_endpoint: `${L.ORIGIN}/oauth/token`,
      registration_endpoint: `${L.ORIGIN}/oauth/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: [SCOPE] });

    if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'Use POST.');
    const body = await L.readBody(req);

    // dynamic client registration (RFC 7591): the client id carries its allowed callback addresses, sealed
    if (op === 'register') {
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      if (!uris.length || !uris.every(okRedirect)) return L.send(res, 400, { error: 'invalid_redirect_uri', error_description: 'Only Claude can connect to Hamid OS.' });
      const name = String(body.client_name || 'Claude').slice(0, 80);
      return L.send(res, 201, { client_id: L.seal({ t: 'client', ru: uris, n: name }), client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name,
        redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE });
    }

    // the sign-in page asks for a code once you've signed in (2FA) and pressed Allow
    if (op === 'code') {
      const client = L.unseal(body.client_id);
      if (!client || client.t !== 'client') return oauthError(res, 400, 'invalid_client', 'Unknown client. Remove the connector in Claude and add it again.');
      if (!client.ru.includes(body.redirect_uri)) return oauthError(res, 400, 'invalid_request', 'That return address isn’t registered.');
      if (body.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(body.code_challenge || ''))) return oauthError(res, 400, 'invalid_request', 'PKCE (S256) is required.');
      // the session must be a full 2FA sign-in
      const s = await L.refreshSession(String(body.refresh_token || ''));
      if (!s) return oauthError(res, 400, 'access_denied', 'Your sign-in has expired. Sign in again.');
      if ((L.jwtPayload(s.access_token) || {}).aal !== 'aal2') return oauthError(res, 403, 'access_denied', 'Two-step sign-in is required.');
      const code = L.seal({ t: 'code', rt: s.refresh_token, cid: body.client_id, ru: body.redirect_uri, ch: body.code_challenge, exp: Date.now() + CODE_SECS * 1000 });
      const back = new URL(body.redirect_uri); back.searchParams.set('code', code); if (body.state) back.searchParams.set('state', body.state);
      return L.send(res, 200, { redirect: back.toString() });
    }

    // token endpoint: code → tokens, and refresh
    if (op === 'token') {
      let rt = null, cid = null;
      if (body.grant_type === 'authorization_code') {
        const c = L.unseal(body.code);
        if (!c || c.t !== 'code' || c.exp < Date.now()) return oauthError(res, 400, 'invalid_grant', 'The code has expired. Try connecting again.');
        if (body.redirect_uri && body.redirect_uri !== c.ru) return oauthError(res, 400, 'invalid_grant', 'Return address mismatch.');
        if (body.client_id && body.client_id !== c.cid) return oauthError(res, 400, 'invalid_grant', 'Client mismatch.');
        if (!body.code_verifier || L.sha256url(String(body.code_verifier)) !== c.ch) return oauthError(res, 400, 'invalid_grant', 'PKCE check failed.');
        rt = c.rt; cid = c.cid;
      } else if (body.grant_type === 'refresh_token') {
        const r = L.unseal(body.refresh_token);
        if (!r || r.t !== 'refresh') return oauthError(res, 400, 'invalid_grant', 'Sign in again.');
        rt = r.rt; cid = r.cid;
      } else return oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
      const s = await L.refreshSession(rt);
      if (!s) return oauthError(res, 400, 'invalid_grant', 'Your Hamid OS session has ended (signed out). Connect again.');
      if ((L.jwtPayload(s.access_token) || {}).aal !== 'aal2') return oauthError(res, 400, 'invalid_grant', 'Two-step sign-in is required.');
      return L.send(res, 200, { access_token: s.access_token, token_type: 'Bearer', expires_in: s.expires_in || 3600,
        refresh_token: L.seal({ t: 'refresh', rt: s.refresh_token, cid }), scope: SCOPE });
    }
    return oauthError(res, 404, 'invalid_request', 'Unknown endpoint.');
  } catch (e) {
    console.error('oauth error', e && e.message);
    return oauthError(res, 500, 'server_error', 'Something went wrong. Try again.');
  }
};
