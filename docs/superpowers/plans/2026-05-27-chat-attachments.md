# Plan d'implémentation — Chat Attachments (F9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre d'attacher jpg / png / svg / pdf (≤ 5 MB) à un message chat. Stockage disque `server/data/uploads/<roomSlug>/<uuid>.<ext>`, rétention 30 jours, rate-limit 3 uploads/min/clientKey, support chat global ET local.

**Architecture:** Un Express router dédié `uploadsRouter` gère POST (upload multipart avec multer en mémoire) et GET (serve statique). La validation magic-bytes et la sanitisation SVG sont isolées dans `validateUpload.ts`. Un cron interne (`uploadsCleanup.ts`) purge les fichiers > 30 j au démarrage et toutes les 6 h. Le serveur valide l'appartenance à la room via le header `x-client-key` avant d'accepter l'upload. Le champ `attachment` sur `ChatMessage` est optionnel ; le handler socket valide l'existence fichier avant broadcast. Côté client : machine d'état `idle/uploading/ready/error` dans `ChatPanel`, preview thumbnail, composant `AttachmentView` pour le rendu des messages reçus.

**Tech Stack:** TypeScript + Node 20 (server), Express + multer (parsing multipart), dompurify + jsdom (SVG sanitization), magic-bytes hand-rolled (pas de dépendance file-type), React 18 + Tailwind (client), Vitest (TDD server).

**Spec source:** `docs/superpowers/specs/2026-05-27-chat-attachments-design.md`

---

## File structure overview

**Created**
- `server/src/uploads/validateUpload.ts` — magic bytes check + SVG sanitization
- `server/src/uploads/validateUpload.test.ts` — vitest TDD
- `server/src/uploads/uploadsRouter.ts` — Express router POST/GET
- `server/src/uploads/uploadsCleanup.ts` — scan + delete > 30 j
- `docs/superpowers/plans/2026-05-27-chat-attachments.md` — ce plan

**Modified**
- `server/package.json` — ajouter multer @types/multer dompurify @types/dompurify jsdom @types/jsdom
- `server/src/types.ts` — étendre `ChatMessage` avec optional `attachment`
- `server/src/index.ts` — monter le router `/api/uploads`, lancer cleanup au boot
- `server/src/socket/handlers.ts` — valider `attachment` dans `chat_message`
- `client/src/types.ts` — mirror `ChatMessage.attachment`
- `client/src/react/components/ChatPanel.tsx` — bouton 📎, state machine upload, preview, envoi
- `.gitignore` — ajouter `server/data/uploads/*`

---

## Task 1 : npm install des dépendances serveur

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1 : Installer les paquets**

```bash
cd /home/openclaw/projects/webinti-town/server
npm install multer @types/multer dompurify @types/dompurify jsdom @types/jsdom
```

Expected: ajout dans `dependencies` / `devDependencies` sans erreur.

- [ ] **Step 2 : Vérifier le type-check global**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected: 0 erreur (rien de nouveau cassé).

- [ ] **Step 3 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/package.json server/package-lock.json
git commit -m "chore(server): add multer + dompurify + jsdom for chat attachments"
```

---

## Task 2 : validateUpload.ts — TDD magic bytes + SVG sanitization

**Files:**
- Create: `server/src/uploads/validateUpload.test.ts`
- Create: `server/src/uploads/validateUpload.ts`

- [ ] **Step 1 : Écrire les tests en premier (Red)**

Créer `server/src/uploads/validateUpload.test.ts` :

```ts
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
```

- [ ] **Step 2 : Lancer les tests — s'attendre à ALL FAIL**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/uploads/validateUpload.test.ts
```

Expected: tous les tests échouent avec `Cannot find module './validateUpload.js'`.

- [ ] **Step 3 : Implémenter `validateUpload.ts`**

Créer `server/src/uploads/validateUpload.ts` :

```ts
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
  const head = buf.slice(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
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
```

- [ ] **Step 4 : Lancer les tests — s'attendre à ALL GREEN**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/uploads/validateUpload.test.ts
```

Expected: tous les tests passent.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/src/uploads/validateUpload.ts server/src/uploads/validateUpload.test.ts
git commit -m "feat(server): validateUpload — magic-bytes detection + SVG sanitization (TDD)"
```

---

## Task 3 : uploadsCleanup.ts — scan + delete > 30 jours

**Files:**
- Create: `server/src/uploads/uploadsCleanup.ts`

- [ ] **Step 1 : Implémenter le module de nettoyage**

Créer `server/src/uploads/uploadsCleanup.ts` :

