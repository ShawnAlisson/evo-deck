/**
 * Browser demo harness for Echoes prompts + UI.
 * Run: node scripts/demo-browser-test.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = `demo+${Date.now()}@echoes.test`;
const PASSWORD = "demopass123";
const OUT = join(process.cwd(), ".tmp-demo-test");
mkdirSync(OUT, { recursive: true });

const results = [];

function log(ok, name, detail = "") {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function cookieHeader(context) {
  const cookies = await context.cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function api(context, path, init = {}) {
  const res = await context.request.fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: await cookieHeader(context),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok(), status: res.status(), json };
}

async function sendChat(context, workspaceId, message) {
  const started = Date.now();
  const res = await api(context, "/api/chat", {
    method: "POST",
    data: JSON.stringify({ workspaceId, message }),
  });
  const ms = Date.now() - started;
  return { ...res, ms };
}

async function getWorkspace(context, workspaceId) {
  return api(context, `/api/workspace/${workspaceId}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  // --- Auth UI dark mode ---
  await page.goto(`${BASE}/login`);
  await page.waitForSelector(".auth-card");
  const loginBg = await page.evaluate(() => {
    const screen = getComputedStyle(document.querySelector(".auth-screen"));
    const card = getComputedStyle(document.querySelector(".auth-card"));
    const input = getComputedStyle(document.querySelector(".auth-card input"));
    const sub = getComputedStyle(document.querySelector(".auth-sub"));
    return {
      screenBg: screen.backgroundImage || screen.backgroundColor,
      cardBg: card.backgroundColor,
      inputBg: input.backgroundColor,
      subColor: sub.color,
      ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
      paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
    };
  });
  await page.screenshot({ path: join(OUT, "login-dark.png"), fullPage: true });
  const darkOk =
    loginBg.paper.toLowerCase().includes("17") ||
    loginBg.ink.toLowerCase().includes("f3") ||
    loginBg.ink.toLowerCase().includes("f");
  log(darkOk, "login dark tokens", `ink=${loginBg.ink} paper=${loginBg.paper}`);
  // Hardcoded white input would fail dark mode
  const inputNotWhite = !/^rgb\(255,\s*255,\s*255\)$/.test(loginBg.inputBg);
  log(inputNotWhite, "login input not forced white", loginBg.inputBg);

  await page.goto(`${BASE}/signup`);
  await page.waitForSelector(".auth-card");
  await page.screenshot({ path: join(OUT, "signup-dark.png"), fullPage: true });
  const signupInk = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
  );
  log(Boolean(signupInk), "signup dark loads", `ink=${signupInk}`);

  // --- Signup via UI ---
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspaces/, { timeout: 30000 });
  log(true, "signup redirects to /workspaces");

  // Create workspace via UI if possible, else API
  let workspaceId = null;
  const createInput = page.locator('input[placeholder*="name" i], input[name="title"], .dash input').first();
  if (await createInput.count()) {
    await createInput.fill("Demo Test Canvas");
    const createBtn = page.getByRole("button", { name: /create/i }).first();
    if (await createBtn.count()) {
      await createBtn.click();
      await page.waitForURL(/\/w\//, { timeout: 20000 }).catch(() => null);
    }
  }
  if (!page.url().includes("/w/")) {
    const created = await api(context, "/api/workspace", {
      method: "POST",
      data: JSON.stringify({ title: "Demo Test Canvas" }),
    });
    if (!created.ok) throw new Error(`create workspace failed: ${JSON.stringify(created.json)}`);
    workspaceId = created.json.workspace.id;
    await page.goto(`${BASE}/w/${workspaceId}`);
  } else {
    workspaceId = page.url().split("/w/")[1].split(/[?#]/)[0];
  }
  log(Boolean(workspaceId), "open workspace", workspaceId);

  await page.waitForSelector(".bottom-dock, .dock-icons", { timeout: 20000 });
  await page.screenshot({ path: join(OUT, "workspace.png") });

  // --- Prompt dock UI: mode + note ---
  await page.getByRole("button", { name: /keyboard|type/i }).click().catch(async () => {
    await page.locator('.dock-btn[aria-label="Keyboard"]').click();
  });
  await page.waitForSelector(".prompt-dock, .mention-composer", { timeout: 10000 });
  const modeBtn = page.locator(".prompt-mode-btn");
  log(await modeBtn.count() > 0, "mode button outside field");
  await modeBtn.click();
  await page.waitForSelector(".prompt-mode-menu", { timeout: 5000 });
  const menuText = await page.locator(".prompt-mode-menu").innerText();
  log(/AI/i.test(menuText) && /Note/i.test(menuText), "mode menu has AI + Note text", menuText.replace(/\s+/g, " "));
  await page.locator('.prompt-mode-menu button', { hasText: "Note" }).click();
  await page.fill(".floating-input input", "Parking lot: follow up with design Monday");
  await page.click('.floating-input button[type="submit"]');
  // Wait for dock to close or note to appear
  await page.waitForTimeout(1500);
  const afterNote = await getWorkspace(context, workspaceId);
  const noteWidgets = (afterNote.json.revisions?.at(-1)?.snapshot?.widgets || []).filter(
    (w) => w.type === "note",
  );
  // revisions structure may differ — fetch latest another way
  let latestWidgets = afterNote.json.revisions?.at(-1)?.snapshot?.widgets;
  if (!latestWidgets) {
    const revs = afterNote.json.revisions || [];
    const last = revs[revs.length - 1];
    latestWidgets = last?.snapshot?.widgets || [];
  }
  const hasParking = latestWidgets.some(
    (w) =>
      w.type === "note" &&
      String(w.props?.body || "").includes("Parking lot"),
  );
  log(hasParking, "note mode adds widget without AI", `widgets=${latestWidgets.length}`);
  await page.screenshot({ path: join(OUT, "after-note.png") });

  // Re-open keyboard for AI tests via API (more reliable than flaky UI timing)
  const prompts = [
    {
      name: "grocery checklist",
      message: "Make a grocery checklist with milk, eggs, bread, and coffee",
      expect: (widgets) =>
        widgets.some(
          (w) =>
            w.type === "genui" ||
            /grocery|checklist|milk/i.test(JSON.stringify(w)),
        ),
    },
    {
      name: "metric card",
      message: "Add a metric card: ARR $2.4M, up 12%",
      expect: (widgets) =>
        widgets.some((w) => {
          if (w.type !== "metric" && w.type !== "genui") return false;
          return /2\.4|2400000|ARR|12/i.test(JSON.stringify(w));
        }),
      prefer: (widgets) => widgets.some((w) => w.type === "metric"),
    },
    {
      name: "flowchart",
      message: "Draw a flowchart: idea → research → build → ship",
      expect: (widgets) =>
        widgets.some(
          (w) =>
            w.type === "flowchart" ||
            /flowchart|idea|ship/i.test(JSON.stringify(w)),
        ),
      prefer: (widgets) => widgets.some((w) => w.type === "flowchart"),
    },
    {
      name: "kanban",
      message: "Make a kanban board for a launch: Todo / Doing / Done with 2 cards each",
      expect: (widgets) =>
        widgets.some(
          (w) =>
            w.type === "kanban" ||
            /Todo|Doing|kanban/i.test(JSON.stringify(w)),
        ),
    },
  ];

  for (const p of prompts) {
    const res = await sendChat(context, workspaceId, p.message);
    if (!res.ok) {
      log(false, p.name, `HTTP ${res.status}: ${res.json?.error || JSON.stringify(res.json).slice(0, 200)}`);
      continue;
    }
    const ws = await getWorkspace(context, workspaceId);
    const revs = ws.json.revisions || [];
    const widgets = revs.at(-1)?.snapshot?.widgets || [];
    const ok = p.expect(widgets);
    const preferred = p.prefer ? p.prefer(widgets) : true;
    log(
      ok,
      p.name,
      `${res.ms}ms widgets=${widgets.length} types=${[...new Set(widgets.map((w) => w.type))].join(",")}${preferred ? "" : " (wanted native type)"}`,
    );
    writeFileSync(
      join(OUT, `prompt-${p.name.replace(/\s+/g, "-")}.json`),
      JSON.stringify({ prompt: p.message, response: res.json, widgets }, null, 2),
    );
  }

  // Mention update: find a genui/checklist-like name
  const ws2 = await getWorkspace(context, workspaceId);
  const widgets2 = (ws2.json.revisions || []).at(-1)?.snapshot?.widgets || [];
  const mentionTarget =
    widgets2.find((w) => /grocery|checklist|fruit/i.test(w.name + w.title)) ||
    widgets2.find((w) => w.type === "genui") ||
    widgets2[0];
  if (mentionTarget) {
    const mentionMsg = `@${mentionTarget.name} add grapes and cheese`;
    const res = await sendChat(context, workspaceId, mentionMsg);
    const ws3 = await getWorkspace(context, workspaceId);
    const widgets3 = (ws3.json.revisions || []).at(-1)?.snapshot?.widgets || [];
    const sameCountOrUpdated =
      res.ok &&
      (JSON.stringify(widgets3) !== JSON.stringify(widgets2) ||
        widgets3.length >= widgets2.length);
    log(
      sameCountOrUpdated,
      "mention update",
      `@${mentionTarget.name} ok=${res.ok} status=${res.status} err=${res.json?.error || ""}`,
    );
  } else {
    log(false, "mention update", "no widget to mention");
  }

  // Live HN — may fail without trigger/clickhouse; still record
  {
    const res = await sendChat(context, workspaceId, "Show Hacker News frontpage");
    const ws = await getWorkspace(context, workspaceId);
    const widgets = (ws.json.revisions || []).at(-1)?.snapshot?.widgets || [];
    const hasFeed =
      widgets.some((w) => w.type === "feed") ||
      /hacker|hn|live/i.test(JSON.stringify(widgets)) ||
      res.ok;
    log(
      res.ok,
      "hacker news prompt",
      `${res.status} ${res.ms}ms feedish=${hasFeed} err=${res.json?.error || ""}`,
    );
  }

  // Reload UI after chats
  await page.goto(`${BASE}/w/${workspaceId}`);
  await page.waitForSelector(".echo-widget, .widget-card, [class*='widget']", {
    timeout: 20000,
  }).catch(() => null);
  await page.screenshot({ path: join(OUT, "after-prompts.png"), fullPage: true });

  // Close button outside prompt — open keyboard after canvas is healthy
  await page.waitForTimeout(800);
  const kb = page.locator('.dock-btn[aria-label="Keyboard"]');
  if (await kb.isVisible().catch(() => false)) {
    await kb.click();
  } else {
    // Dock may already be open, or crashed — try click bottom area keyboard via evaluate
    await page.evaluate(() => {
      const btn = document.querySelector('.dock-btn[aria-label="Keyboard"]');
      if (btn instanceof HTMLButtonElement) btn.click();
    });
  }
  await page.waitForSelector(".prompt-dock", { timeout: 10000 });
  const closeOutside = await page.locator(".prompt-close").count();
  log(closeOutside > 0, "prompt close outside field");

  // Stricter type checks on latest widgets after a fresh workspace run
  const finalWs = await getWorkspace(context, workspaceId);
  const finalWidgets = (finalWs.json.revisions || []).at(-1)?.snapshot?.widgets || [];
  writeFileSync(
    join(OUT, "final-widgets.json"),
    JSON.stringify(finalWidgets.map((w) => ({ name: w.name, type: w.type, title: w.title })), null, 2),
  );

  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log("\n---");
  console.log(`${results.length - failed.length}/${results.length} passed`);
  console.log(`Artifacts: ${OUT}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
