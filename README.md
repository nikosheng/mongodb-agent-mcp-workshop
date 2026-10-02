# MongoDB MCP Server + Atlas Vector Search Workshop

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

## Project layout

```
src/mastra/
  index.ts                     Mastra instance registration
  agents/streaming-catalog-agent.ts   The agent: dynamic model + MCP tools
  processors/demo-gate.ts      Blocks every LLM call outside the active window
  mcp/mongodb-client.ts        Spawns the local MongoDB MCP Server (stdio)
  shared/demo-status.ts        Reads workshop_admin.settings (read-only)
demo/workshop_script.md        Attendee live demo script
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
