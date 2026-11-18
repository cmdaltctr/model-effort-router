# ADR-003: Uneven confidence bars; risk forces the deep tier

- **Date:** 2026-10-29
- **Status:** Accepted
- **Deciders:** Mod owner

## Context

Jev returns a tier (fast, balanced or deep), a confidence, an effort score and a risk score. The two possible mistakes do not cost the same. Too large a model costs money. Too small a model can give a wrong result with no warning. Jev can also time out or fail.

## Decision

1. A move up needs a confidence of `minUpgradeConfidence` (0.3). A move down needs `minDowngradeConfidence` (default 0.6; the owner sets 0.8).
2. A decision with no confidence (the built-in classifier, or the Gateway without probabilities) may move up but never down.
3. When the risk score is above 0.7 (production, credentials, an action that cannot be undone), use the deep tier and at least `high` effort. Do not apply the bars. Risk never lowers an effort.
4. When Jev gives no answer within 800 ms, or fails, leave the request as Claude Code built it. ADR-007 adds an exception for Fable.
5. Prefer TypeSafe's own API when its key is set, because only it reports a calibrated confidence. `provider` can force the Gateway or the built-in classifier.
6. A model the router does not know has no rank. A move from it counts as a move up.

## Consequences
### Positive
- An unsure rating does not put work on a smaller model.
- Risky work always gets the deep tier.
- The router never blocks a request for longer than the timeout.
### Negative
- With a 0.8 bar, many medium tasks stay on the larger model.
### Neutral
- Each decision is logged with what was wanted and what was kept (`logDecisions`).

## Alternatives Considered
| Option | Rejected Because |
|--------|-----------------|
| **One bar for both directions** | It treats an expensive mistake and a harmful mistake the same. |
| **Retry or wait longer for Jev** | It delays every spawn and turn. |
| **Guess a tier when Jev fails** | A guess is not evidence. |

## References
- `hooks/policy.ts` (`allowed`, `route`, `rankOf`, `selectProvider`)
- `hooks/router.ts` (`timeoutMs`)
