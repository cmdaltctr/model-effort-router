# ADR-002: Subagents are routed once at spawn; forks are left alone

- **Date:** 2026-10-29
- **Status:** Accepted
- **Deciders:** Mod owner
- **Amended by:** ADR-007 (a model the parent names is kept; Fable is off limits)

## Context

Subagents inherited the parent's model, so simple subagent work (a browser check, a file count) ran on Opus. A subagent starts with an empty context, so a cheaper model costs it no cache. A fork shares its parent's context and cache, and Claude Code ignores a model set for a fork.

## Decision

1. At `agent.spawn`, ask Jev once and set the subagent's model (`routeSubagentModel`, on in the owner's settings).
2. Keep the decision under the subagent's `agentId`. Apply its effort at each `turn.step` of that subagent. The model and effort do not change during the subagent's run.
3. Do not route forks. A fork keeps the parent's model and effort.
4. Planning subagents (the `Plan` type, plan mode, or a planning turn) start on the deep tier. See ADR-004.

## Consequences
### Positive
- Simple subagent work runs on Haiku or Sonnet.
- A subagent's model and effort are stable for its whole run.
### Negative
- A wrong rating at spawn stays for the whole run.
- Each spawn waits for one Jev call (up to 800 ms).
### Neutral
- A model the caller named was treated as a starting point that Jev could lower. ADR-007 changes this.

## Alternatives Considered
| Option | Rejected Because |
|--------|-----------------|
| **Route at every subagent request** | The model would change under the subagent's own tool loop. |
| **Route forks too** | Claude Code ignores the model for a fork, and a change would lose the shared cache. |
| **Leave subagents on the parent's model** | Simple work ran on Opus. |

## References
- `hooks/router.ts` (`agent.spawn`, subagent branch of `turn.step`)
- `hooks/policy.ts` (`route`, `agentDecisions`)
