# ADR-001: One mod; the main chat routes effort only

- **Date:** 2026-10-29
- **Status:** Accepted
- **Deciders:** Mod owner

## Context

Two mods did overlapping work. `jev-model-router` 0.4.2 picked a model per task with TypeSafe's Jev classifier. `model-effort` drew the model and effort in the footer. They could disagree, and the footer showed the session setting, not the request that was sent.

Changing the main chat's model in the middle of a conversation drops the prompt cache. The next request then pays for the full context again. Effort is a request parameter and does not drop the cache.

## Decision

1. Merge both mods into one mod, `model-effort-router`.
2. On the main chat, route the effort only. Do not change the model (`routeMainModel` off by default).
3. Show in the footer the model and effort that the request was sent with (`showSent` in `hooks/running.ts`).

## Consequences
### Positive
- The prompt cache of the main chat stays valid.
- The footer shows the real request.
- One mod has one `turn.step` hook, so the router and the footer cannot disagree.
### Negative
- A simple task in the main chat still runs on the parent's model. Savings on the model come only through subagents (ADR-002, ADR-005).
### Neutral
- `routeMainModel` stays as an option for a user who accepts the cache cost.

## Alternatives Considered
| Option | Rejected Because |
|--------|-----------------|
| **Keep two mods** | They read the request at different points and disagreed. The mod loader allows one `turn.step` hook per module. |
| **Route the main chat's model per turn** | Each switch drops the prompt cache. |
| **Reinstall `jev-model-router` from claude-code-templates** | This mod replaces it. |

## References
- `hooks/router.ts` (`turn.step`, main-loop branch)
- `hooks/running.ts`
- Backups of the old mods: `~/.agents/backups/mods-20261029/`
