# Pi Durable 1.3.0 — verified API notes (pi-durable / pi-ai / chord 1.3.0, 2026-10-18)

Source: `github.com/earendil-works/pi` @ tag `v1.3.0` — `packages/durable/README.md`, `docs/spec.md`,
32 examples in `packages/durable/test/examples/`. **Read examples at the tag, not main**: main
documents unreleased features (`sleepUntil`, `wake()`, `restartLimit`, `retryTask`, schema v2).
No "vacation planner" example exists. Node ≥22.19 (uses `node:sqlite`).

## Harness, conversations, submit, resume
- `Harness.open(storage, {models, registry, settings?, env?}, ctx)`; storage = `openNodeSqliteStorage(path)` from `@earendil-works/pi-durable/storage/sqlite/node`.
- `harness.root(ctx, {agent})`, `harness.createConversation({ownership:{kind:"ownerless"}, agent?, init?}, ctx)`, `harness.conversation(id, ctx)`, `conv.fork(entryId, …)`.
- `conv.submit({type:"input", content, requestId?, whenBusy?: "steer"|"followUp"|"reject", entry?}, ctx)` → `Submission`; `.wait(ctx)` → `{status:"done", answer: EntryId}` | `{status:"unanswered", reason, detail}`.
- **Idempotency:** same `requestId` → same submission, across restarts. `harness.submission(id, ctx)` reacquires.
- **Crash:** reopen same file + `harness.resume()` (sync). Partial output committed every 100 ms. One process per storage (no cross-process lock).

## Tools / extensions
- `defineTool({name, description, parameters: Type.Object(...), execute(args, api, ctx) => {output?, structuredOutput?, details?, usage?, control?}, replay?: "safe"|"unsafe", ...})`.
- `defineExtension({name, tools, sections, hooks, wraps, tasks})` → `createRegistry().install(ext)`.
- Each tool call = durable task; intent committed before `execute()`. Default `unsafe`: on crash the model gets "Tool X was interrupted by a restart and may have partially run". `safe` re-runs on reopen — must be idempotent (key writes on `api.taskId`). Thrown errors → error result.

## Per-conversation loadouts
`conv.configure({tools, modelTools?, extensions:{add|remove}, instructions, model}, ctx)` (same as `agent:` on create/root; `null` resets). Read-only mode pattern: `27-plan-mode.ts`. Resolve: `(await conv.agent(ctx)).tools`.

## Background tasks / timers
- `defineTask<I, S extends {phase}, R>({name, version, initial, phases:{p:(task, runtime, ctx)=>…}, abort})`; create in a commit: `tx.createTask(Def, input, {ownership:{kind:"conversation"}, background:true})`.
- Each phase ends `runtime.commit(tx => …)` returning `{status:"running", checkpoint}` | `{status:"waiting", on, policy}` | `{status:"terminal", outcome}`. `runtime.memo(name, value?)` guards side effects.
- **No cron in 1.3.0**: loop = commit next checkpoint → `runtime.sleep(absUntil, ctx)`; keep `until` in the checkpoint (phase reruns after restart).
- Patterns: `12-tasks.ts`, `13-recovery.ts`, `23-subagent-background.ts`.

## Documents
- `defineDoc<T>({kind, version, scope:"conversation"|"session"|"task", history:"latest"|"rewindable", fork, initial})`.
- Write: `conv.commit(async tx => { (await tx.doc(Doc, convId)).x = … })` (tools: `api.commit`). Read: `harness.snapshot(Doc, id, ctx)`.
- Prompt injection: `section("key", async (input, ctx) => …input.read.snapshot(Doc, input.conversationId, ctx)…)` → `<key>…</key>`; `undefined` omits; only changed sections resent (`11-extension-state.ts`).
- Live: `harness.watchDoc(Doc, id, ctx).start(async (value, ops) => …)`, `conv.watch(ctx)`, `conv.viewState(ctx).subscribe`.
- Multiplayer = N watches in the owning process, fan out to clients yourself (WebSocket). Late joiners get current view (`21-late-join.ts`). Concurrent submits queue in `pi.inbox`. `{type:"write", entry:{kind:"chat.msg", data}}` appends without a model call.

