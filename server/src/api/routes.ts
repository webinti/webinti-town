import { Router, type Request, type Response } from 'express';
import { roomManager } from '../rooms/RoomManager.js';

export const apiRouter: Router = Router();

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
