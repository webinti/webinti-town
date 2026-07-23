import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { ChatAttachment, ChatMessage, ChatMessageType, DmMessage, PlayerState } from '../../types';

// Égalité « pertinente pour le chat » : ne déclenche un re-render QUE si la liste
// des joueurs (ids), leurs noms ou leur couleur de tenue changent — et PAS à
// chaque déplacement (sinon le panneau, quand il est ouvert, se re-render ~20×/s
// pour rien puisqu'il n'affiche aucune position).
function sameChatPlayers(a: Map<string, PlayerState>, b: Map<string, PlayerState>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, pa] of a) {
    const pb = b.get(id);
    if (!pb || pb.name !== pa.name || pb.appearance.outfit !== pa.appearance.outfit) return false;
  }
  return true;
}

const SHIRT_HEX = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f3f4f6',
];

/** Lit le clientKey stable persisté par SocketManager. Retourne '' si absent. */
function getLocalClientKey(): string {
  try {
    return window.localStorage.getItem('webinti.clientKey') ?? '';
  } catch {
    return '';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function shirtColorFor(playerId: string, players: Map<string, { appearance: { outfit: number } }>): string {
  const p = players.get(playerId);
  const idx = p?.appearance.outfit ?? 0;
  return SHIRT_HEX[idx] ?? '#6366f1';
}

type ChatTab = ChatMessageType | 'dm';

// Message en cours de modification : le champ de saisie devient l'éditeur.
// hasAttachment autorise un texte vide (le message garde sa pièce jointe).
type EditingTarget = { kind: 'chat' | 'dm'; id: string; hasAttachment: boolean };

// Doit rester aligné avec MESSAGE_MAX_LEN côté serveur (socket/handlers.ts).
const MESSAGE_MAX_LEN = 10000;

export function ChatPanel() {
  const open = useGameStore((s) => s.chatPanelOpen);
  const chat = useGameStore((s) => s.chat);
  const unread = useGameStore((s) => s.unreadChat);
  const localId = useGameStore((s) => s.localPlayerId);
  const players = useGameStore((s) => s.players, sameChatPlayers);
  const setOpen = useGameStore((s) => s.setChatPanelOpen);
  const setInputFocused = useGameStore((s) => s.setInputFocused);
  const currentRoomSlug = useGameStore((s) => s.currentRoomSlug);

  // F10 DM
  const dmConversations = useGameStore((s) => s.dmConversations);
  const unreadDm = useGameStore((s) => s.unreadDm);
  const activeDmTarget = useGameStore((s) => s.activeDmTarget);
  const setActiveDmTarget = useGameStore((s) => s.setActiveDmTarget);
  const pendingDmTarget = useGameStore((s) => s.pendingDmTarget);
  const clearPendingDm = useGameStore((s) => s.clearPendingDm);

  const [tab, setTab] = useState<ChatTab>('global');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  // Ref miroir pour les handlers globaux (Escape) sans re-registration à chaque frappe.
  const editingRef = useRef<EditingTarget | null>(null);
  editingRef.current = editing;
  // Brouillon en cours au moment où on entre en mode édition, restauré ensuite.
  const draftBeforeEditRef = useRef('');

  // Ouverture d'un DM demandée depuis l'extérieur (sidebar / carte joueur) :
  // bascule sur l'onglet Privés + sélectionne le contact, puis consomme le signal.
  useEffect(() => {
    if (!pendingDmTarget) return;
    setTab('dm');
    setActiveDmTarget(pendingDmTarget);
    clearPendingDm();
  }, [pendingDmTarget, setActiveDmTarget, clearPendingDm]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef<number>(0);
  const lastTypingEmitRef = useRef<number>(0);

  // ── Attachment upload state machine ─────────────────────────────────────
  type UploadStatus = 'idle' | 'uploading' | 'ready' | 'error';
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Total unread DM (somme — recalculé sur changement)
  const totalDmUnread = useMemo(() => {
    let n = 0;
    for (const v of unreadDm.values()) n += v;
    return n;
  }, [unreadDm]);

  // Émettre dm:read serveur quand l'utilisateur ouvre une conv (debounced via deps)
  useEffect(() => {
    if (tab !== 'dm') return;
    if (!activeDmTarget) return;
    if (!open) return;
    socketManager.markDmRead(activeDmTarget);
  }, [tab, activeDmTarget, open, dmConversations]);

  // Keyboard: C toggles, Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        // Une édition en cours s'annule d'abord ; un 2e Échap ferme le panneau.
        if (editingRef.current) {
          e.preventDefault();
          setEditing(null);
          setText(draftBeforeEditRef.current);
          return;
        }
        if (open) {
          e.preventDefault();
          setOpen(false);
          inputRef.current?.blur();
        }
        return;
      }
      if (inField) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        const willOpen = !useGameStore.getState().chatPanelOpen;
        setOpen(willOpen);
        if (willOpen) {
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Persist scroll position when toggling
  useLayoutEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = scrollPosRef.current || listRef.current.scrollHeight;
    }
  }, [open]);

  // Auto-scroll on new message
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat, dmConversations, activeDmTarget, open]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Fichier trop grand (max 5 MB)');
      setUploadStatus('error');
      return;
    }

    setUploadStatus('uploading');
    setUploadError('');
    setPendingAttachment(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const clientKey = getLocalClientKey();
      const resp = await fetch(`/api/uploads/${currentRoomSlug}`, {
        method: 'POST',
        headers: { 'x-client-key': clientKey },
        body: formData,
      });
      if (!resp.ok) {
        const json = (await resp.json().catch(() => ({}))) as { error?: string };
        const msg =
          resp.status === 413
            ? 'Fichier trop grand (max 5 MB)'
            : resp.status === 429
            ? 'Trop d\'uploads, attendez 1 minute'
            : resp.status === 415
            ? 'Type de fichier non autorisé (jpg/png/svg/pdf)'
            : json.error ?? 'Erreur upload';
        setUploadError(msg);
        setUploadStatus('error');
        return;
      }
      const data = (await resp.json()) as ChatAttachment;
      setPendingAttachment(data);
      setUploadStatus('ready');
    } catch {
      setUploadError('Erreur réseau lors de l\'upload');
      setUploadStatus('error');
    }
  }, [currentRoomSlug]);

  const removeAttachment = useCallback(() => {
    setPendingAttachment(null);
    setUploadStatus('idle');
    setUploadError('');
  }, []);

  const handleSend = useCallback(() => {
    const value = text.trim();
    // Mode édition : on remplace le texte du message ciblé puis on restaure le
    // brouillon qui était en cours avant d'entrer en édition.
    if (editing) {
      if (!value && !editing.hasAttachment) return;
      if (editing.kind === 'dm') {
        socketManager.editDm(editing.id, value.slice(0, MESSAGE_MAX_LEN));
      } else {
        socketManager.editChatMessage(editing.id, value.slice(0, MESSAGE_MAX_LEN));
      }
      setEditing(null);
      setText(draftBeforeEditRef.current);
      if (inputRef.current) inputRef.current.style.height = '';
      return;
    }
    if (!value && !pendingAttachment) return;
    if (uploadStatus === 'uploading') return;
    if (tab === 'dm') {
      if (!activeDmTarget) return;
      socketManager.sendDm(activeDmTarget, value.slice(0, MESSAGE_MAX_LEN), pendingAttachment ?? undefined);
    } else {
      socketManager.sendChat(value.slice(0, MESSAGE_MAX_LEN), tab as ChatMessageType, pendingAttachment ?? undefined);
    }
    setText('');
    setPendingAttachment(null);
    setUploadStatus('idle');
    setUploadError('');
    if (inputRef.current) inputRef.current.style.height = '';
  }, [text, tab, pendingAttachment, uploadStatus, activeDmTarget, editing]);

  // La zone de saisie grandit avec le contenu (long prompt collé) jusqu'à
  // ~6 lignes, puis scrolle en interne.
  const autoGrow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  const startEdit = useCallback((target: EditingTarget, initialText: string) => {
    if (!editingRef.current) {
      draftBeforeEditRef.current = inputRef.current?.value ?? '';
    }
    setEditing(target);
    setText(initialText);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      autoGrow();
    });
  }, [autoGrow]);

  const cancelEdit = useCallback(() => {
    if (!editingRef.current) return;
    setEditing(null);
    setText(draftBeforeEditRef.current);
    requestAnimationFrame(() => autoGrow());
  }, [autoGrow]);

  // Changer d'onglet, de contact DM ou fermer le panneau abandonne l'édition en cours.
  useEffect(() => {
    cancelEdit();
  }, [tab, activeDmTarget, cancelEdit]);
  useEffect(() => {
    if (!open) cancelEdit();
  }, [open, cancelEdit]);

  if (!open) {
    const total = unread + totalDmUnread;
    return (
      <button
        onClick={() => setOpen(true)}
        className="pointer-events-auto fixed bottom-24 right-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg ring-1 ring-white/20 hover:bg-indigo-500"
        title="Chat (C)"
      >
        <span className="text-xl">{'\u{1F4AC}'}</span>
        {total > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white ring-2 ring-slate-900">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
    );
  }

  // Player options for DM list (everyone except me)
  const otherPlayers = Array.from(players.values()).filter((p) => p.playerId !== localId);
  // Conversations existantes avec joueurs offline (= pas dans players)
  const offlineWithHistory: string[] = [];
  for (const otherId of dmConversations.keys()) {
    if (!players.has(otherId)) offlineWithHistory.push(otherId);
  }

  const placeholder = editing
    ? 'Modifiez votre message…'
    : tab === 'dm'
    ? (activeDmTarget ? 'Message privé...' : 'Sélectionnez un contact')
    : tab === 'global' ? 'Message global...' : 'Message proximité...';

  const inputDisabled = tab === 'dm' && !activeDmTarget;
  const maxLen = MESSAGE_MAX_LEN;

  // Determine current DM list to display
  const dmMessages = tab === 'dm' && activeDmTarget ? (dmConversations.get(activeDmTarget) ?? []) : [];

  return (
    <div className="pointer-events-auto fixed right-4 top-20 flex h-[60vh] w-[calc(100vw-2rem)] max-w-96 flex-col rounded-lg bg-slate-900/95 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur sm:w-96">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('global')}
            className={`rounded px-2 py-1 text-xs font-semibold ${tab === 'global' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            Global
          </button>
          <button
            onClick={() => setTab('local')}
            className={`rounded px-2 py-1 text-xs font-semibold ${tab === 'local' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            Proximité
          </button>
          <button
            onClick={() => setTab('dm')}
            className={`relative rounded px-2 py-1 text-xs font-semibold ${tab === 'dm' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            Privés
            {totalDmUnread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold text-slate-900 ring-1 ring-slate-900">
                {totalDmUnread > 9 ? '9+' : totalDmUnread}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={() => {
            scrollPosRef.current = listRef.current?.scrollTop ?? 0;
            setOpen(false);
          }}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
          title="Fermer (Esc)"
        >
          {'✕'}
        </button>
      </div>

      {tab === 'dm' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Colonne gauche : liste des contacts */}
          <div className="w-24 shrink-0 overflow-y-auto border-r border-white/10 bg-slate-900/60 sm:w-32">
            {otherPlayers.length === 0 && offlineWithHistory.length === 0 && (
              <div className="px-2 py-4 text-center text-[11px] text-slate-500">
                Personne dans la room
              </div>
            )}
            {otherPlayers.map((p) => {
              const isActive = activeDmTarget === p.playerId;
              const n = unreadDm.get(p.playerId) ?? 0;
              const color = shirtColorFor(p.playerId, players);
              return (
                <button
                  key={p.playerId}
                  onClick={() => setActiveDmTarget(p.playerId)}
                  className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-slate-700/60 ${isActive ? 'bg-emerald-900/40' : ''}`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  {n > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                      {n > 9 ? '9+' : n}
                    </span>
                  )}
                </button>
              );
            })}
            {offlineWithHistory.length > 0 && (
              <div className="mt-1 border-t border-white/10 pt-1">
                <div className="px-2 py-0.5 text-[10px] uppercase text-slate-500">Absents</div>
                {offlineWithHistory.map((otherId) => {
                  const isActive = activeDmTarget === otherId;
                  const n = unreadDm.get(otherId) ?? 0;
                  const list = dmConversations.get(otherId) ?? [];
                  // Best-effort name : last message from this player
                  const lastFromOther = [...list].reverse().find((m) => m.from === otherId);
                  const name = lastFromOther ? otherId.slice(0, 6) : otherId.slice(0, 6);
                  return (
                    <button
                      key={otherId}
                      onClick={() => setActiveDmTarget(otherId)}
                      className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-700/60 ${isActive ? 'bg-emerald-900/40' : ''}`}
                    >
                      <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full bg-slate-600 ring-1 ring-white/10" />
                      <span className="flex-1 truncate italic">{name}…</span>
                      {n > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                          {n > 9 ? '9+' : n}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Colonne droite : fil DM */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2 text-sm">
            {!activeDmTarget && (
              <div className="px-2 py-6 text-center text-xs text-slate-500">
                Sélectionnez un contact pour commencer
              </div>
            )}
            {activeDmTarget && dmMessages.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-slate-500">
                Aucun message. Écrivez le premier !
              </div>
            )}
            {activeDmTarget && dmMessages.map((m) => (
              <DmRow
                key={m.id}
                msg={m}
                localId={localId}
                players={players}
                onStartEdit={() => startEdit({ kind: 'dm', id: m.id, hasAttachment: !!m.attachment }, m.text)}
                onDelete={() => socketManager.deleteDm(m.id)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2 text-sm">
          {chat.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-slate-500">
              Aucun message. Dites bonjour !
            </div>
          )}
          {chat.map((msg) => (
            <ChatRow
              key={msg.id}
              msg={msg}
              localId={localId}
              players={players}
              onStartEdit={() => startEdit({ kind: 'chat', id: msg.id, hasAttachment: !!msg.attachment }, msg.text)}
              onDelete={() => socketManager.deleteChatMessage(msg.id)}
            />
          ))}
        </div>
      )}

      <div className="border-t border-white/10 p-2">
        {editing && (
          <div className="mb-2 flex items-center justify-between rounded bg-amber-900/40 px-2 py-1 text-xs text-amber-200 ring-1 ring-amber-500/40">
            <span>{'✏️'} Modification du message</span>
            <button onClick={cancelEdit} className="text-amber-300 underline hover:text-white">
              Annuler (Échap)
            </button>
          </div>
        )}
        {uploadStatus === 'ready' && pendingAttachment && (
          <div className="mb-2 flex items-center gap-2 rounded bg-slate-800/80 px-2 py-1 ring-1 ring-indigo-400/40">
            {pendingAttachment.mimeType === 'application/pdf' ? (
              <span className="text-base">{'📄'}</span>
            ) : (
              <img
                src={pendingAttachment.url}
                alt=""
                className="h-10 w-10 rounded object-cover ring-1 ring-white/10"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span className="flex-1 truncate text-xs text-slate-300">{pendingAttachment.filename}</span>
            <button
              onClick={removeAttachment}
              className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
              title="Retirer la pièce jointe"
            >
              {'✕'}
            </button>
          </div>
        )}
        {uploadStatus === 'error' && (
          <div className="mb-2 rounded bg-red-900/60 px-2 py-1 text-xs text-red-300 ring-1 ring-red-500/40">
            {uploadError}
            <button onClick={removeAttachment} className="ml-2 underline hover:text-white">retirer</button>
          </div>
        )}
        {uploadStatus === 'uploading' && (
          <div className="mb-2 text-xs text-slate-400">
            <span className="animate-pulse">{'⏳'} Upload en cours…</span>
          </div>
        )}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, maxLen));
            autoGrow();
            // Pas de typing_start en DM (pas implémenté côté serveur pour les DM)
            if (tab !== 'dm') {
              const now = Date.now();
              if (now - lastTypingEmitRef.current >= 500) {
                lastTypingEmitRef.current = now;
                socketManager.sendTypingStart();
              }
            }
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={inputDisabled}
          placeholder={placeholder}
          rows={2}
          maxLength={maxLen}
          className="w-full resize-none rounded bg-slate-800 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-indigo-400 disabled:opacity-50"
        />
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadStatus === 'uploading' || inputDisabled || editing !== null}
              title="Joindre un fichier (jpg/png/svg/pdf, max 5 MB)"
              className="rounded px-1.5 py-0.5 text-base text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-40"
            >
              {'📎'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/svg+xml,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <span className="text-[10px] text-slate-500">Entrée · Maj+Entrée saut</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">{text.length}/{maxLen}</span>
            <button
              onClick={handleSend}
              disabled={
                editing
                  ? !text.trim() && !editing.hasAttachment
                  : uploadStatus === 'uploading' || inputDisabled || (!text.trim() && !pendingAttachment)
              }
              className={`rounded px-2 py-1 text-xs font-semibold text-white disabled:opacity-40 ${
                editing ? 'bg-amber-600 hover:bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
            >
              {editing ? 'Modifier' : 'Envoyer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Bouton « copier le message » : invisible par défaut, révélé au survol de la
 * ligne (classe `group` sur le conteneur). Feedback ✓ vert pendant 1,5 s.
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback vieux navigateurs / contexte non sécurisé
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* tant pis */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copié !' : 'Copier le message'}
      aria-label="Copier le message"
      className={`rounded p-0.5 transition-opacity focus:opacity-100 group-hover:opacity-100 ${
        copied ? 'opacity-100 text-emerald-400' : 'opacity-0 text-slate-400 hover:bg-slate-700 hover:text-white'
      }`}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

/** Bouton « modifier » : révélé au survol, uniquement sur ses propres messages. */
function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Modifier le message"
      aria-label="Modifier le message"
      className="rounded p-0.5 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 text-slate-400 hover:bg-slate-700 hover:text-white"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
    </button>
  );
}

/**
 * Bouton « supprimer » avec confirmation en deux temps : le 1er clic passe le
 * bouton en rouge pendant 2,5 s, le 2e clic confirme. Évite un modal.
 */
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleClick = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (confirming) {
      setConfirming(false);
      onConfirm();
      return;
    }
    setConfirming(true);
    timerRef.current = window.setTimeout(() => setConfirming(false), 2500);
  }, [confirming, onConfirm]);

  return (
    <button
      onClick={handleClick}
      title={confirming ? 'Cliquez à nouveau pour confirmer' : 'Supprimer le message'}
      aria-label="Supprimer le message"
      className={`rounded p-0.5 transition-opacity focus:opacity-100 group-hover:opacity-100 ${
        confirming
          ? 'opacity-100 bg-red-900/60 text-red-300'
          : 'opacity-0 text-slate-400 hover:bg-slate-700 hover:text-red-300'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </button>
  );
}

function ChatRow({
  msg,
  localId,
  players,
  onStartEdit,
  onDelete,
}: {
  msg: ChatMessage;
  localId: string | null;
  players: Map<string, { appearance: { outfit: number } }>;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  const isMine = msg.playerId === localId;
  const borderColor = msg.type === 'local' ? 'border-l-blue-400' : 'border-l-purple-400';
  const bg = isMine ? 'bg-indigo-500/10' : 'bg-slate-800/40';
  const color = shirtColorFor(msg.playerId, players);
  return (
    <div
      className={`group mb-1.5 animate-fadein rounded border-l-2 px-2 py-1 ${borderColor} ${bg}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-white/20"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-bold text-slate-100">{msg.playerName}</span>
        <span className="text-[10px] text-slate-400">{formatTime(msg.timestamp)}</span>
        {msg.editedAt !== undefined && (
          <span className="text-[10px] italic text-slate-500">(modifié)</span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          {msg.text && <CopyButton text={msg.text} />}
          {isMine && <EditButton onClick={onStartEdit} />}
          {isMine && <DeleteButton onConfirm={onDelete} />}
        </span>
      </div>
      <div className="ml-4.5 whitespace-pre-wrap break-words pl-0.5 text-[13px] text-slate-200">{msg.text}</div>
      {msg.attachment && <AttachmentView attachment={msg.attachment} />}
    </div>
  );
}

function DmRow({
  msg,
  localId,
  players,
  onStartEdit,
  onDelete,
}: {
  msg: DmMessage;
  localId: string | null;
  players: Map<string, { appearance: { outfit: number }; name: string }>;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  const isMine = msg.from === localId;
  const fromPlayer = players.get(msg.from);
  const name = fromPlayer?.name ?? (isMine ? 'Moi' : msg.from.slice(0, 6));
  const color = shirtColorFor(msg.from, players);
  const bg = isMine ? 'bg-emerald-500/10' : 'bg-slate-800/40';
  return (
    <div className={`group mb-1.5 animate-fadein rounded border-l-2 border-l-emerald-400 px-2 py-1 ${bg}`}>
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-white/20"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-bold text-slate-100">{name}</span>
        <span className="text-[10px] text-slate-400">{formatTime(msg.ts)}</span>
        {msg.editedAt !== undefined && (
          <span className="text-[10px] italic text-slate-500">(modifié)</span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          {msg.text && <CopyButton text={msg.text} />}
          {isMine && <EditButton onClick={onStartEdit} />}
          {isMine && <DeleteButton onConfirm={onDelete} />}
        </span>
      </div>
      {msg.text && (
        <div className="ml-4.5 whitespace-pre-wrap break-words pl-0.5 text-[13px] text-slate-200">{msg.text}</div>
      )}
      {msg.attachment && <AttachmentView attachment={msg.attachment} />}
    </div>
  );
}

function AttachmentView({ attachment }: { attachment: ChatAttachment }) {
  const [loadError, setLoadError] = useState(false);

  if (loadError) {
    return (
      <div className="mt-1 rounded bg-slate-700/60 px-2 py-1 text-xs text-yellow-400">
        {'⚠️'} Pièce jointe indisponible
      </div>
    );
  }

  if (attachment.mimeType === 'application/pdf') {
    const sizeKb = Math.round(attachment.sizeBytes / 1024);
    const sizeTxt = sizeKb >= 1024
      ? `${(sizeKb / 1024).toFixed(1)} MB`
      : `${sizeKb} KB`;
    return (
      <a
        href={attachment.url}
        download={attachment.filename}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 flex items-center gap-2 rounded bg-slate-700/60 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
      >
        <span className="text-base">{'📄'}</span>
        <span className="flex-1 truncate">{attachment.filename}</span>
        <span className="text-[10px] text-slate-400">{sizeTxt}</span>
      </a>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block"
    >
      <img
        src={attachment.url}
        alt={attachment.filename}
        className="max-h-60 max-w-full rounded ring-1 ring-white/10 hover:opacity-90"
        style={{ maxWidth: 240 }}
        onError={() => setLoadError(true)}
      />
    </a>
  );
}