## pi-ai
- `createModels()` + `models.setProvider(anthropicProvider())` (`@earendil-works/pi-ai/providers/anthropic`) or `builtinModels()` from `/providers/all`.
- Env: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, … (table: `packages/ai/README.md:454-500`).
- One-shot: `await models.complete(models.getModel("anthropic","claude-sonnet-5-5")!, {systemPrompt, messages:[{role:"user", content, timestamp:Date.now()}]})` → `AssistantMessage`; `completeSimple(model, ctx, {reasoning})`.
- **Usage:** `msg.usage = {input, output, cacheRead, cacheWrite, reasoning?, totalTokens, cost:{…,total}}` — tokens from provider; `cost` from pi-ai catalog prices (not billing). Harness: `entry.model[0].usage`, `pi.usage` doc, `harness.usage(ctx)`.
- Faux provider for tests: `@earendil-works/pi-ai/providers/faux`.

## chord
Pi Durable's doc/replication layer. We need only `BACKGROUND_CONTEXT` from `@earendil-works/chord/context` (every call takes a ctx); maybe `/delta` for browser-side doc ops. Transitive dep.

## TUI / web
`@earendil-works/pi-tui` (Editor, Markdown, SelectList, ScrollView). No web client in examples — closest: `watchEvents()` (`19-json.ts`), `packages/coding-agent/examples/rpc-client.ts`. We build the WebSocket fan-out.

## Minimal snippet
```ts
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { Harness, createRegistry, defineExtension, defineTool, defineTask, defineDoc, AssistantEntry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const Report = defineDoc<{ text: string; at: number }>({ kind: "app.report", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ text: "", at: 0 }) });
const lookup = defineTool({ name: "lookup", description: "Look up a customer", parameters: Type.Object({ id: Type.String() }), replay: "safe",
  execute: async (a) => ({ output: [{ type: "text", text: `customer ${a.id}` }] }) });
const Dream = defineTask<{ every: number }, { phase: "run"; next: number }, null>({ name: "app.dream", version: 1,
  initial: () => ({ phase: "run", next: 0 }),
  phases: { run: async (task, rt, c) => {
    const until = task.state.checkpoint.next;
    if (until > rt.now()) await rt.sleep(until, c);
    await rt.commit(async (tx) => { const d = await tx.doc(Report, task.conversationId!); d.text = "report"; d.at = rt.now();
      return { status: "running", checkpoint: { phase: "run", next: rt.now() + task.input.every } }; }, c);
  } },
  abort: (_t, rt, c) => rt.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c) });

const models = createModels(); models.setProvider(anthropicProvider());
const registry = createRegistry(); registry.install(defineExtension({ name: "mochi", tools: [lookup], tasks: [Dream] }));
const harness = await Harness.open(await openNodeSqliteStorage("./pi.sqlite"), { models, registry }, ctx);
harness.resume();
const root = await harness.root(ctx, { agent: { model: { provider: "anthropic", modelId: "claude-sonnet-5-5" } } });
await root.commit((tx) => tx.createTask(Dream, { every: 86_400_000 }, { ownership: { kind: "conversation" }, background: true }), ctx);
const sub = await root.submit({ type: "input", content: "Brief me on C-42", requestId: "ticket-42" }, ctx);
const s = await sub.wait(ctx);
```

## Unverified / watch out
- Creating `Dream` each process start duplicates it — store its task id in a session doc, check first.
- `task.conversationId` inferred from types, untested.
- Whether `runtime.sleep` in a background task makes the conversation look busy in 1.3.0 (main replaced it with `sleepUntil` for this reason). Alternative: trigger the dream from an external timer / "run dream now".
- No browser wire protocol — build our own WebSocket fan-out.
