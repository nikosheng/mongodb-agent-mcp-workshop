# MongoDB MCP Server + Atlas Vector Search Workshop

> **You are on the `admin` branch.** This branch is a superset of `main` — it
> adds the `admin/` folder (provisioning + lifecycle scripts) and the admin
> sections below. Attendees should clone the `main` branch
> (`https://github.com/nikosheng/mongodb-agent-mcp-workshop`, the default
> branch), not this one.

A minimal, multi-user workshop demo showing the MongoDB MCP Server and Atlas
Vector Search (Automated Embedding, `voyage-4`) through a single Mastra agent.
5–10 attendees clone this repo and share one pre-provisioned Atlas cluster —
nobody needs their own Atlas account, API keys, or cluster.

```
Attendee's laptop (× 5-10, same repo, same shared cluster)
  Mastra agent (Mastra Studio chat UI, `npm run dev`)
    ├─ model: Grove AI Gateway → gpt-6-luna (key fetched from Atlas, not .env)
    └─ tools: MongoDB MCP Server (stdio subprocess, workshop_demo_user)
                    │
                    ▼
      Atlas cluster (admin's existing Flex cluster)
        ├─ streaming_catalog.titles        (shared catalog + autoEmbed index)
        └─ workshop_admin.settings         (admin-only control-plane doc)
```

## How workshop availability works

The agent will only respond during the admin-scheduled workshop window. If
you see a message saying the workshop isn't currently active, contact your
workshop organizer — there's nothing to configure on your end.

Vector search needs **no API key at all**: `plot_vector_index` is an Atlas
**Automated Embedding** index (`autoEmbed` field type, `voyage-4` model) —
Atlas generates and manages embeddings entirely server-side, for both the
seed catalog and anything attendees insert live.

## Workshop guidance for attendees

### 1. Setup (~2 minutes)

```bash
git clone https://github.com/nikosheng/mongodb-agent-mcp-workshop.git
cd mongodb-agent-mcp-workshop
cp .env.example .env
# edit .env: set WORKSHOP_USER_ID (your name/initials), and paste the two
# shared connection strings your workshop admin gives you. No API keys needed.
npm install
npm run dev
```

`npm run dev` opens **Mastra Studio** in your browser — a chat UI with live
tool-call tracing. That chat window is the whole demo surface; there's no
separate app to run.

### 2. Try it out

See [`demo/workshop_script.md`](./demo/workshop_script.md) for the full live
demo flow and example prompts. In short, you can:

- **Ask for a recommendation** — e.g. "Recommend something like Stranger
  Things but funnier." Watch the tool-call trace: the agent runs a
  `$vectorSearch` aggregation against `plot_vector_index`, and Atlas embeds
  your request automatically (no vectors computed in this app).
- **Contribute your own title** — e.g. "Add a movie idea: ..." The agent
  inserts it into the shared catalog tagged with your `WORKSHOP_USER_ID`;
  Atlas embeds it within a few seconds, live.
- **Search again** to confirm your new title shows up in semantic search.
- **Combine filters with semantic search** — e.g. "a sci-fi title similar to
  X, but only from 2022 or later."

Don't ask the agent to drop the index/collection or connect to any other
database — destructive tools are disabled server-side and your credentials
only grant access to `streaming_catalog`, so neither would work anyway.

### 3. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Agent refuses every message with a "workshop not active" style error | The admin hasn't started the window yet, it expired, or it was disabled — contact your organizer, nothing to fix on your end |
| "MONGODB_ADMIN_READONLY_CONNECTION_STRING is missing" | You haven't filled in `.env` yet, or forgot to restart `npm run dev` after editing it |
| MCP tool calls fail with an auth/permission error | Double-check you pasted the exact connection strings from your admin's handout (not your own Atlas credentials) |

## Workshop guidance for admins

> Full step-by-step runbook: [`admin/README.md`](./admin/README.md). This is
> a condensed quick-reference.

### Prerequisites

- An existing Atlas cluster that supports Atlas Search/Vector Search (your
  Flex cluster, or M10+).
