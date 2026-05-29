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
export async function runCleanup(uploadsDir = DEFAULT_UPLOADS_DIR) {
    let roomDirs;
    try {
        roomDirs = await fs.readdir(uploadsDir);
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT')
            return; // pas encore de dossier, pas grave
        console.warn('[uploads/cleanup] cannot read', uploadsDir, err);
        return;
    }
    const now = Date.now();
    let deleted = 0;
    for (const roomSlug of roomDirs) {
        // Sécurité : sauter les entrées non-slug (évite path traversal sur les
        // noms de répertoires eux-mêmes, même si on les contrôle).
        if (!/^[a-z0-9-]{1,50}$/.test(roomSlug))
            continue;
        const roomDir = join(uploadsDir, roomSlug);
        let files;
        try {
            files = await fs.readdir(roomDir);
        }
        catch {
            continue;
        }
        for (const filename of files) {
            const filePath = join(roomDir, filename);
            try {
                const stat = await fs.stat(filePath);
                if (!stat.isFile())
                    continue;
                const age = now - stat.mtimeMs;
                if (age > RETENTION_MS) {
                    await fs.unlink(filePath);
                    deleted++;
                }
            }
            catch {
                // fichier déjà supprimé ou locked — on ignore
            }
        }
    }
    if (deleted > 0) {
        console.log(`[uploads/cleanup] deleted ${deleted} expired file(s)`);
    }
}
let _cleanupTimer = null;
/**
 * Lance le cleanup immédiatement puis toutes les 6h.
 * À appeler une seule fois au démarrage du serveur.
 */
export function startCleanupSchedule(uploadsDir) {
    // Run immediately (fire-and-forget).
    void runCleanup(uploadsDir);
    // Then every 6h.
    _cleanupTimer = setInterval(() => {
        void runCleanup(uploadsDir);
    }, CLEANUP_INTERVAL_MS);
    // Don't block process exit.
    _cleanupTimer.unref?.();
}
//# sourceMappingURL=uploadsCleanup.js.map