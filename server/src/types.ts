export type Direction = 'up' | 'down' | 'left' | 'right';

export type ChatMessageType = 'local' | 'global' | 'system';

export type EmoteType = 'wave' | 'heart' | 'laugh' | 'thumbsup' | 'question' | 'exclaim';

export interface Appearance {
  skin: number;       // 0..8
  outfit: number;     // 0..11
  hairStyle: number;  // 0..5
  hairColor: number;  // 0..3
}

export const DEFAULT_APPEARANCE: Appearance = {
  skin: 2,
  outfit: 0,
  hairStyle: 1,
  hairColor: 1,
};

export type Presence = 'available' | 'away' | 'brb' | 'dnd' | 'inactive';

export interface PlayerState {
  playerId: string;
  socketId: string;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost: boolean;
  joinedAt: number;
  presence: Presence;
  lastActivityAt: number;   // serveur seulement — jamais diffusé au client
  workstationId: string | null;     // calculé server-side depuis x/y ; null si hors zone
  kartId: string | null;            // id du kart conduit, null si piéton
  boosting: boolean;                // true pendant l'effet nitro
}

// ─────────────────────────── Agents IA incarnés ───────────────────────────
// Un agent IA est un PNJ piloté serveur, rendu côté client comme un avatar
// (3 couches LimeZu + label), avec qui on parle dans le chat de proximité.
//   - 'receptionist' : Marie, l'hôtesse, présente d'office dans chaque room.
//   - 'employee'     : IA « embauchée » par l'hôte, postée à un endroit.
//   - 'understudy'   : doublure d'un joueur absent (garde son poste).
export type AiAgentKind = 'receptionist' | 'employee' | 'understudy';

/** État public d'un agent IA — diffusé au client pour le rendu (sans persona/savoir). */
export interface AiAgentState {
  agentId: string;
  name: string;
  role: string;                 // poste / métier affiché (« Accueil », « Support »…)
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  kind: AiAgentKind;
  badge: string | null;         // ex. « En remplacement de Alice »
  ownerPlayerId: string | null; // doublure : à qui appartient le poste, sinon null
}

/** Données SERVEUR d'un agent IA : l'état public + son cerveau (jamais diffusé). */
export interface AiAgentRecord extends AiAgentState {
  persona: string;    // prompt système de base (rôle + comportement)
  knowledge: string;  // consignes / FAQ spécifiques (peut être '')
  createdAt: number;
}

export interface KartState {
  id: string;          // 'kart-1' … 'kart-5'
  x: number;
  y: number;
  parkingX: number;
  parkingY: number;
  driverId: string | null;
  lastMovedAt: number; // epoch ms
}

export interface ChatAttachment {
  url: string;       // /api/uploads/<roomSlug>/<uuid>.<ext>
  filename: string;  // sanitized original (max 80 chars)
  mimeType: 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'application/pdf';
  sizeBytes: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  type: ChatMessageType;
  timestamp: number;
  attachment?: ChatAttachment;  // F9 — pièce jointe optionnelle
}

// F10 — Direct Messages
export interface DmMessage {
  id: string;
  from: string;          // playerId expéditeur
  to: string;            // playerId destinataire
  text: string;          // 0..1000 chars (peut être vide si attachment présent)
  attachment: ChatAttachment | null;
  ts: number;
  readBy: string[];      // playerIds qui ont lu — au moins from à la création
}

export interface WhiteboardStroke {
  id: string;
  playerId: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  isErase: boolean;
}

export interface WhiteboardText {
  id: string;
  playerId: string;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
}

export type KanbanColumn = 'todo' | 'doing' | 'done';

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  column: KanbanColumn;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  completedBy: string | null;
  completedByName: string | null;
}

export interface KanbanBoard {
  cards: KanbanCard[];
}

export interface WorkstationState {
  id: string;                       // matches Workstation.id
  claimedBy: string | null;         // playerId du revendicateur, ou null
  claimedByName: string | null;     // snapshot pour l'affichage
  invitedPlayerIds: string[];       // les invités autorisés à entrer
  claimedAt: number | null;         // pour debug / audit
  customName: string | null;        // nom personnalisé défini par le claimer (max 40 chars)
}

export type InteractiveObject =
  | { id: string; type: 'screen'; x: number; y: number; data: { sharedByPlayerId?: string } }
  | { id: string; type: 'whiteboard'; x: number; y: number; data: { strokes: WhiteboardStroke[]; texts?: WhiteboardText[] } }
  | { id: string; type: 'note'; x: number; y: number; data: { title: string; content: string } }
  | { id: string; type: 'link'; x: number; y: number; data: { url: string; label: string } }
  | { id: string; type: 'kanban'; x: number; y: number; data: Record<string, never> };

export interface RoomState {
  slug: string;
  name: string;
  adminToken: string;
  players: Map<string, PlayerState>;
  agents: Map<string, AiAgentRecord>;   // agents IA incarnés (Marie + embauchés + doublures)
  employeeStore: import('./ai/employeeStore.js').EmployeeStore; // persistance PB des IA embauchées
  createdAt: number;
  chatHistory: ChatMessage[];
  interactiveObjects: InteractiveObject[];
  // Cards are owned by an in-memory store + JSON file per room — not embedded
  // in the InteractiveObject's `data` field. See server/src/kanban/KanbanStore.
  kanbanStore:
    | import('./kanban/KanbanStore.js').KanbanStore
    | import('./kanban/KanbanStorePocketBase.js').KanbanStorePocketBase;
  hostPlayerId: string | null;
  isRecording: boolean;
  workstations: Map<string, WorkstationState>;  // key = workstation.id
  workstationManager:
    | import('./workstations/WorkstationManager.js').WorkstationManager
    | import('./workstations/WorkstationManagerPocketBase.js').WorkstationManagerPocketBase;
  karts: Map<string, KartState>;
  kartManager: import('./karts/KartManager.js').KartManager;
  raceManager: import('./race/RaceManager.js').RaceManager;
  dmStore:
    | import('./dm/DmStore.js').DmStore
    | import('./dm/DmStorePocketBase.js').DmStorePocketBase;
  // Plafonnement de capacité (abonnement) + rooms de démonstration.
  isDemo: boolean;            // slug 'demo' / 'demo-*' → capacité + TTL bridés
  capacity: number;          // nb max de présents simultanés
  ownerEmail: string | null; // 1er compte authentifié à créer la room (fixe la capacité)
  expiresAt: number | null;  // epoch ms d'expiration (rooms demo), sinon null
}

export interface PublicRoomInfo {
  slug: string;
  name: string;
  playerCount: number;
}
