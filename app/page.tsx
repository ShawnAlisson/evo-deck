import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/workspaces");

  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden />
      <header className="landing-nav">
        <p className="echo-brand">Echoes</p>
        <div className="landing-nav-actions">
          <Link href="/login">Sign in</Link>
          <Link className="landing-cta" href="/signup">
            Get started
          </Link>
        </div>
      </header>

      <main className="landing-hero">
        <p className="echo-brand landing-hero-brand">Echoes</p>
        <h1>Your workspace, shaped by conversation.</h1>
        <p className="landing-lead">
          Stop configuring dashboards. Describe what you need—Echoes builds a
          live canvas of widgets, timelines, and signals, then keeps it moving
          with you.
        </p>
        <div className="landing-actions">
          <Link className="landing-cta large" href="/signup">
            Start building
          </Link>
          <Link className="landing-ghost" href="/login">
            I already have an account
          </Link>
        </div>
      </main>
    </div>
  );
}
