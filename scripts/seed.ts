import { createWorkspace } from "@/lib/workspace/timeline";
import type { WorkspaceSnapshot } from "@/lib/workspace/snapshot";

const seedSnapshot: WorkspaceSnapshot = {
  version: 1,
  widgets: [
    {
      id: "welcome-note",
      type: "note",
      name: "welcome",
      title: "Welcome",
      frame: { x: 0.05, y: 0.08, w: 0.36, h: 0.28, z: 1 },
      props: {
        body: "Ask Echoes to build your workspace. Every change becomes a timeline frame you can scrub like video.",
      },
    },
    {
      id: "seed-metric",
      type: "metric",
      name: "focus-signal",
      title: "Focus signal",
      frame: { x: 0.46, y: 0.08, w: 0.22, h: 0.2, z: 2 },
      props: { value: "92", unit: "%", delta: "+4%" },
    },
    {
      id: "seed-chart",
      type: "chart",
      name: "weekly-energy",
      title: "Weekly energy",
      frame: { x: 0.46, y: 0.34, w: 0.48, h: 0.36, z: 3 },
      props: {
        series: [12, 18, 15, 22, 28, 24, 31],
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      },
    },
    {
      id: "seed-feed",
      type: "feed",
      name: "signals",
      title: "Signals",
      frame: { x: 0.05, y: 0.42, w: 0.36, h: 0.4, z: 4 },
      props: {
        items: [
          { title: "Ship the first canvas", meta: "now" },
          { title: "Scrub the timeline", meta: "next" },
          { title: "Connect live sources", meta: "soon" },
        ],
      },
    },
  ],
};

async function main() {
  const { workspace, revision } = await createWorkspace({
    title: "Personal OS",
    seedSnapshot,
  });
  console.log("Seeded workspace:", workspace.id);
  console.log("Origin revision seq:", revision.seq);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
