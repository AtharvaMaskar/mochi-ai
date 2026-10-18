> Local snapshot of the MochiAI design system (https://claude.ai/artifact/Lckv3ErN9PdC9fo2Fk5pYK), product and persona names generalised. Component reference files stay local (gitignored).

MochiAI is an agent-first QA desk: Mochi listens to every call first, and the agent judges what Mochi brings them. Every screen built on this system answers two questions before anything else: what has Mochi already done, and what needs the agent now. These are reference foundations; teams building their own MochiAI should keep the principles and tokens and are free to reshape the components.

## Principles

1. **Mochi works first, the agent decides.** Lead every view with Mochi's finished work (`MochiBrief`, "Mochi already") and the one decision left (`Button` `primary`). Never show a raw call without Mochi's read of it.
2. **Confirm or overturn, never start from scratch.** Present a verdict with its evidence (`KpiVerdict`, `QueryTypeCard`); each decision is one click and becomes a label Mochi learns from.
3. **Every claim points to its moment.** Anything Mochi says about a call (a flag, a verdict, an event, a reason it got stuck) carries a clickable `Timestamp` that plays the call from there, and `CallTimeline` shows them all on one bar. If the agent can't check it in one click, don't show it.
4. **Confidence in words.** Use `Confidence`: Likely, Possible, Unsure. A bare percentage is never enough.
5. **Mochi's mood is the system's state.** Its colour and motion say what the pipeline is doing (see the Mochi component). Severity is never Mochi's job: alarms are `Signal`s.
6. **Admit what's unfinished.** When Mochi can't decide, use `NeedsYou` with the exact reason and a way in.

## Voice

Mochi speaks in the first person, plainly, in sentences under 15 words: "I found the closing at 06:12." Events are past tense with Mochi as subject: "Mochi flagged a skipped disclosure." Buttons are verbs in sentence case. No exclamation marks in alarms, no emoji anywhere, no cuteness when something went wrong: "Transcription failed at 02:10. Listen from there?" Placeholders the agent must fill stay in caps: `[DATE]`, `[REF]`.

## Colour

Three themes: **Light** and **Dark** for the desk, **Warm** for Mochi's own home screen. On the ticket desk the theme is the agent's choice: Light, Dark or System (following the OS), remembered per browser. Set text in `ink` on `bg-surface`; body copy in `ink-body`; labels and times in `ink-muted`; `ink-faint` is decorative only.

Colour has two jobs and they never mix. **Agent colours** (`agent-sky`, `agent-ube`, `agent-sakura`, `agent-yuzu`, `agent-matcha`, `agent-hojicha`, `agent-anzu`) mean "Mochi": its core, its event dots, its action fill, the drafting border, the aura on Mochi's own surfaces (the brief header and the island's working edge). They are never text and never severity. **Status colours** (`critical`, `warning-ink` with `warning-dot`, `success` with `success-bg`, `success-border`, `success-ink`) mean urgency or outcome and always come with a word. `ring-fill` (pastel green) is the team's colour: the goal ring while it fills, never Mochi's.

**One word, one meaning.** *Overturn* is the only name for rejecting Mochi's verdict. *Unsure* is only a confidence level; a verdict Mochi couldn't make is *Can't tell*. *Cleared* means the agent reviewed a call; a call with no warning signs shows *No signs*.

`border-strong` is kept from the reference at under 3:1, so a control's label carries it. Focus is a 2px solid `focus` ring, at least 3:1 everywhere.

## Type

