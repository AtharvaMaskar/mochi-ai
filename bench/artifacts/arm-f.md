# Arm F (TencentDB Agent Memory): not measured

Date: 2026-10-18. This was time-boxed to 60 minutes under `extend-bench` design decision 4. Arm F has no records. The ledger row "TencentDB Agent Memory comparison (arm F)" says "not measured".

## What we checked

We read the npm tarballs and did not install anything.

| Package | Version | What it is |
|---|---|---|
| `@tencentdb-agent-memory/memory-tencentdb` | 1.0.3 | The core and HTTP gateway. It needs Node >= 22.16. |
| `@tencentdb-agent-memory/memory-sdk-ts` | 1.0.0 | The client: `MemoryClient.addConversation`, `searchAtomic` and `searchConversation`. |

The repo is https://github.com/TencentCloud/TencentDB-Agent-Memory. The standalone 1.x server lives on the `feat/server` branch.

## Which step failed

Step (b) needs a programmatic add/search API that bench can meter. That step failed. The package has no embedded library that runs in-process. The memory pipeline runs inside a separate gateway process, `src/gateway/server.ts`, and bench would talk to it over HTTP.

That gateway runs its own extraction LLM calls for facts, scenes and persona. It configures them through `TDAI_LLM_*` against an OpenAI-compatible endpoint. Those calls never pass through `bench/llm.ts`, which causes three problems:

- **Unmetered tokens.** SPEC §3 requires every token to come from provider usage through pi-ai. We could not read the gateway's extraction tokens, so F's ingestion cost would go unreported.
- **No cost cap.** The `--max-usd` cap could not stop spend made inside the gateway.
- **Unpriced models.** The gateway's models are not in `bench/prices.ts`.

There were also practical blockers. The documented standalone setup clones the repo for `tdai-gateway.standalone.yaml`, which is not in the npm tarball. The 1.x line is beta.

A run whose ingestion cost we cannot measure would put an unmeasured number next to measured ones. So we skipped it instead of faking it.

## What would make it measurable

Point the gateway's `TDAI_LLM_BASE_URL` at a local proxy that forwards to Anthropic's OpenAI-compatible endpoint. The proxy records each response's `usage` into bench's meter. Arm F then ingests each ticket thread with `addConversation`. It answers from `searchAtomic` top-k with the same answer model as the other arms.
