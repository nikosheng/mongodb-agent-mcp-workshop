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

## Attendee setup (each person)

```bash
git clone <repo-url>
cd mongodb-agent-mcp-workshop
cp .env.example .env
# edit .env: set WORKSHOP_USER_ID, paste the two shared connection strings
# from the admin's handout. No API keys needed.
npm install
npm run dev
```

`npm run dev` opens Mastra Studio — a chat UI with live tool-call tracing.
See [`demo/workshop_script.md`](./demo/workshop_script.md) for the live demo
flow and example prompts.

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
