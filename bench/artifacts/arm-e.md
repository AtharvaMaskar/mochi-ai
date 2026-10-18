# Arm E (SQLite relational): method notes

- **Store.** Arm E loads the same `data/bench/dataset.json` into `node:sqlite` tables. Temporal facts (`on_plan`, `introduced`) carry `valid_from`/`valid_until`, and a live row ends at the contract's VALID_FOREVER. Like A, B and C, E reads the JSON directly, so it has every ticket's issue link without the dream's extraction.
- **Fixed tools.** E's fixed tools are generated from `READ_TOOL_SPECS` (agent/queries/tools.ts) and keep the same names, descriptions and arguments. Each one has hand-written SQL in `bench/arms/e.ts` `SQL_TOOLS` that returns the same columns.
  - `emerging_clusters` groups tickets by issue: SQLite has no community detection.
  - The vector fallback and `search_similar` scan stored embeddings by brute-force cosine.
- **Ad-hoc queries.** D's `query_graph` is mirrored by `query_sql`, which runs model-written SQL with the same 200-row cap and 5 s timeout. The SQL runs read-only in a child process, which is killed with SIGKILL at the timeout. E's system prompt carries a compact SQL schema section with the same examples as D's graph schema section.
- **E has no algorithm tools.** SQLite has no PageRank or CDLP, and paths are available only as recursive CTEs written through `query_sql`. D's `graph_algorithm` (shortest path, PageRank, communities, components, betweenness, neighbourhood) has no SQL mirror. This is a real capability difference between the stores, so E was not given a fake one.
- **Staleness.** Replay is an UPDATE of the live row's `valid_until` plus an INSERT of the new fact, mirroring gen's `applyEvent`.
