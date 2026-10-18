# FalkorDB — what we know, and what Mochi Brain uses from it

All of docs.falkordb.com (624 pages) was read on 2026-10-18 by four parallel readers, cross-checked
against the `falkordb@6.8.0` npm tarball, and one claim (Redis ACL read-only users) tested in a
throwaway container. Read **Part 0** before writing any Cypher; Parts A–D are the reference.
Every subsection in A–D carries its source URL. `UNVERIFIED` = not in the docs, test before relying on it.

Tip: any docs page is available as clean markdown at `<url>.md`; the index is `https://docs.falkordb.com/llms.txt`.

- **Part 0** — Must-know gotchas · Ideas for Mochi Brain (consolidated, mapped to our graph contract)
- **Part A** — Core: Cypher clauses/functions/procedures, indexes, constraints, data types, every `GRAPH.*` command, config, concurrency & storage design
- **Part B** — Algorithms, UDFs/FLEX, agentic memory, GraphRAG SDK, GenAI tools (MCP), integrations
- **Part C** — Browser, operations (Docker, persistence, replication, cluster), Cloud (tiers, Free limits)
- **Part D** — Enterprise, ACL / multi-tenancy, licensing

---

# Part 0 — Read first

## Gotchas that will bite us

| # | Gotcha | What we do |
|---|---|---|
| 1 | **A property cannot be null.** `SET r.x = null` removes it; `IS NULL` matches "absent" and cannot use an index. | Either keep SPEC's null = "absent" rule, or use a far-future sentinel (idea 2). |
| 2 | **Temporal arithmetic is unsupported**; `datetime()` is undocumented. | Epoch-ms integers from `timestamp()` everywhere (already in contracts). |
| 3 | **Algorithms ignore edge properties.** `algo.*` filters by label and rel type only, so retired edges still count. | Run algorithms on a scratch projection graph of live edges only (idea 9). |
| 4 | **Parallel edges undercount** when the rel variable is unreferenced. `count(t)` over a multigraph lies. | Always bind and count the edge (`count(s)`), and filter on it. |
| 5 | **`RESULTSET_SIZE` silently truncates at 10k rows.** | Aggregate in Cypher. The benchmark records the config. |
| 6 | **`GRAPH.PROFILE` executes writes.** | Profile only read-only queries. |
| 7 | **Vector search takes no property filters**, and the docs contradict themselves on whether `score` is a distance or a similarity. | Over-fetch k×5, then filter in Cypher. Pin the sort direction in a test. |
| 8 | **Constraints need an index first and are built asynchronously (`PENDING`).** UNIQUE skips nulls and arrays. | Create the index, then the constraint, then poll `db.constraints()` until `OPERATIONAL`. |
| 9 | **`MULTI`/`EXEC` blocks every graph.** | Never use it. One `UNWIND … MERGE` query per batch, which is atomic. |
| 10 | **`%R~` (read-only key pattern) breaks `GRAPH.RO_QUERY`**, because the key spec is RW. This was tested. | Grant read-only per command (`-@all +GRAPH.RO_QUERY`), never `%R~`. Part A's ACL idea uses `%R~` and is wrong. |
| 11 | **ACL users made at runtime vanish on restart.** | Use an aclfile on the volume plus `ACL SAVE`, or create them in `REDIS_ARGS`. |
| 12 | **`algo.pageRank` takes one label and one type, no weights, and ranks incoming edges.** CDLP community ids change between runs. | Point edges at what you rank. Key clusters by their smallest ticket id. |
| 13 | **Cypher cannot cross graphs.** | Tier merging is several queries, combined in TS (precedence rules in SPEC §1). |
| 14 | **Not supported:** label expressions, the `=~` regex operator, count/sum/avg inside pattern comprehensions, index use on `<>`, and `LIMIT` on eager writes. | Write around them. |
| 15 | **The docker volume path is inconsistent in the docs** (`/data` vs `/var/lib/falkordb/data`). | Verify with `CONFIG GET dir` before mounting. |
| 16 | **Cloud Free:** 100 MB, no TLS, no persistence, a non-default port, stops after 1 idle day and is deleted after 7. | Use it only as a secondary endpoint. The data must be re-seedable. |

## Ideas for Mochi Brain

These use our contract names (`mochi_company`, Ticket, Issue, Release, AgentUser, SOLVED, ABOUT, INTRODUCED …).
**[SPEC]** marks an idea that needs a human-approved SPEC amendment. Every other idea fits inside the current SPEC.

### Contracts / scaffold (`add-contracts`)
1. **The database enforces read-only access, not only the tool loadout.** This was tested on the OSS image. It becomes a new Feature Ledger row, "tier isolation", **[SPEC]** for that row.
   ```
   ACL SETUSER mochi_reader on >… resetkeys ~mochi_company ~team_* resetchannels -@all +GRAPH.RO_QUERY +GRAPH.EXPLAIN +GRAPH.LIST +PING
   ACL SETUSER mochi_dream  on >… resetkeys ~mochi_company* ~team_* ~algo_scratch resetchannels -@all +GRAPH.QUERY +GRAPH.RO_QUERY +GRAPH.COPY +GRAPH.DELETE +GRAPH.CONSTRAINT +PING
   ACL SETUSER user_<id>    on >… resetkeys ~mochi_company ~team_* -@all +GRAPH.RO_QUERY (~user_<id> ~cust_* +GRAPH.QUERY +GRAPH.RO_QUERY)
   ```
   - User conversations connect as the reader. A prompt-injected `CREATE` fails at the database with `NOPERM`.
   - A small test asserting the four refusals is the ledger row's evidence.
   - README receipt: `ACL GETUSER` output.
2. **Sentinel `valid_until` instead of absent/null [SPEC]:** `253402300799000` (9999-12-31).
   - Live and as-of collapse into one fragment, `r.valid_from <= $as_of AND r.valid_until > $as_of`. Live is simply `$as_of = now`, which is exactly the rule the shareable `?asOf=` stories already require.
   - The filter becomes an index range scan, and gotchas 1 and 4 go away.
   - Retiring a fact stays `SET r.valid_until = timestamp()`.
3. **Unique + mandatory constraints on every id-bearing label** (Customer, Ticket, Issue, Release, AgentUser, KBArticle, Resolution, Suggestion …). A dream re-run after a Pi Durable crash/resume cannot create duplicates. A violation aborts the batch atomically, and the checkpoint retries it.
4. **docker-compose:**
   - Pin the image tag.
   - Persistence: AOF `everysec` + RDB `save` rules in `REDIS_ARGS`.
   - `FALKORDB_ARGS=THREAD_COUNT 4 TIMEOUT_DEFAULT … TIMEOUT_MAX …`.
   - Healthcheck: `redis-cli ping`.
   - aclfile on the volume.
   - Persistence demo: `docker compose restart` gives the same `count(n)`, which is a Track 02 "persists across sessions" receipt.

### Agent (`agent/`)
5. **All five read queries use `roQuery`**, and each receipt carries the `GRAPH.EXPLAIN` plan, which is free because it doesn't execute.
   - Optional: read-only PROFILE "records produced" per operator, so the path receipt can say "customer → 12 tickets → 4 fixes → 1 team".
   - Tag queries `/* mochi:briefing@v1 */` so slowlog lines name the receipt (UNVERIFIED that comments survive).
6. **Briefing vector fallback:** `CALL db.idx.vector.queryNodes('Ticket','embedding',$k*5,vecf32($q)) YIELD node, score`, then filter, then continue the traversal from `node`. The receipt says `path: vector→graph`.
7. **Who-knows:**
   ```
   MATCH (a:AgentUser)-[s:SOLVED]->(t:Ticket)-[:ABOUT]->(:Issue {id:$issue}) RETURN a.id, a.name, count(s) AS solved ORDER BY solved DESC, a.id LIMIT 5
   ```
   - Bind `s`; tiebreak on id so the result is deterministic.
   - PageRank only through a reversed edge on a projection (gotcha 12). Not needed.
8. **Blast radius as real paths:**
   ```
   MATCH p=(r:Release {version:$v})-[i:INTRODUCED]->(:Issue)<-[:ABOUT]-(:Ticket)<-[:RAISED]-(c:Customer)
   ```
   - Apply the temporal filter on `i`, and return `nodes(p)` for the path receipt.
   - `algo.SSpaths` is the alternative when the path length is variable.
9. **Emerging clusters (query 4):**
   - The dream projects the last 7 days of Ticket–ABOUT–Issue edges into `algo_scratch` (UNWIND batches).
   - It runs `CALL algo.labelPropagation({nodeLabels:['Ticket','Issue'], relationshipTypes:['ABOUT'], maxIterations:10}) YIELD node, communityId` and writes `Cluster` nodes plus `IN_CLUSTER` edges back to `mochi_company`.
   - Each cluster is keyed by its smallest ticket id, so names are stable from night to night. "Emerging" means it grew compared with last night's Cluster.
   - The receipt shows both the projection query and the algo call.
10. **Repeat-contact loops:** `algo.wcc` over Customer–RAISED–Ticket–FOLLOWS. A component with one customer, 3+ tickets and no resolution is an unowned loop, which feeds the briefing and the morning report.
11. **Dream write patterns:**
    - Start with `GRAPH.COPY mochi_company mochi_company_prev`. That gives rollback if validation fails, plus a read-only "yesterday's brain" that complements `?asOf=`.
    - Ingest one `UNWIND $batch … MERGE` per batch.
    - Extraction prompt: a **closed label/edge vocabulary taken from `contracts/graph.ts`**, with off-schema output pruned. In GraphRAG-SDK's measurements this cut 447 labels to 30 and doubled triple F1.
    - Deterministic MERGE keys.
    - Store a `content_hash` per ticket to skip unchanged ones.
    - Optional: FLEX `flex.text.jaroWinkler` dedupe of extracted Issue names. FLEX is loaded at boot with `GRAPH.UDF LOAD`.
12. **The mismatch engine stays pure Cypher plus arithmetic**, which matches the docs' examples. Use `FOREACH (_ IN CASE WHEN … THEN [1] ELSE [] END | MERGE …)` for conditional edge writes.

### Bench (`bench/`)
13. **Concurrency smoke test with server-side evidence:**
    - Sample `GRAPH.INFO` (running/waiting queries) every 100 ms during the N-reader + dream-writer run.
    - The dream writes a `Batch {id, n}` marker in the same query as its tickets. Readers assert that `count(batch tickets) = n` whenever the marker is visible. This tests the documented snapshot guarantee directly.
    - Record `THREAD_COUNT` and `MAX_QUEUED_QUERIES`.
14. **Honesty artifacts in `results.json`:** `GRAPH.SLOWLOG` (reset before, saved after), `GRAPH.MEMORY USAGE`, `CALL db.meta.stats()`, and `GRAPH.CONFIG GET *`. Every number then traces back to its config and data size.
15. **Arm B runs inside FalkorDB's vector index** (already in SPEC). The only difference between B and D is then traversal versus similarity.

### Demo / deploy / README
16. **Deploy ranking:**
    - (1) **Railway FalkorDB template + app as a second Railway service**: about 10–15 minutes, persistent volume, hosted HTTPS Browser, app on `FALKORDB_PRIVATE_URL`.
    - (2) Cloud Free + an app host (no persistence).
    - (3) Local compose, which we record the video on regardless.
    - (4) `falkordblite`, as a zero-Docker fallback.
17. **Browser in the video:**
    - The Schema tab is the README graph model made visible. Seed every node with its full property set, because the schema view samples 10 nodes.
    - One renamed tab per tier.
    - The briefing query in Tree layout with Dim, which shows the path receipt.
    - The Explain/Profile tree.
    - Label colours set from `tokens.json`. Styles are per browser, so prepare the recording profile.
    - The same query before and after a dream.
18. **FalkorDB MCP server for judges:**
    - `npx -y @falkordb/mcpserver@latest` with `FALKORDB_DEFAULT_READONLY=true`, committed as `.mcp.json`. Remap its port, because :3000 clashes with the Browser.
    - Judges can ask Claude about `mochi_company` directly. **[SPEC]**, otherwise → `LATER.md`.
19. **Prior art to cite, not adopt:** mem0 (one graph per user) and Graphiti (one graph per tenant, plus temporal invalidation) independently validate our tiers and our time model. All are Python and would hide our Cypher. They belong in the blog's decision log.
20. **Blog lines that are code, not claims:**
    - "Readers never see half a dream: per-graph snapshot reads, serialized atomic writes."
    - "We stored 9999-12-31 because FalkorDB can't store null." (if idea 2 is taken)
    - "The database refuses the write, not our prompt."

---


# Part A — Core

_Its raw ideas list was folded into Part 0._

All 59 URLs in `a.txt` were fetched and read (2026-10-18). Wherever the docs contradict themselves, this file says so. Anything marked UNVERIFIED does not appear on these pages and needs a test before we depend on it.

---

## 0. Setup and runtime facts
Sources: https://docs.falkordb.com · https://docs.falkordb.com/getting-started · https://docs.falkordb.com/getting-started/clients

- Requires **Redis 8.0.0 or later**. 7.x is not supported. The Docker images bundle it.
- `docker run -p 6379:6379 -p 3000:3000 -it --rm falkordb/falkordb:latest` starts the server on 6379 and the Browser UI on 3000. For production use `falkordb/falkordb-server:latest`, which has no browser.
- Pass module args with `-e FALKORDB_ARGS="THREAD_COUNT 4 CACHE_SIZE 50"` and Redis args with `-e REDIS_ARGS="--requirepass pw"`.
- Protocols: RESP, plus Bolt when `BOLT_PORT` is set (it defaults to -1, which means off).
- npm package `falkordb` (falkordb-ts, MIT). The API surface these pages show:
  ```ts
  import { FalkorDB } from 'falkordb';
  const db = await FalkorDB.connect({ username, password, socket: { host: 'localhost', port: 6379 } });
  const g = db.selectGraph('mochi_company');
  await g.query(cypher, { params: { name: 'x' } });   // read/write
  await g.roQuery(cypher, { params });                  // GRAPH.RO_QUERY
  await g.explain(cypher); await g.profile(cypher);     // string[] plan lines
  await g.slowLog(); await g.memoryUsage({ samples: 500 }); await g.delete();
  await db.copyGraph('src', 'dst'); await db.list(); await db.info();
  await db.configGet('*'); await db.configSet('TIMEOUT_DEFAULT', 10000);
  await db.createConstraint('g','UNIQUE','NODE','Person',['first_name','last_name']);
  await db.dropConstraint('g','UNIQUE','NODE','Person',['first_name','last_name']);
  db.close();
  ```
  The examples iterate results as `result.data` in some places and as `for (const r of result)` in others. UNVERIFIED: which shape our client version returns. UNVERIFIED: how to pass a per-query `TIMEOUT` from the npm client.
