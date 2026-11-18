# ADR-006: The footer shows the parent; the band shows a viewed subagent

- **Date:** 2026-10-29
- **Status:** Accepted
- **Deciders:** Mod owner

## Context

Subagents run on other models and efforts than the parent. The user wants to see what each one runs on. The footer (`SessionMode`) is not told which transcript is on screen. A first version used the `ui.view` hook, but it did not fire when the user switched transcripts from the tasks list. The `AbovePrompt` band receives `props.view.agentId`.

## Decision

1. The footer always shows the parent's model and effort, as sent.
2. A `⤷` mark shows when the model family or effort differs from the request Claude Code built.
3. When a subagent's transcript is on screen, the band above the prompt shows `⤷ model / effort` for that subagent.
4. Remove the `ui.view` hook and its state.
5. Amendment 2026-11-05 (commit `af4e609`): the band calls `next(e)` and draws its label above any line another mod draws there (for example, worktree-tracker).
6. The Jev status line is off by default (`showStatus`). With it off, the router clears the status each main turn.

## Consequences
### Positive
- The label matches the transcript on screen.
- Other mods can share the band.
### Negative
- Subagent labels are kept after the subagent ends, up to 64, until a new session.
### Neutral
- A request for `SessionMode` to receive the view is filed as anthropics/claude-code#105952.

## Alternatives Considered
| Option | Rejected Because |
|--------|-----------------|
| **`ui.view` hook** | It does not fire on the user's own tasks-list switch. |
| **Show subagents in the footer** | The footer cannot tell which transcript is on screen. |

## References
- `hooks/register.tsx`, `hooks/running.ts`
- Commit `af4e609`