```ts
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_UPLOADS_DIR = (() => {
  // server/src/uploads/uploadsCleanup.ts → ../../data/uploads == server/data/uploads
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data', 'uploads');
})();

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 heures

/**
 * Scanne `uploadsDir`, supprime tout fichier dont mtime > RETENTION_MS.
 * Ignore les erreurs ENOENT (répertoire absent au premier démarrage).
 * Exported for unit testing with a custom dir.
 */
export async function runCleanup(uploadsDir: string = DEFAULT_UPLOADS_DIR): Promise<void> {
  let roomDirs: string[];
  try {
    roomDirs = await fs.readdir(uploadsDir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return; // pas encore de dossier, pas grave
    console.warn('[uploads/cleanup] cannot read', uploadsDir, err);
    return;
  }

  const now = Date.now();
  let deleted = 0;

  for (const roomSlug of roomDirs) {
    // Sécurité : sauter les entrées non-slug (évite path traversal sur les
    // noms de répertoires eux-mêmes, même si on les contrôle).
    if (!/^[a-z0-9-]{1,50}$/.test(roomSlug)) continue;
    const roomDir = join(uploadsDir, roomSlug);
    let files: string[];
    try {
      files = await fs.readdir(roomDir);
    } catch {
      continue;
    }
    for (const filename of files) {
      const filePath = join(roomDir, filename);
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        const age = now - stat.mtimeMs;
        if (age > RETENTION_MS) {
          await fs.unlink(filePath);
          deleted++;
        }
      } catch {
        // fichier déjà supprimé ou locked — on ignore
      }
    }
  }

  if (deleted > 0) {
    console.log(`[uploads/cleanup] deleted ${deleted} expired file(s)`);
  }
}

let _cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Lance le cleanup immédiatement puis toutes les 6h.
 * À appeler une seule fois au démarrage du serveur.
 */
export function startCleanupSchedule(uploadsDir?: string): void {
  // Run immediately (fire-and-forget).
  void runCleanup(uploadsDir);
  // Then every 6h.
  _cleanupTimer = setInterval(() => {
    void runCleanup(uploadsDir);
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit.
  _cleanupTimer.unref?.();
}
```

- [ ] **Step 2 : Type-check**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected: pas d'erreur.

- [ ] **Step 3 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/src/uploads/uploadsCleanup.ts
git commit -m "feat(server): uploadsCleanup — scan + delete files older than 30 days"
```

---

## Task 4 : uploadsRouter.ts — POST /api/uploads/:roomSlug + GET

**Files:**
- Create: `server/src/uploads/uploadsRouter.ts`

- [ ] **Step 1 : Implémenter le router Express**

Créer `server/src/uploads/uploadsRouter.ts` :

```ts
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectMimeFromBytes, sanitizeSvg, isAllowedMime, type AllowedMime } from './validateUpload.js';
import { roomManager } from '../rooms/RoomManager.js';

// ─── Paths ─────────────────────────────────────────────────────────────────
const UPLOADS_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data', 'uploads');
})();

// ─── Constants ─────────────────────────────────────────────────────────────
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const FILENAME_MAX = 80;

const MIME_TO_EXT: Record<AllowedMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

// ─── Rate limiting (in-memory, par clientKey, fenêtre glissante 1 min) ─────
const rateLimitWindows = new Map<string, number[]>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  let stamps = rateLimitWindows.get(clientKey);
  if (!stamps) {
    stamps = [];
    rateLimitWindows.set(clientKey, stamps);
  }
  // Purger les stamps hors fenêtre
  while (stamps.length > 0 && now - stamps[0]! > RATE_WINDOW_MS) stamps.shift();
  if (stamps.length >= RATE_LIMIT) return false;
  stamps.push(now);
  return true;
}

// ─── Multer (in-memory, limit 5 MB) ────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
});

// ─── Helper : sanitize filename (ne stocke jamais le nom client brut) ───────
function sanitizeOriginalName(raw: string | undefined): string {
  if (!raw) return 'fichier';
  // Garder uniquement les chars alphanumériques, tiret, underscore, point
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, FILENAME_MAX) || 'fichier';
}

// ─── Router ─────────────────────────────────────────────────────────────────
export const uploadsRouter: Router = Router();

