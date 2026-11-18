# Architecture Decision Records

This directory records the significant decisions made for the model-effort-router mod. Decisions made before the git repository existed (2026-11-04) were rebuilt from the project memory and the backups in `~/.agents/backups/`.

## Index

| ADR | Title | Date | Status |
|-----|-------|------|--------|
| [001](./001-one-mod-main-chat-routes-effort-only.md) | One mod; the main chat routes effort only | 2026-10-29 | Accepted |
| [002](./002-subagents-routed-once-at-spawn-forks-left-alone.md) | Subagents are routed once at spawn; forks are left alone | 2026-10-29 | Accepted |
| [003](./003-uneven-confidence-bars-risk-forces-deep.md) | Uneven confidence bars; risk forces the deep tier | 2026-10-29 | Accepted |
| [004](./004-effort-ceiling-and-planning-lift.md) | Effort ceiling and planning lift | 2026-10-29 | Accepted |
| [005](./005-delegate-through-a-note-to-the-parent.md) | Delegate through a note to the parent, not mod-spawned subagents | 2026-10-29 | Accepted |
| [006](./006-footer-shows-parent-band-shows-subagent.md) | The footer shows the parent; the band shows a viewed subagent | 2026-10-29 | Accepted |
| [007](./007-fable-off-limits-for-subagents-named-choices-win.md) | Fable is off limits for subagents; a named model or effort wins | 2026-11-17 | Accepted |

## Convention

Each ADR has these sections:
- **Context**: the problem, the limits and the forces at play.
- **Decision**: what was chosen and why.
- **Consequences**: positive, negative and neutral results.
- **Alternatives Considered**: the options that were rejected.
- **References**: the relevant files and documents.

An ADR does not change after its status is "Accepted". A later ADR that changes it is named in an "Amended by" or "Superseded by" line.

## Creating a new ADR

1. Copy an existing ADR.
2. Give it the next three-digit number.
3. Set its status to "Proposed".
4. Add a row to the index table.
