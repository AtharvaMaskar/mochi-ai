# Demo video: script and shot list

Mochi Brain, Graph Hacks submission. Cap: 3:00. Beats follow SPEC §5 (problem 20s, briefing 45s, crash 15s,
dream and mismatch 30s, two tabs 20s, benchmark 40s). We take the 10 seconds left over for the tiers shot
(SPEC §1 memory tiers, Feature Ledger "tier isolation").

Every benchmark figure is a `[BENCH: field]` placeholder. It is filled from `bench/results.json` on the
recording day, and the overlay is typed from the file, never from memory. If a field is null or a row is
missing, the overlay says "not measured" and the voice-over says why, using the matching `ledger[]` row.

Placeholder shorthand: `per_task[haiku,D]` means the `per_task[]` row with `model_id = claude-haiku-5-5` and
`arch = D`. Arms: C = markdown file memory, D = graph, E = SQLite, F = TencentDB Agent Memory.

URLs below are local (`npm run dev`: agent on :4000, ui on :5173). On the deployed site, the desk is
`/app#/…` and the landing is `/`. FalkorDB Browser is http://localhost:3000.

## Shot list

| time | on screen (URL or route, exact click) | voice-over | overlay |
|---|---|---|---|
| **0:00–0:05** hook | `localhost:5173/#/` Tickets, Ready view. The sim clock is running. A new row slides in at the top. Click it. The brief fills in with path pills and a "Likely" confidence word. | This ticket arrived four seconds ago. Mochi already knows the customer, the likely cause and who fixed it last time. | `New ticket → brief in [BENCH: per_task[haiku,D].p50_ms] ms` |
| **0:05–0:20** problem | Landing page, `/` (landing dev server), hero at the top. Scroll slowly so the sky moves from day toward dusk. Stop on the hero brief fragment. | Support agents start every ticket from zero. The answer is in last month's tickets, but nobody can see how they connect. We put the company's memory in one graph. Every answer shows the path it took. | `Mochi Brain · Tracks 01, 02, 03` then `E Corp Securities is fictional. All data is synthetic, seed 42.` |
| **0:20–0:32** live arrival (Track 01) | Split screen. Left: terminal tailing `npm run dev`, showing the sim webhook line and the listener's upsert. Right: `localhost:5173/#/`, the island reads "I'm reading new tickets". The new row appears in Ready with its guess and confidence. | Tickets come from a simulated helpdesk shaped like Freshdesk. It fires a webhook. We fetch the ticket and write it to FalkorDB. | `sim → webhook → fetch → FalkorDB` |
| **0:32–0:45** the brief | Click the demo ticket (`$DEMO_TICKET`, see checklist). The brief shows: customer header, earlier tickets, similar resolved tickets, likely cause, who knows this. Hover the path pills: `Ticket → ABOUT → Issue ← INTRODUCED ← Release`. | The brief is five hand-written Cypher queries. Same issue, the release that introduced it, the agent who solved it before. The pills are the path the query walked. | `Path receipt: Ticket → ABOUT → Issue ← INTRODUCED ← Release` |
| **0:45–0:53** a number opens its Cypher | In the brief, click the median resolution figure. The receipt popover opens: query id, graph `mochi_company`, Cypher, params, `ran_at`, `as_of`. Hold 2 seconds on the Cypher. | Every number is a stored query. Click it and you read the Cypher that produced it. The model never types a figure. | `Every number carries its query` |
| **0:53–1:05** the path in FalkorDB | FalkorDB Browser, tab renamed `company`. Paste the path query from the checklist with `$DEMO_TICKET` inlined. Click RUN. Graph result tab. Layout → `Tree`, Direction → `LR`. Click the Ticket node, toggle `Dim`. | The same path, in FalkorDB's own browser. Remove FalkorDB and there is no brief. | `FalkorDB is the memory. Not a cache.` |
| **1:05–1:20** crash and resume (Track 02) | Terminal, full screen, large font. Run `npm run crash-demo -w agent`. The JSON lines scroll: `submitted`, `tool_start`, the parent sends `kill -9`, then `resume`, `settled` with `status: done` and `user_inputs: 1`. | We kill the agent with a tool call in flight. Pi Durable reopens from its SQLite checkpoint. Same request id, same submission, one answer. Memory never lived in the process. | `kill -9 mid-tool → resume → one answer` |
| **1:20–1:30** the dream starts at 02:00 (Track 02) | `localhost:5173/#/overview`. The sim clock (shown in the island) reads 01:59 IST. It ticks to 02:00. The island walks the steps: ingest, cluster, retire, mismatch, report. | At two in the morning the brain dreams. It reads the day's tickets, groups them, retires facts that no longer hold, and checks what we say against what we do. | `02:00 IST · dream` then `ingest → cluster → retire → mismatch → report` |
| **1:30–1:42** a fact retired, `?asOf=` before and after | Two browser windows side by side. Left: `localhost:5173/#/r/$REPORT_ID?asOf=$BEFORE_MS`, the as-of banner on top, the likely-cause block naming the release. Right: `localhost:5173/#/r/$REPORT_ID`, live, the same block now shows the fact as retired. Click the number on each side: both popovers show the same Cypher, with different `as_of`. | Release `$RETIRED_RELEASE` was fixed last night. We did not delete that fact. We closed it with a timestamp. The same stored query, read as of yesterday, still shows what we believed then. | `Same query. Left: as of yesterday. Right: now.` and `valid_until = timestamp()` |
| **1:42–1:50** the mismatch suggestion (Track 03) | Right window, scroll to the suggestion block. It names a KB article, its promised hours, the measured hours, the support count and ticket ids. Click the measured figure to open its receipt. | The KB promises one turnaround. The tickets show another. That gap is arithmetic in Cypher, not a model's guess. The model only writes the sentence. It goes to the owning team as a suggestion, never applied on its own. | `Doctrine vs practice: promised [from receipt] h, measured [from receipt] h` |
| **1:50–2:10** two tabs, one living report | Two windows on the same `localhost:5173/#/r/$REPORT_ID` (live). In a third, small window, `localhost:5173/#/overview`, click "Run dream now" (the sim has released the morning's tickets since 02:00). Both report windows re-render to the next version together. The version label goes from `@n` to `@n+1`. | Two people, two tabs, one report. The dream commits a new version and both tabs update over the socket. Reloading re-runs the stored queries, read-only. The report is a link anyone can open. | `/r/<id>@n → @n+1, live in both tabs` |
| **2:10–2:20** tiers, enforced by the database (Track 02) | FalkorDB Browser: click through the tabs `company`, `team_funds`, `user_demo`, `cust_<id>`; each shows its Graph Info counts. Cut to terminal: run the three refusal commands from the checklist as `mochi_reader`. Each prints `NOPERM` or the RO rejection. | Each tier is its own graph. The reader account can only read. A prompt-injected write is refused by FalkorDB, not by our prompt. Judges can ask Claude the same graph through the FalkorDB MCP server, read-only. | `mochi_reader: GRAPH.QUERY → NOPERM` and `.mcp.json → @falkordb/mcpserver, read-only` |
| **2:20–2:35** benchmark headline | Landing page `/#bench`. Hold on the per-task table. Rows: graph (D), markdown (C), SQLite (E), TencentDB (F), each on Haiku. | Same questions, same data, four memory designs. Per task, the graph costs [BENCH: per_task[haiku,D].cost_usd_mean] dollars and answers in [BENCH: per_task[haiku,D].p50_ms] milliseconds at the median. Markdown memory costs [BENCH: per_task[haiku,C].cost_usd_mean]. SQLite costs [BENCH: per_task[haiku,E].cost_usd_mean]. TencentDB: [BENCH: per_task[haiku,F].cost_usd_mean, or the ledger's "not measured" reason]. | `Cost per task: graph [BENCH: per_task[haiku,D].cost_usd_mean] · markdown [BENCH: per_task[haiku,C].cost_usd_mean] · SQLite [BENCH: per_task[haiku,E].cost_usd_mean] · TencentDB [BENCH: per_task[haiku,F].cost_usd_mean]` and `p50: [BENCH: per_task[haiku,D].p50_ms] / [BENCH: per_task[haiku,C].p50_ms] / [BENCH: per_task[haiku,E].p50_ms] / [BENCH: per_task[haiku,F].p50_ms] ms` |
| **2:35–2:48** Haiku vs Sonnet | Same section, the model sweep rows: Haiku on graph next to Sonnet on markdown. | Can a small model on a graph keep up with a big model on notes? Haiku on the graph scores [BENCH: per_task[haiku,D].accuracy] at [BENCH: per_task[haiku,D].cost_usd_mean] per task. Sonnet on markdown scores [BENCH: per_task[sonnet,C].accuracy] at [BENCH: per_task[sonnet,C].cost_usd_mean]. | `Haiku + graph: [BENCH: per_task[haiku,D].accuracy] @ [BENCH: per_task[haiku,D].cost_usd_mean]` vs `Sonnet + markdown: [BENCH: per_task[sonnet,C].accuracy] @ [BENCH: per_task[sonnet,C].cost_usd_mean]` |
| **2:48–3:00** where we lost, close | Same section, scroll to the Feature Ledger and the "where the graph lost" rows. End card: repo URL, blog URL, `npm run bench` reproduces every number from seed 42. | We publish where the graph lost too. Every number here comes from one file, and one command reproduces it. Context for agents should live in a graph, with the path shown. | `Graph lost on: [BENCH: the bucket(s) from summary where D's accuracy is below another arm's]` then `npm run bench · seed 42 · Tracks 01 · 02 · 03` |

Track coverage, said out loud: Track 01 at 0:20 (connected data, path receipts, Cypher on every number).
Track 02 at 1:05 and 2:10 (crash-resume, dream, temporal memory, tiers per tenant). Track 03 at 1:42
(doctrine vs practice, one company graph, answers with sources). The overlay at 0:05 names all three.

## Pre-recording checklist

### Browser profile
- [ ] A fresh Chrome profile named `mochi-demo`. No extensions, no bookmarks bar, no signed-in avatar.
- [ ] Zoom 110% on the desk and the report, 100% on FalkorDB Browser. Window size 1920×1080, or two
      960×1080 windows for the split shots.
- [ ] Notifications off at the OS level. Do Not Disturb on. Dock hidden.
- [ ] Clear site data for `localhost:5173` and the landing port once, so the island and tabs start clean.

### FalkorDB Browser, styled from tokens
Styles are stored per browser and per connection (docs/falkordb.md Part C §1.7), so set them in the
`mochi-demo` profile itself.
- [ ] Log in at http://localhost:3000 with the admin (`default`) user and `$FALKORDB_PASSWORD`, so every
      tier graph is visible. The refusal shot uses `mochi_reader` in the terminal, not the Browser.
- [ ] Open four tabs and rename them (pencil icon): `company` → `mochi_company`, `team_funds`,
      `user_demo`, `cust_<id>` (the demo ticket's customer).
- [ ] Graph Info → palette icon per label. Hex values come from `docs/design-system/tokens.json`, light theme:
      `Ticket` ink `#101828` · `Issue` critical `#B42318` · `Release` warning-dot `#C27A00` ·
      `Customer` agent-sky `#7FAEE6` · `Resolution` success `#2F7D4F` · `KBArticle` agent-ube `#A99BE0` ·
      `AgentUser` agent-matcha `#8DBF7A` · `Team` agent-hojicha `#B0907A` · `ProductArea` ink-muted `#5D6675` ·
      `ObservedPattern` agent-anzu `#F2A27A` · `Suggestion` agent-sakura `#F2A7B5`. Edges: ink-faint `#98A2B3`.
      Node size 1.25x for Ticket, Issue and Release.
- [ ] Settings → User Experience → Captions Keys: `id`, `version`, `name`, `title`. Key prefix off.
- [ ] Theme: Light. The Browser's Chat panel stays closed.
- [ ] Paste the path query into the `company` tab once, so it is in query history:

```cypher
MATCH p1 = (t:Ticket {id: '$DEMO_TICKET'})-[:ABOUT]->(i:Issue)<-[:INTRODUCED]-(:Release)
OPTIONAL MATCH p2 = (i)<-[:ABOUT]-(:Ticket)-[:RESOLVED_BY]->(:Resolution)
OPTIONAL MATCH p3 = (i)<-[:ABOUT]-(:Ticket)<-[:SOLVED]-(:AgentUser)
RETURN p1, p2, p3 LIMIT 12
```

This is a picture of the briefing's MATCH clauses in `agent/queries/index.ts`, not a new product query.
The README carries the real five.

### Reset the demo state (run in order, from the repo root)

```sh
docker compose down -v && docker compose up -d --wait   # empty FalkorDB, ACL users from REDIS_ARGS
rm -f mochi.sqlite mochi.sqlite-*                      # fresh Pi Durable checkpoints
npm run gen -- --seed 42                               # sim world, then data/dataset.json (warm cache: no API calls)
npm run load                                           # history up to replay_start, as mochi_dream
npm run dev                                            # sim, listener, agent :4000, ui :5173
npm run landing                                        # landing; must read the final bench/results.json
```

Then pick the demo values and keep them in the shell:

```sh
# First demo-window ticket about an issue a bad release introduced
DEMO_TICKET=$(jq -r '<filter on sim/data/truth.json: earliest ticket after replay_start whose issue has a live INTRODUCED fact>' sim/data/truth.json)
# The release whose INTRODUCED fact the dream will retire (first issue_fixed event)
RETIRED_RELEASE=$(jq -r '[.events[] | select(.kind=="issue_fixed")][0]' data/dataset.json)
```

Write the exact `jq` filters on the day, against the final `truth.json` and `dataset.json` field names.
Do not guess them here.

- [ ] Before the dream shot: `BEFORE_MS=$(node -e 'console.log(Date.now())')`. Facts are retired with
      `valid_until = timestamp()`, which is wall-clock time, so `?asOf=` must use a wall-clock ms taken
      before the dream runs, not a sim time.
- [ ] After the dream: `REPORT_ID` is the latest morning-report id from `curl -s localhost:4000/api/overview`.
- [ ] Refusal commands for the tiers shot (from docs/falkordb.md Part D §2d):

```sh
redis-cli --user mochi_reader --pass "$MOCHI_READER_PASSWORD" GRAPH.RO_QUERY mochi_company "CREATE (:X)"
redis-cli --user mochi_reader --pass "$MOCHI_READER_PASSWORD" GRAPH.QUERY mochi_company "CREATE (:X)"
redis-cli --user mochi_reader --pass "$MOCHI_READER_PASSWORD" GRAPH.DELETE mochi_company
```

Each must print a refusal. If one succeeds, stop recording: the ACL is wrong.
- [ ] `bench/results.json` is final and passes `validateResults`. Every `[BENCH: …]` above is replaced with
      the value from that file. Copy-paste, do not retype.

### Sim replay clock: seed and speed
- Seed: **42** (the generator default; the eval and the benchmark slice use the same seed).
- Before recording, pause and park the clock just before the demo ticket:
  `POST $SIM_URL/sim/clock {"pause": true, "jump_to": <DEMO_TICKET created_at − 20 s virtual>}`.
- Hook and live arrival shots: `{"pause": false, "speed": 5}`. At speed 5, 20 virtual seconds pass in
  4 real seconds, so exactly one ticket lands on camera. Pause again after the brief shot.
- Dream shot: `{"jump_to": <demo day 01:59:00 IST>, "speed": 60}`. One virtual minute passes in one
  real second; the clock crosses 02:00 IST and the dream starts. If the dream timer does not fire on
  camera, trigger it with `curl -X POST localhost:4000/api/dream/run` at the same moment and say nothing
  different in the voice-over: the run is the same code path.
- Two-tabs shot: `{"speed": 1800}` for 5 real seconds after 02:00 so the morning's tickets arrive, then
  pause, then click "Run dream now".
- `SIM_URL` and the sim's Basic auth come from `sim/` once `add-sim` lands; take them from its README.

### Cross-checks before the final export
- [ ] The landing's chapter markers (`landing/src/sections/Demo.tsx` and `landing/public/chapters.vtt`)
      still use the old times (0, 25, 65, 95, 135, 160 s). They must match this cut: problem 0:00,
      briefing 0:20, crash 1:05, dream 1:20, two tabs 1:50, benchmark 2:20. That edit belongs to the
      landing's owner, through its own change.
- [ ] No real company name, logo or data appears in any frame, terminal history included.
- [ ] Every overlay word passes the CLAUDE.md banned-word list.

## Recording settings
- Capture: 1920×1080, 60 fps, recorded at 2x (Retina) and exported at 1080p. Screen Studio or OBS.
- Cursor: enlarged 1.5x, click highlight on, auto-zoom off (we zoom in the edit, on the brief and the
  popover only).
- Terminal: light theme close to the desk (background `#FFFFFF`, text `#101828`), mono 20 pt, 100×30.
  Clear scrollback before each terminal shot.
- Audio: voice-over recorded separately, USB mic, 48 kHz, −16 LUFS integrated, noise gate on. No music
  under the voice. No sound effects.
- Overlays: added in the edit, humanist sans from the UI, ink on paper, bottom-left, mono only for ids,
  routes and Cypher. One overlay at a time.
- Captions: burn in English subtitles from this script; also upload an `.srt`.
- Export: H.264, 1080p, 12 Mbps, `mochi-brain-demo.mp4`. Poster frame: the 0:45 receipt popover.

## Fallback cut: 90 seconds

Use this if the full cut runs long or a live shot fails twice. Same recording, fewer beats.

| time | shot (from the table above) | voice-over |
|---|---|---|
| 0:00–0:05 | hook | This ticket arrived four seconds ago. Mochi already knows the customer, the likely cause and who fixed it last time. |
| 0:05–0:25 | the brief and the receipt popover | Five hand-written Cypher queries. The pills are the path. Every number opens the query that made it. Tracks 01, 02 and 03. |
| 0:25–0:35 | the path in FalkorDB Browser | The same path in FalkorDB. Remove it and there is no brief. |
| 0:35–0:45 | crash and resume | We kill the agent mid-tool. It resumes from its checkpoint with one answer. |
| 0:45–1:05 | dream at 02:00, then `?asOf=` before and after, then the suggestion | At two in the morning it retires a fact with a timestamp and flags where the KB disagrees with the tickets. The same query, as of yesterday, still shows what we believed. |
| 1:05–1:12 | tiers: the `NOPERM` terminal line | The reader can only read. FalkorDB refuses the write. |
| 1:12–1:30 | benchmark headline | Per task, the graph costs [BENCH: per_task[haiku,D].cost_usd_mean] at [BENCH: per_task[haiku,D].p50_ms] ms, against markdown at [BENCH: per_task[haiku,C].cost_usd_mean], SQLite at [BENCH: per_task[haiku,E].cost_usd_mean] and TencentDB at [BENCH: per_task[haiku,F].cost_usd_mean, or "not measured"]. Haiku on the graph scores [BENCH: per_task[haiku,D].accuracy]; Sonnet on markdown scores [BENCH: per_task[sonnet,C].accuracy]. One command reproduces it. |

The 90-second cut drops the two-tabs shot. That matches SPEC §5's cut order, where the two-terminal demo
is cut before anything above it.