// POST /api/uploads/:roomSlug
uploadsRouter.post(
  '/:roomSlug',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const { roomSlug } = req.params as { roomSlug: string };

    // 1. Vérifier le slug
    if (!/^[a-z0-9-]{1,50}$/.test(roomSlug)) {
      res.status(400).json({ error: 'invalid roomSlug' });
      return;
    }

    // 2. Vérifier que la room existe et que le client en fait partie
    const clientKey = req.headers['x-client-key'];
    if (typeof clientKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(clientKey)) {
      res.status(403).json({ error: 'missing or invalid x-client-key' });
      return;
    }
    const room = roomManager.getRoom(roomSlug);
    if (!room) {
      res.status(403).json({ error: 'room not found' });
      return;
    }
    const isInRoom = room.players.has(clientKey);
    if (!isInRoom) {
      res.status(403).json({ error: 'not in room' });
      return;
    }

    // 3. Rate limit
    if (!checkRateLimit(clientKey)) {
      res.status(429).json({ error: 'rate limit exceeded (3 uploads/min)' });
      return;
    }

    // 4. Vérifier le fichier uploadé
    if (!req.file) {
      res.status(400).json({ error: 'no file' });
      return;
    }
    const buf = req.file.buffer;

    // 5. Détection magic bytes (ignorer le Content-Type déclaré)
    const detectedMime = detectMimeFromBytes(buf);
    if (!isAllowedMime(detectedMime)) {
      res.status(415).json({ error: 'unsupported file type' });
      return;
    }

    // 6. SVG sanitization
    let finalBuf: Buffer;
    if (detectedMime === 'image/svg+xml') {
      const cleaned = sanitizeSvg(buf.toString('utf8'));
      finalBuf = Buffer.from(cleaned, 'utf8');
    } else {
      finalBuf = buf;
    }

    // 7. Construire le nom de fichier : UUID + ext validée (JAMAIS le nom client)
    const ext = MIME_TO_EXT[detectedMime];
    const uuid = randomUUID();
    const storedFilename = `${uuid}${ext}`;
    const originalName = sanitizeOriginalName(req.file.originalname);

    // 8. Écrire sur disque
    const roomDir = join(UPLOADS_ROOT, roomSlug);
    await fs.mkdir(roomDir, { recursive: true });
    const filePath = join(roomDir, storedFilename);
    await fs.writeFile(filePath, finalBuf);

    // 9. Répondre
    const url = `/api/uploads/${roomSlug}/${storedFilename}`;
    res.json({
      url,
      filename: originalName,
      mimeType: detectedMime,
      sizeBytes: finalBuf.length,
    });
  },
);

// Multer error handler (413 si trop grand)
uploadsRouter.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    next: (err?: unknown) => void,
  ) => {
    if (
      err &&
      typeof err === 'object' &&
      (err as Record<string, unknown>).code === 'LIMIT_FILE_SIZE'
    ) {
      res.status(413).json({ error: 'file too large (max 5 MB)' });
      return;
    }
    next(err);
  },
);

// GET /api/uploads/:roomSlug/:filename
uploadsRouter.get('/:roomSlug/:filename', (req: Request, res: Response): void => {
  const { roomSlug, filename } = req.params as { roomSlug: string; filename: string };

  // Vérification stricte slug + filename pour prévenir path traversal
  if (!/^[a-z0-9-]{1,50}$/.test(roomSlug)) {
    res.status(400).json({ error: 'invalid roomSlug' });
    return;
  }
  // filename = UUID + ext — pas de / ni de ..
  if (!/^[0-9a-f-]{36}\.(jpg|png|svg|pdf)$/.test(filename)) {
    res.status(400).json({ error: 'invalid filename' });
    return;
  }

  const filePath = join(UPLOADS_ROOT, roomSlug, filename);
  const ext = extname(filename).toLowerCase();

  // Content-Disposition: inline pour images, attachment pour PDF
  const isPdf = ext === '.pdf';
  const disposition = isPdf
    ? `attachment; filename="${basename(filename)}"`
    : 'inline';

  res.setHeader('Content-Disposition', disposition);
  res.sendFile(filePath, { root: '/' }, (err) => {
    if (err) {
      // sendFile already sent headers if it started streaming; only respond if not
      if (!res.headersSent) {
        res.status(404).json({ error: 'file not found' });
      }
    }
  });
});
```

- [ ] **Step 2 : Type-check**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 3 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/src/uploads/uploadsRouter.ts
git commit -m "feat(server): uploadsRouter — POST/GET /api/uploads/:roomSlug with rate-limit + magic-byte validation"
```

---

## Task 5 : server/src/types.ts + .gitignore + dossier uploads

**Files:**
- Modify: `server/src/types.ts`
- Modify: `.gitignore`
- Create: `server/data/uploads/.gitkeep`

