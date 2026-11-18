# ADR-004: Effort ceiling and planning lift

- **Date:** 2026-10-29
- **Status:** Accepted
- **Deciders:** Mod owner

## Context

A session that started at `xhigh` spent that effort on ordinary building work. Jev scored some build tasks as `xhigh`. An OMRS documentation subagent ran on Opus at `xhigh` for this reason. Planning work gains from more reasoning; building work rarely does.

## Decision

1. Hold every request at or below `maxEffort` (owner: `high`). This covers the main chat and subagents.
2. Lift planning work to `planningEffort` (default `xhigh`; owner: `high` since 2026-11-03).
3. Planning means plan mode, a prompt that starts with "plan", "plans" or "planning", or an OpenSpec planning command in command form (`opsx:`, `opsx-` or `openspec-` with propose, explore, new, continue, ff, update or verify). Apply, archive and sync are building work. The prose "the OpenSpec change X" does not count.
4. Planning subagents start on the deep tier at the planning effort.
5. Amendment 2026-11-03: the per-chat commands `/router-maxEffort-<level>` and `/router-planning-effort-<level|off>` replace `/xhigh` and `/xhigh-off`. The two command families are independent; the chat ceiling does not cap planning.

## Consequences
### Positive
- Building work does not spend `xhigh` effort.
- Planning gets more reasoning without a manual switch.
### Negative
- A prompt that starts with the word "plan" for another reason gets the planning lift.
### Neutral
- A numeric effort is the caller's own scale and is left alone.

## Alternatives Considered
| Option | Rejected Because |
|--------|-----------------|
| **No ceiling** | Jev and session settings spent `xhigh` on build work. |
| **Match "OpenSpec" anywhere in the prompt** | Subagent briefs name the change in prose and were wrongly lifted. |
| **Keep `/xhigh` as a pin** | It overlapped with `/router-maxEffort-xhigh`. |

## References
- `hooks/policy.ts` (`capEffort`, `isOpenSpec`, `isPlanningPrompt`)
- `hooks/chat.ts` (`ROUTER_COMMANDS`)
