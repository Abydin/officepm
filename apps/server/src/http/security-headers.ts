import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MiddlewareHandler } from 'hono';

/**
 * SHA-256 source expressions for the inline classic scripts of an HTML document,
 * so the CSP can allow exactly the scripts the page ships (the built client has
 * one, which applies the saved theme before first paint) and nothing injected.
 * Module scripts with a src are covered by 'self'.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1] ?? '')) continue;
    const digest = crypto
      .createHash('sha256')
      .update(m[2] ?? '')
      .digest('base64');
    hashes.push("'sha256-" + digest + "'");
  }
  return hashes;
}

/**
 * Content-Security-Policy for the built SPA. Scripts are same-origin files plus
 * the hashed inline script; styles allow inline because React, Radix and dnd-kit
 * set style attributes at runtime (style-src-attr), which no nonce can cover.
 * Nothing may frame the app, and nothing loads from another origin.
 */
export function buildCsp(indexHtml: string): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inlineScriptHashes(indexHtml)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Reads index.html once at startup. A missing client just means no script hashes. */
export function readIndexHtml(webDir: string): string {
  try {
    return fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  } catch {
    return '';
  }
}

/** Sets the defensive headers on every response, errors and static files included. */
export function securityHeaders(csp: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('content-security-policy', csp);
    h.set('x-content-type-options', 'nosniff');
    h.set('x-frame-options', 'DENY');
    h.set('referrer-policy', 'no-referrer');
    h.set('cross-origin-opener-policy', 'same-origin');
    h.set('cross-origin-resource-policy', 'same-origin');
    h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // TLS terminates at a local proxy, so the forwarded header is the signal.
    if (c.req.header('x-forwarded-proto') === 'https') {
      h.set('strict-transport-security', 'max-age=15552000');
    }
    // Authenticated JSON is never stored by a shared cache or the back button.
    if (c.req.path.startsWith('/api/') && !h.has('cache-control')) {
      h.set('cache-control', 'no-store');
    }
  };
}
