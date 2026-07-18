# EvoDeck

> **An AI-native collaborative canvas that turns conversation into an evolving, interactive workspace.**

![EvoDeck visual canvas](public/brand/evodeck-hero.svg)

Most work begins as a conversation, then gets scattered across docs, tickets, dashboards, and chat. EvoDeck keeps the intent and the work in one place: describe the workspace you need, interact with what appears, refine a specific widget with an `@mention`, and rewind the workspace through its version history.

## Why it matters

EvoDeck is not a chatbot next to a dashboard. It is a living canvas for planning, decision-making, and collaboration.

- **Start with intent:** turn a plain-language request into the right visual building blocks.
- **Stay interactive:** generated controls, charts, forms, tables, and checklists are real UI—not a screenshot of UI.
- **Evolve precisely:** every widget has an `@name`, so a focused request changes one thing without discarding the rest.
- **Keep decision memory:** each meaningful change becomes a revision on a scrubbable timeline.
- **Ground the canvas:** optional live data flows through Trigger.dev and ClickHouse instead of relying on invented facts.

![EvoDeck architecture](docs/architecture.svg)

## Demo in four moves

![EvoDeck demo flow](docs/demo-flow.svg)

1. Create a workspace and ask: “Create a launch command center with a checklist, content calendar, risks, and a decision flow.”
2. Interact with the generated workspace—check an item, open a control, or rearrange a card.
3. Update one widget directly: `@content-plan add a launch-day social post and make the first item high priority`.
4. Scrub the timeline to show that the workspace remembers how the idea evolved.

## Architecture

| Layer                        | What it does                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------- |
| **Next.js + React**          | Delivers the collaborative, drag-and-drop workspace experience.                   |
| **OpenUI**                   | Translates AI intent into valid, interactive generative UI.                       |
| **AI orchestration**         | Routes requests into safe workspace operations and targeted widget updates.       |
| **Postgres + Drizzle**       | Persists users, workspaces, collaborators, and revision history.                  |
| **Trigger.dev + ClickHouse** | Runs background syncs and stores live-event signals for data-backed visual desks. |

## Stack

`Next.js` `React` `TypeScript` `OpenUI` `AI SDK` `Trigger.dev` `ClickHouse` `Postgres` `Drizzle ORM` `Zustand`

## Run locally

```bash
cp .env.example .env.local
# Add an AI provider key and update any optional Trigger.dev / ClickHouse values.
# Before deploying, set NEXT_PUBLIC_APP_URL to the public https URL for correct social-share links.

docker compose up -d          # Postgres on :5433
npm install
npm run db:migrate:sql
npm run db:seed               # optional: gives the demo a useful starting state
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To demonstrate background sync and live-data desks, start the Trigger.dev worker in a second terminal and initialize ClickHouse:

```bash
npm run clickhouse:init
npm run clickhouse:events
npm run trigger:dev
```

### AI providers

Set `AI_PROVIDER` in `.env.local`, then restart the app:

| Provider           | Required environment                                                | Notes                                                                     |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `openai` (default) | `OPENAI_API_KEY`                                                    | Also supports OpenRouter, LM Studio, or Ollama through `OPENAI_BASE_URL`. |
| `gemini`           | `GEMINI_API_KEY`                                                    | Direct Google AI Studio option.                                           |
| `vertex`           | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, ADC or credentials | Set `VERTEX_MODEL` as needed.                                             |

## Useful scripts

| Command                     | Purpose                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `npm run dev`               | Run the EvoDeck app locally.                                |
| `npm run trigger:dev`       | Start the local Trigger.dev worker.                         |
| `npm run openui:generate`   | Refresh the committed server-safe OpenUI prompt and schema. |
| `npm run clickhouse:init`   | Create the ClickHouse database.                             |
| `npm run clickhouse:events` | Create the ClickHouse event table.                          |
| `npm run db:seed`           | Add a demo workspace.                                       |

## Live data, when you need it

EvoDeck can use source-backed data rather than asking the model to guess.

## Project assets

The visual kit is deliberately lightweight, editable, and ready for the README, a pitch deck, or the deployed app:

- [EvoDeck mark](public/brand/evodeck-mark.svg)
- [EvoDeck wordmark](public/brand/evodeck-wordmark.svg)
- [Hero canvas artwork](public/brand/evodeck-hero.svg)
- [Architecture diagram](docs/architecture.svg)
- [Demo flow diagram](docs/demo-flow.svg)
