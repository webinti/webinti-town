import { config } from '../config.js';

/**
 * Moteur de réponse IA générique, partagé par TOUS les agents incarnés
 * (Marie, IA embauchées, doublures). Persona-agnostique : l'appelant fournit
 * le prompt système complet ; ici on ne gère que l'appel OpenRouter, la mémoire
 * conversationnelle courte et le nettoyage de la réponse.
 *
 * Le moteur reste abstrait derrière `config.ai*` (OpenRouter par défaut, mais
 * AI_BASE_URL / AI_API_KEY / AI_MODEL permettent de brancher un Hermes maison).
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface Memory {
  turns: Turn[];
  lastAt: number;
  busy: boolean;
}

const MAX_TURNS = 10; // on ne garde que les derniers échanges (contexte court)
const MEMORY_TTL_MS = 30 * 60 * 1000; // au-delà, conversation fraîche

// Mémoire par CONVERSATION (clé = `${roomSlug}:${agentId}`) : chaque agent a son
// propre fil, isolé des autres, dans chaque room.
const memories = new Map<string, Memory>();

function getMemory(key: string): Memory {
  const existing = memories.get(key);
  if (existing && Date.now() - existing.lastAt <= MEMORY_TTL_MS) return existing;
  const fresh: Memory = { turns: [], lastAt: Date.now(), busy: false };
  memories.set(key, fresh);
  return fresh;
}

/** Retire un préfixe « Nom : » en tête de réponse (nom de l'agent ou prénom du joueur). */
function stripNamePrefix(text: string, ...names: string[]): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = names.filter(Boolean).map(esc).join('|');
  if (!alt) return text;
  return text.replace(new RegExp(`^\\s*(?:${alt})\\s*:\\s*`, 'i'), '');
}

/**
 * Génère la réponse d'un agent IA à un message d'un joueur proche.
 * Retourne le texte, ou null si l'IA est désactivée / occupée / en erreur.
 */
export async function generateAgentReply(opts: {
  conversationKey: string;
  systemPrompt: string;
  agentName: string;
  userName: string;
  userText: string;
}): Promise<string | null> {
  if (!config.aiEnabled) return null;

  const mem = getMemory(opts.conversationKey);
  if (mem.busy) return null; // un appel est déjà en cours pour ce fil → on laisse passer

  mem.turns.push({ role: 'user', content: `${opts.userName}: ${opts.userText}` });
  if (mem.turns.length > MAX_TURNS) mem.turns.splice(0, mem.turns.length - MAX_TURNS);

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
        messages: [{ role: 'system', content: opts.systemPrompt }, ...mem.turns],
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
    // sa réponse par « <agent> : » ou « <prénom> : ». On retire ce préfixe.
    text = stripNamePrefix(text, opts.agentName, opts.userName);

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

/** Oublie le fil de conversation d'un agent (ex. doublure licenciée). */
export function forgetConversation(conversationKey: string): void {
  memories.delete(conversationKey);
}
