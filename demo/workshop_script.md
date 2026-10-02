# Workshop Script: MongoDB MCP Server + Atlas Vector Search

This workshop has two parts:

- **Part 1 (hands-on, notebook)**: attendees build a vector search pipeline
  manually — explore the schema, embed with Voyage AI, create a vector index,
  query it — in [`notebooks/01_build_vector_search.ipynb`](../notebooks/01_build_vector_search.ipynb).
- **Part 2 (live demo, this script)**: everything here happens by typing
  natural-language prompts into the chat window (Mastra Studio, opened via
  `npm run dev`) — there is no custom UI code to demo, the conversation *is*
  the demo. This is the fully-automated version of what attendees just
  built by hand in Part 1.

## Attendee setup (each person, ~2 minutes)

```bash
git clone <repo-url>
cd mongodb-agent-mcp-workshop
cp .env.example .env
# edit .env: set WORKSHOP_USER_ID to your name/initials, paste the two shared
# connection strings the presenter gave you
npm install
```

Do Part 1 first (see `notebooks/01_build_vector_search.ipynb` and the
"Workshop guidance for attendees" section of the main `README.md`), then
come back here for Part 2:

```bash
npm run dev
```

`npm run dev` opens Mastra Studio in your browser with a chat window connected
to the `streamingCatalogAgent`. That's the whole demo surface for Part 2.

## Live flow (Part 2)

### 1. Semantic search (safe for everyone to try at once)

Try prompts like:

> "I want a feel-good documentary about food."

This is the exact same query you ran manually against your own sandbox
index at the end of the notebook (Part 1) — compare the results and notice
there's no `vo.embed(...)` call anywhere in this app's code this time.

Also try:

> "Recommend something like Stranger Things but funnier."

> "Find a slow-burn romance movie, nothing too long."

Watch the tool call trace in Studio: the agent calls `aggregate` with a
`$vectorSearch` stage against `plot_vector_index`, passing your request as
plain text — Atlas embeds it with `voyage-4` and returns the nearest titles.
No vectors are ever computed in this app's code.

### 2. Contribute your own title

> "Add a movie idea: a time-loop comedy about a barista who relives the same
> Monday morning rush until she finally remembers everyone's order."

The agent calls `insert-many`, tagging the document with your
`WORKSHOP_USER_ID` as `ownerId`. Atlas detects the insert via change streams
and generates its embedding within a few seconds — no action needed from the
agent or from you.

### 3. Search again, including your new title

> "Now search for something like that barista time-loop idea again — did it
> show up?"

This demonstrates that Automated Embedding indexes update live, without
re-running any index-creation step.

### 4. Filtered semantic search (stretch goal)

> "Find a sci-fi title similar to a city-under-siege story, but only from
> 2022 or later."

> "Show me only documentaries."

This combines `$vectorSearch`'s metadata filter (on `genres` / `release_year`
/ `ownerId`, all indexed as filter fields) with semantic similarity — a
realistic production pattern, not just a toy similarity search.

### 5. Optional: ask about the schema

> "What does a typical document in this collection look like?"

Uses `collection-schema` — useful if someone asks "how does the agent know
what fields exist?"

## What NOT to try live

- Don't ask the agent to drop the index or the collection — those tools are
  disabled entirely for this workshop (see `src/mastra/mcp/mongodb-client.ts`).
- Don't ask it to connect to or inspect any other database — its credentials
  only grant access to `streaming_catalog`.
