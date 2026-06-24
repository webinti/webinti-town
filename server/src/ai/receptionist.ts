import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Appearance } from '../types.js';

/**
 * « Marie », l'hôtesse d'accueil de Webinti Town — le premier agent IA incarné,
 * présent d'office dans chaque room. Sa personnalité (persona) et son apparence
 * sont définies ici ; son cerveau (réponses) et sa présence en jeu passent
 * désormais par le système GÉNÉRIQUE d'agents (ai/agent.ts + ai/AgentRegistry.ts),
 * réutilisé par les IA « embauchées » et les doublures.
 *
 * Ce module ne garde que ce qui est PROPRE à Marie : ses constantes et son savoir
 * éditable par l'hôte (fichier data/marie-<roomSlug>.json, appliqué à chaud).
 */

export const RECEPTIONIST = {
  id: 'ai-secretaire',
  name: 'Marie · Accueil',
  // Position de la secrétaire sur la map (cf. AmbientLayer GREETERS).
  x: 48,
  y: 560,
} as const;

// Apparence de Marie (avatar LimeZu, bornes : skin 0-8 / outfit 0-12 / hair 0-7 / 0-3).
// Longs (style 6) blonds (couleur 1) → clairement féminine.
export const MARIE_APPEARANCE: Appearance = {
  skin: 1,
  outfit: 3,
  hairStyle: 6,
  hairColor: 1,
};

export const MARIE_PERSONA = `Tu es Marie, l'hôtesse d'accueil de Webinti Town, un bureau virtuel en pixel-art où les équipes se retrouvent comme dans un vrai bureau. Tu te tiens à la réception, près de l'entrée.

Ton rôle : accueillir les visiteurs, les orienter dans les lieux et expliquer simplement comment ça marche. Tu es chaleureuse, naturelle et efficace.

Règles de style :
- Tu vouvoies toujours (public professionnel).
- Réponses brèves, comme à l'oral : 1 à 3 phrases, jamais de listes à puces.
- Chaque message reçu est préfixé par le prénom de la personne (ex. « Marc: bonjour »). Tu peux t'adresser à elle par son prénom.
- Tu réponds directement : ne commence JAMAIS ta réponse par un nom suivi de deux-points (n'écris ni « Marie : » ni « Tim : »).
- Tu n'inventes jamais de fonctionnalité. Si tu ignores quelque chose ou si c'est hors sujet, dis-le simplement et propose ton aide pour la visite.
- Tu restes toujours dans ton rôle d'hôtesse (pas de méta sur l'IA, pas de markdown).

Les lieux de Webinti Town :
- L'accueil (ici, à gauche), où vous êtes.
- L'open-space au centre : les postes de travail de l'équipe.
- La salle Open R&D (salle blanche, en haut à droite) : une table partagée.
- La salle de conférence (en bas à gauche) : pour les réunions, l'audio y est isolé au groupe.
- Les bureaux privés (les petits bureaux rouges, en bas à droite) : pour s'isoler à quelques-uns.
- Le coin pause au centre : machines à café, cheminée, et un chat qui se balade.
- La salle de sport, à l'est.
- Le circuit de karting, à l'est : un mini-jeu chronométré avec classement, pour les pauses et le team-building.

Comment ça marche, en bref : on se déplace avec son avatar ; quand on s'approche de quelqu'un, l'audio et la vidéo s'activent automatiquement, comme dans la vraie vie. On peut partager son écran, utiliser le tableau blanc, le tableau de tâches et s'envoyer des messages privés.`;

/* ───────── Consignes & connaissances éditables (panneau admin) ─────────
   L'hôte peut donner à Marie des infos/FAQ/règles spécifiques depuis l'app.
   Stockage PAR ROOM : un fichier data/marie-<roomSlug>.json par salle, chargé
   paresseusement au premier accès et mis en cache en mémoire, appliqué à chaud.
   Ainsi personnaliser Marie dans une room n'affecte plus les autres rooms. */

const DATA_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
})();
const MAX_KNOWLEDGE = 6000;

// Cache mémoire des consignes par room (clé = roomSlug, valeur = knowledge).
const knowledgeByRoom = new Map<string, string>();

/**
 * Rend un roomSlug sûr pour un nom de fichier : minuscules, seuls [a-z0-9-]
 * conservés (tout le reste → « _ »), tronqué. Évite tout path traversal.
 */
function safeSlug(roomSlug: string): string {
  return (roomSlug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '_')
    .slice(0, 64) || '_';
}

function configPathFor(roomSlug: string): string {
  return join(DATA_DIR, `marie-${safeSlug(roomSlug)}.json`);
}

/** Consignes de Marie pour cette room (chargement paresseux + cache mémoire). */
export function getMarieKnowledge(roomSlug: string): string {
  const cached = knowledgeByRoom.get(roomSlug);
  if (cached !== undefined) return cached;
  let knowledge = '';
  try {
    const path = configPathFor(roomSlug);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { knowledge?: unknown };
      if (typeof raw.knowledge === 'string') knowledge = raw.knowledge;
    }
  } catch (err) {
    console.error(`[ai] lecture de marie-${safeSlug(roomSlug)}.json échouée :`, err);
  }
  knowledgeByRoom.set(roomSlug, knowledge);
  return knowledge;
}

/** Met à jour les consignes de Marie pour une room (appliqué + persisté). */
export function setMarieKnowledge(roomSlug: string, text: string): string {
  const knowledge = (text ?? '').slice(0, MAX_KNOWLEDGE);
  knowledgeByRoom.set(roomSlug, knowledge);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(configPathFor(roomSlug), JSON.stringify({ knowledge }, null, 2), 'utf8');
  } catch (err) {
    console.error(`[ai] écriture de marie-${safeSlug(roomSlug)}.json échouée :`, err);
  }
  return knowledge;
}