The desk is set in IBM Plex Sans (`body` 14/1.45, `title` 20 semibold, `label` 13 medium, `eyebrow` and `caption` 12; `noticed` 18/1.35, for Mochi's noticed sentence only). Anything a machine produced (timestamps, call IDs, durations, counts) is IBM Plex Mono (`data`, `data-strong`). Mochi's name and mood word use Instrument Serif (`mochi-wordmark`, `mochi-mood` italic) and its home screen uses DM Sans (`state-label`, `bubble`). All four load from Google Fonts.

## Layout

The desk is three panes under a 48px top bar (`layout-topbar`): the queue (`layout-queue`, 340px, `CallRow`s under a `Segmented`), the call (transcript with `EventLine`s and `KpiVerdict`s), and Mochi's brief (`layout-brief`, 380px). The top bar shows two counts in `data-strong`: "with Mochi" and "need you". Space in `space-*` steps: rows `space-3` by `space-4`, brief sections `space-4` by `space-5`, the call pane `space-5` by `space-6`. Radii: `radius-sm` for controls, `radius-md` for cards; Mochi's silhouette is `mochi-rest`.

**The ticket desk.** A support desk built on MochiAI tags tickets instead of judging calls. Its **Tickets** screen keeps the three panes:
- the list (`layout-queue`): `TicketRow`s under a `Segmented` labelled "Tickets" with Ready · Done today · All received, a one-line description of the view, and an Order control (Newest first · Oldest first, default Newest first, remembered per browser);
- the ticket: its whole conversation as a `TicketThread` (customer messages, replies and internal notes, each marked, as plain text);
- Mochi's brief (`layout-brief`): Mochi's top three `QueryTypeCard`s, "Something else" opening `PathPicker`, and `NeedsYou` when Mochi has no guess.

From 768px, Tickets opens on the first Ready ticket, so the ticket pane is never empty. Rows read unread until the agent opens them in this browser, then quieter; this session's arrivals carry a breathing sky dot until opened, and Show it/them flashes them. It has no greeting and no ring; they live on Overview. The layout is in the Tickets card.

**The top bar**, on every screen, left to right:
- the brand mark: a still `xs` Mochi and "MochiAI" in Instrument Serif;
- `ScreenNav`;
- `MochiIsland` at the centre, which speaks only for Mochi's own work and also carries the undo line; every expansion stays one row inside the bar, growing sideways;
- the offline line and the Theme `select` (System · Light · Dark, default System) at the right.

No counts and no user until the desk has a sign-in.

**Screens.** MochiAI has two screens under one top bar: **Tickets** (`#/`, the default) and **Overview** (`#/overview`). Old links still land: `#/today` opens Overview, and `#/all` opens Tickets on All received. `ScreenNav` moves between them: in the bar after the brand mark from 1180px, in its own row under the bar below that. The bar is the same on every screen, so Mochi's presence and the agent's theme never change with the screen.

**Widths.** At 1180px and wider the desk shows all three panes. From 768 to 1179px it shows the list and the ticket, and Mochi's brief opens as a sheet over the ticket pane (`bg-surface`, `shadow-pop`, closed with Esc). Below 768px it shows one pane at a time (list, ticket, brief) with a back control. The page never scrolls sideways.

**Empty lists.** An empty list says so in one quiet line with an `md` Mochi: "Nothing to tag right now.", "Nothing tagged yet today.". Counts in the Tickets switch, the list and Overview always agree, on Tickets straight after a decision. Nothing in the app says "caught up" while tickets are Ready.

**All received.** Route-and-log made visible: the third view of the Tickets switch lists every ticket Mochi received, skipped and review ones too, newest first, with a search, Outcome (All · Kept · Skipped · Review), Rule, Mochi and Decided selects, and "Show more". Skipped and review rows are `TicketRow`s with `status` `skipped` or `review` and the rule in Mochi's words. A kept ticket opens in the ticket view; a skipped or review ticket opens as `SkippedTicket`: Mochi's reason first, then its conversation. Its empty line is "No tickets match.".

## Dashboard

The dashboard opens with `MochiGreeting` above `PipelineStages`. The greeting has three lines: a hello that varies by time and context, a headline of what needs the agent (same shape every day), and a receipt of what Mochi did, a recap since their last visit on the first open of the day and live work after that. Its hello bank and rules live with the component. Its numbers and the stage counts come from the same source and must agree.

**The ticket desk's Overview** (`#/overview`, the team lead's view) is this dashboard for tickets. It's one column on `bg-page`, at most 1280px wide, with the call pane's padding (`space-5` by `space-6`; `space-4` below 768px). It holds:
- a row of three tiles: the greeting (`MochiGreeting`, `unit="tickets"`, recap on the first visit of the day, two columns wide, Mochi held `still`, action "Open the tickets"), the goal ring (`TodayRing`), and **Waiting for your team** (the Ready count, "Oldest X", "Open them");
- `TaughtMochi` under the tiles, only when measured;
- `PipelineFlow`, full width, with Jobs and workers in its disclosure.

