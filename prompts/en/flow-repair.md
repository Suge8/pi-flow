You are fixing validation errors in an existing Pi Flow plan draft. Only edit the current plan draft files; do not modify product code.

Goal: fix `flow.semantic.json` and Goal markdown files under `{{flowPath}}` until the extension can assemble them into a valid Flow.

Rules:
- Only fix or complete the current Flow plan draft.
- Do not write product code, config, tests, README, or docs.
- Only edit `flow.semantic.json` and `G<N>-*.md`; do not create, handwrite, or modify canonical `flow.json`, and do not fill runtime state fields. The extension assembles and validates the complete Flow state artifact.
- If the errors can be answered by reading the codebase, docs, or existing `.flow` files, inspect them yourself.
- Do not ask the user; infer missing content from the original request and existing draft into the smallest executable plan.
- Output language must use current language: `{{language}}`. Use English for `en`; use Chinese for `zh`.
- Each Goal must be small enough to complete in its own Goal session.
- `flow.semantic.json` must be a JSON object with only `title` and `goals`; do not write `source`, `schemaVersion`, `status`, `currentGoal`, `parallelRun`, `checks`, or other runtime fields.
- The `goals` array order is the execution order. Each item only needs `title`, `role`, and `file`. Do not write `index`; the extension recalculates 0-based indexes from order.
- A single-step Flow has exactly 1 `normal` Goal and no final acceptance; in a multi-step Flow, non-final Goals use role `normal` and the last Goal uses role `final_acceptance`.
- Each Goal file must contain Objective / Scope / Steps / Success Criteria / Verification / Notes / Handoff.
- Each Goal's Success Criteria must be ordinary bullets, not checkboxes; write completion status and evidence in Verification / Handoff, not in Success Criteria.
- Each Goal's Steps and Verification must use checkboxes, initially only `[ ]`; Verification needs a command or explicit manual verification step.
- Steps are runtime todo items, not a mechanical list of tiny tasks or vague phases. Prefer 2–10 user-understandable milestones per Goal; smaller tasks may use fewer. Each item must be independently actionable, updatable when complete, and able to provide completion evidence.
- Write each Step as `- [ ] **Short title**: technical detail`; short title <= 20 Chinese chars or concise English, user-readable; detail can be technical.
- Only multi-step Flow must have a final acceptance Goal, reading all Handoffs, reviewing `criteriaChanged`, running global verification, and closing out; single-step Flow must not write final acceptance.
- Do not generate or test `flow.html`; the extension renders HTML after validation.
- After fixing `flow.semantic.json` and Goal markdown, stop. The extension will reassemble and run structural validation (`{{validateCommand}} {{flowPath}}`). Do not manually simulate validation results.
- If you need to write the user's next step after completion, use `/flow go F<N>`; if stopping is needed, use `/flow stop F<N>`. Do not invent another control entry.
- If an error mentions canonical `flow.json` or runtime state fields, do not fill those fields manually; fix the semantic draft and Goal markdown so the extension can process them again.

Current validation errors:
{{errors}}

Original request:
{{originalRequest}}

Flow path:
{{flowPath}}

Current language:
{{language}}
