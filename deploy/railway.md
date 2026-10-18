# Deploy runbook: Railway

Two services in one Railway project:

- **FalkorDB**, from Railway's FalkorDB template. It has a persistent volume and the hosted Browser.
- **app**, this repo's `Dockerfile`. The agent process serves `/` (landing), `/app` (desk), `/blog` and `/api/*`, and owns the Pi SQLite. The same container also runs the sim helpdesk on `localhost:4010` and its webhook listener on `localhost:4011`. These two are internal: the desk reads tickets from the sim, and the listener writes the live tickets into `mochi_company`. Neither needs a public port.

The app reaches FalkorDB over Railway's private network as three ACL users. The `default` user is for the Browser only.

Time: about 15 minutes. Have these ready: a Railway account, the GitHub repo pushed, and your `.env` values.

## 0. Passwords

Make four throwaway passwords (`openssl rand -hex 16`, four times):

| var | user |
|---|---|
| `FALKORDB_PASSWORD` | `default` (admin, Browser) |
| `MOCHI_READER_PASSWORD` | `mochi_reader` (read-only tools, story re-render) |
| `MOCHI_DREAM_PASSWORD` | `mochi_dream` (dream and loader; only writer of `mochi_company`) |
| `MOCHI_DEMO_USER_PASSWORD` | `user_demo` (team, user and customer tier writes) |

## 1. FalkorDB service (template)

1. railway.com, then **New Project**, then **Deploy a Template**. Search "FalkorDB" and pick **FalkorDB** (Single Instance, `railway.com/deploy/falkordb-1`). Do not pick Cluster.
2. If the template asks for `FALKORDB_PASSWORD`, paste yours. Click **Deploy**. Wait for **Active**.
3. Open the FalkorDB service, then **Variables**. Add `MOCHI_READER_PASSWORD`, `MOCHI_DREAM_PASSWORD`, `MOCHI_DEMO_USER_PASSWORD` with your values. The app reads them from here by reference, so each one lives in one place.
4. In **Variables**, set `REDIS_ARGS` to the single line below. If the template already defines it, replace it. This value is the same as `docker-compose.yml`: password, AOF and RDB persistence, and the ACL users.

   ```
   --requirepass ${{FALKORDB_PASSWORD}} --appendonly yes --appendfsync everysec --save 900 1 --save 300 10 --save 60 1000 --user mochi_reader on >${{MOCHI_READER_PASSWORD}} resetkeys ~mochi_company ~team_* resetchannels -@all +GRAPH.RO_QUERY +GRAPH.EXPLAIN +GRAPH.LIST +PING +INFO +CLIENT|SETINFO --user mochi_dream on >${{MOCHI_DREAM_PASSWORD}} resetkeys ~mochi_company ~mochi_company_prev ~algo_scratch ~team_* resetchannels -@all +GRAPH.QUERY +GRAPH.RO_QUERY +GRAPH.EXPLAIN +GRAPH.COPY +GRAPH.DELETE +GRAPH.CONSTRAINT +GRAPH.LIST +PING +INFO +CLIENT|SETINFO --user user_demo on >${{MOCHI_DEMO_USER_PASSWORD}} resetkeys ~mochi_company resetchannels -@all +GRAPH.RO_QUERY +GRAPH.LIST +PING +INFO +CLIENT|SETINFO (~user_demo ~cust_* ~team_* +GRAPH.QUERY +GRAPH.RO_QUERY)
   ```

5. Set `FALKORDB_ARGS` to `THREAD_COUNT 4 MAX_QUEUED_QUERIES 256 TIMEOUT_DEFAULT 30000 TIMEOUT_MAX 60000 RESULTSET_SIZE 10000 QUERY_MEM_CAPACITY 268435456`.
6. Open **Settings**, then **Volumes**, and note the mount path. If it is not `/var/lib/falkordb/data`, add `--dir <mount path>` to the end of `REDIS_ARGS`. Without that, AOF and RDB files are written outside the volume and lost on redeploy.
7. Click **Deploy** to apply the variables. The service redeploys. "Unhealthy" while it deploys is expected.
8. Check it. Open the template's Browser URL (`RAILWAY_PUBLIC_DOMAIN`) and log in as user `default` with `FALKORDB_PASSWORD`. The ACL users are proven in step 3: the loader connects as `mochi_dream`, and it fails with `WRONGPASS` if `REDIS_ARGS` did not apply. With TCP Proxy on, `redis-cli -u "$FALKORDB_PUBLIC_URL" ACL LIST` shows all four users.

## 2. App service (from GitHub)

