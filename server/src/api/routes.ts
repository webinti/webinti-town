import { Router, type Request, type Response } from 'express';
import { roomManager } from '../rooms/RoomManager.js';
import { createLiveKitToken } from '../livekit/tokenService.js';
import { config } from '../config.js';

export const apiRouter: Router = Router();

function sanitizeName(input: unknown): string {
  if (typeof input !== 'string') return 'Guest';
  const stripped = input.replace(/<[^>]*>/g, '').trim();
  return stripped.slice(0, 20) || 'Guest';
}

apiRouter.post('/rooms', (req: Request, res: Response) => {
  const body = req.body as { name?: unknown } | undefined;
  const name = typeof body?.name === 'string' ? body.name : '';
  if (!name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const { slug, adminToken } = roomManager.createRoom(name);
  return res.status(201).json({ slug, adminToken });
});

apiRouter.get('/rooms/:slug', (req: Request, res: Response) => {
  const info = roomManager.getPublicInfo(req.params.slug);
  if (!info) return res.status(404).json({ error: 'room not found' });
  return res.json(info);
});

apiRouter.post('/livekit/token', async (req: Request, res: Response) => {
  const body = req.body as
    | { roomSlug?: unknown; identity?: unknown; name?: unknown }
    | undefined;
  const roomSlug = typeof body?.roomSlug === 'string' ? body.roomSlug : '';
  const identity = typeof body?.identity === 'string' ? body.identity : '';
  if (!roomSlug) return res.status(400).json({ error: 'roomSlug required' });
  if (!identity || identity.length > 64) {
    return res.status(400).json({ error: 'invalid identity' });
  }
  const room = roomManager.getRoom(roomSlug);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const displayName = sanitizeName(body?.name);
  try {
    const token = await createLiveKitToken(roomSlug, identity, displayName);
    return res.json({ token, url: config.livekitUrl });
  } catch (err) {
    console.error('[livekit/token]', err);
    return res.status(500).json({ error: 'token generation failed' });
  }
});
