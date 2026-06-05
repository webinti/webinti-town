// F12 — Persistance du leaderboard de course dans PocketBase.
//
// Un record `lap_times` = meilleur tour d'un joueur sur un circuit d'une room
// (clé logique = room + circuit + playerId). Le serveur (admin) crée la
// collection si absente, lit le classement au démarrage de la room, et upsert
// quand un joueur bat son record.
//
// Tolérant aux pannes : si PocketBase est indisponible / non configuré, on log et
// on dégrade vers un leaderboard purement en mémoire (le reste du jeu marche).

import { getPocketBase } from '../pocketbase/client.js';
import { config } from '../config.js';
import type { LeaderboardEntry } from './RaceManager.js';

const COLLECTION = 'lap_times';
let ensurePromise: Promise<boolean> | null = null;

/** true si PocketBase est configuré (creds admin présents) → on tente la persistance. */
function pbEnabled(): boolean {
  return Boolean(config.pocketbaseAdminEmail && config.pocketbaseAdminPassword);
}

/** Crée la collection lap_times si elle n'existe pas. Mémoïsé. */
function ensureCollection(): Promise<boolean> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const pb = await getPocketBase();
      try {
        await pb.collections.getOne(COLLECTION);
        return true;
      } catch {
        /* n'existe pas → on crée */
      }
      try {
        await pb.collections.create({
          name: COLLECTION,
          type: 'base',
          schema: [
            { name: 'room', type: 'text', required: true },
            { name: 'circuit', type: 'text', required: true },
            { name: 'playerId', type: 'text', required: true },
            { name: 'name', type: 'text', required: true },
            { name: 'ms', type: 'number', required: true },
          ],
          indexes: [
            `CREATE UNIQUE INDEX idx_lap_unique ON ${COLLECTION} (room, circuit, playerId)`,
          ],
        });
        return true;
      } catch (err) {
        console.warn('[race] création collection lap_times échouée', err);
        return false;
      }
    })().catch((err) => {
      console.warn('[race] ensureCollection échouée', err);
      return false;
    });
  }
  return ensurePromise;
}

/** Charge le classement persistant d'un circuit (vide si PB indispo). */
export async function loadLeaderboard(room: string, circuit: string): Promise<LeaderboardEntry[]> {
  if (!pbEnabled()) return [];
  try {
    if (!(await ensureCollection())) return [];
    const pb = await getPocketBase();
    const recs = await pb.collection(COLLECTION).getFullList({
      filter: `room=${JSON.stringify(room)} && circuit=${JSON.stringify(circuit)}`,
      sort: 'ms',
    });
    return recs.map((r) => ({
      playerId: String(r.playerId),
      name: String(r.name),
      ms: Number(r.ms),
    }));
  } catch (err) {
    console.warn('[race] loadLeaderboard échouée', err);
    return [];
  }
}

/** Upsert le meilleur tour d'un joueur (uniquement si meilleur qu'en base). */
export async function saveBest(room: string, circuit: string, e: LeaderboardEntry): Promise<void> {
  if (!pbEnabled()) return;
  try {
    if (!(await ensureCollection())) return;
    const pb = await getPocketBase();
    const existing = await pb.collection(COLLECTION).getFullList({
      filter:
        `room=${JSON.stringify(room)} && circuit=${JSON.stringify(circuit)} ` +
        `&& playerId=${JSON.stringify(e.playerId)}`,
    });
    if (existing.length > 0) {
      if (e.ms < Number(existing[0]!.ms)) {
        await pb.collection(COLLECTION).update(existing[0]!.id, { name: e.name, ms: e.ms });
      }
    } else {
      await pb.collection(COLLECTION).create({
        room,
        circuit,
        playerId: e.playerId,
        name: e.name,
        ms: e.ms,
      });
    }
  } catch (err) {
    console.warn('[race] saveBest échouée', err);
  }
}