- [ ] **Step 1 : Étendre ChatMessage avec optional attachment**

Ouvrir `server/src/types.ts`. Remplacer l'interface `ChatMessage` existante (lignes 36–43) par :

```ts
export interface ChatAttachment {
  url: string;       // /api/uploads/<roomSlug>/<uuid>.<ext>
  filename: string;  // sanitized original (max 80 chars)
  mimeType: 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'application/pdf';
  sizeBytes: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  type: ChatMessageType;
  timestamp: number;
  attachment?: ChatAttachment;  // F9 — pièce jointe optionnelle
}
```

- [ ] **Step 2 : Ajouter server/data/uploads/ au .gitignore**

Ouvrir `.gitignore`. Après la ligne `server/data/*.json`, ajouter :

```
# Upload files — stored on disk, not committed
server/data/uploads/*
!server/data/uploads/.gitkeep
```

- [ ] **Step 3 : Créer le .gitkeep**

```bash
mkdir -p /home/openclaw/projects/webinti-town/server/data/uploads
touch /home/openclaw/projects/webinti-town/server/data/uploads/.gitkeep
```

- [ ] **Step 4 : Type-check**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/src/types.ts .gitignore server/data/uploads/.gitkeep
git commit -m "feat(server): extend ChatMessage with optional attachment + gitignore uploads dir"
```

---

## Task 6 : server/src/index.ts — monter le router + lancer le cleanup

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1 : Ajouter les imports**

En haut de `server/src/index.ts`, après les imports existants, ajouter :

```ts
import { uploadsRouter } from './uploads/uploadsRouter.js';
import { startCleanupSchedule } from './uploads/uploadsCleanup.js';
```

- [ ] **Step 2 : Monter le router**

Juste avant la ligne `app.use('/api', apiRouter);`, ajouter :

```ts
app.use('/api/uploads', uploadsRouter);
```

Le résultat sera dans l'ordre :

```ts
app.use('/api/uploads', uploadsRouter);
app.use('/api', apiRouter);
```

(L'ordre importe : `/api/uploads` doit être monté avant `/api` pour éviter tout conflit de préfixe.)

- [ ] **Step 3 : Lancer le cleanup au boot**

Après la ligne `roomManager.ensureRoom('demo', 'Demo Room');`, ajouter :

```ts
startCleanupSchedule();
```

- [ ] **Step 4 : Type-check**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/src/index.ts
git commit -m "feat(server): mount uploadsRouter + start cleanup schedule on boot"
```

---

## Task 7 : server/src/socket/handlers.ts — valider attachment dans chat_message

**Files:**
- Modify: `server/src/socket/handlers.ts`

- [ ] **Step 1 : Ajouter les imports nécessaires**

En haut de `handlers.ts`, dans le bloc d'imports depuis `'../types.js'`, ajouter `ChatAttachment` :

```ts
import type {
  Appearance,
  ChatAttachment,
  ChatMessage,
  ChatMessageType,
  // ... reste inchangé
} from '../types.js';
```

- [ ] **Step 2 : Ajouter un helper de validation d'attachment**

Juste avant `export function registerSocketHandlers(io: Server)`, ajouter :

```ts
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const UPLOADS_ROOT_HANDLER = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data', 'uploads');
})();

/**
 * Valide qu'un attachment reçu du client référence un fichier existant
 * sous le bon roomSlug. Retourne l'objet nettoyé ou null si invalide.
 */
function parseAttachment(raw: unknown, roomSlug: string): ChatAttachment | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const url = typeof r.url === 'string' ? r.url : null;
  const filename = typeof r.filename === 'string' ? r.filename.slice(0, 80) : null;
  const mimeType = r.mimeType;
  const sizeBytes = typeof r.sizeBytes === 'number' && r.sizeBytes > 0 ? r.sizeBytes : null;

  if (!url || !filename || !sizeBytes) return null;

  // Valider le MIME
  const ALLOWED: ReadonlySet<string> = new Set([
    'image/jpeg', 'image/png', 'image/svg+xml', 'application/pdf',
  ]);
  if (typeof mimeType !== 'string' || !ALLOWED.has(mimeType)) return null;

  // Extraire le roomSlug et le filename depuis l'URL
  // Format attendu: /api/uploads/<roomSlug>/<uuid>.<ext>
  const match = url.match(/^\/api\/uploads\/([a-z0-9-]{1,50})\/([0-9a-f-]{36}\.(jpg|png|svg|pdf))$/);
  if (!match) return null;
  const urlRoomSlug = match[1];
  const urlFilename = match[2];

  // Le roomSlug dans l'URL doit correspondre à la room du socket
  if (urlRoomSlug !== roomSlug) return null;

  // Vérifier que le fichier existe vraiment sur le disque
  const filePath = join(UPLOADS_ROOT_HANDLER, roomSlug, urlFilename!);
  if (!existsSync(filePath)) return null;

  return {
    url,
    filename,
    mimeType: mimeType as ChatAttachment['mimeType'],
    sizeBytes,
  };
}
```