Every piece is certified from real records, and a piece the data can't support yet is left out. Team progress (`QuestCard`, `ClearDays`, `FridayWrap`) waits for the insights layer. Overview's numbers come from one counts-only endpoint, the same counts Tickets and the island show; it polls every 30 seconds and rolls the counts that change. Below 768px the tiles stack. The layout is in the Overview card.

## Mochi Island

Mochi has one live presence on the desk: `MochiIsland`, a dark pill at the top centre. It is calm by default (`compact`: what Mochi is working on), expands for one thing at a time (a new alarm, a moment playing, a stuck stage, the ring closing) and always returns to calm. It never interrupts the agent while they are checking a moment, and it is only ever Mochi's voice. In production, build it on Cult UI's Dynamic Island with these tokens.

## Progress and celebration

MochiAI rewards the quality of the agent's attention, never its volume. Six pieces, all certified from real records: `TodayRing` (one daily goal: every alarm reviewed), `ClearDays` (a quiet count of same-day-clear workdays that freezes itself on days off), `QuestCard` (one to three daily quests that are QA hygiene), `TaughtMochi` (their corrections shown as Mochi's measured improvement), `CatchCard` (milestones in their notebook) and `FridayWrap` (the week in four honest numbers).

- Reward catches, coverage and judgement. Never calls per hour, time in app, or speed.
- No failure states: a missed day is a grey square and a quiet restart, never red, never a warning.
- No leaderboards and no comparisons with anyone, including the agents they review.
- Mochi grows because of them: its improvements are measured, never invented.
- `Celebration` (confetti plus Mochi's hop) is for milestones only: the ring closing, a new catch, a first-time Friday milestone. At most a couple of times a day.
- On the ticket desk, the goal ring lives on Overview. When the last Ready ticket is decided on Tickets, `Celebration` plays there and the island says "Every ticket today has a person’s decision.", once per IST day per browser.
- The test for any new mechanic: would we celebrate the agent for finishing faster with the same catches? If the mechanic wouldn't, cut it.

## Motion

Every click answers within 100 ms: controls dip on press and spring back on release, decisions morph briefly into a drawn check and their result, selections slide rather than jump, and a refused click shakes gently with a line saying why. The full set is in the MicroInteractions card; all of it is built into the components.


Motion means Mochi is working, and stops when it isn't. Shimmer and the flowing border mean writing; the sweep fill means an action is running; a drawn check means done; a breathing mark means "with Mochi"; the ping means an alarm. Content enters with a 6px rise over 0.4–0.45s, staggered 0.08s. Everything respects `prefers-reduced-motion`.

## Icons

MochiAI's icon set is **Lucide** (ISC), single-weight and outlined. Rules:
- 16px beside text, at a 1.5px stroke, in `currentColor` (`ink-muted` by default);
- always `aria-hidden` beside a word, and never colour-coded: words and status colours carry meaning;
- an icon-only control always has an `aria-label`.

Mochi and status dots still do most of the work. The drawn check (16px, 1.6 stroke, `success`) and the ▶ in play-from links stay as they are. Today the set carries only what a build uses: `inbox`, `filter`, `person` and `check`, PipelineFlow's step marks, available as `Icon`. Add an icon by its Lucide node data, never by drawing a new one. Empty-state illustrations come with the design audit.
