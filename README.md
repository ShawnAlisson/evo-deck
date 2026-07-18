# Echoes

AI-native collaborative canvas: chat responses become visual, interactive workspace widgets (OpenUI), with a scrubbable timeline. Trigger.dev orchestrates live sync jobs; ClickHouse stores the real-time event layer.

## Stack

- Next.js (App Router) + Postgres (Docker) + Drizzle
- OpenUI generative UI (`@openuidev/*`)
- Trigger.dev background jobs
- ClickHouse Cloud analytics/events

## Setup

```bash
cp .env.example .env.local
# fill AI_PROVIDER + provider keys, DATABASE_URL, TRIGGER_SECRET_KEY, CLICKHOUSE_*

docker compose up -d          # Postgres on :5433
npm install
npm run db:migrate:sql        # or apply drizzle/*.sql
npm run clickhouse:events     # create events table
npm run dev
npm run trigger:dev           # separate terminal — local Trigger worker
```

Open [http://localhost:3000](http://localhost:3000).

### AI providers

Set `AI_PROVIDER` in `.env.local` and restart `npm run dev`:

| Provider | Env | Notes |
| --- | --- | --- |
| `openai` (default) | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, `OPENAI_MODEL` | OpenAI, OpenRouter, or local LM Studio/Ollama |
| `gemini` | `GEMINI_API_KEY`, optional `GEMINI_MODEL` | Google AI Studio — easiest Gemini path |
| `vertex` | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, ADC / `GOOGLE_APPLICATION_CREDENTIALS`, optional `VERTEX_MODEL` | Gemini on Vertex AI |

Example Vertex switch:

```bash
AI_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=my-gcp-project
GOOGLE_CLOUD_LOCATION=us-central1
VERTEX_MODEL=gemini-2.5-flash
# gcloud auth application-default login
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js app |
| `npm run trigger:dev` | Trigger.dev worker |
| `npm run openui:generate` | Regenerate OpenUI prompt/schema under `lib/openui/generated/` |
| `npm run clickhouse:init` / `clickhouse:events` | ClickHouse bootstrap |
| `npm run db:seed` | Seed data |

## Live data

Chat can pull **real** external data (not LLM guesses) via adapters and an allowlisted fetch tool:

| Ask… | Source |
| --- | --- |
| Weather / forecast | Open-Meteo |
| BTC, ETH, stocks (AAPL…) | CoinGecko / Stooq |
| USD to EUR, FX | Frankfurter |
| HN / GitHub / RSS | public APIs |
| “what is X” | Wikipedia summary |
| `fetch https://…` | Allowlisted `http_get` tool |

API: `GET/POST /api/workspace/[id]/live` — status + refresh desk.

## Notes

- Never commit `.env.local` — only `.env.example`.
- `lib/openui/generated/` is committed so the chat API can load the OpenUI schema without importing React UI on the server.
- Widgets have `@name` handles — edit from the card, or mention them in chat (`@fruit-list add grapes`).