- [ ] **Step 3 : Modifier le handler chat_message**

Localiser le handler `socket.on('chat_message', ...)` (actuellement vers la ligne 261). Modifier la construction du `msg` pour inclure l'attachment validé :

```ts
    socket.on('chat_message', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.chatTimestamps, 5)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const text = sanitizeText(p.text, 300);
      // Le texte peut être vide SI une pièce jointe est présente
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;

      // Valider l'attachment (strip silencieux si invalide)
      const attachment = parseAttachment(p.attachment, session.roomSlug);

      // Un message doit avoir du texte OU une pièce jointe valide
      if (!text && !attachment) return;

      const msg: ChatMessage = {
        id: randomUUID(),
        playerId: player.playerId,
        playerName: player.name,
        text,
        type: p.type === 'global' ? 'global' : p.type === 'system' ? 'system' : 'local',
        timestamp: Date.now(),
        ...(attachment ? { attachment } : {}),
      };
      roomManager.pushChat(session.roomSlug, msg);
      if (msg.type === 'local') {
        const radiusSq = config.proximityRadiusPx * config.proximityRadiusPx;
        for (const other of room.players.values()) {
          const dx = other.x - player.x;
          const dy = other.y - player.y;
          if (dx * dx + dy * dy <= radiusSq) {
            io.to(other.socketId).emit('chat_message', msg);
          }
        }
      } else {
        io.to(session.roomSlug).emit('chat_message', msg);
      }
    });
```

Note : la variable `type` locale de l'ancien handler est inlinée dans la construction du msg. Supprimer la déclaration `const type: ChatMessageType = ...` séparée qui existait avant.

- [ ] **Step 4 : Type-check**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 5 : Run all server tests**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run
```

Expected: tous les tests passent (existants + validateUpload).

- [ ] **Step 6 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/src/socket/handlers.ts
git commit -m "feat(server): validate attachment in chat_message handler (strip invalid silently)"
```

---

## Task 8 : client/src/types.ts — mirror ChatAttachment + ChatMessage.attachment

**Files:**
- Modify: `client/src/types.ts`

- [ ] **Step 1 : Ajouter ChatAttachment + mettre à jour ChatMessage**

Ouvrir `client/src/types.ts`. Juste avant `export interface ChatMessage`, ajouter :

```ts
export interface ChatAttachment {
  url: string;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'application/pdf';
  sizeBytes: number;
}
```

Puis modifier l'interface `ChatMessage` existante pour ajouter le champ optionnel à la fin :

```ts
export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  type: ChatMessageType;
  timestamp: number;
  attachment?: ChatAttachment;  // F9
}
```

- [ ] **Step 2 : Type-check**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 3 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/types.ts
git commit -m "feat(client): mirror ChatAttachment type + extend ChatMessage"
```

---

## Task 9 : client/src/react/components/ChatPanel.tsx — bouton 📎 + upload state machine + AttachmentView

**Files:**
- Modify: `client/src/react/components/ChatPanel.tsx`

C'est la tâche client principale. Lire attentivement le ChatPanel existant avant de commencer.

### 9a — Imports + helper getClientKey

- [ ] **Step 1 : Ajouter les imports**

En haut de `ChatPanel.tsx`, après les imports existants, ajouter :

```ts
import type { ChatAttachment } from '../../types';
```

Et ajouter l'import de `useRef` si pas déjà présent (il l'est déjà — `useCallback, useEffect, useLayoutEffect, useRef, useState`).

### 9b — Helper pour récupérer le clientKey

- [ ] **Step 2 : Ajouter un helper module-level pour lire le clientKey depuis localStorage**

Juste après les imports, avant `const SHIRT_HEX`, ajouter :

```ts
/** Lit le clientKey stable persisté par SocketManager. Retourne '' si absent. */
function getLocalClientKey(): string {
  try {
    return window.localStorage.getItem('webinti.clientKey') ?? '';
  } catch {
    return '';
  }
}
```

### 9c — Upload state machine + bouton 📎 dans ChatPanel

- [ ] **Step 3 : Ajouter le state upload dans le composant ChatPanel**

À l'intérieur de `ChatPanel()`, après les hooks existants (après `const scrollPosRef`), ajouter :

```ts
  // ── Attachment upload state machine ─────────────────────────────────────
  type UploadStatus = 'idle' | 'uploading' | 'ready' | 'error';
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 4 : Ajouter la fonction handleFileChange**

