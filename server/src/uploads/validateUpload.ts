import { createRequire } from 'node:module';
// jsdom + dompurify sont en CommonJS : on les require via createRequire
// pour rester compatible avec le mode ESM du projet.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { JSDOM } = require('jsdom') as { JSDOM: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createDOMPurify = (require('dompurify') as { default: any }).default ?? require('dompurify');

// ─── Types ────────────────────────────────────────────────────────────────
export type AllowedMime = 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'application/pdf';

const ALLOWED_MIMES: ReadonlySet<string> = new Set<AllowedMime>([
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'application/pdf',
]);

export function isAllowedMime(mime: string | null): mime is AllowedMime {
  return mime !== null && ALLOWED_MIMES.has(mime);
}

// ─── Magic-byte detection ─────────────────────────────────────────────────
/**
 * Détecte le MIME type réel du buffer via signature magic-bytes.
 * Retourne null si le type n'est pas dans la liste autorisée ou non reconnu.
 */
export function detectMimeFromBytes(buf: Buffer): AllowedMime | null {
  if (buf.length < 4) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return 'image/png';
  }

  // PDF: 25 50 44 46 ("%PDF")
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'application/pdf';
  }

  // SVG: starts with "<svg" or "<?xml" (after optional BOM / whitespace)
  const head = buf.slice(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    // Extra guard: must contain "<svg" somewhere in the first 512 chars.
    if (head.includes('<svg')) {
      return 'image/svg+xml';
    }
  }

  return null;
}

// ─── SVG sanitization ─────────────────────────────────────────────────────
// DOMPurify instance tied to a jsdom window so it can run in Node.
let _purify: ReturnType<typeof createDOMPurify> | null = null;
function getPurify() {
  if (!_purify) {
    const window = new JSDOM('').window;
    _purify = createDOMPurify(window);
    // Configure: strip script, foreignObject, on* attrs.
    _purify.setConfig({
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
      FORBID_ATTR: [], // on* attrs are blocked by default in SVG profile
    });
  }
  return _purify;
}

/**
 * Nettoie un SVG textuel : supprime <script>, <foreignObject>, attributs on*.
 * Retourne la string sanitisée. Ne lance jamais d'exception.
 */
export function sanitizeSvg(svgString: string): string {
  try {
    const purify = getPurify();
    // DOMPurify with SVG profile also removes on* event handlers.
    const cleaned = purify.sanitize(svgString, {
      USE_PROFILES: { svg: true, svgFilters: true },
    }) as string;
    return cleaned;
  } catch {
    // Si la sanitisation plante (SVG malformé), on retourne un SVG vide inoffensif.
    return '<svg xmlns="http://www.w3.org/2000/svg"/>';
  }
}
