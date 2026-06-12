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

// Purge périodique des clés inactives : sans ça, la Map accumule une entrée par
// clientKey vu (rotation d'utilisateurs sur des mois → fuite mémoire lente).
// Toutes les 10 min, on retire les clés dont tous les stamps sont hors fenêtre.
setInterval(() => {
  const now = Date.now();
  for (const [key, stamps] of rateLimitWindows) {
    while (stamps.length > 0 && now - stamps[0]! > RATE_WINDOW_MS) stamps.shift();
    if (stamps.length === 0) rateLimitWindows.delete(key);
  }
}, 10 * 60_000).unref();

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
