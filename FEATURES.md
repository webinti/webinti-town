# Webinti Town — Listing complet des features

Clone de Gather.Town construit pour héberger des lives de formation (~20 participants).
URL prod cible : `live.webinti.com`. Repo : https://github.com/webinti/webinti-town

---

## 1. Onboarding & avatar

- **Aucun login, aucun email** — accès direct via un lien
- **Pseudo libre** (max 20 caractères)
- **Avatar composable** : 5 dimensions indépendantes
  - Peau (3 carnations)
  - Coiffure (6 styles : aucun, court, mi-long, queue de cheval, casquette, mohawk)
  - Couleur de cheveux (6)
  - T-shirt (10 couleurs)
  - Pantalon (6 couleurs)
  - **6 480 combinaisons possibles**
- **Aperçu en direct** dans l'écran de connexion pendant la personnalisation
- **Persistance localStorage** : pseudo + apparence sauvegardés, retrouvés à chaque retour

---

## 2. Monde 2D & déplacement

- **Carte tilemap 60×42** au format Tiled (éditable visuellement avec Tiled Map Editor)
- **6 zones thématiques** : jardin extérieur, réception, open space (rangées de bureaux), cuisine, salle de réunion, focus pods (avec arcade, billard, piano)
- **256 tuiles** dans le tileset (sols, murs avec fenêtres, mobilier, déco)
- **Déplacement** : WASD ou flèches, 160 px/sec
- **Collisions** sur murs et mobilier (les portes sont traversables)
- **Caméra fluide** qui suit le joueur avec lerp 0.1
- **Animations de marche 4 directions** : avatar qui tourne (haut/bas/gauche/droite), jambes et bras qui s'animent à 6Hz
- **Visage visible uniquement face caméra** (eyes + bouche) — back/profil pour les autres directions
- **Minimap** en bas à droite avec position des joueurs en temps réel

---

## 3. Audio & vidéo de proximité (cœur du concept Gather)

- **WebRTC via LiveKit** (SFU) — qualité prod, jusqu'à 100+ participants
- **Subscribe/unsubscribe automatique** selon la distance (4Hz)
- **Atténuation linéaire du volume** entre 96px (volume plein) et 160px (silence)
- **Bar vidéo dynamique** en haut : tu vois en temps réel les vignettes des seuls joueurs proches
- **Toggle micro / caméra** indépendants (raccourcis **M** et **V**)
- **Demande de permission** native du navigateur au premier toggle

---

## 4. Partage d'écran

- **Bouton "Écran"** → sélecteur natif (onglet / fenêtre / écran complet)
- **Panneau dédié** au-dessus des vignettes vidéo, surligné en indigo
- **Diffusion sur rayon étendu** : un objet "écran" placé sur la map diffuse à toute la salle de réunion (16 tuiles autour, ~3× le rayon normal) — comme dans Gather, idéal pour présenter
- **Audio bidirectionnel** dans le rayon étendu (le présentateur entend les questions)

---

## 5. Communication

### Chat textuel
- **Panneau side** rétractable, raccourci **C**
- **2 modes** : Global (toute la salle) et Proximité (seulement les joueurs proches)
- **Historique 200 messages**, 50 derniers transmis aux nouveaux arrivants
- **Badge de messages non lus**
- **Auto-scroll** + persistance de la position de scroll quand on bascule
- **Validation serveur** : sanitize HTML, max 300 chars, rate-limit 5 msg/sec

### Emotes
- **6 emojis** (👋 👍 😂 ❤️ ❓ ❗) — touches **1-6** ou clic
- **Affichage flottant** au-dessus de l'avatar avec animation bounce, fade après 2.5s
- **Empilement vertical** si spam
- **Applaudissement collectif** : quand 2+ joueurs émotent en moins de 2s, son d'applaudissement synthétisé (bruit blanc filtré multi-claps)

---

## 6. Collaboration

### Tableau blanc collaboratif
- **Objet "tableau" interactif** placé sur la map (lounge zone)
- **Modal canvas plein écran** au clic sur **E**
- **Outils** : 8 couleurs, 3 tailles de pinceau, gomme, "Effacer tout"
- **Synchronisation temps réel** des traits via Socket.IO
- **Historique persistant** dans la session : un nouvel arrivant voit tous les dessins précédents
- **Cap 5000 traits** par tableau

### Framework d'objets interactifs
- 4 types : screen | whiteboard | note | link (les 2 derniers stubbés, prêts à brancher)
- Indication visuelle "[E] Interact" quand le joueur s'approche
- Architecture extensible côté serveur (discriminated union)

