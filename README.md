# MongoDB MCP Server + Atlas Vector Search Workshop

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
8. Insert a brand-new title with zero embedding code and watch it show up in
   semantic search live — the moment that really sells `autoEmbed`
9. Compare both approaches side by side
10. Clean up your sandbox index/collection

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
```

## Security model

| Credential | Scope | Holder |
|---|---|---|
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
