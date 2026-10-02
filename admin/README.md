# Admin runbook

This folder (and this branch) is admin-only — it is **not** part of the
`main` branch that attendees are told to clone. Keep `admin/*` and this
branch's full `.env.example` / `README.md` content to yourself; share only
the `main` branch URL (or the two shared connection strings) with attendees.

> Note: nothing here contains live secrets. Real credentials only ever exist
> in your own local `.env` (gitignored) and in the `workshop_admin.settings`
> document in Atlas itself — never committed anywhere.

## How the admin-controlled "one-day usage switch" works

Every attendee's agent reads a single MongoDB document —
`workshop_admin.settings` — before every LLM call (via a read-only credential
that cannot see anything else). That document holds the Grove AI Gateway API
key, a start/expiry time window, and an `enabled` flag. You edit that one
document (via `npm run admin:extend|disable|enable|rotate-key`) to control
the entire workshop's lifecycle — no redeploy, no per-attendee action, no
attendee ever sees or configures an API key.

Vector search needs **no API key at all**: `plot_vector_index` is an Atlas
**Automated Embedding** index (`autoEmbed` field type, `voyage-4` model) —
Atlas generates and manages embeddings entirely server-side, for both the
seed catalog and anything attendees insert live.

## Prerequisites

- An existing Atlas cluster that supports Atlas Search/Vector Search (your
  Flex cluster, or M10+).
- [Atlas CLI](https://www.mongodb.com/docs/atlas/cli/current/) installed and
  authenticated: `atlas auth login`.
- Node.js ≥ 22.13, npm.
- A Grove AI Gateway API key.
- Your Atlas project ID and cluster hostname (e.g. `your-cluster.abcd1.mongodb.net`,
  the part of your connection string after `@`).

## One-time setup (before the workshop)

```bash
# on the admin branch
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
strings to share with attendees at the end — copy those into your handout.

Save `ADMIN_CONNECTION_STRING=mongodb+srv://workshop_admin_user:<admin-password>@<cluster-host>/...`
into your own `.env` (not shared) — you'll need it for day-to-day lifecycle
commands below.

Wait for the index's initial sync to finish — check with `npm run
admin:status` and, in Atlas's Data Explorer → Search & Vector Search tab,
confirm `plot_vector_index` status is `READY` (not `Pending`/`Building`).
With 28 seed documents this usually takes under a minute.

Distribute `MONGODB_DEMO_CONNECTION_STRING` and
`MONGODB_ADMIN_READONLY_CONNECTION_STRING` to attendees (handout, private
chat — not git), along with the `main` branch clone URL.

## Day-to-day lifecycle commands

```bash
npm run admin:status                       # see current window + enabled state
npm run admin:extend -- --hours 24         # push the expiry forward
npm run admin:disable                      # instant kill-switch
npm run admin:enable                       # re-enable (time window unchanged)
npm run admin:rotate-key -- --key sk-...   # rotate the Grove AI Gateway key
```

`npm run admin:disable` instantly stops every attendee's agent from calling
the LLM, regardless of the configured time window. Or just let `expiresAt`
pass naturally — same effect, no action needed.

## Folder contents

```
admin/
  provision-workshop.ts   One-time setup (idempotent)
  update-settings.ts      Day-to-day lifecycle control
  data/sample_catalog.json  28 synthetic Netflix-style titles (seed data)
  README.md               This file
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
MCP server for this workshop (see `../src/mastra/mcp/mongodb-client.ts`), so
there's no reliance on an LLM behaving itself.

## Notes / things to verify at your workshop

- **IP access**: provisioning opens `0.0.0.0/0` for simplicity. The real
  safety net is the time-boxed `workshop_admin.settings` document, not network
  restriction — revisit this if your threat model differs.
- **Cluster tier**: Automated Embedding and Atlas Search require a tier that
  supports Atlas Search indexes. Confirm your Flex cluster supports this
  before the workshop; `provision-workshop.ts` will surface a clear error on
  `createSearchIndexes` if not.
- **Keeping this branch in sync**: shared app code changes should be made on
  `main` first, then merged forward here (`git checkout admin && git merge
  main`) to pick up updates without losing the `admin/` folder or the
  admin-only doc sections.
