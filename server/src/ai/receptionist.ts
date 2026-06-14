import { config } from '../config.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Agent IA d'accueil — « Marie », l'hôtesse de Webinti Town.
 *
 * C'est un personnage non-joueur (PNJ) posé à la réception. Quand un joueur
 * proche écrit dans le chat local, le serveur lui fait générer une réponse via
 * OpenRouter (API compatible OpenAI) et la renvoie dans le chat.
 *
 * Le moteur est volontairement abstrait derrière `config.ai*` : par défaut on
 * tape OpenRouter, mais il suffit de changer AI_BASE_URL / AI_API_KEY / AI_MODEL
 * pour brancher un Hermes ou un endpoint maison (réutilisable plus tard pour les
 * « agents IA par bureau »).
 */

export const RECEPTIONIST = {
  id: 'ai-secretaire',
  name: 'Marie · Accueil',
  // Position de la secrétaire sur la map (cf. AmbientLayer GREETERS).
  x: 48,
  y: 560,
} as const;

const SYSTEM_PROMPT = `Tu es Marie, l'hôtesse d'accueil de Webinti Town, un bureau virtuel en pixel-art où les équipes se retrouvent comme dans un vrai bureau. Tu te tiens à la réception, près de l'entrée.

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
   Persisté dans data/marie.json, chargé au démarrage, appliqué à chaud. */

const DATA_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
})();
const CONFIG_PATH = join(DATA_DIR, 'marie.json');
const MAX_KNOWLEDGE = 6000;

let knowledge = '';
(function loadKnowledge() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { knowledge?: unknown };
      if (typeof raw.knowledge === 'string') knowledge = raw.knowledge;
    }
  } catch (err) {
    console.error('[ai] lecture de marie.json échouée :', err);
  }
})();

export function getMarieKnowledge(): string {
  return knowledge;
}

/** Met à jour les consignes de Marie (appliqué immédiatement + persisté). */
export function setMarieKnowledge(text: string): string {
  knowledge = (text ?? '').slice(0, MAX_KNOWLEDGE);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify({ knowledge }, null, 2), 'utf8');
  } catch (err) {
    console.error('[ai] écriture de marie.json échouée :', err);
  }
  return knowledge;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface RoomMemory {
  turns: Turn[];
  lastAt: number;
  busy: boolean;
}

const MAX_TURNS = 10; // on ne garde que les derniers échanges (contexte court)
const MEMORY_TTL_MS = 30 * 60 * 1000; // au-delà, on repart sur une conversation fraîche

const memories = new Map<string, RoomMemory>();

function getMemory(roomSlug: string): RoomMemory {
  const existing = memories.get(roomSlug);
  if (existing && Date.now() - existing.lastAt <= MEMORY_TTL_MS) return existing;
  const fresh: RoomMemory = { turns: [], lastAt: Date.now(), busy: false };
  memories.set(roomSlug, fresh);
  return fresh;
}

/** Retire un préfixe « Nom : » en tête de réponse (« Marie : » ou le prénom du joueur). */
function stripNamePrefix(text: string, userName: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = ['Marie', userName].filter(Boolean).map(esc).join('|');
  return text.replace(new RegExp(`^\\s*(?:${names})\\s*:\\s*`, 'i'), '');
}

/** Distance² au comptoir d'accueil ≤ rayon de proximité ? */
export function isNearReceptionist(x: number, y: number): boolean {
  const dx = x - RECEPTIONIST.x;
  const dy = y - RECEPTIONIST.y;
  const r = config.proximityRadiusPx;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Génère la réponse de la secrétaire à un message d'un joueur proche de l'accueil.
 * Retourne le texte, ou null si l'IA est désactivée / occupée / en erreur.
 */
export async function receptionistReply(
  roomSlug: string,
  userName: string,
  userText: string,
  liveContext = '',
): Promise<string | null> {
  if (!config.aiEnabled) return null;

  const mem = getMemory(roomSlug);
  if (mem.busy) return null; // un appel est déjà en cours pour cette room → on laisse passer

  mem.turns.push({ role: 'user', content: `${userName}: ${userText}` });
  if (mem.turns.length > MAX_TURNS) mem.turns.splice(0, mem.turns.length - MAX_TURNS);

  // Prompt système = base + consignes éditables de l'hôte + contexte temps réel.
  const systemPrompt =
    SYSTEM_PROMPT +
    (knowledge
      ? `\n\n# Consignes et connaissances spécifiques (à privilégier)\n${knowledge}`
      : '') +
    (liveContext ? `\n\n# Contexte en temps réel\n${liveContext}` : '');

  mem.busy = true;
  try {
    const res = await fetch(`${config.aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.aiApiKey}`,
        // En-têtes recommandés par OpenRouter (classement / attribution).
        'HTTP-Referer': 'https://live.webinti.com',
        'X-Title': 'Webinti Town',
      },
      body: JSON.stringify({
        model: config.aiModel,
        max_tokens: 220,
        temperature: 0.6,
        messages: [{ role: 'system', content: systemPrompt }, ...mem.turns],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[ai] OpenRouter ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error('[ai] OpenRouter: réponse vide');
      return null;
    }
    // Filet de sécurité : le modèle imite parfois le format d'entrée et préfixe
    // sa réponse par « Marie : » ou « <prénom> : ». On retire ce préfixe.
    text = stripNamePrefix(text, userName);

    mem.turns.push({ role: 'assistant', content: text });
    if (mem.turns.length > MAX_TURNS) mem.turns.splice(0, mem.turns.length - MAX_TURNS);
    mem.lastAt = Date.now();
    return text;
  } catch (err) {
    console.error('[ai] appel OpenRouter échoué :', err);
    return null;
  } finally {
    mem.busy = false;
  }
}
