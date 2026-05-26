# Kanban d'idées collaboratif — Design

**Date** : 2026-05-26
**Statut** : design validé, prêt pour plan d'implémentation

## Objectif

Permettre aux utilisateurs d'une room de proposer des idées / améliorations sous forme de cartes Kanban (3 colonnes : À faire / En cours / Terminé), avec un système de permissions stricte (auteur gère sa carte, hôte marque Terminé) et persistance sur disque pour survivre aux restarts du serveur.

## Modèle de données

### Carte (`KanbanCard`)

```ts
interface KanbanCard {
  id: string;                    // uuid v4
  title: string;                 // 1..80 chars, trim()
  description: string;           // 0..500 chars
  authorId: string;              // playerId du créateur
  authorName: string;            // snapshot du nom à la création (immutable)
  column: 'todo' | 'doing' | 'done';
  createdAt: number;             // Date.now()
  updatedAt: number;             // bumped sur edit title/description ou move
  completedAt: number | null;    // timestamp où la carte est entrée dans 'done'
  completedBy: string | null;    // playerId de l'hôte qui a marqué done
  completedByName: string | null;
}
```

### Board

```ts
interface KanbanBoard {
  cards: KanbanCard[];           // ordre = ordre d'affichage dans chaque colonne
}
```

L'ordre des cartes dans `cards` détermine l'ordre vertical d'affichage dans leur colonne. Réordonner manuellement dans une colonne n'est **pas** dans le scope v1 — on garde l'ordre d'insertion (créées en haut de "À faire").

## Persistance

- Fichier par room : `server/data/kanban-<roomSlug>.json`
- Format : `{ "version": 1, "cards": [...] }` (la version permet une migration future)
- Dossier `server/data/` créé au démarrage si absent
- `.gitignore` : `server/data/*.json` (garde un `.gitkeep`)
- Lecture **une fois** à la première création de la room (lazy load)
- Écriture **atomique** sur chaque mutation : `fs.writeFile(path + '.tmp')` puis `fs.rename(...)` → pas de fichier corrompu en cas de crash
- Si lecture échoue (fichier absent ou JSON invalide) : démarrer avec board vide + log warning, ne pas crasher

## Permissions

Toute permission est **vérifiée côté serveur**. Le client peut afficher/cacher des contrôles pour l'UX, mais une requête non autorisée est silencieusement ignorée (le `kanban:state` broadcast après tout op réussie réaligne l'état si jamais un client était désynchronisé).

| Action            | Auteur de la carte | Hôte | Autres |
|-------------------|--------------------|------|--------|
| Lire le board     | ✅ | ✅ | ✅ |
| Créer une carte (apparaît en haut de 'À faire', authorId = soi) | ✅ | ✅ | ✅ |
| Éditer titre/description de SA carte | ✅ | ❌ | ❌ |
| Supprimer SA carte | ✅ | ❌ | ❌ |
| Déplacer SA carte entre `todo` ↔ `doing` | ✅ | ❌ | ❌ |
| Déplacer n'importe quelle carte vers `done` (marquer terminé) | ❌ | ✅ | ❌ |
| Réactiver une carte `done` → `doing` | ❌ | ✅ | ❌ |
| Déplacer la carte d'un autre vers `todo` ou `doing` | ❌ | ❌ | ❌ |

**Cas explicitement exclus** :
- L'hôte ne peut **pas** éditer ni supprimer la carte d'un autre joueur — il peut seulement marquer terminé / réactiver.
- L'auteur ne peut **pas** déplacer sa propre carte vers `done` — c'est exclusivement à l'hôte de valider.

## Protocole réseau (Socket.IO)

### Client → Serveur

```ts
'kanban:create'  payload: { title: string; description: string }
'kanban:update'  payload: { cardId: string; title?: string; description?: string }
'kanban:move'    payload: { cardId: string; column: 'todo' | 'doing' | 'done' }
'kanban:delete'  payload: { cardId: string }
```

### Serveur → Room (broadcast à tous les clients de la room)

```ts
'kanban:state'   payload: { cards: KanbanCard[] }
```

Le serveur émet `kanban:state` :
- À chaque mutation réussie (broadcast room-wide)
- À chaque join de room (envoyé seulement au client qui rejoint)

