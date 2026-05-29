import { config } from './config.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { apiRouter } from './api/routes.js';
import { roomManager } from './rooms/RoomManager.js';
import { registerSocketHandlers, startTickLoops } from './socket/handlers.js';
const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '64kb' }));
app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
});
app.use('/api', apiRouter);
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
});
registerSocketHandlers(io);
startTickLoops(io);
roomManager.ensureRoom('demo', 'Demo Room');
httpServer.listen(config.port, () => {
    console.log(`[webintispace] listening on http://localhost:${config.port}`);
    console.log(`[webintispace] CORS origin: ${config.clientOrigin}`);
    console.log(`[webintispace] default room: /demo`);
});
//# sourceMappingURL=index.js.map