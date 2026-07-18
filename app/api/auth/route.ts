import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateUser,
  createSession,
  createUser,
  destroySession,
  getSessionUser,
  sessionCookieOptions,
} from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const credSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action as "signup" | "login" | "logout";

    if (action === "logout") {
      const jar = await cookies();
      const token = jar.get("echoes_session")?.value;
      if (token) await destroySession(token);
      const res = NextResponse.json({ ok: true });
      res.cookies.set("echoes_session", "", { path: "/", maxAge: 0 });
      return res;
    }

    const parsed = credSchema.parse(body);

    if (action === "signup") {
      const user = await createUser(parsed);
      const session = await createSession(user.id);
      const res = NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name },
      });
      const opts = sessionCookieOptions(session.expiresAt);
      res.cookies.set(opts.name, session.token, opts);
      return res;
    }

    const user = await authenticateUser(parsed.email, parsed.password);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const session = await createSession(user.id);
    const res = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    });
    const opts = sessionCookieOptions(session.expiresAt);
    res.cookies.set(opts.name, session.token, opts);
    return res;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Auth failed" },
      { status: 400 },
    );
  }
}