Juste avant `handleSend`, ajouter :

```ts
  const currentRoomSlug = useGameStore((s) => s.currentRoomSlug);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input pour permettre de re-sélectionner le même fichier
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    // Taille max 5 MB côté client (le serveur rejette aussi avec 413)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Fichier trop grand (max 5 MB)');
      setUploadStatus('error');
      return;
    }

    setUploadStatus('uploading');
    setUploadError('');
    setPendingAttachment(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const clientKey = getLocalClientKey();
      const resp = await fetch(`/api/uploads/${currentRoomSlug}`, {
        method: 'POST',
        headers: {
          'x-client-key': clientKey,
        },
        body: formData,
      });
      if (!resp.ok) {
        const json = (await resp.json().catch(() => ({}))) as { error?: string };
        const msg =
          resp.status === 413
            ? 'Fichier trop grand (max 5 MB)'
            : resp.status === 429
            ? 'Trop d\'uploads, attendez 1 minute'
            : resp.status === 415
            ? 'Type de fichier non autorisé (jpg/png/svg/pdf)'
            : json.error ?? 'Erreur upload';
        setUploadError(msg);
        setUploadStatus('error');
        return;
      }
      const data = (await resp.json()) as ChatAttachment;
      setPendingAttachment(data);
      setUploadStatus('ready');
    } catch {
      setUploadError('Erreur réseau lors de l\'upload');
      setUploadStatus('error');
    }
  }, [currentRoomSlug]);

  const removeAttachment = useCallback(() => {
    setPendingAttachment(null);
    setUploadStatus('idle');
    setUploadError('');
  }, []);
```

- [ ] **Step 5 : Modifier handleSend pour inclure l'attachment**

Remplacer la `handleSend` existante par :

```ts
  const handleSend = useCallback(() => {
    const value = text.trim();
    // Autoriser envoi si texte OU pièce jointe
    if (!value && !pendingAttachment) return;
    // Bloquer si upload en cours
    if (uploadStatus === 'uploading') return;
    socketManager.sendChat(value.slice(0, 300), tab, pendingAttachment ?? undefined);
    setText('');
    setPendingAttachment(null);
    setUploadStatus('idle');
    setUploadError('');
  }, [text, tab, pendingAttachment, uploadStatus]);
```

Note : `socketManager.sendChat` doit être mis à jour pour accepter un 3e argument optionnel `attachment`. Voir le Step 6 ci-dessous.

### 9d — Mettre à jour SocketManager.sendChat

- [ ] **Step 6 : Modifier `client/src/network/SocketManager.ts` — sendChat**

Trouver la méthode `sendChat` (actuellement : `sendChat(text: string, type: ChatMessageType): void`). La remplacer par :

```ts
  sendChat(text: string, type: ChatMessageType, attachment?: ChatAttachment): void {
    this.socket?.emit('chat_message', { text, type, ...(attachment ? { attachment } : {}) });
  }
```

Ajouter l'import de `ChatAttachment` dans le bloc d'imports existants du fichier.

### 9e — Rendu : bouton 📎, zone preview, bouton Envoyer

- [ ] **Step 7 : Modifier la zone de saisie dans le JSX de ChatPanel**

Localiser la section `<div className="border-t border-white/10 p-2">` (zone de saisie). Remplacer son contenu entier par :