1. In the same project, click **New**, then **GitHub Repo**, and pick this repo. Railway finds the `Dockerfile` and builds it. The build takes 3 to 5 minutes and the image is about 300 MB compressed.
2. App service, then **Variables**. Add these. The `${{FalkorDB.…}}` syntax references the FalkorDB service. If you renamed that service, use its name.

   | var | value |
   |---|---|
   | `FALKORDB_HOST` | `${{FalkorDB.RAILWAY_PRIVATE_DOMAIN}}` |
   | `FALKORDB_PORT` | `6379` |
   | `FALKORDB_PASSWORD` | `${{FalkorDB.FALKORDB_PASSWORD}}` |
   | `MOCHI_READER_PASSWORD` | `${{FalkorDB.MOCHI_READER_PASSWORD}}` |
   | `MOCHI_DREAM_PASSWORD` | `${{FalkorDB.MOCHI_DREAM_PASSWORD}}` |
   | `MOCHI_DEMO_USER_PASSWORD` | `${{FalkorDB.MOCHI_DEMO_USER_PASSWORD}}` |
   | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (embeddings, text-embedding-3-small) and `MOCHI_ADMIN_TOKEN` | your key |
   | `MOCHI_LOGIN_USER`, `MOCHI_LOGIN_PASSWORD` | the platform sign-in. Defaults are the demo credentials `admin` / `admin@1234`: change them |
   | `MOCHI_SESSION_SECRET` | a long random string (`openssl rand -hex 32`). Unset, it is random at boot and every redeploy signs everyone out |
   | `MOCHI_MODEL` | `claude-haiku-5-5` |
   | `MOCHI_JUDGE_MODEL` | `claude-opus-5-5` |
   | `MOCHI_SQLITE` | `/data/mochi.sqlite` |
   | `PORT` | `4000` |
   | `SIM_SPEED` (optional) | replay speed, default `60` (x real time) |
   | `SIM_START`, `SIM_PAUSED` (optional) | replay start (epoch ms) and start paused (`true`) |

   `SIM_URL` (`http://localhost:4010`), `SIM_API_KEY` (`sim-key`), `SIM_WEBHOOK_URL` (`http://localhost:4011/webhook`) and `SIM_LISTEN_PORT` (`4011`) default to the in-container values. Leave them unset.

   The code connects with host and port (`agent/db.ts`), not a URL. `FALKORDB_PRIVATE_URL` is the same endpoint (`redis://default:…@<private domain>:6379`). It is useful for `redis-cli -u` from another service.
3. App service, then **Settings**, then **Volumes**, then **Add Volume**, mount path `/data`. This holds the Pi SQLite: checkpoints, transcripts and stories. Without it, every redeploy loses the stories and the crash-resume state.
4. App service, then **Settings**, then **Networking**, then **Generate Domain**, port `4000`. That URL is the public site.
5. Deploy. The log line must read `[mochi] http://localhost:4000/ · /app · /blog · /api · dream installed`.

## 3. Seed the graph (once)

Use the Railway CLI. Run it inside the app container, which already has the dataset and the private network:

```
npm i -g @railway/cli && railway login && railway link   # pick the project, then the app service
railway ssh -- node gen/load.ts                           # about 20 s, prints node and edge counts
```

The loader connects as `mochi_dream`, and it is idempotent. Add `--fresh` to rebuild. If `railway ssh` is unavailable, enable **TCP Proxy** on the FalkorDB service. Then run `FALKORDB_HOST=<proxy host> FALKORDB_PORT=<proxy port> npm run load` on your laptop with your `.env` passwords, and disable the proxy afterwards.

## 4. Check it

```
BASE=https://<your-app>.up.railway.app deploy/smoke.sh
```

Every line should start with `200` (`/`, `/app/`, `/blog`, `/api/health`, the desk bundle), except `/api/stories`, which must be `401` without the session. Then open `/app/`, sign in with `MOCHI_LOGIN_USER` / `MOCHI_LOGIN_PASSWORD`, and ask the chat one question.

## Fallback A: FalkorDB Cloud Free + app on Railway

Use this when the template fails. The cost is no persistence, no TLS, and an idle stop after 1 day (deleted after 7). See `docs/falkordb.md` §3.1 and §3.7.

1. Sign up at `app.falkordb.cloud/signup` (GitHub SSO). Go to Subscriptions, Free, then Create instance. Note the host, port, user and password.
2. Create the ACL users. Connect as the instance admin with `redis-cli -h H -p P --user U --pass PW` and run the three `ACL SETUSER mochi_reader …`, `ACL SETUSER mochi_dream …` and `ACL SETUSER user_demo …` commands, with the same rules as `REDIS_ARGS` above (drop the leading `--user`). If Free refuses `ACL SETUSER`, the tier split cannot run there. Use Fallback B.
3. Follow step 2 above without the FalkorDB service. Set `FALKORDB_HOST` and `FALKORDB_PORT` to the Cloud endpoint, and set the four passwords literally. Keep the `/data` volume.
4. Seed (step 3) from your laptop: `FALKORDB_HOST=… FALKORDB_PORT=… npm run load`. Run a keep-alive query before judging. Re-seed if the instance was deleted.

## Fallback B: local production stack (docker compose)

This is also what the demo video is recorded on. It needs Docker (or colima) and a filled `.env` (copy `.env.example`).

```
deploy/smoke.sh                                                    # builds, starts, checks every route
docker compose -f docker-compose.prod.yml exec app node gen/load.ts # seed once
open http://localhost:4100/                                        # landing; /app desk; /blog
docker compose -f docker-compose.prod.yml down                     # add -v to drop the graph and SQLite
```

Host ports are 6380 (FalkorDB) and 4100 (app), so it runs alongside the dev stack on 6379 and 3000.
