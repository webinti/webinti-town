import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Agent IA d'accueil : clé du moteur de réponses (OpenRouter par défaut).
// AI_API_KEY a priorité ; OPENROUTER_API_KEY accepté en repli (nom usuel).
const aiApiKey = process.env.AI_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '';

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
  // Durée de vie des messages (chat + DM) : au-delà, purge auto.
  messageTtlMs: Number(process.env.MESSAGE_TTL_MS ?? 3 * 24 * 60 * 60 * 1000),
  // Plafond de présents simultanés par room selon le plan du compte propriétaire.
  // Le 1er compte authentifié qui « crée » une room non-demo en devient
  // propriétaire et fixe la capacité d'après son abonnement.
  planCapacity: { free: 3, demarrage: 10, equipe: 25, entreprise: 100 } as Record<string, number>,
  // Rooms de démonstration (slug 'demo' / 'demo-*') : capacité + durée de vie
  // limitées (prospection). Surchargeable par env.
  demoRoomCapacity: Number(process.env.DEMO_ROOM_CAPACITY ?? 10),
  demoRoomTtlMs: Number(process.env.DEMO_ROOM_TTL_HOURS ?? 24) * 60 * 60 * 1000,
  // F11 — PocketBase backend (migration progressive depuis JSON)
  // Backend par store : 'json' (legacy) ou 'pocketbase'.
  // On peut switcher indépendamment pour migrer poste par poste.
  pocketbaseUrl: process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090',
  pocketbaseAdminEmail: process.env.POCKETBASE_ADMIN_EMAIL ?? '',
  pocketbaseAdminPassword: process.env.POCKETBASE_ADMIN_PASSWORD ?? '',
  kanbanBackend: (process.env.KANBAN_BACKEND ?? 'json') as 'json' | 'pocketbase',
  dmBackend: (process.env.DM_BACKEND ?? 'json') as 'json' | 'pocketbase',
  workstationBackend: (process.env.WORKSTATION_BACKEND ?? 'json') as 'json' | 'pocketbase',
  // Agent IA d'accueil (la secrétaire). Moteur compatible OpenAI via OpenRouter
  // par défaut ; surchargeable pour brancher un Hermes / endpoint maison.
  aiBaseUrl: process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
  aiApiKey,
  aiModel: process.env.AI_MODEL ?? 'openai/gpt-4o-mini',
  aiEnabled: aiApiKey.length > 0,
};
