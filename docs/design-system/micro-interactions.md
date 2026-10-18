> Binding for every Mochi Brain surface (desk, chat, reports, landing). Adapted from the MochiAI design system's MicroInteractions card; keyboard-shortcut behaviour removed (CLAUDE.md bans shortcut chrome).

# MicroInteractions

Every tap in Mochi Brain is answered within 100 ms, and every answer feels physical: buttons are keycaps, numbers roll, finished work slides away. Built into the components; this card is where to feel them all.

## Buttons are keycaps

| Behaviour | How | Why |
| --- | --- | --- |
| Sink | Pressed, a button drops 1 px and squashes slightly (0.975 × 0.95); its lip presses in. Released, it springs back (260 ms, slight overshoot). | It feels like a real key. |
| Fingertip light | A soft glow blooms from the exact point you pressed and fades over 0.45 s. | The button answers *your* touch, not a generic ripple. |
| Landing | `success="Confirmed"` turns the button into a drawn check and the word for about a second, keeping its width. | You see the decision land. |
| Haptic tick | An 8 ms vibration on decisions (primary, success, hold) where the device supports it; `haptic={false}` turns it off. | Tablets and phones feel the click too. |
| Hold | `hold={700}` fills the button while held; letting go early cancels. | Weighty actions (overturn, escalate) can't happen by accident, and finishing one feels deliberate. |
| Loading | `loading` shows a quiet shimmer and blocks double taps. | Waiting is visible but calm. |
| Disabled, but honest | `disabledReason` keeps the button tappable: a tap shakes it gently and shows the reason underneath. | No dead buttons, ever. |

## Everything else

| Interaction | Where | What happens |
| --- | --- | --- |
| Press | `Segmented`, `Timestamp`, island buttons, `MochiAction`, cards, `TicketRow` | Dips on press and springs back; bigger surfaces dip less (cards 0.975, rows 0.994). |
| Sliding selection | `Segmented` | The highlight glides to the chosen option (320 ms spring). |
| Selecting a ticket | `TicketRow` | The ink edge grows from the centre (280 ms). |
| A handled ticket leaves | `TicketRow` with `leaving` | It slides left and fades, then the list closes the gap (420 ms); `onLeft` removes it. |
| Numbers roll | `RollingNumber`, `TodayRing` | Digits roll like an odometer when a count changes. |
| Timestamp | `Timestamp` | A soft ring ripples out; ▶ becomes three playing bars for 0.9 s. |
| A tag lands | confirmed tags | Pops in (340 ms spring). |
| Not yet | `shake(el)` | A 3 px shake, always with words saying why. |
| Mochi | every `Mochi`, everywhere | Tap it and it squishes like jelly from its base; each tap restarts it. A delight, never required (`squishable={false}` opts out). |

## Satisfying, not addictive

Mochi Brain should become a habit because every action feels crisp and finished, never because it pulls the agent back compulsively.

- **Reward completion and progress** (a ticket handled, the ring filling, a catch), never speed. Confirming fast must never feel better than confirming right: that is rubber-stamping.
- **No variable rewards on decisions:** no random sparkles, combos, streak pressure or points for verdicts.
- **No interface sounds.** the agent works in headphones listening to calls; UI sounds would compete with the audio she's judging.
- **Never slow the work:** feedback runs alongside the action, never before it.
- **Reduced motion:** sinks, slides, rolls and squishes switch off; colour, the check, the words and haptics remain.

## Mochi Brain additions

| Interaction | Where | What happens |
| --- | --- | --- |
| Receipt opens | every `NumPill`, KPI, chart mark | Press dips the pill; the popover grows from the pill (180 ms, origin at the pill), Cypher types in line by line (no more than 300 ms total). |
| Path draws | `PathReceipt` | Pills appear left to right with the edge line drawing between them (60 ms stagger), once per card. |
| Brief fills | `MochiBrief` while a tool runs | Shimmer lines, then content rises 6 px and fades in, staggered 0.08 s. |
| Live update | report or chat block when a watched story changes | The changed number rolls; the block's edge flashes `agent-sky` once (600 ms). |
| As-of | `AsOfBanner` toggling | The page cross-fades between now and then (240 ms); numbers roll to their as-of values. |
| Dream runs | `PipelineFlow`, `MochiIsland` | Mochi on the rail moves step to step; a step's check draws as it finishes. |