```tsx
      <div className="border-t border-white/10 p-2">
        {/* Zone preview pièce jointe */}
        {uploadStatus === 'ready' && pendingAttachment && (
          <div className="mb-2 flex items-center gap-2 rounded bg-slate-800/80 px-2 py-1 ring-1 ring-indigo-400/40">
            {pendingAttachment.mimeType === 'application/pdf' ? (
              <span className="text-base">{'📄'}</span>
            ) : (
              <img
                src={pendingAttachment.url}
                alt=""
                className="h-10 w-10 rounded object-cover ring-1 ring-white/10"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span className="flex-1 truncate text-xs text-slate-300">{pendingAttachment.filename}</span>
            <button
              onClick={removeAttachment}
              className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
              title="Retirer la pièce jointe"
            >
              {'✕'}
            </button>
          </div>
        )}
        {uploadStatus === 'error' && (
          <div className="mb-2 rounded bg-red-900/60 px-2 py-1 text-xs text-red-300 ring-1 ring-red-500/40">
            {uploadError}
            <button onClick={removeAttachment} className="ml-2 underline hover:text-white">retirer</button>
          </div>
        )}
        {uploadStatus === 'uploading' && (
          <div className="mb-2 text-xs text-slate-400">
            <span className="animate-pulse">{'⏳'} Upload en cours…</span>
          </div>
        )}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 300))}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={tab === 'global' ? 'Message global...' : 'Message proximité...'}
          rows={2}
          maxLength={300}
          className="w-full resize-none rounded bg-slate-800 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Bouton 📎 */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadStatus === 'uploading'}
              title="Joindre un fichier (jpg/png/svg/pdf, max 5 MB)"
              className="rounded px-1.5 py-0.5 text-base text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-40"
            >
              {'📎'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/svg+xml,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <span className="text-[10px] text-slate-500">Entrée · Maj+Entrée saut</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">{text.length}/300</span>
            <button
              onClick={handleSend}
              disabled={uploadStatus === 'uploading' || (!text.trim() && !pendingAttachment)}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Envoyer
            </button>
          </div>
        </div>
      </div>
```

### 9f — Composant AttachmentView + rendu dans ChatRow

- [ ] **Step 8 : Ajouter le composant AttachmentView**

À la fin du fichier `ChatPanel.tsx`, après `ChatRow`, ajouter :

```tsx
function AttachmentView({ attachment }: { attachment: ChatAttachment }) {
  const [loadError, setLoadError] = useState(false);

  if (loadError) {
    return (
      <div className="mt-1 rounded bg-slate-700/60 px-2 py-1 text-xs text-yellow-400">
        {'⚠️'} Pièce jointe indisponible
      </div>
    );
  }

  if (attachment.mimeType === 'application/pdf') {
    const sizeKb = Math.round(attachment.sizeBytes / 1024);
    const sizeTxt = sizeKb >= 1024
      ? `${(sizeKb / 1024).toFixed(1)} MB`
      : `${sizeKb} KB`;
    return (
      <a
        href={attachment.url}
        download={attachment.filename}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 flex items-center gap-2 rounded bg-slate-700/60 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
      >
        <span className="text-base">{'📄'}</span>
        <span className="flex-1 truncate">{attachment.filename}</span>
        <span className="text-[10px] text-slate-400">{sizeTxt}</span>
      </a>
    );
  }

  // Images : jpg / png / svg
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block"
    >
      <img
        src={attachment.url}
        alt={attachment.filename}
        className="max-h-60 max-w-full rounded ring-1 ring-white/10 hover:opacity-90"
        style={{ maxWidth: 240 }}
        onError={() => setLoadError(true)}
      />
    </a>
  );
}
```

- [ ] **Step 9 : Afficher l'attachment dans ChatRow**

Localiser le composant `ChatRow`. Dans le JSX, après `<div className="ml-4.5 break-words...">`, ajouter le rendu de l'attachment :

```tsx
      {msg.attachment && <AttachmentView attachment={msg.attachment} />}
```

La section complète du corps de la bubble de chat devient :

```tsx
      <div className="ml-4.5 break-words pl-0.5 text-[13px] text-slate-200">{msg.text}</div>
      {msg.attachment && <AttachmentView attachment={msg.attachment} />}
```

- [ ] **Step 10 : Ajouter useState dans AttachmentView**

`AttachmentView` utilise `useState`. L'import de `useState` est déjà en haut du fichier (`import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';`) — rien à ajouter.

- [ ] **Step 11 : Type-check**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 12 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/react/components/ChatPanel.tsx client/src/network/SocketManager.ts
git commit -m "feat(client): ChatPanel — attachment upload (📎 button, state machine, preview + AttachmentView)"
```

---

## Task 10 : Build complet + smoke test + restart service

**Files:** aucun (déploiement)

