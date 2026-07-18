"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [info, setInfo] = useState<{
    workspaceTitle: string;
    email: string;
    role: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invite?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Invite not found");
        setInfo(data);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const auth = await fetch("/api/auth");
      const authData = await auth.json();
      if (!authData.user) {
        router.push(`/login?next=/invite/${token}`);
        return;
      }
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not accept");
      router.push(`/w/${data.workspaceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p className="echo-brand">Echoes</p>
        <h1>Workspace invite</h1>
        {info ? (
          <>
            <p className="auth-sub">
              You’re invited to <strong>{info.workspaceTitle}</strong> as{" "}
              <em>{info.role}</em>.
            </p>
            <p className="auth-sub">Invite email: {info.email}</p>
            <button type="button" disabled={busy} onClick={() => void accept()}>
              {busy ? "…" : "Accept invite"}
            </button>
          </>
        ) : (
          <p className="auth-sub">{error ? error : "Loading invite…"}</p>
        )}
        {error && info ? <p className="auth-error">{error}</p> : null}
        <p className="auth-switch">
          <Link href="/workspaces">Back to workspaces</Link>
        </p>
      </div>
    </div>
  );
}
