"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui/confirm-modal";

type WorkspaceRow = {
  id: string;
  title: string;
  role: string;
  updatedAt: string;
};

export function WorkspacesDashboard() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [duplicateBusyId, setDuplicateBusyId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  async function load() {
    const [auth, list] = await Promise.all([
      fetch("/api/auth"),
      fetch("/api/workspace"),
    ]);
    const authData = await auth.json();
    if (!authData.user) {
      router.replace("/login");
      return;
    }
    setUserEmail(authData.user.email);
    const data = await list.json();
    if (!list.ok) throw new Error(data.error ?? "Failed to load");
    setWorkspaces(data.workspaces ?? []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuId(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuId]);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setError("Give your workspace a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      router.push(`/w/${data.workspace.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function renameWorkspace(id: string) {
    const next = renameValue.trim();
    if (!next) return;
    const res = await fetch(`/api/workspace/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Rename failed");
      return;
    }
    setRenamingId(null);
    setMenuId(null);
    await load();
  }

  async function deleteWorkspace() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/workspace/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Delete failed");
        return;
      }
      setDeleteTarget(null);
      setMenuId(null);
      await load();
    } finally {
      setDeleteBusy(false);
    }
  }

  async function duplicateWorkspace(id: string) {
    setDuplicateBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/${id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Duplicate failed");
      setMenuId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
    } finally {
      setDuplicateBusyId(null);
    }
  }

  async function logout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/");
  }

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="evodeck-brand">EvoDeck</p>
          <p className="dash-sub">{userEmail}</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <section className="dash-create">
        <h1>Your workspaces</h1>
        <form onSubmit={createWorkspace}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Name a new canvas…"
            required
          />
          <button type="submit" disabled={busy || !title.trim()}>
            Create
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
      </section>

      <section className="dash-grid">
        {workspaces.length === 0 ? (
          <p className="dash-empty">No canvases yet. Create one to begin.</p>
        ) : (
          workspaces.map((w) => (
            <div key={w.id} className="dash-card-wrap">
              {renamingId === w.id ? (
                <form
                  className="dash-card is-renaming"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void renameWorkspace(w.id);
                  }}
                >
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                  />
                  <div className="dash-rename-actions">
                    <button type="submit">Save</button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <Link href={`/w/${w.id}`} className="dash-card">
                  <strong>{w.title}</strong>
                  <span>{w.role}</span>
                </Link>
              )}

              <div className="dash-more">
                <button
                  type="button"
                  className="dash-more-btn"
                  aria-label="More"
                  onClick={(e) => {
                    e.preventDefault();
                    setMenuId((cur) => (cur === w.id ? null : w.id));
                  }}
                >
                  ⋯
                </button>
                {menuId === w.id ? (
                  <div className="dash-menu" ref={menuRef} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={duplicateBusyId === w.id}
                      onClick={() => void duplicateWorkspace(w.id)}
                    >
                      {duplicateBusyId === w.id ? "Duplicating…" : "Duplicate"}
                    </button>
                    {w.role === "owner" ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setRenamingId(w.id);
                            setRenameValue(w.title);
                            setMenuId(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          onClick={() => {
                            setDeleteTarget(w);
                            setMenuId(null);
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>

      <ConfirmModal
        open={deleteTarget != null}
        title="Delete workspace"
        body={
          deleteTarget
            ? `Delete “${deleteTarget.title}” permanently? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete workspace"
        danger
        busy={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
        onConfirm={() => void deleteWorkspace()}
      />
    </div>
  );
}