---

## 7. Enregistrement de session

- **Bouton "Enregistrer"** (visible uniquement par l'hôte)
- **Pause / Reprendre** (chrono freeze)
- **Mix audio configurable** :
  - Audio des participants (LiveKit direct, fonctionne même si tu partages un autre onglet/fenêtre)
  - Micro local (toggle)
  - Audio de l'onglet capturé (si applicable)
- **Sortie WebM** téléchargé automatiquement à l'arrêt
- **Indicateur visible par tous** : badge rouge "🔴 Enregistrement par {hôte}" affiché aux autres participants
- **Compatible avec n'importe quoi** : tu peux partager tes slides, ton IDE, ce que tu veux — l'audio des participants est mixé via LiveKit indépendamment

---

## 8. Système d'hôte

- **Token URL** : `?host=<secret>` au premier accès, sauvé en localStorage
- **Premier-arrivé fallback** si personne ne détient le token
- **Promotion automatique** : si l'hôte quitte, le suivant est promu
- **Pill "Hôte"** orange dans le top bar (visible par toi)
- **Privilèges hôte** :
  - Lancer/arrêter l'enregistrement (les autres ne le peuvent pas)
  - Ouvrir l'admin panel

---

## 9. Modération (admin panel host-only)

- **Modal admin** accessible via bouton **👥 Admin** dans le top-right
- **Liste des joueurs** avec point coloré (couleur du t-shirt) + pseudo
- **Actions par joueur** :
  - **Mute** — coupe leur micro côté LiveKit (server-side)
  - **Kick** — les déconnecte (ils retournent au JoinScreen avec un message)
- **Actions globales** :
  - **Tout muter** (sauf l'hôte)
  - **Fermer la salle** (déconnecte tous les non-hôtes, avec confirmation)
- **Validation serveur** : seul l'hôte peut déclencher ces actions

---

## 10. Mode fantôme

- **Touche G** → ton avatar devient semi-transparent (alpha 50%)
- **Visible par tous les autres** (pas juste local)
- Toggle libre, à tout moment
- Utile pour traverser un groupe sans gêner visuellement

---

## 11. UX & polish

- **Help panel** (raccourci **H** ou **?**) listant tous les raccourcis classés par catégorie
- **Sons synthétisés** (Web Audio API, zéro asset à charger) :
  - Pop d'arrivée (sweep ascendant)
  - Sweep descendant au départ
  - Double bip de chat (uniquement pour les messages des autres)
  - Applaudissement (3 secondes, multi-claps overlapped)
- **Toggle son global** 🔊/🔇 dans le HUD
- **Notifications visuelles** : bandeau rouge en cas de kick, banner d'erreurs LiveKit
- **Édition de map à la souris** via Tiled Map Editor (gratuit) — fichier `.tmj` natif, hot-reload Vite

---

## 12. Stack technique

| Couche | Techno |
|---|---|
| Frontend | Vite + React 18 + TypeScript strict + Phaser 3 + Tailwind |
| State | Zustand |
| Backend | Node.js + Express + Socket.IO + TypeScript strict |
| Real-time A/V | LiveKit (SFU Go, self-hosted via Homebrew) |
| Persistence | In-memory (Postgres prévu pour plus tard) |
| Build | Vite (HMR), tsx watch (server) |
| Repo | https://github.com/webinti/webinti-town |

### Architecture en 1 phrase
Phaser dessine la map et les avatars dans un canvas, React superpose le HUD via DOM, Socket.IO sync les positions à 20Hz et la proximité à 4Hz, LiveKit gère les flux WebRTC avec subscribe/unsubscribe pilotés par la proximité serveur.

---

## 13. Raccourcis clavier complets

| Touche | Action |
|---|---|
| WASD / Flèches | Déplacer l'avatar |
| M | Toggle micro |
| V | Toggle caméra |
| C | Ouvrir/fermer le chat |
| 1-6 | Emotes (👋 👍 😂 ❤️ ❓ ❗) |
| E | Interagir avec un objet (écran, tableau, ...) |
| G | Mode fantôme |
| H ou ? | Help panel |
| Esc | Fermer une fenêtre / défocus |

---

## 14. Ce qui n'est PAS encore là (transparence)

- Persistence base de données (rooms perdues au redémarrage serveur)
- URL de room paramétrable (une seule salle `demo` pour l'instant)
- UI popup pour les objets `note` et `link` (framework prêt, UI manque)
- Templates de map multiples
- Transfert d'host manuel via UI
- Setup déploiement prod (HTTPS, TURN, domaine)
