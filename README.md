# MongoDB MCP Server + Atlas Vector Search Workshop

> **You are on the `admin` branch.** This branch is a superset of `main` — it
> adds the `admin/` folder (provisioning + lifecycle scripts) and the admin
> sections below. Attendees should clone the `main` branch
> (`https://github.com/nikosheng/mongodb-agent-mcp-workshop`, the default
> branch), not this one.

A hands-on workshop on MongoDB Atlas Vector Search: attendees first **build a
vector search pipeline by hand** (schema → embed with Voyage AI → create a
vector index → query it) in a Jupyter notebook, then see the same capability
**fully automated** (Atlas Automated Embedding, `voyage-4`) through a single
Mastra agent + the MongoDB MCP Server. 5–10 attendees clone this repo and
share one pre-provisioned Atlas cluster — nobody needs their own Atlas
account, Voyage account, or cluster.

```
Attendee's laptop (× 5-10, same repo, same shared cluster)
  Part 1: Jupyter notebook (pymongo + voyageai, manual pipeline)
  Part 2: Mastra agent (Mastra Studio chat UI, `npm run dev`)
    ├─ model: Grove AI Gateway → gpt-6-luna (key fetched from Atlas, not .env)
    └─ tools: MongoDB MCP Server (stdio subprocess, workshop_demo_user)
                    │
                    ▼
      Atlas cluster (admin's existing Flex cluster)
        ├─ streaming_catalog.titles           (shared catalog + autoEmbed index, Part 2)
        ├─ streaming_catalog.titles_sandbox_*  (your personal collection + index, Part 1)
        └─ workshop_admin.settings            (admin-only control-plane doc)
```

## How workshop availability works

Both the notebook (Part 1) and the agent (Part 2) only work during the
admin-scheduled workshop window — they read the same admin-controlled
`workshop_admin.settings` document (via a read-only credential) to fetch
their respective API keys (Voyage AI, Grove AI Gateway) and check whether
the workshop is currently enabled. If you see an "inactive" style error in
either, contact your workshop organizer — there's nothing to configure on
your end.

## Workshop guidance for attendees

### Setup (~2 minutes)

```bash
git clone https://github.com/nikosheng/mongodb-agent-mcp-workshop.git
cd mongodb-agent-mcp-workshop
cp .env.example .env
# edit .env: set WORKSHOP_USER_ID (your name/initials), and paste the two
# shared connection strings your workshop admin gives you. No API keys needed.
npm install
```

### Part 1: Build your own vector search (notebook)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r notebooks/requirements.txt
jupyter lab notebooks/01_build_vector_search.ipynb
```

Work through [`notebooks/01_build_vector_search.ipynb`](./notebooks/01_build_vector_search.ipynb)
cell by cell. You'll:

1. Explore the schema of the shared `streaming_catalog.titles` collection
2. Copy a small subset into your own sandbox collection
3. Embed the `synopsis` field yourself with the **Voyage AI** embeddings API
4. Create your own self-managed Atlas **Vector Search** index on those embeddings
5. Run a `$vectorSearch` query against your own self-managed index
6. Drop that index, then build a second index on the same documents using
   Atlas's **Automated Embedding** (`autoEmbed`) — no embedding code this time
7. Query the `autoEmbed` index with plain text instead of a pre-computed vector
8. Combine semantic search with a `release_year` metadata filter
9. Insert a brand-new title with zero embedding code and watch it show up in
   semantic search live — the moment that really sells `autoEmbed`
10. Combine `synopsis`, `genres`, and `cast` into one embedding using a
    MongoDB View, and watch it stay fresh as each field changes independently
11. Compare both approaches side by side
12. Clean up your sandbox index/collection

**Prerequisite:** Python 3.10+ and pip.

### Part 2: End-to-end agent demo (Mastra Studio)

```bash
npm run dev
```

`npm run dev` opens **Mastra Studio** in your browser — a chat UI with live
tool-call tracing. See [`demo/workshop_script.md`](./demo/workshop_script.md)
for the full live demo flow and example prompts. In short, you can:

- **Ask for a recommendation** — e.g. "Recommend something like Stranger
  Things but funnier." Watch the tool-call trace: the agent runs a
  `$vectorSearch` aggregation against `plot_vector_index`, and Atlas embeds
  your request automatically — no embedding code anywhere in this app,
  unlike the manual version you just built in Part 1.
- **Contribute your own title** — e.g. "Add a movie idea: ..." The agent
  inserts it into the shared catalog tagged with your `WORKSHOP_USER_ID`;
  Atlas embeds it within a few seconds, live.
- **Search again** to confirm your new title shows up in semantic search.
- **Combine filters with semantic search** — e.g. "a sci-fi title similar to
  X, but only from 2022 or later."

Don't ask the agent to drop the index/collection or connect to any other
database — destructive tools are disabled server-side and your credentials
only grant access to `streaming_catalog`, so neither would work anyway.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Notebook or agent refuses with a "workshop not active" style error | The admin hasn't started the window yet, it expired, or it was disabled — contact your organizer, nothing to fix on your end |
| "MONGODB_ADMIN_READONLY_CONNECTION_STRING is missing" (agent) / `KeyError` on the same var (notebook) | You haven't filled in `.env` yet, or forgot to restart `npm run dev` / restart the notebook kernel after editing it |
| `ModuleNotFoundError: No module named 'pymongo'` (or `voyageai`, `dotenv`) in the notebook | You haven't created/activated your `.venv` and run `pip install -r notebooks/requirements.txt` yet (see Part 1 setup above), or launched `jupyter lab` from a different environment than the one you installed into |
| MCP tool calls or pymongo calls fail with an auth/permission error | Double-check you pasted the exact connection strings from your admin's handout (not your own Atlas credentials) |
| Notebook's vector index never becomes "queryable" | Give it a minute — index builds take a little time; if it's stuck longer, re-run the polling cell or ask your admin to check cluster index limits |

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
notebooks/
  01_build_vector_search.ipynb Part 1: manual schema/embed/index/search walkthrough
  requirements.txt             pymongo, voyageai, python-dotenv, jupyterlab
src/mastra/
  index.ts                     Mastra instance registration
  agents/streaming-catalog-agent.ts   The agent: dynamic model + MCP tools
  processors/demo-gate.ts      Blocks every LLM call outside the active window
  mcp/mongodb-client.ts        Spawns the local MongoDB MCP Server (stdio)
  shared/demo-status.ts        Reads workshop_admin.settings (read-only)
demo/workshop_script.md        Part 1 + Part 2 attendee/presenter live demo script
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
- **Notebook sandboxes are isolated, but please clean up**: `workshop_demo_user`
  (readWrite on `streaming_catalog`) is enough to create/drop your own Atlas
  Search indexes directly — no extra admin privileges needed. Your sandbox
  collection/index in Part 1 is named after your `WORKSHOP_USER_ID`, so it
  never collides with anyone else's or with the shared production index. Run
  the notebook's cleanup cell when you're done — Atlas Search index counts
  are limited per cluster, especially on shared/Flex tiers.
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
