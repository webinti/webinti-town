import type { AiAgentRecord, AiAgentState, Appearance } from '../types.js';
import {
  RECEPTIONIST,
  MARIE_PERSONA,
  MARIE_APPEARANCE,
  getMarieKnowledge,
} from './receptionist.js';

/**
 * Registre des agents IA incarnés d'une room. Source de vérité pour :
 *  - le RENDU (positions/apparences diffusées au client, sans le cerveau),
 *  - le ROUTAGE (trouver l'agent le plus proche d'un joueur qui parle),
 *  - la construction du PROMPT système par agent.
 *
 * Marie est l'agent « built-in » : chaque room en est dotée à sa création.
 */

/** Construit le record de Marie pour une room (savoir lu depuis son fichier). */
export function seedMarieAgent(roomSlug: string): AiAgentRecord {
  return {
    agentId: RECEPTIONIST.id,
    name: RECEPTIONIST.name,
    role: 'Accueil',
    appearance: MARIE_APPEARANCE,
    x: RECEPTIONIST.x,
    y: RECEPTIONIST.y,
    direction: 'down',
    kind: 'receptionist',
    badge: null,
    ownerPlayerId: null,
    persona: MARIE_PERSONA,
    knowledge: getMarieKnowledge(roomSlug),
    createdAt: Date.now(),
  };
}

/** Persona d'une IA « embauchée », bâtie depuis son nom + son rôle. */
export function buildEmployeePersona(name: string, role: string): string {
  const job = role.trim() || "membre de l'équipe";
  return `Tu es ${name}, ${job} de Webinti Town, un bureau virtuel en pixel-art où les équipes se retrouvent comme dans un vrai bureau. Tu es posté(e) à ton bureau ; quand une personne proche t'écrit dans le chat de proximité, tu lui réponds.

Ton rôle : ${job}.

Règles de style :
- Tu vouvoies toujours (public professionnel).
- Réponses brèves, comme à l'oral : 1 à 3 phrases, jamais de listes à puces.
- Chaque message reçu est préfixé par le prénom de la personne. Tu peux t'adresser à elle par son prénom.
- Tu réponds directement : ne commence JAMAIS ta réponse par un nom suivi de deux-points.
- Tu n'inventes pas. Si tu ignores quelque chose, dis-le simplement et propose ton aide.
- Tu restes dans ton rôle (pas de méta sur l'IA, pas de markdown).`;
}

/** Persona d'une doublure : garde le poste d'un joueur absent et répond en son nom. */
export function buildUnderstudyPersona(ownerName: string): string {
  return `Tu es la doublure IA de ${ownerName}, qui s'est momentanément absenté(e) de son poste dans Webinti Town, un bureau virtuel. Tu gardes sa place et réponds à sa place, en son nom, aux personnes qui passent.

Ton rôle : signaler poliment que ${ownerName} est absent(e), proposer de prendre un message, et répondre brièvement aux questions simples si tu connais la réponse.

Règles de style :
- Tu vouvoies toujours.
- Réponses brèves (1 à 2 phrases), naturelles, comme à l'oral.
- Si on te le demande, précise que tu es la doublure de ${ownerName}.
- Si on te confie un message pour ${ownerName}, confirme chaleureusement que tu le lui transmettras.
- Pas de markdown, pas de méta sur l'IA.`;
}

/** Assemble le prompt système complet d'un agent (persona + savoir + contexte live). */
export function buildAgentSystemPrompt(agent: AiAgentRecord, liveContext = ''): string {
  return (
    agent.persona +
    (agent.knowledge
      ? `\n\n# Consignes et connaissances spécifiques (à privilégier)\n${agent.knowledge}`
      : '') +
    (liveContext ? `\n\n# Contexte en temps réel\n${liveContext}` : '')
  );
}

/**
 * Agent le plus proche d'un point (x, y) dans le rayon donné, ou null.
 * Permet de router un message de proximité vers le bon persona.
 */
export function getNearestAgent(
  agents: Map<string, AiAgentRecord>,
  x: number,
  y: number,
  radiusPx: number,
): AiAgentRecord | null {
  let best: AiAgentRecord | null = null;
  let bestSq = radiusPx * radiusPx;
  for (const a of agents.values()) {
    const dx = a.x - x;
    const dy = a.y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestSq) {
      best = a;
      bestSq = d;
    }
  }
  return best;
}

/** Projette les records en état public (sans persona/knowledge) pour le client. */
export function toPublicAgents(agents: Map<string, AiAgentRecord>): AiAgentState[] {
  return [...agents.values()].map((a) => ({
    agentId: a.agentId,
    name: a.name,
    role: a.role,
    appearance: a.appearance,
    x: a.x,
    y: a.y,
    direction: a.direction,
    kind: a.kind,
    badge: a.badge,
    ownerPlayerId: a.ownerPlayerId,
  }));
}

/** Version publique d'un seul agent (pour les events granulaires). */
export function toPublicAgent(a: AiAgentRecord): AiAgentState {
  return {
    agentId: a.agentId,
    name: a.name,
    role: a.role,
    appearance: a.appearance,
    x: a.x,
    y: a.y,
    direction: a.direction,
    kind: a.kind,
    badge: a.badge,
    ownerPlayerId: a.ownerPlayerId,
  };
}

export type { Appearance };
