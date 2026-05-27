# Pièces jointes dans le chat — Design (F9)

**Date** : 2026-05-27
**Statut** : design validé

## Objectif

Permettre d'attacher jpg / png / svg / pdf (≤ 5 MB) à un message chat. Stockage disque par room, rétention 30 jours, support chat global ET local (proximité).

## Limites

- **Types autorisés** : `image/jpeg`, `image/png`, `image/svg+xml`, `application/pdf`. Détectés via signature magic bytes (pas seulement Content-Type).
- **Taille max** : 5 MB par fichier (5_242_880 bytes).
- **Rate-limit** : 3 uploads / minute / socket (au-delà : 429).
- **Total par room** : pas de limite explicite v1, mais le nettoyage 30 j contient la croissance.

## Modèle

**Storage** : `server/data/uploads/<roomSlug>/<uuid>.<ext>` (ex : `server/data/uploads/discord/a3f8...e2.png`).

**ChatMessage extended** :
```ts
interface ChatMessage {
  // ...existing fields
  attachment?: {
    url: string;          // /api/uploads/<roomSlug>/<uuid>.<ext>
    filename: string;     // sanitized original (max 80 chars)
    mimeType: 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'application/pdf';
    sizeBytes: number;
  };
}
```

## Protocole

**HTTP POST `/api/uploads/:roomSlug`** :
- multipart/form-data, single field `file`.
- Auth implicite via cookie session OU header `x-client-key` (le client envoie son clientKey persisté pour qu'on vérifie qu'il est bien dans la room).
- Réponse 200 : `{ url, filename, mimeType, sizeBytes }`.
- Erreurs : 413 (too large), 415 (bad type), 429 (rate limit), 403 (not in room), 400 (other validation).

**HTTP GET `/api/uploads/:roomSlug/:filename`** :
- Sert le fichier statique. Pas de protection au-delà : on assume « si tu connais l'URL, tu peux voir » (URL = UUID = impossible à deviner).
- `Content-Disposition: inline` pour les images, `attachment; filename="..."` pour PDF (download).

**Socket flow** :
1. User sélectionne fichier dans ChatPanel → upload via `fetch('/api/uploads/<slug>', { method: 'POST', body: formData })`.
2. Réponse OK → l'user peut maintenant taper du texte (optionnel) puis envoyer.
3. À l'envoi du message, le client emit `chat_message` avec le champ `attachment` (objet `{ url, filename, mimeType, sizeBytes }`).
4. Serveur valide l'attachment fait référence à un fichier existant sous le bon roomSlug (sinon strip silencieusement) puis broadcast normalement.

## Rétention

Au démarrage du serveur + toutes les 6 h, scanner `server/data/uploads/` et supprimer tout fichier dont mtime > 30 jours. Pas besoin d'index/DB — c'est le filesystem qui est la source de vérité.

## Permissions

- Upload : doit être membre de la room (vérification via `clientKey` → playerId dans `roomManager`).
- Lecture : public via URL (URLs aléatoires UUID, pas devinables).
- Suppression manuelle : v1 non, le nettoyage 30 j suffit. Hors scope.

## UX

- Dans `ChatPanel` : bouton 📎 à côté du champ texte.
- Click → ouvre `<input type="file" accept="image/jpeg,image/png,image/svg+xml,application/pdf" />`.
- Pendant l'upload : spinner, le bouton « Envoyer » est désactivé.
- Une fois l'upload OK : preview thumbnail (50×50 pour image, icône PDF) à droite du champ, avec un bouton « ✕ retirer ».
- Envoi du message inclut l'attachment.
- Rendu dans le chat :
  - Image (jpg/png/svg) : thumbnail max 240×240, click → ouvre l'URL dans un nouvel onglet.
  - PDF : carte cliquable « 📄 nom-du-fichier.pdf (1.2 MB) » qui télécharge.
- Si la PJ ne se charge pas (404), afficher « ⚠️ pièce jointe indisponible ».

## Sécurité

- **MIME spoofing** : validation par magic bytes via `file-type` package OU custom :
  - JPEG : `FF D8 FF`
  - PNG : `89 50 4E 47`
  - PDF : `25 50 44 46` (`%PDF`)
  - SVG : `<svg` ou `<?xml ... <svg` après normalisation.
- **SVG XSS** : les SVG peuvent contenir du `<script>`. On STRIP les balises `<script>`, `<foreignObject>`, et tous les attributs `on*` avant écriture sur disque. (Bibliothèque DOMPurify côté serveur, ou regex strict si on évite la dépendance.)
- **Path traversal** : le nom de fichier stocké est un UUID + extension validée, jamais le nom client. Le serveur ne fait JAMAIS `path.join(slug, userProvidedName)`.
- **Quota disque** : pas de mécanisme dur en v1. Le nettoyage 30 j devrait suffire pour un usage normal. À surveiller.

## Architecture code

**Serveur** :
- `server/src/uploads/` (nouveau dossier) :
  - `uploadsRouter.ts` — express router pour POST `/api/uploads/:slug` et GET `/api/uploads/:slug/:filename`.
  - `validateUpload.ts` — magic bytes check + SVG sanitization.
  - `uploadsCleanup.ts` — scan + delete > 30 j, lancé au startup et via setInterval(6h).
- `server/package.json` : ajouter `multer` (parsing multipart) et `dompurify` + `jsdom` pour SVG cleaning.
- `server/src/index.ts` : monter le router sur `/api/uploads`, lancer cleanup au boot.
- `server/src/types.ts` : étendre `ChatMessage` avec optional `attachment`.
- `server/src/socket/handlers.ts` : dans `chat_message`, accepter `attachment` champ, valider qu'il référence bien un fichier existant pour ce slug, sinon strip.

**Client** :
- `client/src/types.ts` : mirror `ChatMessage.attachment`.
- `client/src/react/components/ChatPanel.tsx` : ajouter le bouton 📎, state local pour le file selected + uploadStatus, fetch vers `/api/uploads/<slug>`, intégration dans le payload d'envoi.
- `client/src/react/components/ChatPanel.tsx` (rendu) : composant `<AttachmentView attachment={msg.attachment} />` pour image/PDF.

## Tests

- `server/src/uploads/validateUpload.test.ts` : magic bytes pour chaque type, rejet d'un .exe renommé .png, SVG avec `<script>` strippé.
- `server/src/uploads/uploadsCleanup.test.ts` : fichier > 30 j supprimé, fichier récent gardé.
- Pas de tests client (UX).

## Hors scope (YAGNI)

- Drag & drop dans le chat.
- Multi-fichiers par message.
- Vidéos, audio (l'app a déjà LiveKit).
- Aperçu OCR / preview rendu PDF.
- Reconnaissance des liens dans le message texte.
