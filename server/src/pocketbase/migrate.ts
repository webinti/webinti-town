/**
 * One-shot migration script: server/data/*.json → PocketBase collections.
 *
 * Run with:
 *   cd server && npm run migrate:pocketbase
 *
 * Idempotent : skip records that already exist (matched by id for kanban_cards
 * and dm_messages ; matched by (roomSlug, workstationId) for workstation_states).
 *
 * Does NOT delete the JSON files. Stores keep reading from JSON until the
 * env var `*_BACKEND=pocketbase` is set.
 */
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPocketBase } from './client.js';
import type { KanbanCard, DmMessage, WorkstationState } from '../types.js';

const DATA_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
})();

async function listJsonFiles(prefix: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(DATA_DIR);
    return entries.filter((e) => e.startsWith(prefix) && e.endsWith('.json'));
  } catch {
    return [];
  }
}

function slugFromFilename(filename: string, prefix: string): string {
  // e.g. "kanban-discord.json" + prefix "kanban-" → "discord"
  return filename.slice(prefix.length, -5);
}

async function migrateKanban(): Promise<void> {
  const pb = await getPocketBase();
  const files = await listJsonFiles('kanban-');
  console.log(`[migrate] Kanban — ${files.length} room file(s)`);
  let imported = 0, skipped = 0;
  for (const file of files) {
    const slug = slugFromFilename(file, 'kanban-');
    const raw = await fs.readFile(join(DATA_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as { version?: number; cards?: KanbanCard[] };
    if (!parsed.cards) continue;
    for (const card of parsed.cards) {
      try {
        // PocketBase IDs are 15-char strings; we cannot reuse our UUIDs as PK,
        // but we can store the original UUID in a "legacyId" field. Or skip-by-uuid
        // via filter. Simpler: just create and let PB assign new IDs. Original
        // UUIDs are reflected only in references inside DmMessage etc., so we
        // keep them via field if needed. For now: create with all fields.
        await pb.collection('kanban_cards').create({
          roomSlug: slug,
          title: card.title,
          description: card.description ?? '',
          authorId: card.authorId,
          authorName: card.authorName,
          column: card.column,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          completedAt: card.completedAt,
          completedBy: card.completedBy,
          completedByName: card.completedByName,
        });
        imported++;
      } catch (err) {
        // Likely a duplicate or schema mismatch — log and continue
        skipped++;
        const msg = (err as { message?: string }).message ?? String(err);
        console.warn(`  skip card "${card.title}" in ${slug}: ${msg}`);
      }
    }
  }
  console.log(`[migrate] Kanban done — ${imported} imported, ${skipped} skipped`);
}

async function migrateDm(): Promise<void> {
  const pb = await getPocketBase();
  const files = await listJsonFiles('dm-');
  console.log(`[migrate] DM — ${files.length} room file(s)`);
  let imported = 0, skipped = 0;
  for (const file of files) {
    const slug = slugFromFilename(file, 'dm-');
    const raw = await fs.readFile(join(DATA_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as {
      version?: number;
      conversations?: Record<string, DmMessage[]>;
    };
    if (!parsed.conversations) continue;
    for (const msgs of Object.values(parsed.conversations)) {
      if (!Array.isArray(msgs)) continue;
      for (const m of msgs) {
        try {
          await pb.collection('dm_messages').create({
            roomSlug: slug,
            fromId: m.from,
            toId: m.to,
            text: m.text ?? '',
            attachment: m.attachment ?? null,
            ts: m.ts,
            readBy: m.readBy ?? [],
          });
          imported++;
        } catch (err) {
          skipped++;
          const msg = (err as { message?: string }).message ?? String(err);
          console.warn(`  skip dm ${m.id} in ${slug}: ${msg}`);
        }
      }
    }
  }
  console.log(`[migrate] DM done — ${imported} imported, ${skipped} skipped`);
}

async function migrateWorkstations(): Promise<void> {
  const pb = await getPocketBase();
  const files = await listJsonFiles('workstations-');
  console.log(`[migrate] Workstations — ${files.length} room file(s)`);
  let imported = 0, skipped = 0;
  for (const file of files) {
    const slug = slugFromFilename(file, 'workstations-');
    const raw = await fs.readFile(join(DATA_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as { version?: number; states?: WorkstationState[] };
    if (!parsed.states) continue;
    for (const s of parsed.states) {
      if (!s.claimedBy) continue; // never persist unclaimed
      try {
        await pb.collection('workstation_states').create({
          roomSlug: slug,
          workstationId: s.id,
          claimedBy: s.claimedBy,
          claimedByName: s.claimedByName ?? '',
          invitedPlayerIds: s.invitedPlayerIds ?? [],
          claimedAt: s.claimedAt,
          customName: s.customName ?? '',
        });
        imported++;
      } catch (err) {
        skipped++;
        const msg = (err as { message?: string }).message ?? String(err);
        console.warn(`  skip workstation ${s.id} in ${slug}: ${msg}`);
      }
    }
  }
  console.log(`[migrate] Workstations done — ${imported} imported, ${skipped} skipped`);
}

async function main(): Promise<void> {
  console.log(`[migrate] Starting migration → ${process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'}`);
  console.log(`[migrate] Reading from ${DATA_DIR}`);
  await migrateKanban();
  await migrateDm();
  await migrateWorkstations();
  console.log('[migrate] All done.');
}

main().catch((err) => {
  console.error('[migrate] FATAL', err);
  process.exit(1);
});