- The bulk loader for big CSV seeds: `pip install falkordb-bulk-loader` then `falkordb-bulk-insert GRAPH -n nodes.csv -r edges.csv`.
- License: SSPLv1. That is fine for a hackathon or internal service. It only bites if we offer FalkorDB itself as a service (https://docs.falkordb.com/references/license).

---

## 1. Commands (GRAPH.* and ACL)
Source index: https://docs.falkordb.com/commands. Every command is a Redis module command, and most take the graph key first. The first `GRAPH.QUERY` against a key creates the graph; there is no CREATE GRAPH command.

### GRAPH.QUERY / GRAPH.RO_QUERY
https://docs.falkordb.com/commands/graph.query · https://docs.falkordb.com/commands/graph.ro-query
```
GRAPH.QUERY    <graph> "<query>" [TIMEOUT ms] [--compact] [version <n>]
GRAPH.RO_QUERY <graph> "<query>" [TIMEOUT ms] [--compact] [version <n>]
GRAPH.QUERY g "CYPHER p1='Hawaii' p2=3 MATCH (s {name:$p1}) RETURN s"   -- parameters in redis-cli
```
- Plans are cached for up to `CACHE_SIZE` unique query strings, which defaults to **25** and evicts LRU. Parameterize; never interpolate. Parameters also block Cypher injection. The reply statistics include `Cached execution: 0|1`.
- `RO_QUERY` returns an error on any write (CREATE, SET, DELETE, a MERGE that creates). It can run on replicas.
- `version`: when the graph's schema version differs from the one sent, the server returns `version mismatch`. This is for clients that cache schema.
- `--compact`: labels, types and property keys come back as integer IDs. Clients resolve them with `db.labels()`, `db.relationshipTypes()` and `db.propertyKeys()`; IDs start at 0 and only grow (https://docs.falkordb.com/design/client-spec).
- Reply shape: with RETURN, `[header, rows, stats]`; without RETURN, `[stats]`. Possible stats: `Labels added/removed`, `Nodes created/deleted`, `Properties set/removed`, `Relationships created/deleted`, `Indices created/deleted`, `Cached execution`, `Query internal execution time: <float> milliseconds` (https://docs.falkordb.com/design/result-structure).
- In verbose output, booleans arrive as the strings "true"/"false" and doubles as strings with 15-digit precision.

### GRAPH.EXPLAIN
https://docs.falkordb.com/commands/graph.explain
`GRAPH.EXPLAIN <graph> "<query>"` builds the plan **without running the query**, so nothing is read or written. It accepts the `CYPHER p=v` prefix. The output is an operation tree, for example:
```
1) "Results"
2) "    Project"
3) "        Index Scan | (p:Person)"            -- index used
                Node By Label Scan | (p:Person) -- no index (also printed as "Label Scan")
        Edge By Index Scan | [f:FOLLOW]          -- relationship range index
        ProcedureCall | db.idx.vector.queryNodes -- vector / fulltext / cch
```
**Use for us:** safe on write queries, so the dream's MERGE queries can be inspected. Cheap enough to attach to every receipt. It proves the index-hit claims ("Index Scan" against "Node By Label Scan").

### GRAPH.PROFILE
https://docs.falkordb.com/commands/graph.profile
`GRAPH.PROFILE <graph> "<query>" [TIMEOUT ms]` **executes the query, writes included**, and returns the plan with `Records produced: N, Execution time: X ms` per operator. It returns no RETURN rows and no stats.
```
1) "Create | Records produced: 11208, Execution time: 168.208661 ms"
2) "    Filter | Records produced: 11208, Execution time: 1.250565 ms"
3) "        Conditional Traverse | Records produced: 12506, Execution time: 7.705860 ms"
4) "            Node By Label Scan | (actor_a:Actor) | Records produced: 1317, Execution time: 0.104346 ms"
```
**Use for us:** a per-hop receipt: how many candidates each traversal stage produced, and where the time went. **Never PROFILE a write query against live memory.** It mutates the graph. Profile writes only against a GRAPH.COPY.

### GRAPH.SLOWLOG
https://docs.falkordb.com/commands/graph.slowlog
`GRAPH.SLOWLOG <graph>` returns **up to 10** of the slowest queries, and only those that took **10 ms or more**. Each entry is `[unix_ts(double), command, query, ms(double), params|nil]`. `GRAPH.SLOWLOG <graph> RESET` clears the log permanently.
**Use for us:** reset before a benchmark run, dump after it, and store the dump in the bench artifacts. This is honest evidence of the worst-case queries.

### GRAPH.INFO
https://docs.falkordb.com/commands/graph.info
`GRAPH.INFO [RunningQueries] [WaitingQueries] [ObjectPool]`. With no argument it returns all three sections. Running means a worker thread is executing the query. Waiting means it is queued for a thread. `ObjectPool` gives "Unique Objects in Pool" and "Average References per Object". Controlled by `CMD_INFO yes|no`, and the history depth by `MAX_INFO_QUERIES` (0–1000, default 1000).
**Use for us:** poll it during the concurrency smoke test. It shows the dream's write queued or running while N readers run, which is direct evidence of the reader-writer model.

### GRAPH.COPY
https://docs.falkordb.com/commands/graph.copy
`GRAPH.COPY <src> <dest>` returns `OK`. The source stays readable and writable during the copy. The destination is a **consistent snapshot as of the moment the command starts**, and later writes to the source do not reach it. It copies nodes, edges, properties, **indexes and constraints**. It **errors if dest exists**, so GRAPH.DELETE first. It uses `TEMP_FOLDER` (default `/tmp`, must be writable) for dump files. ACL: it reads src and writes dest, so use `%R~src_pattern` plus `~dest_pattern` (see ACL).
**Use for us:** the pre-dream as-of snapshot, rollback, a sandbox for PROFILE, and tenant templates (see Ideas).

### GRAPH.CONSTRAINT CREATE / DROP
https://docs.falkordb.com/commands/graph.constraint-create · https://docs.falkordb.com/commands/graph.constraint-drop
```
GRAPH.CONSTRAINT CREATE <graph> MANDATORY|UNIQUE NODE <label>|RELATIONSHIP <reltype> PROPERTIES <n> <prop> [<prop>...]
GRAPH.CONSTRAINT DROP   <graph> MANDATORY|UNIQUE NODE <label>|RELATIONSHIP <reltype> PROPERTIES <n> <prop> [<prop>...]
-- n between 1 and 255
```
- **UNIQUE requires an existing exact-match (range) index on exactly those properties**: `CREATE INDEX FOR (t:Ticket) ON (t.id)`. Without it, creation fails synchronously.
- CREATE is **asynchronous**. It returns `PENDING`, the status goes `UNDER CONSTRUCTION` → `OPERATIONAL`, or `FAILED` if existing data violates it. A FAILED constraint is **not enforced**: fix the data, drop it and recreate it. Check with `CALL db.constraints()`, which yields `type, label, properties, entitytype, status`.
- UNIQUE is enforced only when **all** constrained properties are non-null. It is **not enforced on array-valued properties**.
- MANDATORY means the property must exist on every node with that label, or every edge of that type.
- You cannot drop an index that supports a constraint. Dropping the constraint does not drop the index. DROP is synchronous and returns `OK`, or an error if the constraint does not exist.
- A violation fails the whole query atomically (see concurrency).
- Constraints work on relationships too (`RELATIONSHIP Visited PROPERTIES 1 date`).

### GRAPH.CONFIG GET / SET
https://docs.falkordb.com/commands/graph.config-get · https://docs.falkordb.com/commands/graph.config-set
`GRAPH.CONFIG GET <name>|*` · `GRAPH.CONFIG SET k1 v1 [k2 v2 ...]`. Values set at runtime are **not persisted** across restarts. Load-time-only parameters return `(error) This configuration parameter cannot be set at run-time`. An invalid value leaves the previous one in place. The docs say "typically" admin-only.

### GRAPH.LIST / GRAPH.DELETE / GRAPH.MEMORY
https://docs.falkordb.com/commands/graph.list · https://docs.falkordb.com/commands/graph.delete · https://docs.falkordb.com/commands/graph.memory
- `GRAPH.LIST` lists the graph keys in the current Redis DB. **It includes internal `telemetry{<graph>}` keys**, so filter them out before showing tenant graphs.
- `GRAPH.DELETE <graph>` cannot be undone. It takes the write lock: running queries finish first, then new ones block. It runs async when `ASYNC_DELETE yes`, the default. Cypher `DELETE` on a node always removes its edges.
- `GRAPH.MEMORY USAGE <graph> [SAMPLES n]` (n defaults to 100, clamped to 1–10000) returns MB values: `total_graph_sz_mb, label_matrices_sz_mb, relation_matrices_sz_mb, amortized_node_block_sz_mb, amortized_node_attributes_by_label_sz_mb{label:MB}, amortized_unlabeled_nodes_attributes_sz_mb, amortized_edge_block_sz_mb, amortized_edge_attributes_by_type_sz_mb{type:MB}, indices_sz_mb`. In npm: `graph.memoryUsage({samples})`.
  **Use for us:** a measured memory row for each memory variant (graph+vector index against vector only) in `bench/results.json`.

### ACL (read-only users, per-tenant access)
https://docs.falkordb.com/commands/acl
```
ACL SETUSER <user> on|off nopass|>password ~<pattern> %R~<pattern> %W~<pattern> %RW~<pattern> +<cmd> -<cmd>
ACL GETUSER u · ACL DELUSER u · ACL LIST · ACL LOG [count] · ACL SAVE (needs an aclfile configured)
ACL SETUSER reader on >pass +GRAPH.RO_QUERY %R~*        -- doc's read-only recipe
ACL SETUSER x +@all ~app1:* %R~app2:*                     -- copy from app2 (R) into app1 (RW)
```
- `~p` is the same as `%RW~p`. W covers insert, update, delete; R covers data returned to the client. GRAPH.LIST metadata is not covered by R.
- A write that also returns data needs **both R and W**. Side channels such as mutation counts are not treated as reads.
- `ACL SETUSER` is in-memory only. Persist it with an aclfile plus `ACL SAVE`.
- A denied command returns a permission error and lands in `ACL LOG`.

### GRAPH.BULK (design doc)
https://docs.falkordb.com/design/bulk-spec
`GRAPH.BULK <graph> ["BEGIN"] <node_count> <edge_count> <blob>...` takes binary blobs (header: null-terminated name, u32 prop count, prop names; values typed by `BI_NULL=0, BI_BOOL=1, BI_DOUBLE=2, BI_STRING=3, BI_LONG=4, BI_ARRAY=5`). It **only creates new graphs**: BEGIN fails if the key exists. Blobs are limited to 512 MB and a query to 1 GB. Node IDs are assigned in creation order. Not worth it for us: our synthetic seed is small, and `UNWIND $rows MERGE` is fine.

---

## 2. Configuration parameters
Source: https://docs.falkordb.com/getting-started/configuration

| Param | When settable | Default | Notes |
|---|---|---|---|
| `THREAD_COUNT` | load only | logical cores | thread pool size = max concurrent queries |
| `CACHE_SIZE` | load only | 25 | plan-cache entries, LRU |
| `OMP_THREAD_COUNT` | load only | GraphBLAS default | intra-query parallelism for matrix ops |
| `NODE_CREATION_BUFFER` | load only | 16384 (min 128, rounded up to a power of 2) | matrix headroom; affects memory and resize cost |
| `BOLT_PORT` | load only | -1 (off) | |
| `IMPORT_FOLDER` | load only | `/var/lib/FalkorDB/import/` | root for LOAD CSV `file://` paths |
| `TEMP_FOLDER` | load only | `/tmp` | GRAPH.COPY dump files; must be writable |
| `ASYNC_DELETE` | load + run | yes | GRAPH.DELETE runs in the background |
| `MAX_QUEUED_QUERIES` | load + run | UINT64_MAX | over the limit returns `Max pending queries exceeded` |
| `TIMEOUT` | load + run | deprecated since v2.10 | old meaning: read-only timeout; writes never timed out |
| `TIMEOUT_MAX` | load + run | 0 (off) | v2.10+: hard cap for **reads and writes**; a write that times out is **rolled back**; a per-query TIMEOUT above it returns an error |
| `TIMEOUT_DEFAULT` | load + run | 0 (= TIMEOUT_MAX) | v2.10+: default per query; must be ≤ TIMEOUT_MAX |
| `RESULTSET_SIZE` | load + run | **10,000** | rows beyond it are **silently dropped** (example: SET 3 → `UNWIND range(1,5)` returns 3 rows, no error) |
| `QUERY_MEM_CAPACITY` | load + run | unlimited (0 or negative) | bytes per query; over it returns `Query's mem consumption exceeded capacity` |
| `VKEY_MAX_ENTITY_COUNT` | load + run | 100,000 | entities per virtual key for replication |
| `EFFECTS_THRESHOLD` | load + run | 0 μs since v4.20.2 (300 μs before) | replicate as effects or as the query text |
| `CMD_INFO` | load + run | yes | enables GRAPH.INFO |
| `MAX_INFO_QUERIES` | load + run | 1000 | telemetry history depth, 0–1000 |
| `DELTA_MAX_PENDING_CHANGES` | load + run | 10,000 | pending changes in the delta matrices before a flush; 0 resets to the default |
| `DELAY_INDEXING` | load + run | no | build indexes after RDB decode |
| `JS_HEAP_SIZE` / `JS_STACK_SIZE` | load + run | 256 MB / 1 MB (min 1 MB each) | QuickJS UDF runtime |

Per query: `GRAPH.QUERY g "..." TIMEOUT 500`, which applies to QUERY, RO_QUERY and PROFILE.

---

## 3. Cypher clauses (exact syntax)
Index: https://docs.falkordb.com/cypher · cheat sheet: https://docs.falkordb.com/cypher/cheat-sheet · coverage: https://docs.falkordb.com/cypher/cypher-support

FalkorDB implements a subset of openCypher v9 plus extensions. Comments `// ...` and `/* ... */` are allowed anywhere whitespace is.

- **MATCH** (https://docs.falkordb.com/cypher/match): `(a:L {p:v})-[r:T {p:v}]->(b)`. Also `<-`, `-` (undirected; `<-[:T]->` means the same), `--`, and `(n:A:B)` (requires all labels). **Relationship type alternation `[:A|B]` works**; node label alternation `(n:A|B)` does not. Variable length: `-[:T*min..max]->`, `*`, `*2`, `*..3`, `*1..3`; defaults are 1..∞. Named paths: `p = (...)` with `nodes(p)`, `relationships(p)`, `length(p)`. Undirected matches return each pair twice.
- **OPTIONAL MATCH** (https://docs.falkordb.com/cypher/optional-match): unmatched elements become null. **A mandatory MATCH cannot follow an OPTIONAL MATCH.** SET, MERGE and DELETE ignore null inputs, but `CREATE (c)-[:R]->()` with a null `c` errors and commits nothing.
- **WHERE** (https://docs.falkordb.com/cypher/where): `= <> < <= > >= STARTS WITH ENDS WITH CONTAINS IN IS NULL IS NOT NULL AND OR NOT XOR`. Pattern predicates: `WHERE (a)-[:T]->(b)` and `WHERE NOT (a)-[:T]->(b)`. Label predicates: `WHERE n:A OR n:B` (slower than a label in the pattern). **There is no `=~` regex.**
- **RETURN** (https://docs.falkordb.com/cypher/return): `RETURN [DISTINCT] expr [AS alias], ...`. Grouping is implicit: every non-aggregated item is a grouping key. There is no GROUP BY.
- **ORDER BY** `expr [ASC|ASCENDING|DESC|DESCENDING], ...` (https://docs.falkordb.com/cypher/order-by) · **SKIP n** (https://docs.falkordb.com/cypher/skip) · **LIMIT n** (https://docs.falkordb.com/cypher/limit). There is no default limit, but `RESULTSET_SIZE` caps output. Without ORDER BY, row order is non-deterministic.
- **WITH** (https://docs.falkordb.com/cypher/with): a pipeline step. It accepts DISTINCT, ORDER BY, SKIP and LIMIT, and aggregation in it groups the same way RETURN does. Variables not listed are dropped. **A WHERE after a WITH sees the post-write state** of earlier clauses.
- **UNWIND** `list AS x` (https://docs.falkordb.com/cypher/unwind): an empty list yields zero rows and kills the row.
- **UNION / UNION ALL** (https://docs.falkordb.com/cypher/union): column names and count must match. UNION dedups. To ORDER BY each branch, wrap the union in `CALL {}`.
- **CREATE** (https://docs.falkordb.com/cypher/create): `CREATE (n:L {..}), (m)`, or `MATCH ... CREATE (a)-[:T]->(:New)`. Every unbound element in the pattern is created.
- **MERGE** (https://docs.falkordb.com/cypher/merge): `MERGE pattern [ON CREATE SET ...] [ON MATCH SET ...]`. It matches or creates the **whole** pattern, so a path MERGE with a missing edge duplicates its endpoints. **Merge one entity per clause:** `MERGE (a:X {id:$a}) MERGE (b:Y {id:$b}) MERGE (a)-[:R]->(b)`. Variables bound earlier are only ever matched. Use `MATCH ... MATCH ... MERGE (a)-[:R]->(b)` to create the edge only when both endpoints exist.
- **SET** (https://docs.falkordb.com/cypher/set): `SET n.p = v, n.q = w`. `SET n = {map}` replaces all properties. `SET n += {map}` merges. `SET a = b` copies all properties. `SET n.p = NULL` removes the property.
- **REMOVE** (https://docs.falkordb.com/cypher/remove): `REMOVE n.p`, `REMOVE n:L`, `REMOVE n:A:B`.
- **DELETE** (https://docs.falkordb.com/cypher/delete): `DELETE n` always behaves as DETACH. `DETACH DELETE` is accepted too. `DELETE r` removes only the edge.
- **FOREACH** (https://docs.falkordb.com/cypher/foreach): `FOREACH (x IN list | <CREATE|MERGE|SET|REMOVE|DELETE|FOREACH>...)`. It cannot contain MATCH or RETURN, its variables are local, and the row count is unchanged. Conditional write idiom: `FOREACH (_ IN CASE WHEN cond THEN [1] ELSE [] END | SET ...)`.
- **CALL {} subquery** (https://docs.falkordb.com/cypher/call): runs once per input row. Import outer variables only through an opening `WITH a, b` or `WITH *`. Returned variables cannot shadow outer ones. A subquery without RETURN keeps the row count (side effects only); one with RETURN can change it. Uses: post-UNION processing, per-row aggregation.
- **CALL procedure** (https://docs.falkordb.com/cypher/procedures): `CALL proc(args) [YIELD col [AS x], ...]`. Without YIELD, all columns come back.
- **LOAD CSV** (https://docs.falkordb.com/cypher/load-csv): `LOAD CSV [WITH HEADERS] FROM 'file://x.csv'|'https://...' AS row [FIELDTERMINATOR ';']`. A row is a list, or a map under WITH HEADERS. Every value is a string. `file://` resolves under `IMPORT_FOLDER`. Remote files must use HTTPS. `CREATE (a:L) SET a = row` handles missing columns.
- **Parameters:** `$name`. In redis-cli, prefix `CYPHER name="x" n=3`.
- **Expressions:** list comprehension `[x IN list WHERE cond | expr]`; pattern comprehension `[(n)-[e:T]->(f) WHERE e.p < 1 | f.x]`; `CASE x WHEN v THEN r ... ELSE d END`; `CASE WHEN pred THEN r ... END`; `reduce(acc = 0, x IN list | acc + x)`; map projection `n {.a, .b, k: expr}`; map merge `{a:1} + {a:2, c:3}`; map access `m.k` or `m['k'+1]`. Math operators: `+ - * / ^ %`.

---

## 4. Functions (complete list from the functions page)
Source: https://docs.falkordb.com/cypher/functions (`*` marks a FalkorDB extension)

- **Predicate:** `all/any/none/single(x IN list WHERE p)`, `exists(n.prop)` (pattern arguments such as `exists((n)-->())` are **not** supported; use a pattern predicate), `isEmpty(list|map|string)`.
- **Scalar:** `coalesce`, `startNode`, `endNode`, `hasLabels(node, [labels])*`, `id()` (**not stable**; IDs get reused after deletes), `labels`, `properties`, `randomUUID()`, `timestamp()` (**epoch ms**), `type`, `typeOf(expr)*` (returns Map|String|Integer|Boolean|Float|Node|Edge|List|Path|Point|Null), `prev(expr)*` (the previous value inside a var-length traversal; null on the first call).
- **Aggregating:** `avg, collect (skips nulls), count(expr|*), max, min, percentileCont(e,p), percentileDisc(e,p), stDev, stDevP, sum` (sum of nothing is 0).
- **List:** `head, last, tail, keys, size, range(a,b[,step]), reduce`, plus `list.dedup*`, `list.insert(l,idx,v[,dups])*`, `list.insertListElements(l,l2,idx[,dups])*`, `list.remove(l,idx[,count])*`, `list.sort(l[,asc])*`.
- **Math:** `abs, ceil**, floor**, round** (half away from zero), e(), exp, log, log10, pow*, rand, sign, sqrt` (`**`: an integer input returns an integer).
- **Trig:** `acos asin atan atan2 cos cot degrees haversin pi radians sin tan`.
- **String:** `left, right, lTrim, rTrim, trim, replace, reverse, split, substring(s,start[,len])` (0-based), `toLower, toUpper, size`, `string.join(list[,delim])*`, `string.matchRegEx(s,re)*`, `string.replaceRegEx(s,re,rep)*`, `toJSON(expr)*`, `intern(str)` (stores one shared copy of a repeated string).
- **Point:** `point({latitude, longitude})` (case-sensitive keys), `distance(p1,p2)` in metres.
- **Type conversion:** `toBoolean, toBooleanOrNull, toBooleanList, toFloat, toFloatOrNull, toFloatList, toInteger*` (**floors** floats), `toIntegerOrNull, toIntegerList, toString, toStringOrNull, toStringList`.
- **Node:** `indegree(n [, 'T' ...|[types]])*`, `outdegree(...)*`.
- **Path:** `nodes, relationships, length, shortestPath((a)-[*]->(b))*` (endpoints must be bound, no property filters in the pattern, min hops 0 or 1, returns NULL if no path), `allShortestPaths(...)*` (use inside MATCH: `MATCH p=allShortestPaths((a)-[*]->(g))`).
- **Vector:** `vecf32(array)`, `vec.euclideanDistance(v1,v2)`, `vec.cosineDistance(v1,v2)`. `vecf64()` appears only in a FAQ (UNVERIFIED).
- **toJSON** shapes: a node is `{"type":"node","id","labels","properties"}`; a relationship is `{"type":"relationship","id","relationship","properties","start","end"}`.
- The coverage page says "user-defined functions unsupported"; its FAQ says Flex UDFs are supported (JS/QuickJS, see JS_HEAP_SIZE). Named temporal arithmetic functions are unsupported, but `+` and `-` work on temporals.

---

## 5. Procedures
Source: https://docs.falkordb.com/cypher/procedures

| Procedure | Args | Yields |
|---|---|---|
| `db.labels()` | – | label |
| `db.relationshipTypes()` | – | relationshipType |
| `db.propertyKeys()` | – | propertyKey |
| `db.meta.stats()` | – | labels, relTypes, relCount, nodeCount, labelCount, relTypeCount, propertyKeyCount |
| `db.indexes()` | – | label, properties, types, options, language, stopwords, entitytype, status, info |
| `db.constraints()` | – | type, label, properties, entitytype, status |
| `db.idx.fulltext.createNodeIndex(label\|{label,language,stopwords}, prop\|{field,weight,nostem,phonetic}...)` | | – |
| `db.idx.fulltext.drop(label)` | | – (drops **all** fulltext props on the label) |
| `db.idx.fulltext.queryNodes(label, q)` | | node, score (TF-IDF) |
| `db.idx.fulltext.queryRelationships(type, q)` | | relationship, score |
| `db.idx.vector.queryNodes(label, attr, k, vec)` | | node, score |
| `db.idx.vector.queryRelationships(type, attr, k, vec)` | | relationship, score |
| `db.idx.cch.query({sourceNode, targetNode, relTypes, weightProp})` | | pathWeight, path |
| `algo.pageRank(label, relType)` | | node, score |
| `algo.BFS(source, maxLevel(0=∞), relType)` | | nodes, edges |
| `algo.WCC(config)` | | node, componentId |
| `algo.labelPropagation(config)` | | node, communityId |
| `algo.betweenness(config)` | | node, score |
| `algo.MSF(config)` | | edges, nodes |
| `algo.SPpaths({sourceNode,targetNode,relTypes,weightProp,pathCount})` | | path, pathWeight, pathCost |
| `algo.SSpaths(config)` | | path, pathWeight, pathCost |
| `dbms.procedures()` | – | name, mode |

The config keys for WCC, labelPropagation, betweenness and MSF are on the Algorithms pages, which are not in this URL set. They are not covered here.

---

## 6. Indexes
Overview: https://docs.falkordb.com/cypher/indexing. Four types: RANGE, FULLTEXT, VECTOR, CCH. List them with `CALL db.indexes()`.

### Range
https://docs.falkordb.com/cypher/indexing/range-index
```
CREATE INDEX FOR (p:Person) ON (p.age)            -- old form: CREATE INDEX ON :Person(age)
CREATE INDEX FOR ()-[f:FOLLOW]-() ON (f.created_at)
CREATE INDEX FOR (p:Person) ON (p.first_name, p.last_name)   -- multi-prop form, used for UNIQUE constraints
DROP INDEX ON :Person(age) · DROP INDEX ON :FOLLOW(created_at)
```
- Indexes strings, numerics, points, and arrays of scalars (`WHERE 90 IN p.samples`). Not nested arrays, maps or vectors.
- Used automatically for `=`, ranges, `IN`, prefix, and geo `distance(...) < r` (only `<` and `<=`). **`<>` is never indexed.**
- The relationship index plans as `Edge By Index Scan`. The docs say it helps with super nodes and with starting a traversal from edges.
- Contradiction: the FAQ says "each index covers a single property", but the constraint page builds a two-property index. Trust the constraint page.

### Full-text (RediSearch)
https://docs.falkordb.com/cypher/indexing/fulltext-index
```
CREATE FULLTEXT INDEX FOR (n:Movie) ON (n.title) [OPTIONS {language:'German', stopwords:['a','ab']}]
CREATE FULLTEXT INDEX FOR ()-[m:Manager]-() ON (m.name)
DROP FULLTEXT INDEX FOR (n:Movie) ON (n.title)       -- drops one prop (procedure drop drops all)
CALL db.idx.fulltext.queryNodes('Movie', 'Jun*|%Forst%1 -Jungle') YIELD node, score
```
Query syntax: a space is AND, `|` is OR, `-` is NOT, `term*` is a prefix (end of word only), and `%term%d` is fuzzy with Levenshtein distance 1–3 (default 1). Field options: weight, nostem, phonetic (`'dm:en'`). Language drives stemming. The results can be chained into WHERE and ORDER BY.

### Vector (HNSW)
https://docs.falkordb.com/cypher/indexing/vector-index
```
CREATE VECTOR INDEX FOR (t:Ticket) ON (t.embedding)
  OPTIONS {dimension:768, similarityFunction:'cosine', M:16, efConstruction:200, efRuntime:10}
CREATE VECTOR INDEX FOR ()-[e:Call]->() ON (e.summary) OPTIONS {dimension:128, similarityFunction:'euclidean'}
DROP VECTOR INDEX FOR (t:Ticket) ON (t.embedding)
CREATE (:Ticket {embedding: vecf32([0.1, ...])})
CALL db.idx.vector.queryNodes('Ticket','embedding', 10, vecf32($q)) YIELD node, score
```
- dimension 1–4096 (required). similarityFunction `cosine|euclidean` (required). M defaults to 16, efConstruction to 200, efRuntime to 10.
- Memory is roughly `vectors × dim × 4 B + ~20%` (1M × 768 ≈ 3 GB). Results are approximate.
- **A vector query cannot be combined with property filters.** Over-fetch k, then filter with WHERE after YIELD.
- Every vector must match the index dimension.
- Score direction is inconsistent in the docs. The cheat sheet says cosine means higher is more similar (sort DESC), but the function is named `cosineDistance`, and euclidean means lower is closer. **Verify the order empirically before any benchmark uses it.**

### CCH (contraction hierarchies, weighted shortest path)
https://docs.falkordb.com/cypher/indexing/cch-index
```
CREATE CCH INDEX FOR ()-[e:ROAD|FERRY]->() ON (e.w)
DROP   CCH INDEX FOR ()-[e:ROAD]->() ON (e.w)
MATCH (a {id:0}),(b {id:42}) CALL db.idx.cch.query({sourceNode:a, targetNode:b, relTypes:['ROAD'], weightProp:'w'}) YIELD pathWeight, path
```
- Relationships only, one weight property. A missing weight counts as 1. Parallel edges collapse to the cheapest one, and self-loops are ignored. Direction is respected.
- It is the only index type that can span several relationship types. `relTypes` must match the index key exactly.
- An unreachable target returns 0 rows. Source equal to target returns weight 0.
- It is read-only to query, so it works over RO_QUERY. It maintains itself; adding or removing a node triggers a full rebuild. It persists to RDB.
- Mochi has no weighted routing problem, so we skip it.

---

## 7. Data types
Source: https://docs.falkordb.com/datatypes · https://docs.falkordb.com/cypher/cypher-support

- Structural types (Node, Relationship, Path) **can never be stored as properties**. A relationship has exactly one type and is always directed.
- Storable: String (Unicode), Boolean, Integer (int64), Float (double), Point (two float32), temporal values (`date('YYYY-MM-DD')`, `localtime('HH:MM:SS')`, `localdatetime('YYYY-MM-DDTHH:MM:SS')`, `duration('P3DT12H')`; components `.year`, `.month`, `.day`, `.hour`, `.minute`, `.second`, `.years`, `.hours`; arithmetic `date + duration`), arrays (**with no null or graph-entity elements**), and vectors (vecf32).
- **Maps cannot be stored as properties. Null cannot be stored either:** setting a property to null removes it.
- `1 = true` is **false**, because comparison is typed. `null = null` and `null IN [..]` both evaluate to null.
- A map projection on a null entity is null, and `collect()` skips it, so OPTIONAL MATCH plus a projection gives `[]`.
- Hex and octal literals are unsupported. NaN, ±inf and -0.0 may not follow the standard. Nodes are not orderable.

---

## 8. Known limitations and gotchas
Source: https://docs.falkordb.com/cypher/known-limitations (plus the cheat sheet's "Gotchas")

1. **Relationship uniqueness:** if a relationship alias is not referenced anywhere else in the query, FalkorDB only checks that **at least one** such edge exists. With two parallel edges, `MATCH (a)-[e]->(b) RETURN count(b)` returns 1. Fix it by referencing the alias: `WHERE ID(e) >= 0`, `count(e)`, or a property filter on `e`. **This matters for us:** temporal multigraph edges (several SOLVED or FACT edges between the same pair) undercount unless the edge is referenced.
2. **LIMIT does not bound eager operations** (CREATE, SET, DELETE, MERGE, aggregations). `UNWIND [1,2,3] AS v CREATE (...) RETURN ... LIMIT 1` creates all 3.
3. **Indexes ignore `<>`.**
4. **No aggregation inside pattern comprehensions.** Aggregate in a WITH first, or use `size([...])`.
5. No regex operator; use `string.matchRegEx`. No label alternation `(n:A|B)`. No `exists(pattern)`.
6. A mandatory MATCH cannot follow an OPTIONAL MATCH.
7. `id()` values get reused after deletes, so never use them as external keys.
8. `RESULTSET_SIZE` defaults to 10k and truncates silently.
9. No query that returns the schema. Use `db.labels()` and friends, or `db.meta.stats()`.
10. Telemetry keys appear in GRAPH.LIST.
11. `GRAPH.PROFILE` performs the query's writes.

---

## 9. Design: concurrency, storage, GraphBLAS
### Concurrency and atomicity
Source: https://docs.falkordb.com/design/concurrency

- **Per-graph reader-writer model.** Many readers run in parallel, bounded by the `THREAD_COUNT` pool. **Writers to the same graph are serialized FIFO.** Readers see a snapshot of the graph as of the moment their query started, and never a partial write. The page describes this as similar to snapshot isolation.
- **Every write query is atomic,** including multi-clause queries (WITH, UNION) and schema changes such as new labels. A constraint violation or timeout rolls everything back.
- Within one query, clauses apply in order. A WHERE after a WITH sees earlier deletes and creates (the "orphan delete" pattern: `MATCH (:A)-[r:R]->(b:B) DELETE r WITH b WHERE NOT (b)<-[]-() DELETE b`).
- There are no multi-query transactions. `MULTI`/`EXEC` groups commands but **blocks all graphs** for its duration.
- Write-heavy load bottlenecks on serialization, so batch changes into fewer queries (`UNWIND $batch`).
- Writes to *different* graphs are not serialized against each other, because the serialization is per graph. That follows from the per-graph model and is not stated outright.

### Storage model and GraphBLAS
Source: https://docs.falkordb.com/design · https://docs.falkordb.com/design/third-party · https://docs.falkordb.com/references

- The graph is held as **sparse adjacency matrices**. THE adjacency matrix (any type) has `M[src,dst]=1`. Each relationship type has its own matrix, whose entry holds the edge id. Each label has a diagonal matrix (`P[n,n]=1`). Rows are sources and columns are destinations.
- **A traversal is a matrix multiplication.** Friends of friends is `F²`. A pattern `(N0)-[A]->(N1)-[B]->(N2)<-[A]-(N3)` becomes `A * B * Transpose(A)`. Associativity lets the planner choose the sparsest order and compute sub-expressions in parallel (`OMP_THREAD_COUNT`).
- The **GraphBLAS** (SuiteSparse, Apache-2.0) uses the CSC format today. RediSearch backs full-text. Parsing uses Lex and Lemon (the third-party page also lists libcypher-parser).
- Execution path: AST → algebraic expressions → filter trees → plan (Filtered and Conditional Traverse, Filter, Project) → result set.
- Claims: edge insert is O(1); about 1M nodes in under 0.5 s and 500K edges in 0.3 s. Data lives in RAM with RDB/AOF persistence. Node creation pre-allocates matrix room (`NODE_CREATION_BUFFER`). Pending changes buffer in delta matrices (`DELTA_MAX_PENDING_CHANGES`).
- Background paper: "RedisGraph GraphBLAS Enabled Graph Database", IPDPS 2019 GrAPL.
- **For the blog:** "a 3-hop briefing is three sparse matrix products" is a true, explainable sentence. That makes it a good want→mechanism line.

---

---

# Part B — Algorithms, UDFs, GenAI, integrations

_Its raw ideas list was folded into Part 0._

Read from the 109 URLs in `b.txt` (all fetched 2026-10-18), plus `https://docs.falkordb.com/udfs`, which documents how UDFs load.
Fit verdicts are against our stack: TypeScript, hand-written Cypher, a multigraph (`mochi_company` / `team_*` / `user_*` / `cust_*`) and temporal edges (`valid_from` / `valid_until`).

## B0. Cross-cutting facts that constrain Mochi

- **No algorithm filters on edge properties.** Every `algo.*` procedure filters only on node label and relationship type. An edge with `valid_until` in the past is still traversed. A temporal "current graph" therefore has to be one of two things:
  - (a) a relationship type of its own, kept up to date by the dream (for example `SOLVED` for live edges, while retired facts keep `valid_until` and are also copied to `SOLVED_HIST`). This is a materialized view. The append-only log stays the edge properties.
  - (b) a scratch projection graph (for example `algo_scratch`) that the app rebuilds before each algorithm run. Cypher cannot read across graphs, so the copy goes through TS: read the rows, then `UNWIND` them into the scratch graph.
- `algo.pageRank` takes **one label string and one relType string**, not arrays, and has no weights. Every other config-map algorithm takes arrays.
- Non-deterministic: `algo.betweenness` (sampling; pass `samplingSeed`) and `algo.labelPropagation` (random node order; community IDs are not stable between runs). `algo.HarmonicCentrality` is an approximation (HLL).
- `algo.HarmonicCentrality` raises an error if any named label or type is missing from the graph. A fresh `user_*` or `cust_*` graph will not yet have every label, so guard the call.
- UDF libraries are **server-wide**: `GRAPH.UDF LIST` lists them for the whole database, and inside a UDF `graph` is bound to the graph running the query. Load once and every tier graph can call them.
- Read paths should use `GRAPH.RO_QUERY`. The MCP server's `readOnly` flag uses it, and it is the safe default for concurrent reads.

## B1. Algorithms (`CALL algo.*`)

### B1.1 PageRank
Source: https://docs.falkordb.com/algorithms/pagerank
```
CALL algo.pageRank(label, relationshipType) YIELD node, score
```
- `label`: String, null means all nodes. `relationshipType`: String, null means all types. Both are positional, not a map.
- Directed. A node scores high when it has many incoming edges from high-scoring nodes. Scores sum to 1.0 and are relative.
- Example: `CALL algo.pageRank('Paper','CITES') YIELD node, score RETURN node.title, score ORDER BY score DESC`.
- Fit: yes. There is no weighting, and direction decides who gets ranked (see Ideas).

### B1.2 Betweenness centrality
Source: https://docs.falkordb.com/algorithms/betweenness-centrality
```
CALL algo.betweenness({nodeLabels:[..], relationshipTypes:[..], samplingSize:<int>, samplingSeed:<int>}) YIELD node, score
```
- Defaults: `nodeLabels` [] (all), `relationshipTypes` [] (all), `samplingSize` 32 (randomly sampled source nodes; if larger than the eligible set, all are used), `samplingSeed` 0 (time-based, so results vary between runs).
- Example: Bob = 6, the bridge in a FRIEND chain. Can be costly on dense graphs.
- Fit: yes. Always pass `samplingSeed: 42` so receipts and benchmark numbers are reproducible.

### B1.3 BFS
Source: https://docs.falkordb.com/algorithms/bfs
```
CALL algo.bfs(start_node, max_depth, relationship) YIELD nodes, edges
```
- `start_node` Node (required; null raises an error). `max_depth` Integer (required). `relationship` String or null (a single type; null means all).
- Yields `nodes` (in BFS order) and `edges`. A relationship type that does not exist returns only the start node. Visited nodes are held in memory.
- Fit: yes, as a cheap blast-radius traversal. It takes one relType only, and you cannot set direction.

### B1.4 CDLP / label propagation
Source: https://docs.falkordb.com/algorithms/cdlp
```
CALL algo.labelPropagation([{nodeLabels:[..], relationshipTypes:[..], maxIterations:<int>}]) YIELD node, communityId
```
- Default `maxIterations` 10. O(m+n) per iteration. Nodes are processed in random order, so results "may vary slightly". Isolated nodes get their own community.
- Grouping idiom: `... RETURN communityId, collect(node.name) AS members, count(*) AS size ORDER BY size DESC`.
- Fit: yes. This is the "emerging clusters" algorithm. `communityId` is not stable between runs, so key a cluster by something stable, such as the smallest ticket id in it or a hash of its sorted members.

### B1.5 WCC
Source: https://docs.falkordb.com/algorithms/wcc
```
CALL algo.wcc([{nodeLabels:[..], relationshipTypes:[..]}]) YIELD node, componentId
CALL algo.WCC(null) YIELD node, componentId      -- the docs use both spellings
```
- Ignores direction. O(V+E). Count components with `RETURN count(DISTINCT componentId)`.
- Fit: yes. It is cheap and deterministic in practice.

### B1.6 Harmonic centrality
Source: https://docs.falkordb.com/algorithms/harmonic-centrality
```
CALL algo.HarmonicCentrality([{nodeLabels:[..], relationshipTypes:[..]}]) YIELD node, score, reachable
```
- H(u) = Σ 1/d(u,v), with unreachable nodes contributing 0. Directed, so a node with only incoming edges scores 0. Computed approximately with HLL and GraphBLAS.
- `reachable` (an HLL estimate) is filled only when you yield it. Config may be NULL or omitted. A missing label or type raises an error.
- Fit: maybe. It could score "hub" customers or components. It is approximate, so label any receipt that uses it as an estimate.

### B1.7 SPpaths (single pair)
Source: https://docs.falkordb.com/algorithms/sppath
```
CALL algo.SPpaths({sourceNode, targetNode, relTypes:[..], weightProp, costProp, maxCost, maxLen,
                   relDirection:'outgoing'|'incoming'|'both', pathCount}) YIELD path, pathWeight, pathCost
```
- `pathCount`: 0 means all shortest paths, 1 is the default, n means up to n. `weightProp` is minimized. `costProp` + `maxCost` is a constraint. `maxLen` caps hops. No path gives an empty result, not an error.
- Fit: yes, for "how is customer X connected to incident Y", which gives the path shown on a receipt.

### B1.8 SSpaths (single source)
Source: https://docs.falkordb.com/algorithms/sspath
```
CALL algo.SSpaths({sourceNode, relTypes:[..], weightProp?, costProp?, maxCost?, maxLen?, relDirection, pathCount})
  YIELD path, pathWeight, pathCost
```
- Without `weightProp`, it finds the fewest hops. Example: `costProp:'dist', maxCost:10, pathCount:1000`.
- Fit: yes. This is the best fit for the blast radius: from a Component, `relDirection:'incoming'`, `maxLen:3`, over the dependency types.

### B1.9 A*
Source: https://docs.falkordb.com/algorithms/astar
```
CALL algo.AStar({sourceNode, targetNode, relTypes:[..], weightProp, latitudeProperty, longitudeProperty,
                 heuristicScale (1.0), relDirection ('outgoing'), pathCount (1)}) YIELD path, pathWeight
```
- Requires lat/lon on every node visited. The heuristic is haversine meters; `heuristicScale` must convert it so it never overestimates.
- Fit: no. We have no spatial data.

### B1.10 Max flow
Source: https://docs.falkordb.com/algorithms/maxflow
```
CALL algo.maxFlow({sourceNodes:[..], targetNodes:[..], relationshipTypes:[..], capacityProperty:'capacity', nodeLabels:[..]})
  YIELD nodes, edges, edgeFlows, maxFlow
```
- The config map is **required**. Uses capacity scaling with a virtual super-source and super-sink, O(V·E²). Returns only the entities that carry positive flow. Zip edges with flows: `UNWIND range(0,size(edges)-1) AS i`.
- Fit: no real use. A stretch would be routing capacity across teams.

### B1.11 Minimum spanning forest
Source: https://docs.falkordb.com/algorithms/msf
```
CALL algo.MSF({nodeLabels:[..], relationshipTypes:[..], objective:'minimize'|'maximize', weightAttribute}) YIELD edges, nodes
```
- Yields one row per tree. Direction is ignored. An edge missing the weight is used only if nothing else connects its component.
- Fit: no.

## B2. UDF system (JavaScript)

### B2.1 Loading and API
Source: https://docs.falkordb.com/udfs
- Commands:
  - `GRAPH.UDF LOAD [REPLACE] <Lib> <script>`
  - `GRAPH.UDF LIST [Lib] [WITHCODE]`
  - `GRAPH.UDF DELETE <Lib>`
  - `GRAPH.UDF FLUSH`
  - The Python client wraps these as `db.udf_load(lib, script)`, `udf_list`, `udf_delete` and `udf_flush`. The docs show no TS wrapper, so from Node send the raw command on the client's Redis connection. (Unverified: check the `falkordb` npm client for a helper.)
- Inside a script, expose a function with `falkor.register('Name', fn)`. Functions that are not registered are private helpers. Call a registered function as `<Lib>.<Name>(...)`, for example `RETURN StringUtils.UpperCaseOdd('abcdef')`.
- `falkor.log(msg)` writes to the server's stdout.
- Datatypes available inside a UDF:
  - Node: `id`, `labels`, `attributes`, and `getNeighbors({direction:'incoming'|'outgoing'|'both', types:[..], labels:[..], returnType:'nodes'|'edges'})`.
  - Edge: `id`, `type`, `source`, `target`, `attributes`.
  - Path: `nodes`, `length`, `relationships`.
- Global `graph` object: `graph.traverse(sources, config)` (multi-source; `targets[i]` holds the neighbours of source i), `graph.getNodeById(id)`, `graph.iterateNodes(label)` and `graph.iterateEdges(relType)` (both are iterators).
- **Breaking change in v4.16:** `falkor.traverse()` was removed. Use `graph.traverse()`.
- Throwing `new Error(..)` fails the query.
- Fit: yes. One small `mochi` library is the only way to get a **temporal-aware traversal** inside the database, because `getNeighbors` returns edges whose `attributes.valid_until` can be checked.

### B2.2 FLEX library (`flex.*`)
Source: https://docs.falkordb.com/udfs/flex (plus each function page)
- FLEX is open source at github.com/FalkorDB/flex. **It must be loaded as a UDF library** ("Do I need to install FLEX separately? Yes."). Check `GRAPH.UDF LIST` on our image; if it is missing, load it at boot.
- Everything is JS: integers are 32-bit, comparisons are case-sensitive (wrap inputs in `toLower()`), and null input returns null.

| Namespace | Function signatures (exact) | Notes |
|---|---|---|
| `flex.sim` | `jaccard(list1, list2)` | Float in 0..1. Treats lists as sets. Returns null for non-arrays. |
| `flex.text` | `levenshtein(s1,s2)` (int edit distance; null treated as ''); `jaroWinkler(s1,s2)` (0..1, favours shared prefixes) | For fuzzy names and dedupe. |
| `flex.text` | `capitalize(s)`, `decapitalize(s)`, `swapCase(s)`, `camelCase(s)`, `upperCamelCase(s)`, `snakeCase(s)` | Case conversion. |
| `flex.text` | `format(template, [params])` (`{0}`,`{1}`), `join(list, delim)`, `lpad(s, len, ch=' ')`, `rpad(s, len, ch=' ')`, `repeat(s, n)` | Formatting. |
| `flex.text` | `indexOf(s, sub, offset=0, to=-1)` (-1 if not found), `indexesOf(s, sub, from=0, to=-1)`, `replace(s, regex, repl)` (global regex), `regexGroups(s, regex)` (returns `[[full, g1, ..], ..]`) | Search and regex. |
| `flex.coll` | `union(l1,l2)` (order not guaranteed), `intersection(l1,l2)` (keeps l1 order), `shuffle(l)`, `zip(l1,l2)` (pairs, shorter length), `frequencies(l)` (returns `{elem: count}`, keys stringified) | Note the namespace is `coll`, not `collections`. |
| `flex.map` | `merge(m1,m2,...)` (shallow; later wins), `fromPairs([[k,v],..])`, `submap(m, keys)`, `removeKey(m, k)`, `removeKeys(m, keys)` | |
| `flex.json` | `toJson(v)`, `fromJsonMap(str)` (`{}` on error), `fromJsonList(str)` (`[]` on error) | Never throws. |
| `flex.date` | `format(dt, pattern='YYYY-MM-DDTHH:mm:ss[Z]', tz)`; `parse(str, pattern, tz)` (patterns `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`, `YYYY-MM-DD HH:mm:ss`); `truncate(dt, unit)` (minute, hour, day, week = ISO Monday, month, quarter, year); `toTimeZone(dt, '+05:30')` (no DST handling) | Tokens: `YYYY MM DD HH mm ss SSS [Z]`. |
| `flex.bitwise` | `and(a,b)`, `or(a,b)`, `xor(a,b)`, `not(a)`, `shiftLeft(a,n)`, `shiftRight(a,n)` (arithmetic shift) | 32-bit signed. |

## B3. Agentic memory integrations

### B3.1 Graphiti (Zep)
Source: https://docs.falkordb.com/agentic-memory/graphiti
- Python: `pip install graphiti-core[falkordb]`, then `Graphiti(uri="falkor://localhost:6379", graph_name="user1_memory", username, password, llm_client=...)`. Run `await build_indices_and_constraints()` once.
- Write with `add_episode(name, episode_body, episode_type=EpisodeType.text, reference_time, source_description)`.
- Read with `search(query, num_results, reference_time=...)` (point-in-time), `retrieve_nodes`, `retrieve_episodes`.
- Pitched as "temporally-aware, multi-tenant", with one graph per tenant through `graph_name`.
- Fit: **no** at runtime (Python, and its own LLM extraction would hide our Cypher). It is the obvious prior art for temporal invalidation and graph-per-tenant, so cite it in the blog's "what we rejected" entries.

### B3.2 Graphiti MCP server
Source: https://docs.falkordb.com/agentic-memory/graphiti-mcp-server
- Docker:
  - Combined image: get the compose file with `curl -O https://raw.githubusercontent.com/getzep/graphiti/main/mcp_server/docker/docker-compose.yml`. The MCP endpoint is `http://localhost:8000/mcp/`, health is `/health`, Browser is :3000.
  - Standalone: `zepai/knowledge-graph-mcp:standalone`.
- Env: `OPENAI_API_KEY` (or ANTHROPIC, GOOGLE, GROQ, AZURE_*), `FALKORDB_URI=redis://..`, `FALKORDB_PASSWORD`, `FALKORDB_DATABASE=default_db`, `GRAPHITI_GROUP_ID`, `SEMAPHORE_LIMIT=10`.
- Tools: `add_episode`, `search_nodes`, `search_facts`, `delete_entity_edge`, `delete_episode`, `get_entity_edge`, `get_episodes`, `clear_graph`.
- Schema: `Entity{name,entity_type,summary}`, `Episode{name,content,timestamp,source}`, edges `RELATES_TO`, `MENTIONED_IN`, `OCCURRED_AFTER`. Graph name `graphiti_memory`.
- Built-in entity types: Preference, Requirement, Procedure, Location, Event, Organization, Document, Topic, Object.
- Fit: no. Its "Procedure" type is a useful hint for how to type doctrine nodes.

### B3.3 Mem0 (`mem0-falkordb`)
Source: https://docs.falkordb.com/agentic-memory/mem0
- Python:
  - `pip install mem0ai mem0-falkordb`, then call `from mem0_falkordb import register; register()` before `Memory.from_config({...})`.
  - Config: `{"graph_store":{"provider":"falkordb","config":{host,port,database:"mem0",username,password,base_label:True}}}`.
- **Each user gets their own graph, named `{database}_{user_id}`** (for example `mem0_alice`). Queries need no user_id filter, and `delete_all` drops the graph.
- API: `add`, `search`, `get_all`, `delete`, `delete_all`, `history`.
- Fit: no at runtime. **It validates our `user_*` and `cust_*` tier design.** FalkorDB's own docs give "native multi-graph = no WHERE on user_id" as the reason, so quote it in the README.

### B3.4 Cognee
Source: https://docs.falkordb.com/agentic-memory/cognee
- Python 3.11–3.13: `pip install "cognee>=1.2,<2.0" cognee-community-hybrid-adapter-falkor`.
- Import `register` before any `config.set_*`. The provider name is `"falkor"`, not "falkordb". FalkorDB serves as both the vector and the graph DB.
- Flow: `add()`, then `cognify()`, then `search(query_type=SearchType.GRAPH_COMPLETION|CHUNKS|RAG_COMPLETION|SUMMARIES|TEMPORAL|CYPHER|NATURAL_LANGUAGE|GRAPH_COMPLETION_COT|HYBRID_COMPLETION, ...)`.
- Env: `GRAPH_DATASET_DATABASE_HANDLER=falkor_graph_local`, `VECTOR_DATASET_DATABASE_HANDLER=falkor_vector_local`.
- Fit: no.

## B4. GraphRAG SDK (Python, v1.3.x)

Fit overall: **no at runtime.** It is Python only, and it writes its own schema: a single `RELATES` edge type plus Document/Chunk nodes. It would replace our hand-written Cypher, which is the part judges grade. Several of its mechanisms are worth copying into the dream; see Ideas.

### B4.1 Facade and API
Source: https://docs.falkordb.com/graphrag/api-reference , https://docs.falkordb.com/genai-tools/graphrag-sdk , https://docs.falkordb.com/graphrag/getting-started
- Install: `pip install "graphrag-sdk[litellm,pdf]"`.
- Constructor: `GraphRAG(connection=ConnectionConfig(host, port, username, password, graph_name="knowledge_graph", max_connections=16, retry_count=3, retry_delay=1.0, query_timeout_ms=10_000, pool_timeout=30), llm=LiteLLM(model=..), embedder=LiteLLMEmbedder(model=..), ontology=None, retrieval_strategy=None, embedding_dimension=256, enable_cypher=False)`.
- Methods:
  - `ingest(source | text=, document_id=, loader/chunker/extractor/resolver=, max_concurrency=3)`
  - `retrieve(question)` returns a `RetrieverResult` (items with content, metadata and score)
  - `completion(question, history=, return_context=)` returns a `RagResult`
  - `query(cypher, params)`
  - `finalize()`
  - `deduplicate_entities(fuzzy, similarity_threshold=0.95, judge=...)`
  - `update()`, `delete_document()`, `apply_changes()`, `drop_table()`
  - `_sync` variants of the above.
- `enable_cypher=True` turns on text-to-Cypher. It is validated read-only, has LIMIT added, costs one extra LLM call, and its results go to the context without reranking.

### B4.2 Architecture and graph layout
Source: https://docs.falkordb.com/graphrag/architecture , https://docs.falkordb.com/graphrag/graph-schema , https://docs.falkordb.com/graphrag/storage
- Ingestion takes 9 steps: Load, Chunk, Lexical graph, Extract, Prune (off-schema), Resolve, Write (batched `UNWIND .. MERGE`, 500 per batch), then Mentions and Index chunks in parallel.
- Nodes:
  - `Document{id,path,content_hash}`, linked to Chunks by `PART_OF`, and `Chunk{id,text,index,embedding vecf32}`, linked to each other by `NEXT_CHUNK`.
  - Entity nodes carry a domain label plus `__Entity__`, with `id = "name__type"` (deterministic), `description`, `source_chunk_ids` and `spans`.
- Edges:
  - `MENTIONED_IN` (Entity to Chunk).
  - **`RELATES` for every extracted relation**, with `rel_type`, `fact`, `description`, `keywords`, `weight` (1.0 explicit, 0.5 implied, 0.2 weak), `src_name`, `tgt_name`, `source_chunk_ids`, `spans` and `embedding`.
- Index DDL it uses (all valid FalkorDB):
  - `CREATE VECTOR INDEX FOR (n:Chunk) ON (n.embedding) OPTIONS {dimension:256, similarityFunction:'cosine'}`
  - `CREATE VECTOR INDEX FOR ()-[e:RELATES]->() ON (e.embedding) OPTIONS {...}`
  - `CALL db.idx.fulltext.createNodeIndex('__Entity__','name','description')`
  - Queries: `db.idx.vector.queryNodes`, `db.idx.vector.queryRelationships` (FalkorDB ≥ 4.2), `db.idx.fulltext.queryNodes`.
- Write pattern: `UNWIND $batch AS item MERGE (n:`Person` {id:item.id}) SET n += item.properties SET n:__Entity__`.

### B4.3 Extraction and ontology
Source: https://docs.falkordb.com/graphrag/extraction , https://docs.falkordb.com/graphrag/configuration , https://docs.falkordb.com/graphrag/ontology-discovery , https://docs.falkordb.com/graphrag/ontology-evolution
- Extraction runs in two steps:
  - Step 1 is local NER (GLiNER `urchade/gliner_medium-v2.1`, threshold 0.75; the band 25% below it is kept as "Unknown").
  - Step 2 has the LLM verify the entities and extract relations with evidence spans, returning JSON. If step 2 fails, step 1's entities are kept without relations.
- Name gates: 2–80 characters, plus a stoplist of about 50 pronouns and generic nouns ("narrator", "someone").
- Relation vocabulary:
  - `Ontology.relations` is **enforced**: the prompt says the type "MUST be one of" them, and off-schema edges are pruned.
  - `relation_types=` is only a preference.
  - The default vocabulary has 31 labels.
  - Measured: with an open vocabulary the model produced **447 distinct labels against 30 in the answer key**. A vocabulary cut that about 4x and doubled exact triple F1.
- Schema objects: `EntityType(label, description, properties=[PropertyType(name, type STRING|INTEGER|FLOAT|BOOLEAN|DATE|LIST, required)])` and `RelationType(label, description, patterns=[(src,tgt)])`.
- Discovery: `Ontology.from_sources(sources, llm, method="llm"|"grounded", boundaries=..)` and `rag.suggest_schema_extensions(sources, boundaries=..)`. You review the proposal, then apply it.
- Evolution: there are 15 methods. `add_attribute` is atomic: it backfills with the LLM first and commits the schema last, so there is never a window where the schema promises an attribute that is not there.

### B4.4 Dedup, incremental updates, grounding
Source: https://docs.falkordb.com/graphrag/api-reference , https://docs.falkordb.com/graphrag/incremental-updates , https://docs.falkordb.com/graphrag/reliability-and-grounding , https://docs.falkordb.com/graphrag/reducing-llm-hallucinations
- Dedup phases:
  1. Canonical-name match (folds case, accents, punctuation, `A.I.`=`AI`, "Surname, Given", legal suffixes, and acronym to long form).
  2. Embedding cosine at 0.95 or above (opt-in).
  3. A resolver: `LLMVerifiedResolution`, which asks about pairs from cosine 0.6. **A NO is stored as a `DISTINCT_FROM` edge so the same pair is never asked again.**
  4. An LLM judge over sets of at most 8, with a second shuffled vote. Pairs the two passes disagree on become `SAME_AS` edges instead of merges. The docs report 9 wrong merges with a gpt-4.1-class judge against 51 with gpt-4o-mini.
- Survivor rule: declared key, then real over placeholder, then long form, then degree, then description length. Edges are remapped, and the loser's name goes into `aliases`.
- `update()`: a SHA-256 `content_hash` that matches gives `no_op=True`. It follows a six-phase crash-safe state machine with one commit point (`mark_pending_committed`): a crash before it rolls back, a crash after it rolls forward. Orphan cleanup only touches entities this document referenced, never the whole graph.
- Abstention is **prompt-level only** (system prompt rule 6). The docs recommend enforcing it yourself with `retrieve()` plus a score gate. Fact filter: `filter_facts_by_relevance(min_score=0.25)`. Chunk retrieval applies no similarity floor.

### B4.5 Retrieval, strategies, benchmark
Source: https://docs.falkordb.com/graphrag/retrieval , https://docs.falkordb.com/graphrag/strategies , https://docs.falkordb.com/graphrag/benchmark , https://docs.falkordb.com/graphrag/graphrag-accuracy-benchmark , https://docs.falkordb.com/graphrag/structured-ingestion , https://docs.falkordb.com/graphrag/ingestion , https://docs.falkordb.com/graphrag/providers
- `MultiPathRetrieval(chunk_top_k=15, max_entities=30, max_relationships=20, rel_top_k=15, keyword_limit=10)`. The paths:
  - keywords (LLM)
  - RELATES-edge vector search
  - optional text-to-Cypher
  - entity discovery (CONTAINS + fulltext)
  - 1-hop expansion (top 15 entities, limit 150) and 2-hop (top 5, limit 25)
  - four chunk paths (fulltext, vector, MENTIONED_IN, 2-hop)
  - cosine rerank, then context assembly.
- Strategy ABCs: Loader, Chunking (`FixedSizeChunking(1000,100)`, `SentenceTokenCapChunking(max_tokens=384, overlap_sentences=2)`, `ContextualChunking`, `CallableChunking`, `StructuralChunking`), Extraction, Resolution, Retrieval (`LocalRetrieval`, `MultiPathRetrieval`) and Reranking (`CosineReranker`).
- Structured ingestion: `TableMapping(source, label, key, name, properties={..: Column(name, type)}, links=[Link(type, to, by)])`. It writes CSVs deterministically with no LLM. Properties are signed `<table>__<prop>`, and placeholder nodes carry `is_stub`.
- Benchmark (their claim, on GraphRAG-Bench, gpt-4o-mini): Novel 66.09, Medical 76.87, overall 71.48 against 55.39 for vector RAG with rerank. They declare their deviations from defaults (`enable_cypher=True`, which contributed to 22–29% of answers, and 1024-dimension embeddings). They name a duplicate question id in the dataset and say they skip samples where the judge errors.
- Fit: the benchmark write-up is a **template for our honesty clauses**: declared deviations, scored-sample counts, and "a ceiling, not a guarantee".

## B5. GenAI tools

### B5.1 FalkorDB MCP server
Source: https://docs.falkordb.com/genai-tools/mcpserver , https://docs.falkordb.com/genai-tools/mcpserver/quickstart , https://docs.falkordb.com/genai-tools/mcpserver/configuration , https://docs.falkordb.com/genai-tools/mcpserver/docker
- Node 18+, no code to write.
  - Client config: `{"mcpServers":{"falkordb":{"command":"npx","args":["-y","@falkordb/mcpserver@latest"],"env":{"FALKORDB_HOST":"localhost","FALKORDB_PORT":"6379","FALKORDB_USERNAME":"","FALKORDB_PASSWORD":""}}}}`.
  - Direct HTTP: `MCP_TRANSPORT=http MCP_PORT=3005 FALKORDB_HOST=localhost npx -y @falkordb/mcpserver`.
- Env: `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_USERNAME`, `FALKORDB_PASSWORD`, **`FALKORDB_DEFAULT_READONLY=true`**, `MCP_TRANSPORT=stdio|http`, `MCP_PORT=3000`, `MCP_API_KEY` (sent as `Authorization: Bearer`; uses Streamable HTTP), `ENABLE_FILE_LOGGING`.
- Docker: `falkordb/mcpserver:latest|edge|1.0.0`, exposes **:3000**. That clashes with the FalkorDB Browser's :3000, so remap one of them.
- Capabilities: query (OpenCypher; the `query_graph` tool takes `readOnly`, which runs `GRAPH.RO_QUERY`), create nodes and edges, list graphs, show graph structure, delete a graph. You can run several server entries, for example dev read-write and prod read-only.
- Fit: **yes.** It is Node, needs no code, and lets judges query the brain directly.

### B5.2 LangChain (Python and TS)
Source: https://docs.falkordb.com/genai-tools/langchain
- Python `langchain-falkordb`: `FalkorDBGraph`, `FalkorDBVector` (MMR, hybrid, metadata filter), `FalkorDBQAChain` (requires `allow_dangerous_requests=True`), `FalkorDBSaver`, `FalkorDBChatMessageHistory` (one graph per session_id).
- TS: `npm install @falkordb/langchain-ts falkordb langchain @langchain/openai`.
  - `await FalkorDBGraph.initialize({host, port, graph} | {url:"falkor[s]://user:pass@host:port", graph, enhancedSchema})`
  - `.query(cypher)`, `.refreshSchema()`, `.getSchema()`, `.getStructuredSchema()` (gives `nodeProps` and `relationships`), `.close()`
  - Use with `GraphCypherQAChain` from `@langchain/community/chains/graph_qa/cypher`.
- Fit: partial. It is TS, but NL-to-Cypher goes against "hand-written Cypher". At most it could back an optional "ask anything" box that shows its generated Cypher as the receipt, never in the five core queries.

### B5.3 LangGraph
Source: https://docs.falkordb.com/genai-tools/langgraph
- Python. Install `pip install langgraph "langchain-falkordb[langgraph]"`. Checkpointer: `FalkorDBSaver(host, port)`, used as `workflow.compile(checkpointer=memory)` with `thread_id`.
- Fit: no. Pi Durable and SQLite already own checkpoints, by design.

### B5.4 LlamaIndex
Source: https://docs.falkordb.com/genai-tools/llamaindex
- Python: `pip install llama-index llama-index-graph-stores-falkordb`, then `FalkorDBGraphStore(hostname, port, username, password, database)` and `KnowledgeGraphIndex.from_documents(..., max_triplets_per_chunk=10, include_embeddings=True)`.
- Fit: no.

### B5.5 AG2 (AutoGen)
Source: https://docs.falkordb.com/genai-tools/ag2
- Python: `pip install -U ag2[openai,graph-rag-falkor-db]`, then `FalkorGraphQueryEngine(name, host, port)`, `.init_db(input_doc=[Document(...)])`, and `FalkorGraphRagCapability.attach(agent, engine)`.
- Fit: no.

### B5.6 AWS GraphRAG Toolkit
Source: https://docs.falkordb.com/genai-tools/graphrag-toolkit
- Python contrib package. Register with `GraphStoreFactory.register(FalkorDBGraphStoreFactory)` and connect with `falkordb://...`. Supports semantic-guided search only, with **no traversal-based search**.
- Fit: no.

### B5.7 Code-Graph
Source: https://docs.falkordb.com/genai-tools/code-graph
- Indexes Python, Java or C# repos into FalkorDB. CLI: `pip install falkordb-code-graph`, then `cgraph index .`, `cgraph neighbors 42 --rel CALLS`, `cgraph paths 42 99`. It has a web UI and LiteLLM chat.
- Fit: no. It is reference UI only: a path-finding endpoint with JSON output.

### B5.8 Graphify
Source: https://docs.falkordb.com/genai-tools/graphify
- A coding-assistant skill: `pip install "graphifyy[falkordb]"; graphify install`, then `/graphify ./dir --falkordb-push falkordb://localhost:6379` (target graph `graphify`). It uses MERGE and never removes deleted entities. `--falkordb` writes `graphify-out/cypher.txt` instead.
- Fit: no. That is scope creep.

### B5.9 QueryWeaver
Source: https://docs.falkordb.com/genai-tools/queryweaver
- Text2SQL (Postgres, MySQL, Snowflake) that stores the schema graph in FalkorDB. Docker: `falkordb/queryweaver` on :5000. It has an MCP endpoint at `/mcp` with tools `list_databases`, `connect_database`, `database_schema`, `query_database`.
- Fit: no.

## B6. Integrations

| Integration | Source | What it is | Fit |
|---|---|---|---|
| Bolt | https://docs.falkordb.com/integration/bolt-support | **Experimental, not for production.** Start with `-e FALKORDB_ARGS="BOLT_PORT 7687"`, connect with neo4j drivers to `bolt://localhost:7687`, `database_="graph"`. | No. Use the native `falkordb` npm client. |
| Bulk loader | https://docs.falkordb.com/integration/bulk-loader | Python `falkordb-bulk-insert <Graph> -n Node.csv -r REL.csv` over `GRAPH.BULK`. Flags: `-u` server URL, `-N/-R` explicit label or type, `-d` enforce schema (`:ID(User),name:STRING,rank:INT`), `-j` id type, `-s/-e` skip invalid, `-i Label:Prop`, `-f` fulltext. | Maybe, for a fast seed of the synthetic set. TS `UNWIND` batches of 500 are probably enough. |
| REST (Browser API v1.4.6) | https://docs.falkordb.com/integration/rest | JWT from `POST /api/auth/tokens/credentials`. Then `GET /api/status`, `GET /api/graph`, `GET /api/graph/{g}?query=..&timeout=` (SSE). Needs `ENCRYPTION_KEY`. | No. Our own API serves the UI. |
| Kafka Connect | https://docs.falkordb.com/integration/kafka-connect | Sink connector `com.falkordb.FalkorDBSinkConnector`, `falkor.url=redis://..`. | No. |
| n8n | https://docs.falkordb.com/integration/n8n | `@falkordb/n8n-nodes-graphrag`. Talks to GraphRAG-Server, not to FalkorDB directly. | No. |
| PyG | https://docs.falkordb.com/integration/pyg | `falkordb-pyg` remote FeatureStore/GraphStore for NeighborLoader. | No. |
| Jena | https://docs.falkordb.com/integration/jena | `com.falkordb:jena-falkordb-adapter:0.2.0`, SPARQL over FalkorDB. | No. |
| Snowflake | https://docs.falkordb.com/integration/snowflake | Native App in SPCS: `start_app`, `load_csv(graph, cypher)`, Cortex agent. | No. |
| Spring Data | https://docs.falkordb.com/integration/spring-data-falkordb | `spring-data-falkordb:1.0.8` + `jfalkordb:0.8.0`, OGM annotations. | No. |

---

# Part C — Browser, operations, Cloud

_Its raw ideas list was folded into Part 0._

Fetched 2026-10-18. There were 280 URLs: 23 browser, 22 operations, 11 enterprise/operations and 224 cloud. All were fetched as Mintlify `.md`; raw copies are in `scratchpad/falkor/cmd/`. Every Browser and Operations page was read in full. Cloud API pages are generated per tier and component, and they repeat. Only the deltas between them are recorded here.

Tip: any docs page can be fetched as `<url>.md` to get clean markdown. The index is at `https://docs.falkordb.com/llms.txt`.

---

## 1. Browser

### 1.1 How to run it, ports, connecting, auth
Sources: https://docs.falkordb.com/operations/docker · https://docs.falkordb.com/browser/ui/login · https://docs.falkordb.com/browser/ui/auth-access-control

- **Images**
  - `falkordb/falkordb` = server + Browser. Ports: **6379** (server) and **3000** (Browser).
  - `falkordb/falkordb-server` = server only (6379).
  - `falkordb/falkordb-browser` = Browser only (3000). It needs the `FALKORDB_URL` env var, e.g. `redis://falkordb-server:6379`. `FALKORDB_PASSWORD` is optional.
- **Disable the Browser** in the combined image with `-e BROWSER=0` (used in the cluster guide).
- **Quick start:** `docker run -p 6379:6379 -p 3000:3000 -it --rm falkordb/falkordb:latest`, then open http://localhost:3000.
- **Login, manual mode:** Host (placeholder `localhost`), Port (`6379`), optional Username and Password, a **TLS** toggle and an optional **CA certificate** upload. Turning TLS off clears the uploaded CA. For a local server with default credentials, leave user and password blank.
- **Login, URL mode:** `falkor[s]://[[username][:password]@][host][:port][/db-number]`. Also accepts `redis://` and `rediss://`. Examples: `falkor://Default:Default@localhost:6379` and `falkors://user:pass@my-host:6379`. The form validates the URL before it tries to connect. A bad login shows "Invalid credentials". On success it goes to `/graph`.
- **Browser auth model:** NextAuth with credentials.
  - **Read-Only** role: cannot create graphs, add or delete elements, or edit labels.
  - **Admin** role: also sees the Settings sections "DB Configurations" and "Users" (both need an online connection).
  - Every user gets **Personal Access Tokens** (create with optional expiry, view, revoke).
- **Sidebar badges:** connection mode (**Single / Sentinel / Cluster**), plus **Offline** when the backend is unreachable.

### 1.2 Routes
- `/login`
- `/graph` (workspace)
- `/settings`
- `/udf` (JS UDF libraries)
- `/docs` (Swagger UI; the spec is served at `/api/swagger`)
- `/api/graph/{graph}/export` (downloads a `.dump`)

Sources: https://docs.falkordb.com/browser/ui/api-documentation · https://docs.falkordb.com/browser/ui/navigation

### 1.3 Graph page layout and multi-graph
Sources: https://docs.falkordb.com/browser/ui/graph-page · https://docs.falkordb.com/browser/ui/graph-tabs

**Layout**
- Left sidebar: Graphs/Settings navigation, theme toggle (Dark → Light → System), Graph Info toggle, CHAT toggle, Help menu (Docs, API docs, Discord, About), logout.
- Top bar: **graph selector**, Monaco query editor, RUN, history button, maximize.
- **Tab strip** across the full width.
- Results area with four tabs: **Graph / Table / Metadata / Schema**.
- Resizable right panel: Data, Add, Chat, Graph Info or Customize Style.

**Graph tabs**
- Each tab holds: graph, query, active results tab, viewport, selection, layout, direction, animation/pin/dim, search and filter state, Graph Info state, Chat state and the open Style panel.
- Graph and Schema views keep separate state inside the same tab.
- Controls: `+` (New tab), pencil to rename (Enter commits, Esc cancels, empty restores the graph name), `X` to close. The last tab cannot be closed.
- Tabs persist in **localStorage, scoped per connection**, and survive a reload.
- **Max Tabs** is 4–10 (default 8), set in Settings → User Experience.
- Chat history is kept per tab.
- Graph Info refreshes on the "Refresh Interval" setting.

### 1.4 Query editor
Source: https://docs.falkordb.com/browser/ui/query-editor

- Monaco editor with an openCypher grammar plus FalkorDB extensions.
- **Real-time syntax validation:** errors are underlined, and hovering explains them. Running an invalid query raises a local "Syntax Error" and nothing is sent to the server. Quick-fix offers "Did you mean…?" and "✨ Fix with AI" when Chat is configured.
- **Autocomplete:** keywords, built-in functions and procedures, **UDFs**, graph-scoped labels, relationship types and property keys (fetched from the server), and variables bound earlier in the query.
- **Run:** RUN button, Enter (when no suggestion is open) or Cmd/Ctrl+Enter. Shift+Enter inserts a newline. Up and Down on the first or last line walk the query history.
- **Maximize** opens a full-screen dialog with Run and Clear.

### 1.5 Query history (the "saved queries" equivalent)
Source: https://docs.falkordb.com/browser/ui/query-history

- There is no named saved-query feature. History is stored in localStorage under the key `query history`.
- Clock button opens the dialog (it is disabled when the history is empty). It offers:
  - search;
  - **filter by graph name**;
  - load a query into an editor;
  - per-query tabs Edit Query / Profile / Metadata / Explain;
  - delete selected queries (Ctrl+right-click multi-select) or delete all.
- Other places that keep queries:
  - "Default Query On-load" in Settings;
  - the per-connection tabs (section 1.3);
  - Upload Data → Cypher batch (section 1.11).

### 1.6 Graph canvas (visualization)
Sources: https://docs.falkordb.com/browser/ui/graph-canvas · https://docs.falkordb.com/browser/canvas · https://docs.falkordb.com/browser/ui/toolbar-actions

**Canvas basics**
- Pan and zoom. Selecting an element opens the Data panel. Right-click gives a context menu.
- **Labels** and **Relationships** overlay lists toggle visibility without re-running the query.

**Controls**

| Control | Options |
|---|---|
| Animation | play / pause of the force simulation |
| Zoom | zoom in / zoom out |
| Fit to screen | fits everything, or just the selection |
| **Layout** | `Force` / `Tree` / `Radial` |
| Direction | Tree: TD / BU / LR / RL. Radial: Outward / Inward |
| **Pin** on drag | Tree and Radial pin automatically |
| **Dim** | dims elements outside the selection |

**Toolbar**
- In-canvas search by property-value prefix, ID, label or relationship type. Enter selects and the canvas zooms to the match.
- **Show All** un-hides every hidden label and type. Read-only users can use it too.
- **Add node**, **Add edge** (needs two nodes selected) and **Delete** (not for Read-Only).
- A warning appears when the result limit was hit or the limit setting changed.

**Embeddable renderer**
- The canvas is the npm web component **`@falkordb/canvas`** (`<falkordb-canvas>`).
- Methods: `setData({nodes,links})`, `setConfig`, `setLayout('force'|'tree'|'radial')`, `zoomToFit`, `getViewport`/`setViewport`, `setAnimation(false)`, plus `largeGraph` culling options.
- It does **not** query the DB. Our app would run the Cypher and pass the nodes and links to it.
- Colors are set per node and link (hex), so our mochi tokens would apply.

### 1.7 Styling
Source: https://docs.falkordb.com/browser/ui/style-panel

- Open it from **Graph Info → palette icon** next to a label or relationship type.
- **Color:** 15 presets, or a custom value by picker or hex.
- **Size:** 10 steps from 0.25x to 2.50x. On nodes it scales the radius. On relationships it scales line width, label font and arrowhead together.
- Live preview. The style is also used in the Schema view.
- Save Changes / Cancel (reverts, panel stays open) / X.
- Styles are stored **in the browser, per connection**. They are not shared with other users and must be set again on the recording machine.
- Saving is blocked during the tutorial.
- Captions are set in Settings → User Experience:
  - "Captions Keys": property keys in priority order, plus "Add Property Key To Caption";
  - "Show property key prefix".

### 1.8 Schema view
Source: https://docs.falkordb.com/browser/ui/schema-view

**What it shows**
- Uses read-only queries. It never modifies data and never re-runs the editor query.
- Nodes are **labels** (plus a `No Label` entry). Links are **placements**: one per distinct (source label, relationship type, target label).
- Counters: `Labels: n` and `Connections: n`.
- Selecting an element opens **Label Schema** / **Relationship Schema** with these columns:
  - **Key**;
  - **Type** (e.g. `Integer | String`);
  - **Constraints** (Unique and Mandatory badges);
  - **Index** (`range` / `fulltext` / `vector`).

**How it behaves**
- Placements and labels are exact.
- Property keys are **sampled from 10 elements per label or type**, so rare keys can be missing.
- Constraints and indexes are exact.
- No edit controls and no refresh button. The schema is rediscovered each time the tab opens and cached per tab.

### 1.9 Graph Info panel
Source: https://docs.falkordb.com/browser/ui/graph-info-panel

- Shows: graph name, optional memory usage (MB), node and edge counts, labels, edge types, property keys.
- **Click to explore:**
  - a label runs `MATCH (n:Label) RETURN n`;
  - an edge type runs `MATCH p=()-[:TYPE]-() RETURN p`;
  - a property key finds the elements that have it;
  - `*` shortcuts run all nodes and all edges.
- Offloaded graphs (Enterprise only) show `N/A`.

### 1.10 Table, Metadata, Data panel
Sources: https://docs.falkordb.com/browser/ui/table-view · https://docs.falkordb.com/browser/ui/metadata-view · https://docs.falkordb.com/browser/ui/data-panel

- **Table:** headers are the union of keys across rows. Search, nested-value expand. **Export CSV** gives `<graph>_table_export.csv`, with objects written as JSON.
- **Metadata:** three panes.
  - **Profile** actually executes the query and renders a tree.
  - **Metadata** shows the result-stat lines.
  - **Explain** shows the plan tree without executing.
- **Data panel:** ID, attribute count, labels or relationship type, and an editable property table. Add and remove labels (not Read-Only). Esc closes it.

### 1.11 Graphs Manager, Upload, UDF, Chat, Settings
Sources: https://docs.falkordb.com/browser/ui/graph-management · https://docs.falkordb.com/browser/ui/upload-data · https://docs.falkordb.com/browser/ui/udf-libraries · https://docs.falkordb.com/browser/ui/chat-panel · https://docs.falkordb.com/browser/ui/settings

- **Graphs Manager:** create, delete (multi-select), **duplicate (with data)**, export `.dump`, upload data. On Enterprise it also shows Loaded / Offloaded dots.
- **Upload Data:**
  - **Load CSV** uploads a file, generates a `LOAD CSV` query with columns as `row.col` and a "Use CSV headers" toggle, which you edit and then RUN. The file is deleted afterwards.
  - **Cypher batch** takes a `.cypher` or `.txt` file and runs its statements sequentially against the active graph.
- **UDF page (`/udf`):** Load Lib (a JS file), Flush Libs, browse, inspect source, Export.
- **Chat:** natural language → Cypher, executed on the selected graph.
  - Needs Settings → Browser Settings → Chat to be configured.
  - Cloud key options: OpenAI, Anthropic, Gemini, Groq, Cohere, xAI, DeepSeek.
  - Local options: Ollama `http://localhost:11434`, LM Studio `http://localhost:1234/v1`.
  - Keeps the last 5–10 interactions per tab and graph. Opening Chat clears the selection.
- **Settings → Browser Settings:**
  - Chat;
  - Graph Info "Max Items For Search";
  - **Query Execution: Timeout, Limit (max rows), Default Query On-load**;
  - User Experience: captions, key prefix, Refresh Interval, Max Tabs, table column width and row height;
  - **Replay Tutorial**.
  - Admin only: **DB Configurations** (view and update DB config values) and **Users** (view, change roles, add, remove).

---

## 2. Operations

### 2.1 Docker and Docker Compose
Source: https://docs.falkordb.com/operations/docker

**Env vars**
- `REDIS_ARGS` is passed to redis-server, e.g. `--requirepass X --appendonly yes --appendfsync everysec --maxmemory 2gb --maxmemory-policy allkeys-lru --aclfile ...`.
- `FALKORDB_ARGS` is passed to the module, e.g. `THREAD_COUNT 8 CACHE_SIZE 50 TIMEOUT_MAX 60000 TIMEOUT_DEFAULT 30000 QUERY_MEM_CAPACITY 104857600`.

**Production compose from the docs (verbatim parts)**
```yaml
services:
  falkordb:
    image: falkordb/falkordb-server:latest
    ports: ["6379:6379"]
    environment:
      - REDIS_ARGS=--requirepass ${FALKORDB_PASSWORD:-falkordb} --appendonly yes
      - FALKORDB_ARGS=THREAD_COUNT 8 TIMEOUT_MAX 30000
    volumes: [falkordb_data:/data]
    restart: unless-stopped
    healthcheck: {test: ["CMD","redis-cli","ping"], interval: 30s, timeout: 10s, retries: 3}
volumes: {falkordb_data: {}}
```
- With a password, the healthcheck becomes `["CMD","redis-cli","-a","$${FALKORDB_PASSWORD:-changeme}","ping"]`.
- Split server and browser: `falkordb-browser` with `FALKORDB_URL=redis://falkordb-server:6379` and `FALKORDB_PASSWORD=falkordb`, on a shared bridge network.
- **Data-path inconsistency in the docs.** The Docker page mounts `/data`. The Persistence and ACL pages and the FAQ say the default data dir is **`/var/lib/falkordb/data`** ("Why is my data lost… mount `-v falkordb_data:/var/lib/falkordb/data`"). Mount both, or verify with `redis-cli CONFIG GET dir`.
- Pin a tag in production, e.g. `falkordb/falkordb-server:4.0.0` from the docs example. FalkorDBLite defaults to module `v4.16.3`, a hint at the current version.
- Troubleshooting commands: `docker-compose exec falkordb redis-cli ping`, `docker-compose logs -f falkordb`, `docker-compose top`.

### 2.2 Persistence (RDB/AOF), DUMP/RESTORE, ACL persistence
Sources: https://docs.falkordb.com/operations/durability · https://docs.falkordb.com/operations/durability/persistence · https://docs.falkordb.com/operations/durability/acl-persistence

**RDB**
- Config lines `save <sec> <changes>`, e.g. `save 900 1`, `save 300 10`, `save 60 1000`, plus `dir` and `dbfilename dump.rdb`.
- Uses fork. The pause is milliseconds to about 1 s on very large datasets.

**AOF**
- `appendonly yes` with `appendfsync always | everysec (default, recommended) | no`.
- Overhead: about 1–2% at everysec. `always` is significantly slower.
- Rewrite: `auto-aof-rewrite-percentage 100`, `auto-aof-rewrite-min-size 64mb`, or manually with `BGREWRITEAOF`.
- With both RDB and AOF on, **restart loads the AOF**.

**Profiles from the docs**

| Profile | Settings |
|---|---|
| Recommended | `save 900 1; save 300 10; save 60 1000; appendonly yes; appendfsync everysec` |
| Maximum durability | `save 60 1; appendfsync always` |
| Dev | `save ""; appendonly no` |

**Inspection and backup**
- `redis-cli INFO persistence`: check `rdb_last_save_time`, `aof_enabled`, `aof_last_rewrite_status`.
- `SAVE` (blocking) and `BGSAVE`.
- **Per-graph backup:** `redis-cli DUMP mygraph > mygraph.dump`, then `RESTORE mygraph 0 "<blob>" [REPLACE]`. Each graph is one Redis key.
- Docker check from the docs: create a node, `docker stop/start`, then `MATCH (n) RETURN n` should still return it.

**ACL users**
- They live **only in memory** unless you configure an ACL file.
- `touch ./data/users.acl` **before** start, or Redis refuses to boot.
- Start with `REDIS_ARGS="--appendonly yes --aclfile /var/lib/falkordb/data/users.acl"`.
- Create users with `ACL SETUSER ...`, then run **`ACL SAVE`**.
- Example of a read-only app user: `ACL SETUSER bob on '>bobpass' '~bob:*' '+@read' '+GRAPH.QUERY' '+GRAPH.RO_QUERY'`.
- Harden with `ACL SETUSER default off` and `chmod 600` on the file.
- Cannot be mixed with inline `user` directives.

### 2.3 Replication
Source: https://docs.falkordb.com/operations/replication

- Single primary with **async** replication. Replicas are read-only, so use `GRAPH.RO_QUERY` on them.
- Setup:
  - `docker network create falkordb-network`;
  - master on 6379;
  - replica `-p 6380:6379`;
  - on the replica, run `redis-cli replicaof falkordb-master 6379`.
- Check lag with `INFO replication`. Docs claim it is typically sub-ms.
- **No automatic failover** without Sentinel or Cluster. Replicas do not scale writes.

### 2.4 Cluster
Source: https://docs.falkordb.com/operations/cluster

- Redis Cluster with 16,384 hash slots. **Each graph is one key, so it lives on one shard.** A single graph is never split across shards.
- Clients must be cluster-aware (handle `MOVED`). Use `redis-cli -c`.
- Docker recipe:
  1. Start 6 nodes with `-e BROWSER=0 -e "FALKORDB_ARGS=--port N --cluster-enabled yes --cluster-announce-ip nodeI --cluster-announce-port N"`.
  2. Add the nodes to `/etc/hosts`.
  3. Run `redis-cli --cluster create node1:6379 … node6:6384 --cluster-replicas 1 --cluster-yes`.
  4. Verify with `--cluster check`. Scale with `--cluster add-node`.
- Relevance to us: per-tenant graphs (`company`, `team_*`, `user_*`) would spread across shards. That is not needed for the demo.

### 2.5 Kubernetes (Helm, KubeBlocks)
Sources: https://docs.falkordb.com/operations/k8s-support · https://docs.falkordb.com/operations/kubeblocks

**Bitnami redis chart**
- values:
  - `global.security.allowInsecureImages: true`;
  - `image.repository: falkordb/falkordb`;
  - `master/replica.extraFlags: ["--loadmodule /var/lib/falkordb/bin/falkordb.so"]`.
- Install with `helm install -f values.yaml my-falkordb oci://registry-1.docker.io/bitnamicharts/redis` (Sentinel HA).
- Get the password: `kubectl get secret my-falkordb-redis -o jsonpath="{.data.redis-password}" | base64 -d`.
- Connect: `kubectl port-forward svc/my-falkordb-redis-master 6379:6379`.

**Cluster variant**
- `bitnamicharts/redis-cluster` with image `bitnamilegacy/redis-cluster:8.2.1-debian-12-r0`.
- An initContainer copies `falkordb.so` from `falkordb/falkordb-server`, and the configmap adds `loadmodule /falkordbmodule/falkordb.so`.
- Default is 6 nodes.

**KubeBlocks operator**
- `helm install kubeblocks kubeblocks/kubeblocks -n kb-system`, then `kbcli addon install falkordb` (or `helm install falkordb-addon kubeblocks-addons/falkordb`).
- Topologies: standalone, replication (Sentinel starts first) and sharding. Day-2 operations: horizontal and vertical scale, volume expansion, restart.
- **Not worth it today.**

### 2.6 PaaS: Railway (template) and Lightning.AI
Sources: https://docs.falkordb.com/operations/railway · https://docs.falkordb.com/operations/lightning-ai

**Railway templates**
- **Single Instance** (`railway.com/deploy/falkordb-1`): the **Browser is on by default**. It comes with a persistent Railway volume.
- **Cluster** (`railway.com/deploy/falkordb-cluster`).

**Railway variables**

| Variable | Use |
|---|---|
| `RAILWAY_PUBLIC_DOMAIN` | HTTPS Browser |
| `FALKORDB_PRIVATE_URL` | Services in the same project and env (private network) |
| `FALKORDB_PUBLIC_URL` | External access; needs the **TCP Proxy** enabled |
| `FALKORDB_PASSWORD`, `FALKORDB_HOST`, `FALKORDB_PORT` | Credentials and endpoint |

- Browser login username is **`default`**.
- `redis-cli -u "$FALKORDB_PUBLIC_URL" GRAPH.QUERY g "RETURN 1"`.
- Logs and Metrics tabs are in the Railway dashboard.
- **Lightning.AI** is a prebuilt RAG notebook environment. Not relevant.

### 2.7 FalkorDBLite (embedded) — local fallback with no Docker
Sources: https://docs.falkordb.com/operations/falkordblite · https://docs.falkordb.com/operations/falkordblite/falkordblite-ts

- `npm install falkordblite`. Needs Node ≥ 20. Runs on **Linux x64 and macOS arm64** only (Windows needs WSL2).
- It downloads the module at install time and spawns an embedded `redis-server`.
- Usage: `const db = await FalkorDB.open({ path: './data' }); db.selectGraph('g'); graph.query / roQuery; db.close()`.
- Setting `path` turns on periodic snapshots.
- Options:
  - `maxMemory`;
  - `additionalConfig` (e.g. `{port:'6379'}`, which exposes a port the Browser could attach to);
  - `falkordbVersion` (default `v4.16.3`);
  - `timeout` (default 10000);
  - `logFile`, `inheritStdio`.
- Switching to a remote server is one line: `import { FalkorDB } from 'falkordb'; await FalkorDB.connect({socket:{host,port}})`.

### 2.8 Configuration, monitoring, tracing
Sources: https://docs.falkordb.com/operations/docker · https://docs.falkordb.com/operations/opentelemetry · https://docs.falkordb.com/cloud/api-reference/schemas

- Module parameters that appear in these pages:
  - `THREAD_COUNT`, `CACHE_SIZE` (Cloud range 1–256, default 25);
  - `MAX_QUEUED_QUERIES` (Cloud range 1–512, default 50);
  - `NODE_CREATION_BUFFER` (default 16384);
  - `QUERY_MEM_CAPACITY`;
  - `RESULTSET_SIZE` (Cloud default 10000, 0 = unlimited);
  - `TIMEOUT_DEFAULT`, `TIMEOUT_MAX`.
- Set them at start with `FALKORDB_ARGS`, at runtime with `GRAPH.CONFIG SET`, or through Browser Admin → DB Configurations.
- Monitoring named in the docs:
  - `INFO persistence`, `INFO replication`;
  - `redis-cli ping`;
  - Railway Metrics tab;
  - Cloud Grafana (section 3.6);
  - Browser Metadata → Profile/Explain.
- The Cloud **Admin preset** grants `+MONITOR +SLOWLOG +GRAPH.MEMORY +GRAPH.CONFIG`. Read and Write users do not get them.
- OpenTelemetry: the page is **Python-only** (`opentelemetry-instrumentation-redis` plus manual spans with `db.statement`). Nothing is documented for TS.

### 2.9 Migration
Sources: https://docs.falkordb.com/operations/migration (+ /redisgraph-to-falkordb, /neo4j-to-falkordb, /kuzu-to-falkordb, /rdf-to-falkordb, /sql-to-falkordb)

- **RedisGraph:** load the existing RDB with no conversion. Same `GRAPH.*` commands.
- **Neo4j:** extractor config, then CSV, then load.
- **Kuzu:** automatic schema discovery, CSV, then the bulk loader.
- **RDF/TTL:** ontology extraction and URI shortening, then CSV.
- **SQL** (Postgres, MySQL, BigQuery, Snowflake, ClickHouse, Databricks): the DM-SQL-to-FalkorDB loaders do one-shot or continuous CDC sync.
- None are needed for our synthetic seed. Our generator should write Cypher (or CSV + `LOAD CSV`) directly.

### 2.10 Connection-string formats (and the "proxy")
Sources: https://docs.falkordb.com/browser/ui/login · https://docs.falkordb.com/operations/railway · https://docs.falkordb.com/cloud/console/connect

- URL forms: `falkor://[user[:pass]@]host[:port][/db]`, `falkors://…` (TLS), `redis://…`, `rediss://…` (TLS).
- No dedicated proxy page exists in this set. The only proxy that appears is **Railway's TCP Proxy**, which supplies `FALKORDB_PUBLIC_URL`.
- Node client: `FalkorDB.connect({ username, password, socket: { host, port, tls: true } })`. Drop `tls` for the Cloud Free tier.
- Python client: `FalkorDB.from_url(url)` auto-detects cluster mode.
- redis-cli: `redis-cli -h H -p P --user U --pass PW [--tls] GRAPH.QUERY g "…"` or `redis-cli -u URL`.

---

## 3. FalkorDB Cloud

### 3.1 FREE tier: yes
Sources: https://docs.falkordb.com/cloud/tiers/free · https://docs.falkordb.com/cloud/api-reference/free/free/create

**What you get**
- **100 MB RAM**, which is also the maximum graph dataset.
- Multi-graph and multi-tenancy, plus graph access control.
- **AWS or GCP**. Example region in the docs: `us-east-1`. **No region list is published.** The console shows the choices, and the docs say to pick the one nearest the app.
- **No credit card.** The plan is "Auto Approval", so the subscription is active immediately.

**What you don't get**
- **No TLS, no persistence, no backups or snapshots, no Metrics tab, no sizing or tuning parameters.** Only `name`, `description`, `falkordbUser` and `falkordbPassword` can be set.
- Always Standalone. Multi-tenant.

**Lifecycle risk**
- **Stopped after 1 day without use. Deleted after 7 days.** Data cannot be recovered.
- Keep a copy with **Import/Export RDB** (a download link valid for 1 hour).
- Plan to re-seed from `gen/` if the instance is deleted. Run a keep-alive query before judging starts.

### 3.2 Provisioning speed and flow
Sources: https://docs.falkordb.com/cloud/console/sign-up · https://docs.falkordb.com/cloud/console/create-instance · https://docs.falkordb.com/cloud/quickstart

**Console path (about 5 minutes)**
1. Sign up at `app.falkordb.cloud/signup` (GitHub or Google SSO skips email verification).
2. Account Management → Subscriptions → Subscribe to Free.
3. Deployments → Instances → Create.
4. Pick provider and region. Set the password (≥ 6 chars). The user is fixed to `falkordb`.
5. Click Create. "Most instances are ready within a few minutes."
6. Status goes **Deploying → Running**. "Unhealthy" during the deploy is expected.

**API path**
- Sign in: `POST https://app.falkordb.cloud/api/signin` with `{email,password}`. The `omnistrate_token` cookie lasts 1 hour; the refresh token lasts 24 hours.
- Create: `POST https://api.omnistrate.cloud/2022-09-01-00/resource-instance/sp-JvkxkPhinN/falkordb/v1/prod/falkordb-free-customer-hosted/falkordb-free-falkordb-customer-hosted-model-omnistrate-multi-tenancy/free` with an explicit `Cookie: omnistrate_token=$TOKEN` header and body `{"cloud_provider":"aws","region":"us-east-1","requestParams":{"name":…,"falkordbUser":"falkordb","falkordbPassword":…}}`. Returns 202 with `{id}`.
- Poll `GET …/free/$ID` until `status=RUNNING`. Then `result_params.falkordbHostname` and `falkordbPort` give the endpoint.

### 3.3 Connection details and TLS
Sources: https://docs.falkordb.com/cloud/console/connect · https://docs.falkordb.com/cloud/features

- **Where to find them:** Connectivity tab → Endpoint `host:port` (shown only while Running). **The port is often not 6379.** Instance Details → FalkorDB User (`falkordb`) and Password.
- Extra users are created in **User Access**:
  - Admin (default role);
  - Read: `GRAPH.RO_QUERY/EXPLAIN/INFO/LIST` only;
  - Write: adds `GRAPH.QUERY/DELETE/CONSTRAINT/BULK/COPY/PROFILE/UDF`;
  - Custom ACL.
  - No preset grants `+ACL`.
- **TLS:** Startup tier and above only. Chosen with "Enable TLS" at creation and **immutable** afterwards. **The Free tier never has TLS**, so the client must not set `tls`.
- Troubleshooting from the docs: a TLS error means the client TLS setting doesn't match the instance. Connection refused means the instance isn't Running or the port is wrong.

### 3.4 Is the Browser hosted? Yes, through Connect
Sources: https://docs.falkordb.com/cloud/console/connect · https://docs.falkordb.com/cloud/features

- In the console, select a Running instance and click **Connect**. FalkorDB Browser opens in a new tab with Host, Port, Username and the TLS setting filled in. Enter the password and log in.
- Disabled for Private-network (Enterprise VPC) instances.
- A local `falkordb/falkordb-browser` container (or the combined image's `:3000`) can also log in to the Cloud endpoint with URL mode `falkor://falkordb:PW@host:port`.

### 3.5 Pricing tiers (summary)
Sources: https://docs.falkordb.com/cloud/tiers/startup · https://docs.falkordb.com/cloud/tiers/pro · https://docs.falkordb.com/cloud/tiers/enterprise

| Tier | Price | RAM | TLS | HA | Persistence | Backups | Deploy types | Clouds |
|---|---|---|---|---|---|---|---|---|
| Free | $0 | 100 MB | no | no | none | none | Standalone | AWS, GCP |
| Startup | from **$73/mo** ($0.10 per GB-hour; 1 GB = $73, 2 GB = $146) | 1 or 2 GB (`memoryRequestsAndLimits` 1200M/2200M) | yes | no | not "continuous" | every 12 h, kept 7 d | Standalone | AWS, GCP |
| Pro | from **$350/mo** ($0.20 per core-hour + $0.01 per GB-hour; 2c/8GB = $350.40) | 4–128 GB | yes | yes | **AOF + snapshot** | every 12 h, kept 7 d | Standalone, Single-Zone, Multi-Zone | AWS, GCP |
| Enterprise | custom | custom | yes | yes | yes | every 2 h, kept 2 d | adds Cluster SZ/MZ and VPC | adds Azure; BYOA option |

- Paid tiers need a Stripe card.
- Stopped paid instances are removed after 14 days (a snapshot is taken first). Snapshots expire after 14 days.
- The API intro lists "Cluster (Multi-Zone)" under Pro, but the console docs say clusters are Enterprise-only. The docs contradict each other.
- Pro offers a Grafana dashboard. Scheduled exports are Pro and above.
- Changing deployment type or tier means creating a new instance and importing from the old one.

### 3.6 Cloud operations (paid tiers, mostly)
Sources: https://docs.falkordb.com/cloud/operations/backups-snapshots · https://docs.falkordb.com/cloud/operations/export-import · https://docs.falkordb.com/cloud/operations/monitoring-dashboard · https://docs.falkordb.com/cloud/operations/user-management · https://docs.falkordb.com/cloud/operations/upgrading-instances · https://docs.falkordb.com/cloud/operations/customer-networks · https://docs.falkordb.com/cloud/operations/maintenance-windows

- **Import/Export RDB (all tiers, including Free):**
  - Export to a 1-hour download link, GCS or S3.
  - Import from upload (≤ 2 GB), an HTTPS URL, GCS, S3 or another instance.
  - **An import erases the instance first.** A safety copy is taken.
  - One task at a time per instance.
- **Backups and restores:** a restore always creates a **new instance**. Point-in-time restore is available on tiers that have backups.
- **Grafana Metrics tab (Startup, Pro, Enterprise; not Free):**
  - clients, uptime, memory %, graph count;
  - **per-graph memory** (top 10);
  - memory by component (nodes, edges, matrices, indices);
  - Total Commands/sec and **Graph Commands/sec**;
  - **Avg Query Latency per GRAPH.* command**;
  - **Slowlog** (last 10);
  - CPU, network, connected and blocked clients;
  - logs.
- **Modify:** change name, description or password (a password change restarts the instance). Paid tiers can also resize.
- **Maintenance:** Pro and below get notice-based maintenance. Standalone means a short restart, so build retry logic.
- **Customer networks / VPC:** Enterprise only, `/20` CIDR or larger, peering through a support ticket.
- **Enterprise self-managed (K8s) pages** (`/enterprise/operations/*`): backups, graph offloading (evicts idle graphs to disk), Prometheus/Grafana, scaling, RDB export, LDAP. Not applicable to us.

### 3.7 What it takes to deploy Mochi against Cloud Free
Synthesized from the sources above.

1. Create the Free instance (about 5 minutes). Note host, port and password.
2. App host. Pick one:
   - **Railway** service from the GitHub repo;
   - Fly.io app;
   - Render.
   - Env vars: `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_USERNAME=falkordb`, `FALKORDB_PASSWORD`, with **no TLS**. The endpoint is public, so the PaaS needs no peering.
3. The TS client connects with `FalkorDB.connect({username,password,socket:{host,port}})`.
4. The Pi Durable SQLite file needs a volume on the app host. FalkorDB Free has no persistence, so the graph must be re-seedable with `npm run seed`.
5. Watch the 100 MB cap. Use `GRAPH.MEMORY USAGE`, or the Browser Graph Info memory toggle, to confirm the synthetic dataset plus the dream-cycle growth fits.
6. Risks:
   - no TLS, so plain-text credentials over the internet (use a throwaway password);
   - idle stop after 1 day;
   - no Metrics tab for the concurrency demo.

---

---

# Part D — Enterprise, ACL, licensing

_Its raw ideas list was folded into Part 0._

Scope: all 235 URLs in `d.txt`, fetched 2026-10-18 as Markdown (`<url>.md`). Groups:
- 55 FalkorDB **Cloud** "enterprise tier" API pages: 5 tiers x 11 verbs.
- ~140 **Enterprise Admin Server** REST endpoint pages (OpenAPI).
- ~40 guide pages: get-started, databases, deployment, operations, reference, upgrades, security, licensing.

Main finding: Enterprise is a **Kubernetes management plane** (Helm + KubeBlocks + Admin Server/UI/CLI) around the same database. It adds no per-graph permission model. Database access control is plain **Redis ACL**, plus optional LDAP that maps directory groups to ACL rule tokens. I verified the ACL behaviour below against the open-source `falkordb/falkordb:latest` image: it works today with no Enterprise.

---

## 1. What Enterprise is

Source: https://docs.falkordb.com/enterprise/get-started/overview

- A self-managed distribution for Kubernetes, shipped as one Helm release. It contains:
  - **Admin UI** (web console)
  - **Admin Server** (REST API: deployments, ops, backup/restore, logs, metrics, users, RBAC, settings, audit logs, licensing, diagnostics)
  - **FalkorDB KubeBlocks addon**
  - **FalkorDB Browser**
  - **Admin CLI** `falkordb-admin`
  - `install.sh` / `uninstall.sh`
- Namespaces: `falkordb-system` (product), `kb-system` (KubeBlocks + snapshot controller).
- Only **one install per k8s cluster**, enforced by the cluster-scoped lock `falkordb-enterprise-install-lock`.
- Vocabulary: "deployment" means a FalkorDB database instance. "Cluster" means the k8s cluster.
- Applications connect to the database Service directly. The Admin Server does not proxy data traffic.
- Requirements: Enterprise Portal access through a FalkorDB account manager; ≥3 worker nodes at 4 CPU / 16 GB each; default StorageClass; k8s ≥1.27. Source: https://docs.falkordb.com/enterprise/get-started/requirements
- Images are private: `registry.falkordb.cloud/falkordb/falkordb-enterprise-db:v4.20.x/v4.22.0`. Pulling needs portal registry credentials. Source: https://docs.falkordb.com/enterprise/deployment/private-images

### Topologies

Source: https://docs.falkordb.com/enterprise/databases/standalone (also replicated, sentinel, sharded)

| Topology | spec | Constraints |
|-|-|-|
| Standalone | `topology: standalone`, `replicas: 1` (Dev) | No failover. Wizard default auth `acl`, user `default` |
| Replicated, no Sentinel | `topology: standalone`, `replicas ≥2`, no `spec.sentinel` | |
| Sentinel | `topology: replication`, `sentinel.enabled: true` | Sentinel count odd, ≥3. Prod template: ≥2 replicas, Sentinel required |
| Sharded | `topology: cluster`, `sharding.shardCount` | ≥3 shards, ≥2 replicas per shard, 16,384 hash slots |

Glossary: "Primary accepts writes. Replicas stream from the primary and **serve reads**." Source: https://docs.falkordb.com/enterprise/reference/glossary

Caveat stated in the docs: the UI **Switchover** button "only shows a success toast", with no backend operation wired. Do manual failover through KubeBlocks. Source: https://docs.falkordb.com/enterprise/databases/sentinel

### Day-2 operations

Groups of near-identical endpoint pages are folded into this subsection.

- **Scaling.** Sources: https://docs.falkordb.com/enterprise/operations/scaling and the `cluster-operations/*` endpoints.
  - Horizontal OpsRequest per component: `falkordb`, `falkordb-sent`, `shard`. UI maximum is 10 replicas.
  - Rebalance runs `redis-cli --cluster rebalance`. It skips shards within 2% of an even share.
  - Manual reshard: `falkordb-admin operations reshard <dep> --slots 0-999,5000 --to shard-x --from shard-y`.
  - Vertical CPU/memory changes trigger a rolling restart.
  - Storage expansion cannot be undone.
- **Parameters.** Source: https://docs.falkordb.com/enterprise/operations/parameters
  - FalkorDB module config and `redis.conf` are applied through a KubeBlocks reconfigure OpsRequest.
  - Most directives apply live. `databases` and `io-threads` cause a rolling restart.
  - Enterprise-module keys use the `falkordbe.` prefix and always apply live.
- **Graph offloading** (enterprise module only). Source: https://docs.falkordb.com/enterprise/operations/graph-offloading
  - Commands: `GRAPH.OFFLOAD <key>`, `GRAPH.LOAD <key> [FORCE]`, `GRAPH.STUBS`, `GRAPH.STUBINFO <key>`.
  - An idle graph becomes a roughly 1-byte `graphstub` key. The data goes to `/data/offload/<key>.graph`.
  - Config: `falkordbe.idle-threshold-ms` (0 = off, minimum 1000), `falkordbe.evict-interval-ms` (default 10000), `falkordbe.memory-pressure` (0.0–1.0; needs `maxmemory`), `falkordbe.load-evict-budget` (0 off, -1 unlimited).
  - Offload and load run off the global lock.
  - They are **not replicated**; each node manages its own memory.
  - RDB and volume-snapshot backups include the stubs. AOF backups do not.
  - The docs name the use case: "**multi-tenant workloads**" where many graphs exist but few are active.
- **Backups and restores.** Sources: https://docs.falkordb.com/enterprise/operations/backups , https://docs.falkordb.com/enterprise/operations/restore-new-database , https://docs.falkordb.com/enterprise/operations/restore-same-database
  - Backups go to repositories (S3, NFS, and similar) through backup policies and schedules.
  - Schedule defaults: cron `0 3 * * *`, retention `30d`, method `datafile`.
  - A restore creates a new deployment (a clone) or restores into the same one.
- **RDB export/import.** Source: https://docs.falkordb.com/enterprise/operations/rdb-export-import
  - Uses `redis-rdb-cli` Jobs, one RDB per shard, on a schedule.
  - Import sources: an export, another deployment, or any `redis://` address.
  - Takes a pre-import snapshot and can roll back.
- **Monitoring.** Source: https://docs.falkordb.com/enterprise/operations/monitoring
  - Per-pod live metrics: CPU, memory, clients, net I/O, command and graph-command rates and latency, DB keys.
  - Optional `podMonitor.enabled`, `alertRules.enabled`, `grafanaDashboards.enabled`.
  - Alerts: `FalkorDBMetricsDown`, `NodeDown`, `ShardedClusterFailed`, `ReplicaLinkDown`, `ReplicaLost`, `MemoryNearLimit` (0.9), `PersistenceFailing`, `VolumeNearlyFull` (0.15), `BackupFailed`.
- **TLS.** Source: https://docs.falkordb.com/enterprise/databases/tls
  - Fixed when the deployment is created.
  - Issuers: FalkorDB Enterprise CA (10-year CA, 1-year certificate, auto-renewed 30 days before expiry), cert-manager, your own Secret, or KubeBlocks.
  - Covers clients, replication, Sentinel and the cluster bus.
  - Certificates hot-reload with `CONFIG SET`.
- **Networking.** Source: https://docs.falkordb.com/enterprise/databases/networking
  - Cluster-internal by default.
  - `spec.externalDomain` plus ExternalDNS gives per-pod external names.
  - ClusterIP, NodePort and LoadBalancer Services are also available.
- **Other.** Sources: https://docs.falkordb.com/enterprise/operations/cost-showback , https://docs.falkordb.com/enterprise/troubleshooting/support-package , https://docs.falkordb.com/enterprise/deployment/production
  - Cost showback estimates per deployment and fleet.
  - Diagnostics and support package export.
  - Platform guides for AKS, EKS, GKE, k3s, OpenShift, Rancher and private registries (same chart, platform-specific ingress and storage).
  - Upgrade, addon and migration guides cover 0.3→0.4 and 0.3→1.0.

### FalkorDB Cloud "Enterprise" tiers

Source: https://docs.falkordb.com/cloud/api-reference/enterprise/multi-zone/create (the other 54 pages differ only in tier name)

- 5 tiers: `standalone`, `single-zone`, `multi-zone`, `cluster-single-zone`, `cluster-multi-zone`.
- Each tier has the same 11 verbs: create, describe, list, update, delete, start, stop, restart, backup, copy-snapshot, failover.
- The only difference: `numReplicas` is fixed at **2** on single-zone and multi-zone.
- Auth uses the session cookie `omnistrate_token=<jwt>`.
- Create body fields:
  - `cloud_provider`, `region`, `custom_network_id`
  - `requestParams.{enableEnterpriseModule, enableTLS, falkordbUser="falkordb", falkordbPassword, nodeInstanceType="e2-custom-4-8192", maxMemory="6GB", AOFPersistenceConfig everysec|always, RDBPersistenceConfig low|medium|high}`
  - Engine knobs, all set at creation only: `falkorDBCacheSize` (25, range 1–256), `falkorDBMaxQueuedQueries` (50, 1–512), `falkorDBNodeCreationBuffer` (16384), `falkorDBQueryMemCapacity` (20 GiB), `falkorDBResultSetSize` (10000), `falkorDBTimeoutDefault` / `falkorDBTimeoutMax` (0, maximum 45000 ms).
- Only **one** DB user can be created through the API.

---

## 2. Access control: three separate layers

### 2a. Admin-plane RBAC (the console, not the data)

Sources: https://docs.falkordb.com/enterprise/api-reference/endpoints/rbac/create-a-custom-rbac-role , https://docs.falkordb.com/enterprise/api-reference/endpoints/users/create-a-new-user , https://docs.falkordb.com/enterprise/api-reference/endpoints/audit/query-audit-logs-with-filtering

- `POST /api/rbac/roles` takes `{name, description, rules:[{resource, actions[], namespace?}]}`.
  - `resource` ∈ `clusters | clusters.backups | clusters.restores | clusters.transfers | users | rbac | admin | settings | system | *`.
  - `actions` ∈ `list | get | read | create | update | delete | *`.
- Predefined roles: **operator** (every action) and **viewer** (`list`, `get`).
- Group mappings: `{groupEmail, roleName, priority}`. A reload from the ConfigMap is available.
- Users: `{email, name, role, source: local|google|okta|auth0|azure, password ≥8, status}`.
- **Audit log** `GET /api/audit/?userId&action&resourceType&resourceName&result=success|failure&startDate&endDate&limit≤1000&offset`.
  - Each row: `userId, timestamp, action, resourceType, resourceName, result, message, ip, userAgent`.
  - It records **admin actions only**. Graph queries are not logged.
- All of this governs who may create, scale or back up deployments. It **never** reaches graph keys or Cypher.

### 2b. k8s security posture

Source: https://docs.falkordb.com/enterprise/security

- No wildcard roles.
- The Admin Server has no Secret or ConfigMap access in any namespace it has not been bound into. The k8s API server enforces this.
- All chart-owned pods meet the `restricted` Pod Security Standard (non-root, read-only rootfs, drop ALL, seccomp RuntimeDefault).
- NetworkPolicies exist but are **off by default** (`networkPolicy.enabled`).
- Images are signed with cosign and carry a CycloneDX SBOM (`--insecure-ignore-tlog=true`).
- The KubeBlocks operator should be treated as cluster-admin-equivalent.
- Database namespaces run only at the `baseline` level.

### 2c. Database-level auth (what matters for Mochi)

Sources: https://docs.falkordb.com/enterprise/operations/parameters#ldap-authentication and the `falkordbe.ldap_*` schema in https://docs.falkordb.com/enterprise/api-reference/endpoints/clusters/create-a-new-falkordb-cluster

- Deployment `spec.auth = {username: "default" (the only allowed value), password: 8–128 chars}`. Only the built-in `default` account can be set at create time. Other ACL users need `ACL SETUSER` yourself.
- LDAP (enterprise module):
  - `falkordbe.ldap_servers=ldap[s]://host:port,...`
  - `falkordbe.ldap_auth_mode=bind|search+bind`
  - `falkordbe.ldap_exempted_users_regex=^(default|exporter|replication)$`
  - `falkordbe.ldap_acl_fallback_enabled`
  - `falkordbe.ldap_default_acl_rules` (default `on resetpass`)
  - `falkordbe.ldap_groups_rules_attribute` (default `valkeyACL`): the group entry holds **space-delimited ACL rule tokens**
  - `falkordbe.ldap_group_acl_rules_map` (static group → ACL tokens)
  - `falkordbe.ldap_group_acl_user_map` (legacy `group=acluser`)
- So even Enterprise's identity integration ends in **Redis ACL rule tokens**. There is no per-graph or per-label permission system beyond that.

### 2d. Can Redis ACL restrict a user to GRAPH.RO_QUERY on specific graph keys? **Yes. Verified on the OSS image.**

Not documented in section D. I tested it against local `falkordb/falkordb:latest`: Redis 8.10.2, module `graph` ver 42201, default module args `MAX_QUEUED_QUERIES 25 TIMEOUT 1000 RESULTSET_SIZE 10000`. A graph is one Redis key named after the graph, so `~company` matches the `company` graph and `~cust_*` matches every customer graph.

```
ACL SETUSER mochi_reader on >readerpw resetkeys ~company resetchannels -@all +GRAPH.RO_QUERY +GRAPH.EXPLAIN +PING
```

| As `mochi_reader` | Result |
|-|-|
| `GRAPH.RO_QUERY company "MATCH (f) RETURN count(f)"` | OK |
| `GRAPH.RO_QUERY company "CREATE (:X)"` | `graph.RO_QUERY is to be executed only on read-only queries` |
| `GRAPH.RO_QUERY company "CREATE INDEX FOR (f:F) ON (f.t)"` | same rejection |
| `GRAPH.QUERY company "CREATE (:X)"` | `NOPERM User mochi_reader has no permissions to run the 'graph.QUERY' command` |
| `GRAPH.RO_QUERY team_x ...` | `NOPERM No permissions to access a key` |
| `GRAPH.DELETE company` / `GRAPH.LIST` | NOPERM (command) |

**Gotcha: `%R~` read-only key patterns do NOT work for graphs.** `COMMAND INFO` shows the key-spec flags are `RW access update` for **both** `GRAPH.QUERY` and `GRAPH.RO_QUERY`. As a result, `%R~company` denies even `GRAPH.RO_QUERY` (tested: `NOPERM No permissions to access a key`). Read-only must be enforced at the **command** level (`+GRAPH.RO_QUERY`), not the key level. Also, there is no `@graph` ACL category in `ACL CAT`, so name the commands one by one.

**One user, mixed tiers: ACL selectors work (Redis ≥7).** Read-only on company and teams, write on own user and customer graphs:

```
ACL SETUSER mochi_agent on >pw resetkeys -@all ~company ~team_* +GRAPH.RO_QUERY (~user_alice ~cust_* +GRAPH.QUERY +GRAPH.RO_QUERY)
```

Tested results:
- `GRAPH.RO_QUERY company`: OK.
- `GRAPH.QUERY company "CREATE..."`: NOPERM.
- `GRAPH.QUERY user_alice "CREATE..."`: OK.
- `GRAPH.RO_QUERY team_x`: OK.
- `user_bob`: NOPERM.

**Boot-time config on the docker image.** `run.sh` passes `${REDIS_ARGS}` straight to `redis-server`. This was tested and works:

```
docker run -e 'REDIS_ARGS=--requirepass adminpw --user mochi_reader on >readerpw ~company resetchannels -@all +GRAPH.RO_QUERY' falkordb/falkordb:latest
```

After this, unauthenticated clients get `NOAUTH`. `aclfile` is empty by default. Users created at runtime with `ACL SETUSER` are lost on restart unless you use `REDIS_ARGS` or mount an `--aclfile`.

Enterprise equivalent: the same ACL tokens, through `ACL SETUSER` on the deployment or LDAP group rules (§2c).

---

## 3. Multi-tenancy model, as the docs present it

Sources: https://docs.falkordb.com/enterprise/operations/graph-offloading , https://docs.falkordb.com/enterprise/security , https://docs.falkordb.com/enterprise/operations/scaling

- **Coarse isolation:**
  - one *deployment* per tenant, optionally in its own k8s namespace;
  - Admin RBAC rules scoped by `namespace`;
  - namespace guard `adminServer.managedNamespaces.pattern` (the docs call it "a guard rail, not an isolation mechanism").
- **Fine isolation:** many graphs, one key each, in one deployment.
  - Offloading keeps idle tenant graphs on disk.
  - Redis ACL key patterns gate which graphs a connection can touch.
- No Enterprise feature partitions inside a graph (no label- or property-level ACL).
- Sharded deployments distribute by Redis hash slot. A graph is a single key, so the docs' 16,384-slot model implies one graph is never split across shards. Many tenant graphs spread across shards. (This is an inference from the slot model; the docs do not say it directly.)
- Read scaling: replicas serve reads, so `GRAPH.RO_QUERY` traffic can go to replicas. Writes go to the primary.

---

## 4. Limits and licensing that matter to a public hackathon repo

Sources: https://docs.falkordb.com/enterprise/licensing , https://docs.falkordb.com/enterprise/get-started/enterprise-portal

- The Enterprise license is an offline Ed25519-signed string, `falkor.license.v1.<payload>.<signature>`. It is bound to the k8s cluster through the `kube-system` namespace uid.
- It limits capacity only: `deployments`, `cpuCores`, `memoryGB`, `users`. "The license does **not** gate features."
- With no license you get a **14-day trial with no limits**. After it ends, the management plane goes read-only (HTTP `423 Locked`). "Databases are unaffected and keep serving traffic."
- States: `trial | active | expired | invalid | locked | disabled`.
- Getting Enterprise needs an account manager, portal access and registry credentials. **Not practical by the deadline, and not reproducible from a public repo.** A clean clone could not pull the `falkordb-enterprise-db` image.
- The enterprise-only DB features are graph offloading and LDAP. Mochi needs neither. Everything we use (ACL, `GRAPH.RO_QUERY`, multigraph) is in the OSS image.
- Do not commit any license string, registry token or Admin Server JWT secret.
- Data-plane knobs that bound concurrency on the OSS image: `MAX_QUEUED_QUERIES` (image default 25), `TIMEOUT` (1000 ms), `RESULTSET_SIZE` (10000). Cloud defaults are 50, 0 and 10000.

---

---
