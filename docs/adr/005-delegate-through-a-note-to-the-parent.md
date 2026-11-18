# ADR-005: Delegate through a note to the parent, not mod-spawned subagents

- **Date:** 2026-10-29
- **Status:** Accepted
- **Deciders:** Mod owner

## Context

The main chat keeps its model (ADR-001), so a task Jev rates as cheap still runs on the expensive model. A subagent can run on the cheaper model, but something must start it.

The mod tried two ways. `autoDelegate` let the mod start a subagent with the raw prompt and push its answer back into the chat. `suggestDelegation` adds a hidden note that tells the parent to start a briefed subagent with the Agent tool.

On 2026-11-04 `autoDelegate` sent the prompt "what's the report" to a Sonnet subagent with no conversation history. The confused answer came back into the chat as a new message.

## Decision

1. Delegate only through the note (`suggestDelegation`, default off; on in the owner's settings).
2. Add the note when Jev rates the typed prompt for a cheaper tier than the parent, at `minDelegationConfidence` (0.6) or above, and the task is not risky. Add it only to the user's own prompts.
3. A subagent the main chat starts in a turn that got the note uses the surer of two ratings: the prompt's or its brief's. It may move down at `minDelegationConfidence` in place of `minDowngradeConfidence`, because a new subagent has no cache to lose.
4. Delete `autoDelegate` and its settings (`autoDelegate`, `minAutoDelegateConfidence`, `minAutoDelegateChars`, `relaySubagentAnswer`) on 2026-11-04.

## Consequences
### Positive
- The parent writes the brief with the context it has.
- The subagent's result comes back as a normal Agent tool result.
### Negative
- The parent can ignore the note.
- The subagent sees only the brief, not the chat history.
### Neutral
- A short reply ("yes", "do it") is answered by the parent; the note says so.

## Alternatives Considered
| Option | Rejected Because |
|--------|-----------------|
| **`autoDelegate` (mod spawns and relays)** | No history in the subagent; a confused answer was pushed into the chat. |
| **Switch the main chat's model for the turn** | It drops the prompt cache (ADR-001). |

## References
- `hooks/policy.ts` (`cheaperModel`, `delegationNote`, `moreConfident`)
- `hooks/router.ts` (`prompt.submit`, `agent.spawn`)
- Backup before the deletion: `~/.agents/backups/mods-20261104/`
