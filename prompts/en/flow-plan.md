You are generating a recoverable multi-session Pi Flow Goal queue. Only write `.flow` draft files; do not modify product code.

Goal: from the current conversation, user input, or markdown file, create a draft Flow:

```text
.flow/flows/<id>/
  flow.semantic.json
  flow.html  # rendered by the extension; do not write it
  G1-*.md
  G2-*.md
  G<N>-final-acceptance.md
```

Rules:
- You may read code, docs, and run read-only checks to confirm facts.
- During generation, do not modify product code, config, tests, README, or docs; only write `.flow` files.
- Only write `flow.semantic.json` and `G<N>-*.md`; do not create, handwrite, or fill canonical `flow.json` / runtime state fields. The extension assembles and validates the complete Flow state artifact.
- Do not write or test `flow.html`; the extension renders it after validation with its built-in renderer. Do not copy HTML report templates or candidate structures into Flow goal files.
- Output language must use current language: `{{language}}`. Use English for `en`; use Chinese for `zh`.
- `title`, each Goal title, and the first sentence of each `Objective` are user-facing: plainly state what the user gets when done. Put technical details in `Steps` / `Verification`.
- Flow directory names use the next max F number under `.flow/flows`, format `F1-xxx`; use `task` when no English/numeric slug exists.
- Generate 2–10 Goals including the final acceptance Goal; prefer 3–7. More than 10 is invalid; ask the user to split into multiple flows.
- The last Goal must be final acceptance, filename uses the actual sequence plus `final-acceptance`, role `final_acceptance`, e.g. `G3-final-acceptance.md`.
- Each Goal must be small enough to complete in its own Goal session.
- Each Goal file must contain: `Objective / Scope / Steps / Success Criteria / Verification / Notes / Handoff`.
- Each Goal's `Steps` and `Verification` must use checkboxes, initially only `[ ]`; `Verification` needs an objectively verifiable command or explicit manual verification step.
  (e.g. `- [ ] \`npm test -- --testPathPattern=auth\` exit 0`; avoid `- [ ] check that the feature works` which cannot be objectively judged)
- `Steps` are runtime todo items, not coarse phases. Prefer 3–12 small items per Goal; smaller tasks may use fewer. Each item must be independently actionable and updatable.
- Write each Step as `- [ ] **Short title**: technical detail`; short title <= 20 Chinese chars or concise English, user-readable; detail can be technical.
  (e.g. `- [ ] **Add verifyToken**: implement verifyToken(token) in auth.ts, handle TokenExpiredError and invalid signature, return parsed payload`)
- Include the `Handoff` heading when generating; content may be empty.
- Put dependencies only in `Scope` or `Notes`; do not add structured dependency fields.
- Chinese titles use `G<N>-goal.md`; English titles may slug, e.g. `G1-login-ui.md`.
- `flow.semantic.json` must be a JSON object with only `title` and `goals`; do not write `source`, `schemaVersion`, `status`, `currentGoal`, `checks`, or other runtime fields.
- The `goals` array order is the execution order. Each item only needs `title`, `role`, and `file`. Do not write `index`; the extension recalculates 0-based indexes from order.
- Non-final Goals use role `normal`; the last Goal uses role `final_acceptance`; do not use `implementation`.
- Each `file` must be a relative path inside the current Flow directory, and the referenced Goal markdown file must exist.
- Do not copy the original request verbatim into each Goal; distill it into objective, scope, steps, and success criteria. The extension writes the real source into canonical `flow.json` from the current request.
- The final acceptance Goal must read all Handoffs, review `criteriaChanged`, run global verification, check whether docs / AGENTS.md need updates, and close out. Its Steps cover all prior Goals' deliverables and differ from regular Goals.
  Reference Steps structure (adjust to actual scope):
  - [ ] **Read all Handoffs**: confirm each Goal's deliverables and open issues one by one
  - [ ] **Global verification**: run global verification command, confirm end-to-end flow exits 0
  - [ ] **Doc close-out**: check docs / AGENTS.md for affected module descriptions; update if needed
  - [ ] **Confirm no loose ends**: no open issues, no unresolved TODO/FIXME
- After writing `flow.semantic.json` and all Goal markdown files, stop. The extension will assemble the complete Flow state and run structural validation (`{{validateCommand}} <Flow directory>`). Do not replace real tool output with "self-check", and do not manually simulate extension validation.
- Do not do deep alignment now; generate directly from current context, aligned summary, and user input.
- Ask one blocking question only when the target is missing, requirements conflict, or an irreversible decision cannot be reasonably assumed. End the question with `<!-- pi-flow:need-input -->` on its own line.
- If a question can be answered by reading the codebase, docs, or existing `.flow` files, inspect them instead of asking the user.

Minimal `flow.semantic.json` skeleton:

```json
{
  "title": "Task title",
  "goals": [
    { "title": "First Goal", "role": "normal", "file": "G1-goal.md" },
    { "title": "Final acceptance", "role": "final_acceptance", "file": "G2-final-acceptance.md" }
  ]
}
```

Original user request:
{{originalRequest}}

Source:
{{source}}

Current language:
{{language}}
