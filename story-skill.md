# Story composer — skill + story format

How Mochi builds dashboards and stories on request ("/story …", "/dashboard …", or a plain ask
in the channel). One system, two producers: the dream authors the morning report on schedule;
the `build_story` tool authors on demand. Both emit the same document; one renderer draws it.

Format borrowed from nao (`apps/shared/src/tools/story.ts`, `apps/shared/src/story-segments.ts`):
**markdown plus self-closing tags that reference query results by id.** The model writes prose
and tags; it never writes data, HTML, or styles.

## The contract

- **The model never writes HTML or picks colors.** It writes markdown and the tags below. The
  renderer owns the MochiAI design system.
- **Data lives in query results, not in the story.** Every graph query a producer runs returns
  `{ id: "q_<n>", cypher, graph, columns, rows }` and is stored with the story. Tags carry only a
  `query_id` plus column keys; the renderer pulls rows from that result.
- **Receipts are structural.** A tag whose `query_id` is missing or unknown fails the parse — the
  story is rejected, not rendered. Every inline number in prose is wrapped in `<num>`.
  Clicking any number or chart opens its Cypher.
- **Live refresh** re-runs each stored query by id; the prose stays, the numbers update.

## Tool: `build_story`

```
input:  { topic: string, audience?: "agent" | "lead" (default lead), window?: "day"|"week"|"month" }
steps:  1. plan which questions answer the topic (max 6 visual tags)
        2. run read-only graph queries (GRAPH.RO_QUERY on company + caller's tiers) → q_<n> ids
        3. compose the story per the viz grammar
        4. commit as a Pi Durable document (kind: "mochi.story") — watchers re-render live
replay: "safe" (reads only; the document commit is idempotent per requestId)
```

Stored document:

```jsonc
{
  "title": "Release 2.4 — what it's costing us",
  "generated_at": 1760764800,
  "generated_by": "dream | user:<id>",
  "topic": "release 2.4",
  "queries": { "q_1": { "cypher": "MATCH ...", "graph": "company", "columns": [...], "rows": [...] } },
  "body": "markdown with tags (below)"
}
```

## Tags

```
Inline number (mandatory for every number in prose):
  <num query_id="q_1" column="median_h">7.2</num>

<kpi query_id="q_1" label="Median resolution" column="median_h" unit="h"
     promised="4" bad="true"/>                         doctrine delta = value − promised
<bars query_id="q_2" label="Emerging clusters" x="cluster" y="tickets" trend="trend" hot="hot"/>
<line query_id="q_3" label="Tickets per day" x="day" series='["opened","resolved"]'/>
<table query_id="q_4" label="Top repeat-contact customers" columns='["customer","contacts","issue"]'/>
<memdiff query_id="q_5"/>                              rows: { change: "retired"|"added", fact }
<suggestion query_id="q_6" tag="The docs and reality disagree" edge="CONTRADICTS"
            actions='["send_to_team:funds","draft_kb:KB-12","dismiss"]'>
  Prose for the suggestion; numbers inside still use <num>.
</suggestion>
<grid widths="2,1"> ...tags... </grid>                 layout only
```

`<suggestion>` is the one tag with a body. Renderer: the report page maps each tag to its
component (visual reference: `report-story-mockup.html`, re-skinned to the design system);
unknown tags render as a plain note, never crash.

## Viz grammar (system-prompt section for the composer)

- One number judged against a promise → `<kpi>` with `promised`. Never a lone big number
  without context.
- Comparing categories, cluster sizes, team loads → `<bars>`. No pie charts.
- Change over time → `<line>`. Growing/shrinking without a time axis → `<bars>` with `trend`.
- "Why", causality, provenance, anything relational → markdown prose with `<num>` receipts,
  not a chart.
- A recommendation → `<suggestion>`, always with its evidence query; never state a
  recommendation in plain prose.
- What memory changed → `<memdiff>`.
- Raw records someone will scan → `<table>`, max 10 rows.
- Max 6 visual tags. Open with prose. Audience "agent" → lead with the densest actionable
  tag instead.
- If the graph can't support the ask, say so in prose ("not enough resolved tickets in this
  window to compare") — never fabricate a figure.
- Every `query_id` must be the query that actually produced the number. No decorative queries.

## In chat

Chat answers use the same tags and the same parser as reports, and story tags are the default
way to show rich content. Plain markdown tables are fine for prose content: the renderer styles
them. Use the sandboxed-HTML exception (SPEC §4) only when no tag fits. Its HTML uses only
`mochi.css` variables, makes no network calls, and holds no literal numbers: every figure is
`<span data-q="q_1" data-col="median_h"></span>`, which the host fills from the stored query.
