import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: Number(process.env.PORT ?? 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  tickRateHz: 20,
  proximityRateHz: 4,
  proximityRadiusPx: 5 * 32,
  defaultSpawn: { x: 400, y: 300 } as const,
  livekitUrl: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
  hostToken: process.env.HOST_TOKEN ?? '',
  // Seul ce compte (email connecté) devient hôte/admin. Plus de "premier arrivé".
  hostEmail: (process.env.HOST_EMAIL ?? 'agence.webinti@gmail.com').toLowerCase(),
  // F11 — PocketBase backend (migration progressive depuis JSON)
  // Backend par store : 'json' (legacy) ou 'pocketbase'.
  // On peut switcher indépendamment pour migrer poste par poste.
  pocketbaseUrl: process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090',
  pocketbaseAdminEmail: process.env.POCKETBASE_ADMIN_EMAIL ?? '',
  pocketbaseAdminPassword: process.env.POCKETBASE_ADMIN_PASSWORD ?? '',
  kanbanBackend: (process.env.KANBAN_BACKEND ?? 'json') as 'json' | 'pocketbase',
  dmBackend: (process.env.DM_BACKEND ?? 'json') as 'json' | 'pocketbase',
  workstationBackend: (process.env.WORKSTATION_BACKEND ?? 'json') as 'json' | 'pocketbase',
};