**Pourquoi full snapshot et pas diff** : simplicité. Avec quelques dizaines de cartes (cas réaliste), le JSON fait <5 KB. Pas de bug de désynchronisation possible.

### Validation serveur

- `title` : trim, longueur 1..80 → sinon ignorer
- `description` : trim, longueur 0..500 → tronquer si > 500 plutôt que rejeter
- `column` ∈ enum → sinon ignorer
- `cardId` doit exister → sinon ignorer
- Vérification de permission selon table ci-dessus → sinon ignorer
- Logs serveur en `console.warn` pour les requêtes refusées (utile en debug, pas de spam)

## UX — Accès dans le monde

Un nouvel objet interactif placé sur la map :

```ts
{
  id: 'kanban-ideas-1',
  type: 'kanban',
  x: 10 * 32,                 // tile (10, 36) — 2 tiles à droite du whiteboard
  y: 36 * 32,
  data: {}                    // les cartes sont gérées séparément, pas dans data
}
```

Visuellement sur la map : un petit panneau type "post-it board" (texte/icône). Le texte d'interaction proximité : « Appuyer sur E pour ouvrir le tableau d'idées ».

Le store client a un `openKanban: string | null` (id de la carte, comme `openWhiteboard`). Quand le joueur appuie E à proximité, `setOpenKanban(obj.id)` → `KanbanModal` se monte.

## UX — Modal `KanbanModal.tsx`

### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Tableau d'idées                                              [×]   │
├──────────────┬──────────────────┬──────────────────────────────────┤
│  À faire     │  En cours        │  Terminé                         │
│ [+ Nouvelle] │                  │                                  │
│              │                  │                                  │
│ ┌──────────┐ │  ┌──────────┐    │  ┌──────────────────────┐        │
│ │ Carte 1  │ │  │ Carte 3  │    │  │ Carte 5 (Terminée)   │        │
│ │ desc...  │ │  │ desc...  │    │  │ desc...              │        │
│ │ Marie 2h │ │  │ Tim 5h   │    │  │ Marie · Term. par H. │        │
│ └──────────┘ │  └──────────┘    │  └──────────────────────┘        │
│ ┌──────────┐ │                  │                                  │
│ │ Carte 2  │ │                  │                                  │
│ └──────────┘ │                  │                                  │
└──────────────┴──────────────────┴──────────────────────────────────┘
```

### Carte affichée

- Titre (font-semibold)
- Description (max 3 lignes visibles avec `line-clamp-3`, expand au clic)
- Méta footer : `Auteur · il y a X` + si done `Terminé par Hôte il y a Y`
- Icônes au survol (selon permissions) :
  - Si auteur sur sa carte non-done : ✏️ éditer, 🗑 supprimer
  - Si hôte sur n'importe quelle carte non-done : ✓ Terminer
  - Si hôte sur carte done : ↩ Réactiver
- Style fond pastel selon colonne (à faire = jaune léger, en cours = bleu léger, terminé = vert léger)

### Création (clic "+ Nouvelle")

Mini-form inline en haut de "À faire" :
- Input titre (autofocus, max 80)
- Textarea description (max 500, optionnelle)
- Boutons "Ajouter" / "Annuler"
- Submit → emit `kanban:create` + ferme le form

### Édition

Clic ✏️ → la carte se transforme en form inline (mêmes inputs préremplis). Submit → `kanban:update`.

### Drag-and-drop

- HTML5 natif (`draggable`, `onDragStart`, `onDragOver`, `onDrop`)
- Une carte est `draggable` uniquement si l'utilisateur a la permission de la déplacer vers AU MOINS une autre colonne (sinon `draggable={false}` direct).
- Sur `onDragOver` d'une colonne cible : tester si le drop est autorisé, sinon `event.preventDefault = false` (= curseur "not-allowed") et changer le visuel de la colonne (overlay rouge subtil).
- Sur `onDrop` autorisé : emit `kanban:move`.

### Helper de relative time

`il y a X` calculé côté client avec une petite fn : `<1min`, `<1h`, `<24h`, `<7j`, sinon date ISO courte. Re-render naturel à chaque `kanban:state` reçu.

## Architecture code

### Nouveaux fichiers

```
server/src/kanban/
  KanbanStore.ts          # state + persistance JSON + validation
  kanbanSocket.ts         # wire les handlers Socket.IO

