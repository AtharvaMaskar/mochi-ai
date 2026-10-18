# Mochi Brain — Path B build spec
Graph Hacks (FalkorDB), Oct 15–18 2026 · deadline **Sun Oct 18, 23:59 IST** · tracks: 01 + 02 + 03 + blog

**Stack:** TypeScript · Pi Durable (`@earendil-works/pi-durable` + `pi-ai` + `chord`) · FalkorDB via `falkordb` npm client · SQLite storage for the harness · hand-written Cypher (no Graphiti).

**Non-negotiables from the rules:** FalkorDB load-bearing (product breaks without it) · synthetic data only · public repo · README carries the graph model + the Cypher the product depends on · demo video · deployment or full local setup · name all three tracks · disclose AI-assistant use.

---

## 1 · Graph model

One **company graph** (`mochi_company`) + per-customer **episodic graphs** (`cust_<id>`) to showcase FalkorDB multigraph (Track 02's "separate memory per user or tenant").

### Nodes (company graph)
| label | key props |
|---|---|
| `Customer` | id, name, segment (retail/premium/HNI), city, language, joined_at |
| `Ticket` | id, subject, body, channel (app/email/chat), status, priority, created_at, resolved_at |
| `Issue` | id, name (canonical issue class, e.g. "payment debited, order not placed"), first_seen |
| `ProductArea` | name (login, kyc, funds, orders, charges, app) |
| `Team` | name |
| `AgentUser` | id, name |
| `Resolution` | id, kind (workaround/fix/escalation/info), summary |
| `KBArticle` | id, title, updated_at |
| `Release` | version, shipped_at, notes |
| `Plan` | name (basic/premium) |

### Edges
```
(Customer)-[:RAISED]->(Ticket)
(Customer)-[:ON_PLAN {valid_from, valid_until}]->(Plan)          // temporal
(Ticket)-[:ABOUT]->(Issue)
(Issue)-[:IN]->(ProductArea)-[:OWNED_BY]->(Team)
(AgentUser)-[:SOLVED]->(Ticket)                                   // expertise signal
(Ticket)-[:RESOLVED_BY]->(Resolution)-[:BASED_ON]->(KBArticle)
(Release)-[:INTRODUCED {valid_from, valid_until}]->(Issue)        // temporal: fix retires it
(Ticket)-[:FOLLOWS]->(Ticket)                                     // repeat contact chain
```

**Temporal rule (decision 05, amended 2026-10-18, human-approved):** every mutable fact is an edge with `valid_from` / `valid_until`. FalkorDB cannot store null, so a live fact has `valid_until = 253402300799000` (9999-12-31, the `VALID_FOREVER` sentinel), never absent. Contradiction = `SET old.valid_until = timestamp()` + `CREATE` new edge. One filter serves live and as-of: `valid_from <= $as_of AND valid_until > $as_of` (live = `$as_of` is now) — an indexable range scan. Every node carries `created_at`; as-of reads also exclude nodes created after `$as_of`.

### Memory tiers (decision 07)
Three kinds of graphs in one FalkorDB instance (multigraph):
- **`company`** — the brain. Written ONLY by the dream task, append-only with temporal invalidation (facts retired, never edited). User-facing connections query it with `GRAPH.RO_QUERY` (verified); Pi Durable loadouts give user conversations read tools only — the company write tool is not in their toolset. **Enforced by the database too (amended 2026-10-18, human-approved):** Redis ACL users — `mochi_reader` (only `GRAPH.RO_QUERY`/`EXPLAIN`/`LIST` on `mochi_company` + `team_*`), `mochi_dream` (the only writer of `mochi_company`; used by the dream and the loader), and per-user `user_<id>` (read company/team, write own `user_<id>` + `cust_*`). Grants are per command — never `%R~` (it blocks RO_QUERY). A prompt-injected write fails at FalkorDB with NOPERM.
- **`team_<name>`** — shared within a team; members' conversations read/write.
- **`user_<id>`** — personal; that user's conversations only.
Context assembly precedence: user overrides for preferences, company wins for facts; every node carries provenance (`source_ticket` / `source_session`).

### Doctrine vs Practice — the mismatch engine (decision 08)
Two sub-layers inside `company`:
- **Doctrine** = what the company claims: `KBArticle` / `Policy` nodes with claim properties (`promised_tat_hours`, documented steps).
- **Practice** = what actually happens: `ObservedPattern` nodes the dream distills from tickets (`measured_tat_hours`, workaround clusters) with `support_count`, `last_seen`.
The dream computes mismatch edges **deterministically** (arithmetic + Cypher, no LLM):
```
(obs:ObservedPattern)-[:CONTRADICTS {delta}]->(doc:KBArticle)   // promised 24h, measured 71h
(obs:ObservedPattern)-[:UNDOCUMENTED]->(area:ProductArea)       // workaround used 23×, in no doc
```
Each mismatch becomes a `Suggestion` node — evidence (ticket IDs), support count, confidence, expiry — routed `-[:FOR]->` the owning Team and surfaced in the morning briefing. The LLM writes only the suggestion prose. Suggestions are hypotheses with receipts, never auto-applied; a `feedback` tool lets any user mark one right/wrong (nao-style), which the dream reads next cycle.

### Context input paths (no GUI this weekend)
nao's lesson: context is an engineered, versioned artifact. Our materialization is the graph; input paths are:
1. **Bulk load** — the seeded loader.
2. **Automatic** — dream ingestion from tickets.
3. **Human** — a `teach` tool in chat ("remember: refunds over ₹10k need manager approval"). Teachings do NOT write `company` directly: they land as doctrine *candidates* the dream reviews and commits with provenance (`taught_by`, session id). Humans propose; the dream commits.
4. **Inspect** — FalkorDB Browser (exists; demo with it, don't rebuild it).
5. **Ask** (amended 2026-10-18, human-approved) — the official FalkorDB MCP server (`@falkordb/mcpserver`), read-only, connected as `mochi_reader`, committed as `.mcp.json` so judges can ask Claude about `mochi_company` directly.
A graph-based input/editing UI → `LATER.md`.

### The Feature Ledger (benchmark every graph use, good or bad)
No graph feature ships without a row here (lives in README + blog):
| feature | graph mechanism | measured against | result |
|---|---|---|---|
| briefing retrieval | multi-hop Cypher | arms A/B/C (main benchmark) | from results.json |
| mismatch detection | deterministic CONTRADICTS/UNDOCUMENTED rules | **ablation:** LLM given all docs+tickets as text, asked to find contradictions; 5 planted mismatches as ground truth; score found/missed/hallucinated + tokens | from results.json |
| emerging clusters | community detection | LLM clustering of raw ticket text on the same week (labels vs planted bad-release spikes) — run only if time; else "not measured" stated | — |
| crash resume | Pi Durable checkpoints | demonstrated, not benchmarked — say so | clip |
| tier isolation | Redis ACL users per tier (reader can only RO_QUERY; dream sole writer) | refusal test: RO `CREATE`, `GRAPH.QUERY`, foreign graph, `GRAPH.DELETE` as `mochi_reader` — each must be refused | from results.json |
| multi-agent concurrency | one harness, N parallel conversations + dream writing; multigraph isolation | latency p50/p95 vs N, consistency-under-dreaming assertion, one-graph vs per-user graphs | from results.json |
A feature whose row says "not measured" says so in public. A feature that loses its ablation gets reported in "Where we lost".

### The five load-bearing Cypher queries (these go in the README verbatim)
1. **Briefing** — customer profile + last 3 tickets + 5 most similar resolved tickets with their resolutions (match on shared `Issue`, order by recency; fall back to vector sim on `Ticket.body` embedding if no Issue link yet — FalkorDB vector index).
2. **Likely cause** — `(t:Ticket)-[:ABOUT]->(:Issue)<-[:INTRODUCED]-(r:Release)` with the temporal filter.
3. **Who knows this** — top agents by `count((a)-[:SOLVED]->(:Ticket)-[:ABOUT]->(i))`.
4. **Emerging clusters** — community detection (`algo.labelPropagation` / CDLP per FalkorDB algorithms docs — verify exact proc name against docs on day) over the last 7 days' Ticket–Issue subgraph; return top communities by growth.
5. **Blast radius** — for a Release: affected customers, segments, open ticket count (Track 01 "actions based on what the graph shows": agent drafts an incident note for the owning Team).

---

## 2 · Synthetic dataset generator (`gen/`)

Deterministic, seeded (`--seed 42`), outputs `data/*.json` + `load.ts` that writes the graph. Fictional broker: **E Corp Securities** (chosen 2026-10-18; a nod to *Mr. Robot*'s fictional conglomerate — name only, no logos or characters; not the employer's, nothing confusable with a real Indian broker).

- 150 Customers (60% retail / 30% premium / 10% HNI; 8 Indian cities; language mix en/hi + 2 regional — a few ticket bodies in Hinglish for flavor)
- 8 Releases over 90 days; **2 are "bad releases"** that each INTRODUCE 1–2 Issues and cause ticket spikes in the following week (this is what makes multi-hop questions have real answers)
- 18 Issues across 6 ProductAreas, 4 Teams, 6 AgentUsers
- 400 Tickets over 90 days: body text templated per Issue with noise; 70% resolved with Resolution (→ KBArticle where kind=fix/info); 12% repeat-contact chains via `FOLLOWS`
- 25 KBArticles (3 deliberately stale — superseded by a Release) with doctrine claim props (`promised_tat_hours`, documented steps) — the stale ones exist to be caught by the mismatch engine; plus 2 widely-used workarounds that appear in resolutions but in no KB (→ UNDOCUMENTED)
- **10 contradiction events** with timestamps (plan upgrades, "Issue fixed in vX.Y") → drives the staleness test
- `gen/eval.ts` emits **50 questions + ground truth** from the same seed: 20 single-fact, 20 multi-hop, 10 structural. Ground truth is computed from the JSON, not the graph, so the graph is being tested, not trusted.

Same JSON feeds all four baselines (fairness: identical information available to each).

---

## 3 · Benchmark harness (`bench/`)

One file per retriever, one runner, one `results.json` the blog reads.

| id | retriever | implementation sketch |
|---|---|---|
| A | stuff-everything | concat all tickets+KB into prompt (truncate at context limit, record that) |
| B | vector top-k | embed ticket bodies + KB (store vectors **in FalkorDB's vector index** — still one DB, but retrieval ignores edges); k=8 chunks |
| C | file memory (Devin spec) | `memory/MEMORY.md` index + per-area `.md` notes generated from the same JSON by an LLM "dream" pass; retrieval = load MEMORY.md, model picks files, read them. Nightly dream = LLM rewrites files (count those tokens as maintenance cost) |
| D | graph | the five Cypher queries; prompt gets only query results + the path taken |

**Per question record:** `{arch, bucket, input_tokens, output_tokens, retrieval_ms, answer, correct}`.
- Tokens from the provider's usage field (via pi-ai), never estimated.
- Scoring: single-fact = normalized exact-match; multi-hop & structural = LLM-judge against ground truth (judge prompt in repo; judge model ≠ answer model if budget allows, else same model, disclosed).
- **Maintenance run:** replay the 10 contradiction events through C (dream rewrite) and D (invalidation writes); record tokens + whether a post-event question gets the stale or fresh answer. This is the staleness table.
- **Mismatch ablation (Feature Ledger):** graph rules vs LLM-over-text on the 5 planted mismatches; score found/missed/hallucinated + tokens. ~45 min, runs after the main benchmark.
- **Concurrency smoke test (Feature Ledger, ~1h):** N ∈ {1, 5, 10, 25} parallel conversations requesting briefings **while the dream is mid-write**. Record briefing latency p50/p95 per N, throughput, and a consistency assertion: every briefing served during the dream contains either the pre- or post-consolidation fact, never torn state (append-only + valid_until makes this checkable). Second pass: all writes to one graph vs writes spread across user_* graphs (multigraph isolation, measured). Report as single-container architectural behavior, not a scalability claim — but it answers the "real ticket volume" FAQ with numbers.
- One model for all arms, name + ₹/$ per-1M-input stated in results.json; cost = tokens × price.
- `npm run bench` reproduces everything from the seed. Judges can re-run.

**Honesty clauses (also in blog):** baseline C is the open Agent Memory Repo spec, not Devin the product; report the buckets where C/B win; report D's ingestion cost (LLM entity-extraction tokens at load time).

---

## 4 · Agent on Pi Durable (`agent/`)

- `Harness.open(sqlite)` · root conversation = the support channel.
- Extension `mochi-graph`: tools, all `replay: "safe"` (reads) — `briefing(ticketId)`, `who_knows(issueId)`, `blast_radius(version)`, `search_similar(text)`. Each tool returns results **plus the path walked** (the briefing card renders it; "explainable results" is a judged criterion).
- Write tools (`record_resolution`, `retire_fact`) — **no replay** (crash → model is told the call was interrupted, decides; never silently repeated).
- **Dream** = Pi Durable background task (`ownership: conversation, background: true`), timer-scheduled: ingest the day's tickets (LLM entity extraction → MERGE Cypher), run community detection, promote repeated resolutions into ObservedPatterns, apply invalidation, **run the mismatch rules** (doctrine vs practice → Suggestion nodes), write the morning briefing into a **document** (`defineDoc`) that a `section()` injects into the system prompt — so the agent literally wakes up knowing what the dream learned, suggestions included.
- **Living report** = the briefing doc rendered as a small HTML dashboard (reuse the blog's bar components — same aesthetic); every number carries the Cypher that produced it (nao's data-story pattern, our graph). Multiple clients attach to the channel conversation and watch the doc update (Pi Durable multiplayer is native — two-terminal demo costs ~30 min).
- **Shareable stories (amended 2026-10-18, human-approved).** Every story/report has a random id and a link `/r/<storyId>` (versions: `/r/<storyId>@<n>`). Opening a link renders the latest version; every number opens its Cypher. All open tabs update live over WebSocket (the server runs inside the agent process — one process owns the Pi SQLite). Refresh re-runs the stored queries read-only. **`?asOf=<epoch ms>`** re-runs the same stored queries with the as-of temporal filter instead of live, showing what the brain believed at that time — the demo compares a report before and after a dream. No login or per-link permissions (synthetic data; unguessable ids) → `LATER.md`.
- Per-customer episodic writes go to `cust_<id>` graphs (multigraph flex for the demo).
- Surface: TUI borrowed from Pi's coding-agent components (their vacation example shows how) or a minimal web client via `watch()` — TUI is cheaper, pick it.
- **Crash demo:** script that submits a ticket, `kill -9` after first tool call, reopen + `harness.resume()`, same `requestId` → original submission returns. Record as the 15-sec clip.

Hour 1 ritual: point the coding agent at `packages/durable` README + the 30 examples + the vacation planner before writing any agent code.

---

## 5 · Schedule (IST) — now → deadline

| when | what | done means |
|---|---|---|
| Sat 12:30–14:30 | repo, Docker FalkorDB, Pi checkout, agent reads durable examples | harness opens, trivial tool runs |
| Sat 14:30–17:30 | generator + loader + eval emitter | graph visible in FalkorDB Browser, counts match spec |
| Sat 17:30–20:30 | the five Cypher queries, tuned in Browser | each returns correct answer for 3 spot-checked cases |
| Sat 20:30–24:00 | agent tools + briefing card + TUI | end-to-end: ticket in → briefing with path out |
| Sun 00:00–02:00 | dream task + invalidation + morning briefing doc | dream run mutates graph correctly on contradiction events |
| — sleep — | | |
| Sun 09:00–13:00 | benchmark: A–D + runner + judge → results.json | `npm run bench` green, numbers sane |
| Sun 13:00–14:30 | concurrency smoke test + crash-test script + record clips (crash, briefing, dream) | numbers in results.json, 3 clips on disk |
| Sun 14:30–17:30 | blog: real numbers in, write decisions 05–06 + losses + bill, animation polish | no TODO markers left except load-test FAQ |
| Sun 17:30–19:30 | README (graph model + Cypher + setup), deploy (Fly/Railway; else airtight local steps), demo video (≤3 min: problem 20s → briefing 45s → crash 15s → dream + mismatch suggestion 30s → two terminals steering the living report 20s → benchmark 40s) | a stranger can run it |
| Sun 19:30–21:30 | submission form (all 3 tracks named, AI use disclosed), blog published | submitted |
| Sun 21:30–23:59 | buffer | — |

**Cut order if behind (pre-decided, in order):** clustering ablation → concurrency second pass (keep the N-sweep + consistency assertion; cut the one-graph-vs-many comparison) → teach tool → feedback tool → two-terminal demo → per-customer/user-tier graphs (keep company + one team graph) → mismatch ablation (the ledger row then says "not measured") → baseline B → TUI polish (fall back to CLI) → dream clustering (keep invalidation + mismatch rules — deterministic and cheap). Never cut: briefing query + path display, mismatch suggestions in the briefing, benchmark A/C/D, crash demo, README Cypher, the Feature Ledger itself (honest "not measured" rows are allowed; missing rows are not).

---

## 6 · Risk register
- **Pi Durable learning curve** → timebox: if the harness isn't running a tool by Sat 15:00, fall back to a plain TS loop with a JSON checkpoint file (lose multiplayer, keep crash-resume story honest about being hand-rolled).
- **FalkorDB algo proc names** differ from Neo4j GDS → verify `algorithms` docs before writing query 4.
- **LLM-judge flakiness** → pin temperature 0, 3-vote majority on disagreements only.
- **Benchmark surprises** (graph loses a bucket) → publish anyway; it feeds "Where we lost" and credibility.
- **Scope creep** → anything not in this spec goes to a `LATER.md`, not the build.
