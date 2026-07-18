# Serialize every generation-phase state change under one lock

## Objective

Every state write in the plan-generation and alignment phase commits inside the Flow directory lock: when two sessions take over the same draft, or a stop command races a late model callback, there is a deterministic winner and the loser exits without writing. Reuses the existing Flow lock plus `alignment.updatedAt` as the CAS revision.

## Scope

- Single source of truth: `plans/006-lock-all-generation-state-transitions.md`; read fully before touching code.
- Allowed: `src/flow/generation.ts`, `src/flow/store.ts` (pre-draft reservation boundary only), `src/shared/generation-state.ts`, `tests/flow-smoke.mjs`, docs.
- Forbidden: schema changes or migrations, new cwd-level locks, journals, polling or sleep; no git commits.

## Steps

- [x] **Confirm the plan has not drifted**: read the plan document end to end and run the drift check against the "current state" snapshot; declare `BLOCKED` on mismatch
- [x] **Write the race regressions first**: add six controlled-race scenarios to `tests/flow-smoke.mjs` (callback during lock hold, stop wins, same-revision double write, cross-session takeover, half-committed alignment/flow, draft with stale alignment) using lock barriers instead of sleep; confirm at least one is red
- [x] **Make the revision a strictly monotonic CAS**: `writeAlignmentState()` takes `max(Date.now(), old+1)`; a single in-lock mutation helper re-reads and compares revision/session/stage, stale callbacks become no-ops, lock-busy retries once via `watchFlowLockRelease()`
- [x] **Close out first-create and every write path**: split `createPreDraftFlow()` into exclusive mkdir reservation + in-lock alignment-then-flow write; Q&A, stage saves, rebind, pause/resume, failure, repair and the final semantic commit all go through the helper; alignment-first with no rollback
- [x] **Deterministic stop and takeover**: after a stop commits, the old session's late callbacks acquire the lock and no-op; takeover updates sessionFile/revision in one transaction and cleans stale draft artifacts
- [x] **Fix the crash-recovery order**: every pre-draft recovery entry does a minimal in-lock reconcile; final HTML projection runs outside the lock on the no-throw path

## Success Criteria

- Every plugin-owned Flow/alignment/artifact write in `generation.ts` happens inside the Flow dir lock; stale-revision callbacks write nothing.
- After a stop or cross-session takeover commits, the old session cannot overwrite status, sessionFile, Q&A or repairAttempts; no duplicate hidden prompts in the existing stop/go smokes.
- The first visible pre-draft Flow always has a valid alignment; the final draft carries `meta.alignment` before `alignment.json` is deleted; both crash windows recover idempotently.
- `rg -n "setInterval|sleep" src/flow/generation.ts` has no matches; no new schema, journal or cwd lock.
- `npm run check && npm test` exit 0; plan status row is DONE.

## Verification

- `node tests/flow-smoke.mjs` passes with all six race scenarios green.
- `npm run check && npm test` exit 0 from an idle report port.

## Notes

- Key decision: reuse `alignment.updatedAt` as the CAS revision plus the existing Flow dir lock; a new generation id/journal/second state machine was rejected as redundant state.
- The lock only guards short transactions; anything that waits on a model or the user splits into in-lock intent, out-of-lock wait, and an in-lock CAS close-out.

## Handoff

- All six race scenarios plus the existing stop/go, repair and autoStart regressions pass; `npm run check && npm test` exit 0.