server/data/
  .gitkeep                # commité pour que le dossier existe

client/src/react/components/
  KanbanModal.tsx         # UI complète (~350 lignes attendues)
  kanbanRelativeTime.ts   # helper isolé pour testabilité

docs/superpowers/specs/
  2026-05-26-kanban-ideas-design.md   # ce fichier
```

### Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `server/src/types.ts` | + `KanbanCard`, `KanbanBoard`; étendre `InteractiveObject` avec `{ type: 'kanban', data: {} }` |
| `server/src/rooms/RoomManager.ts` | + objet kanban dans `defaultInteractiveObjects`; instancier un `KanbanStore` par room |
| `server/src/socket/index.ts` | + appel à `wireKanbanHandlers(io, socket, room)` |
| `.gitignore` | + `server/data/*.json` |
| `client/src/types.ts` | mirror types serveur |
| `client/src/network/SocketManager.ts` | + emit helpers + listener `kanban:state` |
| `client/src/stores/gameStore.ts` | + `openKanban`, `setOpenKanban`, `kanbanBoard`, `setKanbanBoard` |
| `client/src/phaser/scenes/GameScene.ts` | + rendu visuel pour `type === 'kanban'`, hint texte, ouverture sur E |
| `client/src/react/HUD.tsx` | + monter `<KanbanModal>` si `openKanban` |
| `client/public/maps/default.tmj` | placer un sprite "panneau Kanban" tile (10, 36) si besoin (sinon juste l'objet interactif suffit côté serveur) |

### `KanbanStore` (serveur) — API publique

```ts
class KanbanStore {
  constructor(roomSlug: string);
  getCards(): KanbanCard[];

  // Toutes ces méthodes retournent true en cas de succès, false si refusé
  // (permission, validation). Le caller broadcast 'kanban:state' si true.
  create(authorId: string, authorName: string, title: string, description: string): boolean;
  update(actorId: string, cardId: string, patch: { title?: string; description?: string }): boolean;
  move(actorId: string, isHost: boolean, cardId: string, column: KanbanColumn): boolean;
  delete(actorId: string, cardId: string): boolean;
}
```

Persistance interne : `private save(): void` debounce 100ms (évite de réécrire à chaque touche de clavier si une rafale arrive ; en pratique chaque modif passe par une commande discrète donc le debounce est une assurance, pas un besoin critique).

### Tests prévus

- `server/src/kanban/KanbanStore.test.ts` (vitest) :
  - création OK / titre vide rejeté / titre > 80 rejeté
  - update par auteur OK / par autre rejeté
  - delete par auteur OK / par autre rejeté
  - move auteur todo↔doing OK / vers done rejeté
  - move hôte vers done OK / non-hôte rejeté
  - move hôte done→doing OK (réactivation)
  - persistance : créer, instancier nouveau store sur même slug → lit le JSON
- `client/src/react/components/kanbanRelativeTime.test.ts` : cas limites (<1min, ~1h, ~24h, jours)

## Cas non couverts (YAGNI explicite)

- Réordonnage manuel dans une colonne (drag dans la même colonne)
- Tags / labels couleur
- Pièces jointes / images
- Mentions / notifications
- Commentaires sur cartes
- Multi-hôte (un seul hôte par room actuellement)
- Pagination si milliers de cartes
- Soft-delete / corbeille
- Export

Si un de ces besoins remonte, on fera une itération séparée.

## Risques connus

- **Concurrence** : 2 clients qui modifient la même carte en même temps. Dernière écriture gagne (last-write-wins). Acceptable pour ce cas d'usage (peu de contention attendue, l'UI montre l'état actuel après chaque broadcast).
- **Taille du fichier JSON** : si une room a 10 000 cartes, le rewrite atomique à chaque modif devient coûteux. Acceptable pour la v1 (réaliste < 100 cartes par room).
- **Pas de chiffrement au repos** : les idées sont en clair dans `server/data/`. Le VPS est privé, pas critique.
