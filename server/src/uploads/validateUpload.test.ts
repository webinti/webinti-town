import { describe, it, expect } from 'vitest';
import { detectMimeFromBytes, sanitizeSvg } from './validateUpload.js';

// ─── Magic-bytes helpers ───────────────────────────────────────────────────
function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/\s/g, ''), 'hex');
}

// JPEG: FF D8 FF E0 + padding
const JPEG_BYTES = hexToBuffer('FFD8FFE0' + '00'.repeat(16));
// PNG: 89 50 4E 47 0D 0A 1A 0A + padding
const PNG_BYTES  = hexToBuffer('89504E470D0A1A0A' + '00'.repeat(8));
// PDF: 25 50 44 46 (= %PDF) + padding
const PDF_BYTES  = hexToBuffer('25504446' + '00'.repeat(12));
// SVG: starts with <svg
const SVG_BYTES  = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
// SVG: starts with XML declaration
const SVG_XML_BYTES = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
// EXE disguised as PNG (MZ header)
const EXE_AS_PNG = hexToBuffer('4D5A9000' + '00'.repeat(12));

describe('detectMimeFromBytes', () => {
  it('detects JPEG by FF D8 FF', () => {
    expect(detectMimeFromBytes(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('detects PNG by 89 50 4E 47', () => {
    expect(detectMimeFromBytes(PNG_BYTES)).toBe('image/png');
  });

  it('detects PDF by %PDF', () => {
    expect(detectMimeFromBytes(PDF_BYTES)).toBe('application/pdf');
  });

  it('detects SVG by <svg', () => {
    expect(detectMimeFromBytes(SVG_BYTES)).toBe('image/svg+xml');
  });

  it('detects SVG with leading XML declaration', () => {
    expect(detectMimeFromBytes(SVG_XML_BYTES)).toBe('image/svg+xml');
  });

  it('returns null for .exe renamed .png (MZ header)', () => {
    expect(detectMimeFromBytes(EXE_AS_PNG)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(detectMimeFromBytes(Buffer.alloc(0))).toBeNull();
  });
});

// ─── SVG sanitization ──────────────────────────────────────────────────────
describe('sanitizeSvg', () => {
  it('strips <script> tags', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>';
    const out = sanitizeSvg(input);
    expect(out).not.toContain('<script');
    expect(out).toContain('<rect');
  });

  it('strips <foreignObject> tags', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>evil</div></foreignObject></svg>';
    const out = sanitizeSvg(input);
    expect(out).not.toContain('foreignObject');
  });

  it('strips on* event attributes', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" fill="red"/></svg>';
    const out = sanitizeSvg(input);
    expect(out).not.toContain('onclick');
    expect(out).toContain('fill');
  });

  it('strips onerror on image', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="alert(1)"/></svg>';
    const out = sanitizeSvg(input);
    expect(out).not.toContain('onerror');
  });

  it('passes a clean SVG through unchanged (modulo whitespace)', () => {
    const clean = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="blue"/></svg>';
    const out = sanitizeSvg(clean);
    expect(out).toContain('circle');
    expect(out).toContain('fill');
    expect(out).not.toContain('script');
  });
});
