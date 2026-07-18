"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceCanvas } from "@/components/canvas/workspace-canvas";
import {
  TimelineScrubber,
  type TimelineRevision,
} from "@/components/timeline/scrubber";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { MentionComposer, type ComposeMode } from "@/components/workspace/mention-composer";
import {
  emptySnapshot,
  snapshotAtPlayhead,
  type WorkspaceSnapshot,
  type WorkspaceWidget,
} from "@/lib/workspace/snapshot";
import {
  allocateName,
  newWidgetId,
  nextWidgetFrame,
} from "@/lib/workspace/naming";
import { isLiveDataBusyMessage } from "@/lib/workspace/data-intent";
import { chatMessageFromAction } from "@/lib/openui/action-message";
import type { ActionEvent } from "@openuidev/react-lang";

type RevisionRow = TimelineRevision & { snapshot: WorkspaceSnapshot };
type PresenceUser = {
  userId: string;
  name: string | null;
  email: string;
  color: string;
};
type Member = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
};
type Me = { id: string; email: string; name: string | null };

type DockMode = "idle" | "keyboard" | "timeline";

export function WorkspaceShell() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const workspaceId = params.id;

  const [me, setMe] = useState<Me | null>(null);
  const [role, setRole] = useState<string>("viewer");
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("…");
  const [error, setError] = useState<string | null>(null);
  const [dockMode, setDockMode] = useState<DockMode>("idle");
  const [draft, setDraft] = useState("");
  const [composeMode, setComposeMode] = useState<ComposeMode>("ai");
  const [selectedWidget, setSelectedWidget] = useState<WorkspaceWidget | null>(
    null,
  );
  const autoMentionRef = useRef<string | null>(null);
  const [listening, setListening] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "editor" | "viewer">(
    "editor",
  );
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    | null
    | { type: "remove"; userId: string; label: string }
    | { type: "delete-workspace" }
    | { type: "continue-from"; seq: number; label: string }
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const committingRef = useRef(false);
  const recognitionRef = useRef<{
    stop: () => void;
    start: () => void;
    abort?: () => void;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canEdit = role === "owner" || role === "editor";

  const refreshWorkspace = useCallback(
    async (stickToHead = true) => {
      const detail = await fetch(`/api/workspace/${workspaceId}`);
      if (detail.status === 401) {
        router.replace("/login");
        return;
      }
      if (!detail.ok) throw new Error("Failed to refresh workspace");
      const full = await detail.json();
      setRole(full.role);
      setMembers(full.members ?? []);
      setRevisions(full.revisions);
      if (stickToHead) setPlayhead(Math.max(0, full.revisions.length - 1));
    },
    [workspaceId, router],
  );

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setMe(d.user ?? null))
      .catch(() => undefined);
    refreshWorkspace(true).catch((e) => setError(e.message));
  }, [refreshWorkspace]);

  useEffect(() => {
    const source = new EventSource(`/api/workspace/${workspaceId}/events`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          count?: number;
          presence?: PresenceUser[];
        };
        if (data.type === "revisions" && typeof data.count === "number") {
          if (data.count !== revisions.length) void refreshWorkspace(true);
        }
        if (data.type === "presence" && data.presence) {
          setPresence(data.presence);
        }
      } catch {
        // ignore
      }
    };
    return () => {
      source.close();
      recognitionRef.current?.abort?.();
      void fetch(`/api/workspace/${workspaceId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leave: true }),
      });
    };
  }, [workspaceId, revisions.length, refreshWorkspace]);

  useEffect(() => {
    if (dockMode === "keyboard") {
      inputRef.current?.focus();
    }
  }, [dockMode]);

  const syncSelectionMention = useCallback(
    (widget: WorkspaceWidget | null) => {
      if (dockMode !== "keyboard" || composeMode !== "ai") return;

      setDraft((current) => {
        // Helper draft = empty, or only an @mention (optional trailing space)
        const isHelper = !current.trim() || /^@[a-z0-9-]+\s*$/i.test(current);
        if (!isHelper) return current;

        if (widget?.name) {
          autoMentionRef.current = widget.name;
          return `@${widget.name} `;
        }

        autoMentionRef.current = null;
        return "";
      });
    },
    [dockMode, composeMode],
  );

  useEffect(() => {
    syncSelectionMention(selectedWidget);
  }, [selectedWidget, syncSelectionMention]);

  const onDraftChange = useCallback((next: string) => {
    setDraft(next);
    if (!/^@[a-z0-9-]+\s*$/i.test(next) && next.trim() !== "") {
      autoMentionRef.current = null;
    }
  }, []);

  const onSelectedChange = useCallback((widget: WorkspaceWidget | null) => {
    setSelectedWidget((prev) => {
      if (widget == null) return prev == null ? prev : null;
      if (prev?.id === widget.id && prev.name === widget.name) return prev;
      return widget;
    });
  }, []);

  const live = playhead >= revisions.length - 1 - 0.001;
  const viewSnapshot = useMemo(
    () => snapshotAtPlayhead(revisions, playhead),
    [revisions, playhead],
  );

  const avatarPeople = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; label: string; color: string }
    >();
    if (me) {
      byId.set(me.id, {
        id: me.id,
        label: me.name || me.email,
        color: "#3f5d4a",
      });
    }
    for (const p of presence) {
      byId.set(p.userId, {
        id: p.userId,
        label: p.name || p.email,
        color: p.color,
      });
    }
    for (const m of members) {
      if (!byId.has(m.userId)) {
        byId.set(m.userId, {
          id: m.userId,
          label: m.name || m.email,
          color: "#8a5a2b",
        });
      }
    }
    // current user first
    const list = [...byId.values()];
    if (me) {
      list.sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0));
    }
    return list;
  }, [me, presence, members]);

  async function sendChat(message: string) {
    if (!canEdit || !message.trim()) return;
    setBusy(true);
    setBusyLabel(
      isLiveDataBusyMessage(message) ? "Fetching live data…" : "Thinking…",
    );
    setError(null);
    try {
      const fromSeq = live ? undefined : revisions[Math.floor(playhead)]?.seq;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, message: message.trim(), fromSeq }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chat failed");
      setDraft("");
      autoMentionRef.current = null;
      setDockMode("idle");
      await refreshWorkspace(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setBusy(false);
    }
  }

  function handleGenUiAction(widget: WorkspaceWidget, event: ActionEvent) {
    if (!canEdit || busy) return;
    const mention = widget.name || widget.id;
    const message = chatMessageFromAction(event, mention);
    if (!message) return;
    void sendChat(message);
  }

  async function addNoteWidget(message: string) {
    if (!canEdit || !message.trim() || committingRef.current) return;
    const body = message.trim();
    const base = viewSnapshot.widgets ? viewSnapshot : emptySnapshot();
    const taken = new Set(base.widgets.map((w) => w.name));
    const name = allocateName("note", taken);
    const next: WorkspaceSnapshot = {
      version: 1,
      widgets: [
        ...base.widgets,
        {
          id: newWidgetId("note"),
          type: "note",
          name,
          title: body.slice(0, 48),
          frame: nextWidgetFrame(base.widgets),
          props: { body },
        },
      ],
    };

    committingRef.current = true;
    setBusy(true);
    setBusyLabel("Adding note…");
    setError(null);
    try {
      const fromSeq = live ? undefined : revisions[Math.floor(playhead)]?.seq;
      const res = await fetch("/api/workspace/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          snapshot: next,
          fromSeq,
          label: `Note: ${body.slice(0, 48)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add note");
      setDraft("");
      autoMentionRef.current = null;
      setDockMode("idle");
      await refreshWorkspace(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add note");
    } finally {
      setBusy(false);
      committingRef.current = false;
    }
  }

  async function submitCompose() {
    if (composeMode === "note") {
      await addNoteWidget(draft);
    } else {
      await sendChat(draft);
    }
  }

  async function commitLayout(
    next: WorkspaceSnapshot,
    meta?: { label?: string },
  ) {
    if (!canEdit || !live || committingRef.current) return;
    committingRef.current = true;
    setError(null);

    // Optimistic head update so the canvas snapshot matches the drag before the network returns
    setRevisions((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const last = copy[copy.length - 1]!;
      copy[copy.length - 1] = { ...last, snapshot: next };
      return copy;
    });

    try {
      const res = await fetch("/api/workspace/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          snapshot: next,
          label: meta?.label ?? "Manual layout",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Layout save failed");
      setRevisions((prev) => {
        const withoutDup = prev.filter((r) => r.seq !== data.revision.seq);
        const nextRevs = [...withoutDup, data.revision].sort(
          (a, b) => a.seq - b.seq,
        );
        setPlayhead(Math.max(0, nextRevs.length - 1));
        return nextRevs;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Layout save failed");
      await refreshWorkspace(true);
    } finally {
      committingRef.current = false;
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteUrl(null);
    const res = await fetch(`/api/workspace/${workspaceId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Invite failed");
      return;
    }
    setInviteUrl(data.inviteUrl);
    setInviteCopied(false);
    setInviteEmail("");
    await refreshWorkspace(false);
  }

  async function copyInviteLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      setError("Could not copy link");
    }
  }

  async function removeMember(userId: string) {
    if (role !== "owner") return;
    const res = await fetch(`/api/workspace/${workspaceId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Remove failed");
      return;
    }
    await refreshWorkspace(false);
  }

  async function deleteWorkspace() {
    if (role !== "owner") return;
    const res = await fetch(`/api/workspace/${workspaceId}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Delete failed");
      return;
    }
    router.push("/workspaces");
  }

  async function continueFromPlayhead(seq?: number) {
    if (!canEdit || busy) return;
    const targetSeq =
      seq ?? revisions[Math.floor(playhead)]?.seq;
    if (targetSeq == null) return;
    setBusy(true);
    setBusyLabel("Restoring…");
    setError(null);
    try {
      const res = await fetch("/api/workspace/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          continueFromSeq: targetSeq,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not continue from here");
      await refreshWorkspace(true);
      setDockMode("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not continue from here");
    } finally {
      setBusy(false);
    }
  }

  function requestContinueFromPlayhead() {
    const rev = revisions[Math.floor(playhead)];
    if (!rev) return;
    setConfirmAction({
      type: "continue-from",
      seq: rev.seq,
      label: rev.label ?? `#${rev.seq}`,
    });
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      if (confirmAction.type === "remove") {
        await removeMember(confirmAction.userId);
      } else if (confirmAction.type === "continue-from") {
        await continueFromPlayhead(confirmAction.seq);
      } else {
        await deleteWorkspace();
      }
      setConfirmAction(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  function toggleDock(mode: DockMode) {
    stopListening();
    setDockMode((current) => (current === mode ? "idle" : mode));
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function startListening() {
    if (!canEdit) return;
    const SpeechRecognition =
      typeof window !== "undefined"
        ? (
            window as unknown as {
              SpeechRecognition?: new () => SpeechRecognitionLike;
              webkitSpeechRecognition?: new () => SpeechRecognitionLike;
            }
          ).SpeechRecognition ||
          (
            window as unknown as {
              webkitSpeechRecognition?: new () => SpeechRecognitionLike;
            }
          ).webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognition) {
      setError("Speech recognition isn’t supported in this browser.");
      return;
    }

    stopListening();
    setDockMode("keyboard");
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0]?.transcript ?? "";
      }
      setDraft(text.trim());
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function initials(label: string) {
    const parts = label
      .replace(/@.*/, "")
      .split(/[\s._-]+/)
      .filter(Boolean);
    return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  }

  return (
    <div className="canvas-app">
      <header className="canvas-chrome">
        <Link
          href="/workspaces"
          className="chrome-icon-btn"
          aria-label="Back to workspaces"
          title="Home"
        >
          <HomeIcon />
        </Link>

        <div className="chrome-avatars">
          {avatarPeople.slice(0, 5).map((person, index) => (
            <button
              key={person.id}
              type="button"
              className={`avatar-btn ${person.id === me?.id ? "is-self" : ""}`}
              style={{ background: person.color, zIndex: index + 1 }}
              title={person.label}
              aria-label={
                person.id === me?.id ? "Open collaborators" : person.label
              }
              onClick={() => setPeopleOpen((v) => !v)}
            >
              {initials(person.label)}
            </button>
          ))}
          {avatarPeople.length > 5 ? (
            <span className="avatar-more">+{avatarPeople.length - 5}</span>
          ) : null}
        </div>
      </header>

      {peopleOpen ? (
        <div className="people-panel">
          <p className="people-title">Collaborators</p>
          <ul className="member-list">
            {members.map((m) => {
              const ownerCount = members.filter(
                (x) => x.role === "owner",
              ).length;
              const canRemove =
                role === "owner" &&
                m.userId !== me?.id &&
                (m.role !== "owner" || ownerCount > 1);
              return (
                <li key={m.userId}>
                  <span>{m.name || m.email}</span>
                  <div className="member-meta">
                    <em>{m.role}</em>
                    {canRemove ? (
                      <button
                        type="button"
                        className="member-remove"
                        onClick={() =>
                          setConfirmAction({
                            type: "remove",
                            userId: m.userId,
                            label: m.name || m.email,
                          })
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {role === "owner" ? (
            <>
              <form onSubmit={sendInvite} className="people-invite">
                <input
                  type="email"
                  required
                  placeholder="Invite by email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(
                      e.target.value as "owner" | "editor" | "viewer",
                    )
                  }
                  aria-label="Invite role"
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="submit">Invite</button>
              </form>
              <button
                type="button"
                className="people-danger"
                onClick={() => setConfirmAction({ type: "delete-workspace" })}
              >
                Delete workspace
              </button>
            </>
          ) : (
            <p className="people-hint">
              Only owners can invite, remove people, or delete the workspace.
            </p>
          )}
          {inviteUrl ? (
            <div className="invite-share">
              <p className="invite-share-label">Invite link ready</p>
              <div className="invite-share-row">
                <code className="invite-share-url" title={inviteUrl}>
                  {inviteUrl}
                </code>
                <button
                  type="button"
                  className="invite-share-copy"
                  onClick={() => void copyInviteLink()}
                >
                  {inviteCopied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="canvas-stage">
        <WorkspaceCanvas
          snapshot={viewSnapshot.widgets ? viewSnapshot : emptySnapshot()}
          interactive={live && !busy && canEdit}
          onCommit={commitLayout}
          onSelectedChange={onSelectedChange}
          onGenUiAction={handleGenUiAction}
        />
      </div>

      {error ? <p className="echo-error">{error}</p> : null}

      <div className="bottom-dock">
        {dockMode === "keyboard" ? (
          <MentionComposer
            value={draft}
            onChange={onDraftChange}
            onSubmit={() => void submitCompose()}
            onClose={() => {
              stopListening();
              setDockMode("idle");
            }}
            mode={composeMode}
            onModeChange={setComposeMode}
            widgets={viewSnapshot.widgets ?? []}
            disabled={!canEdit || busy}
            busy={busy}
            busyLabel={busyLabel}
            canEdit={canEdit}
            inputRef={inputRef}
            listening={listening}
            onToggleMic={() => {
              if (listening) stopListening();
              else startListening();
            }}
          />
        ) : null}

        {dockMode === "timeline" ? (
          <div className="timeline-dock">
            <div className="floating-timeline">
              <TimelineScrubber
                revisions={revisions}
                playhead={playhead}
                onPlayheadChange={setPlayhead}
                live={live}
              />
            </div>
            <div className="timeline-actions">
              {!live && canEdit ? (
                <button
                  type="button"
                  className="timeline-continue"
                  disabled={busy}
                  title="Discard later frames and continue from this point"
                  onClick={requestContinueFromPlayhead}
                >
                  Continue here
                </button>
              ) : null}
              <button
                type="button"
                className="floating-close"
                aria-label="Close timeline"
                onClick={() => setDockMode("idle")}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {dockMode === "idle" ? (
          <div className="dock-icons">
            <button
              type="button"
              className="dock-btn"
              aria-label="Keyboard"
              title="Type"
              onClick={() => toggleDock("keyboard")}
            >
              <KeyboardIcon />
            </button>
            <button
              type="button"
              className={`dock-btn ${listening ? "is-hot" : ""}`}
              aria-label="Microphone"
              title="Speak"
              onClick={() => {
                if (listening) stopListening();
                else startListening();
              }}
            >
              <MicIcon />
            </button>
            <button
              type="button"
              className="dock-btn"
              aria-label="Timeline"
              title="Timeline"
              onClick={() => toggleDock("timeline")}
            >
              <TimelineIcon />
            </button>
            {!live && canEdit ? (
              <button
                type="button"
                className="timeline-continue timeline-continue-idle"
                disabled={busy}
                title="Continue from the selected timeline frame"
                onClick={requestContinueFromPlayhead}
              >
                Continue here
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmModal
        open={confirmAction != null}
        title={
          confirmAction?.type === "remove"
            ? "Remove collaborator"
            : confirmAction?.type === "continue-from"
              ? "Continue from this frame?"
              : "Delete workspace"
        }
        body={
          confirmAction?.type === "remove"
            ? `Remove ${confirmAction.label} from this workspace? They will lose access immediately.`
            : confirmAction?.type === "continue-from"
              ? `Make “${confirmAction.label}” the live canvas and discard everything after it? You can still scrub earlier frames.`
              : "Delete this workspace permanently? This cannot be undone."
        }
        confirmLabel={
          confirmAction?.type === "remove"
            ? "Remove"
            : confirmAction?.type === "continue-from"
              ? "Continue here"
              : "Delete workspace"
        }
        danger={confirmAction?.type !== "continue-from"}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirmAction(null);
        }}
        onConfirm={() => void runConfirmedAction()}
      />
    </div>
  );
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript?: string }>>;
};

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="6"
        width="18"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12h16M7 8v8M12 6v12M17 9v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
