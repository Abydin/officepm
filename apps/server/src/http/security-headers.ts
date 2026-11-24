import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { GOATCOUNTER_CODE_PATTERN } from '../config.js';

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
 * Nothing may frame the app, and nothing loads from another origin, unless a GoatCounter
 * site code is given (GOATCOUNTER_CODE): then, and only then, its script host is allowed
 * in script-src and its counting endpoint in img-src and connect-src.
 */
export function buildCsp(indexHtml: string, goatCounterCode = ''): string {
  const counter = goatCounterCode ? goatCounterHosts(goatCounterCode) : null;
  return [
    "default-src 'self'",
    [
      "script-src 'self'",
      ...inlineScriptHashes(indexHtml),
      ...(counter ? [counter.script] : []),
    ].join(' '),
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data:", ...(counter ? [counter.endpoint] : [])].join(' '),
    "font-src 'self'",
    ["connect-src 'self'", ...(counter ? [counter.endpoint] : [])].join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The two hosts GoatCounter needs. Scheme-less, so they follow the page's own scheme. */
function goatCounterHosts(code: string): { script: string; endpoint: string } {
  assertGoatCounterCode(code);
  return { script: 'gc.zgo.at', endpoint: code + '.goatcounter.com' };
}

function assertGoatCounterCode(code: string): void {
  if (!GOATCOUNTER_CODE_PATTERN.test(code)) {
    throw new Error('GOATCOUNTER_CODE may only contain letters, digits and hyphens.');
  }
}

/**
 * index.html with the GoatCounter counting script added before </head>. The code is checked
 * against a strict pattern first, so it cannot carry markup into the page.
 */
export function injectGoatCounter(html: string, code: string): string {
  assertGoatCounterCode(code);
  const tag = `<script data-goatcounter="https://${code}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => tag + '\n  </head>') : html + tag;
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
