import { config } from './config.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { apiRouter } from './api/routes.js';
import { roomManager } from './rooms/RoomManager.js';
import { registerSocketHandlers, startTickLoops } from './socket/handlers.js';
import { uploadsRouter } from './uploads/uploadsRouter.js';
import { startCleanupSchedule } from './uploads/uploadsCleanup.js';
import { stripeRouter } from './stripe/stripeRouter.js';
import { startLicenseHeartbeat, getLicenseStatus } from './license/index.js';

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));

// ── Webhook Stripe : CORPS BRUT obligatoire ────────────────────────────────
// La vérification de signature (stripe.webhooks.constructEvent) a besoin du
// corps EXACT, octet pour octet. On applique donc express.raw() UNIQUEMENT sur
// le chemin du webhook, monté AVANT le express.json() global : pour cette route
// req.body est un Buffer non parsé. Toutes les autres routes (y compris les
// autres routes Stripe) gardent leur JSON parsé via le json() global ci-dessous.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use('/api/uploads', uploadsRouter);
// Vente d'abonnements Stripe : pertinent UNIQUEMENT sur l'instance SaaS de
// Webinti. En self-host (le client héberge, Webinti vend en amont), on ne monte
// pas le routeur du tout.
if (config.edition !== 'selfhosted') {
  app.use('/api/stripe', stripeRouter);
}
app.use('/api', apiRouter);

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: config.clientOrigin, credentials: true },
  // Tolérance aux onglets en arrière-plan : les navigateurs throttlent les
  // timers d'un onglet inactif → le heartbeat client arrive en retard. Avec le
  // pingTimeout par défaut (20 s) ça provoquait des déconnexions intempestives
  // (avatar « fantôme », audio coupé). 60 s laisse largement le temps au pong.
  pingInterval: 25000,
  pingTimeout: 60000,
});

registerSocketHandlers(io);
startTickLoops(io);

roomManager.ensureRoom('demo', 'Demo Room');
startCleanupSchedule();

// Kill-switch self-host : démarre le heartbeat de licence UNIQUEMENT en édition
// 'selfhosted'. Sur l'instance SaaS de Webinti, aucune licence n'est vérifiée.
if (config.edition === 'selfhosted') {
  if (!process.env.HOST_EMAIL) {
    console.warn(
      '[webintispace] ⚠️ EDITION=selfhosted sans HOST_EMAIL défini : désigne le' +
        ' compte administrateur via HOST_EMAIL, sinon personne ne sera hôte.',
    );
  }
  startLicenseHeartbeat();
}

httpServer.listen(config.port, () => {
  console.log(`[webintispace] listening on http://localhost:${config.port}`);
  console.log(`[webintispace] CORS origin: ${config.clientOrigin}`);
  console.log(`[webintispace] default room: /demo`);
  if (config.edition === 'selfhosted') {
    console.log(`[webintispace] édition self-host — licence: ${getLicenseStatus().state}`);
  }
});