- [Atlas CLI](https://www.mongodb.com/docs/atlas/cli/current/) installed and
  authenticated: `atlas auth login`.
- Node.js ≥ 22.13, npm.
- A Grove AI Gateway API key.
- Your Atlas project ID and cluster hostname (e.g.
  `your-cluster.abcd1.mongodb.net`, the part of your connection string after
  `@`).

### One-time setup (before the workshop)

```bash
git clone -b admin https://github.com/nikosheng/mongodb-agent-mcp-workshop.git
cd mongodb-agent-mcp-workshop
cp .env.example .env
# Fill in the admin-only section of .env (or export directly):
#   ATLAS_PROJECT_ID, ATLAS_CLUSTER_HOST, ADMIN_AI_GATEWAY_API_KEY
npm install

npm run admin:provision -- \
  --demo-password '<choose-a-strong-password>' \
  --readonly-password '<choose-a-strong-password>' \
  --admin-password '<choose-a-strong-password>' \
  --hours 24
```

This creates 3 scoped Atlas database users, opens the IP access list to
`0.0.0.0/0` for the workshop duration, seeds `workshop_admin.settings`,
inserts the sample catalog (`admin/data/sample_catalog.json`), and creates the
`plot_vector_index` Automated Embedding index. It prints the two connection
strings to share with attendees at the end — put those plus the `main`
branch clone URL into your handout.

Save `ADMIN_CONNECTION_STRING=mongodb+srv://workshop_admin_user:<admin-password>@<cluster-host>/...`
into your own `.env` (not shared) — you'll need it for the lifecycle commands
below.

### Day-to-day lifecycle commands

```bash
npm run admin:status                       # see current window + enabled state
npm run admin:extend -- --hours 24         # push the expiry forward
npm run admin:disable                      # instant kill-switch
npm run admin:enable                       # re-enable (time window unchanged)
npm run admin:rotate-key -- --key sk-...   # rotate the Grove AI Gateway key
```

`npm run admin:disable` instantly stops every attendee's agent from calling
the LLM, regardless of the configured time window — no redeploy, no
per-attendee action required.

### Admin troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing required environment variable: ADMIN_CONNECTION_STRING` | Add it to your local `.env` after provisioning (see above) |
| `createSearchIndexes` fails during provisioning | Your cluster tier doesn't support Atlas Search indexes — confirm before the workshop |
| Attendees report the agent is inactive right after you provisioned | Check `npm run admin:status` — the index's initial sync can take up to a minute; confirm `plot_vector_index` is `READY` in Atlas's Data Explorer |

## Project layout

```
src/mastra/
  index.ts                     Mastra instance registration
  agents/streaming-catalog-agent.ts   The agent: dynamic model + MCP tools
  processors/demo-gate.ts      Blocks every LLM call outside the active window
  mcp/mongodb-client.ts        Spawns the local MongoDB MCP Server (stdio)
  shared/demo-status.ts        Reads workshop_admin.settings (read-only)
demo/workshop_script.md        Attendee/presenter live demo script
admin/                         Admin-only (this branch only, not on main)
  provision-workshop.ts        One-time setup (idempotent)
  update-settings.ts           Day-to-day lifecycle control
  data/sample_catalog.json     28 synthetic Netflix-style titles (seed data)
  README.md                    Full admin runbook
```

## Security model

| Credential | Scope | Holder |
|---|---|---|
| `workshop_admin_user` | readWrite on `workshop_admin` only | Admin only, never distributed |
| `workshop_readonly_user` | **read-only** on `workshop_admin` only | All attendees (shared) |
| `workshop_demo_user` | readWrite on `streaming_catalog` only | All attendees (shared) |

Attendees' agents can never read or modify the admin settings document — that
boundary is enforced by Atlas's role system, not just application logic.
Destructive MongoDB tools (`drop-database`, `drop-collection`, `delete-many`,
`update-many`, `rename-collection`, `drop-index`) are disabled outright on the
MCP server for this workshop (see `mongodb-client.ts`), so there's no reliance
on an LLM behaving itself.

## Notes

- **Shared collection**: all attendees read/write the same
  `streaming_catalog.titles` collection, tagged by `ownerId`. This is
  intentional — everyone can see everyone's contributions, which is a feature
  for a workshop, not a bug.
- **IP access**: provisioning opens `0.0.0.0/0` for simplicity. The real
  safety net is the time-boxed `workshop_admin.settings` document, not network
  restriction — revisit this if your threat model differs.
- **Keeping this branch in sync**: make shared app code changes on `main`
  first, then merge them forward here (`git checkout admin && git merge
  main`) to pick up updates without losing the `admin/` folder or the admin
  sections above.
- **No secrets live in git on either branch**: real credentials only ever
  exist in your local, gitignored `.env` and in the `workshop_admin.settings`
  document in Atlas itself.