- [ ] **Step 1 : Lancer tous les tests**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run
cd /home/openclaw/projects/webinti-town/client && npx vitest run
```

Expected: tous verts.

- [ ] **Step 2 : Backup des dists actuels**

```bash
cd /home/openclaw/projects/webinti-town
TS=$(date +%Y%m%d-%H%M%S)
cp -r client/dist client/dist.backup-${TS} 2>/dev/null || true
cp -r server/dist server/dist.backup-${TS} 2>/dev/null || true
echo "backups: client/dist.backup-${TS} server/dist.backup-${TS}"
```

- [ ] **Step 3 : Build prod**

```bash
cd /home/openclaw/projects/webinti-town/client && npm run build
cd /home/openclaw/projects/webinti-town/server && npm run build
```

Expected: les deux compilent sans erreur TS.

- [ ] **Step 4 : Restart service**

```bash
sudo /bin/systemctl restart webinti-server
sleep 2
systemctl is-active webinti-server
journalctl -u webinti-server -n 15 --no-pager | tail -8
```

Expected: `active`, logs montrent `[webintispace] listening on …` et `[uploads/cleanup]` (s'il y avait des fichiers > 30 j).

- [ ] **Step 5 : Smoke test**

Demander à l'utilisateur de :

1. Ouvrir https://live.webinti.com/?room=test-attachments (room fraîche, 2 onglets ou 2 navigateurs).
2. Dans le ChatPanel, cliquer sur 📎 → choisir une image JPG → vérifier le spinner, puis la thumbnail preview avec ✕.
3. Envoyer le message (texte optionnel) → vérifier que l'image apparaît dans le chat des deux côtés (thumbnail clickable → ouvre dans nouvel onglet).
4. Répéter avec un PNG, un SVG (vérifier que le SVG est rendu inline), un PDF (vérifier la carte cliquable avec nom + taille).
5. Tester le rejet : uploader un fichier de 6 MB → vérifier le message d'erreur "Fichier trop grand (max 5 MB)".
6. Tenter d'uploader un `.exe` renommé `.png` → vérifier le rejet 415 ("Type de fichier non autorisé").
7. Vérifier le rate limit : uploader 4 fichiers rapides → le 4e doit être rejeté avec "Trop d'uploads, attendez 1 minute".
8. Vérifier que l'attachment persiste dans `chatHistory` : rejoindre la room, vérifier que les messages avec pièces jointes sont encore visibles.

En cas d'échec critique, rollback :

```bash
cd /home/openclaw/projects/webinti-town
rm -rf client/dist server/dist
mv client/dist.backup-${TS} client/dist
mv server/dist.backup-${TS} server/dist
sudo /bin/systemctl restart webinti-server
```

- [ ] **Step 6 : Commit final si nécessaire**

```bash
cd /home/openclaw/projects/webinti-town
git status
# Committer tout reste éventuel (ex: server/data/uploads/.gitkeep si oublié)
```

---

## Self-review — couverture spec

| Exigence spec | Tâche |
|---|---|
| magic-bytes JPEG/PNG/PDF/SVG | Task 2 (validateUpload + TDD) |
| Rejet .exe renommé .png | Task 2 tests |
| SVG sanitization (script, foreignObject, on\*) | Task 2 (sanitizeSvg + TDD) |
| multer in-memory 5 MB limit | Task 4 (uploadsRouter) |
| Réponse `{ url, filename, mimeType, sizeBytes }` | Task 4 |
| Rate-limit 3/min/clientKey | Task 4 |
| Validation x-client-key + isInRoom | Task 4 |
| GET avec Content-Disposition (inline/attachment) | Task 4 |
| Path traversal impossible (UUID, pas nom client) | Task 4 |
| Cleanup 30 j au boot + setInterval 6h | Task 3 |
| `.gitignore server/data/uploads/*` | Task 5 |
| `ChatMessage.attachment` optionnel (server) | Task 5 |
| `ChatAttachment` client mirror | Task 8 |
| Validation attachment dans chat_message (fs.existsSync) | Task 7 |
| Strip silencieux si attachment invalide | Task 7 |
| Bouton 📎 + file input (accept=...) | Task 9 |
| State machine idle/uploading/ready/error | Task 9 |
| Thumbnail preview + ✕ retirer | Task 9 |
| Envoi message avec attachment | Task 9 |
| AttachmentView — image thumbnail | Task 9 |
| AttachmentView — PDF card + download | Task 9 |
| Fallback "⚠️ pièce jointe indisponible" | Task 9 |
| Smoke test (chaque type + 6 MB → 413) | Task 10 |
| npm install multer dompurify jsdom | Task 1 |

Aucun placeholder TBD/TODO. Chaque step montre le code complet.

---

### Critical Files for Implementation
- `/home/openclaw/projects/webinti-town/server/src/uploads/validateUpload.ts`
- `/home/openclaw/projects/webinti-town/server/src/uploads/uploadsRouter.ts`
- `/home/openclaw/projects/webinti-town/client/src/react/components/ChatPanel.tsx`
- `/home/openclaw/projects/webinti-town/server/src/socket/handlers.ts`
- `/home/openclaw/projects/webinti-town/server/src/types.ts`

---