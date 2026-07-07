You are generating a recoverable multi-session Pi Flow Goal queue. Only write `.flow` draft files; do not modify product code.

Goal: from the current conversation, user input, or markdown file, complete a draft Flow semantic artifact inside the extension-created directory:

```text
{{flowPath}}/
  flow.json  # created by the extension; do not modify it
  flow.semantic.json
  flow.html  # rendered by the extension; do not write it
  G1-*.md
  G2-*.md
  G<N>-final-acceptance.md  # multi-step Flow only
```

Rules:
- You may read code, docs, and run read-only checks to confirm facts.
- During generation, do not modify product code, config, tests, README, or docs; only write `.flow` files.
- Only write `flow.semantic.json` and `G<N>-*.md` inside `{{flowPath}}`; do not create, handwrite, or fill canonical `flow.json` / runtime state fields. The extension assembles and validates the complete Flow state artifact.
- Do not write or test `flow.html`; the extension renders it after validation with its built-in renderer. Do not copy HTML report templates or candidate structures into Flow goal files.
- Output language must use current language: `{{language}}`. Use English for `en`; use Chinese for `zh`.
- `title`, each Goal title, and the first sentence of each `Objective` are user-facing: plainly state what the user gets when done. Put technical details in `Steps` / `Verification`.
- The Flow directory has already been allocated by the extension as bare `F<N>`; do not create another Flow directory and do not use `F<N>-slug`.
- Generate 1–11 Goals (at most 10 execution Goals plus the final acceptance Goal for multi-step Flow); prefer 1–7. More than 10 execution Goals is invalid; ask the user to split into multiple flows.
- A single-step Flow generates exactly 1 `normal` Goal and no final acceptance Goal.
- A multi-step Flow must close with final acceptance: the last Goal filename uses the actual sequence plus `final-acceptance`, role `final_acceptance`, e.g. `G3-final-acceptance.md`. 
- Each Goal must be small enough to complete in its own Goal session.
- Each Goal file must contain: `Objective / Scope / Steps / Success Criteria / Verification / Notes / Handoff`.
- Each Goal's `Success Criteria` must be ordinary bullets, not checkboxes; write completion status and evidence in `Verification` / `Handoff`, not in `Success Criteria`.
- Each Goal's `Steps` and `Verification` must use checkboxes, initially only `[ ]`; `Verification` needs an objectively verifiable command or explicit manual verification step.
  (e.g. `- [ ] \`npm test -- --testPathPattern=auth\` exit 0`; avoid `- [ ] check that the feature works` which cannot be objectively judged)
- `Steps` are runtime todo items, not a mechanical list of tiny tasks or vague phases. Prefer 2–10 user-understandable milestones per Goal; smaller tasks may use fewer. Each item must be independently actionable, updatable when complete, and able to provide completion evidence in `Verification` / `Handoff`.
- Write each Step as `- [ ] **Short title**: technical detail`; short title <= 20 Chinese chars or concise English, user-readable; detail can be technical.
  (e.g. `- [ ] **Token verification works**: implement verifyToken(token) in auth.ts, handle TokenExpiredError and invalid signature, return parsed payload`)
- Include the `Handoff` heading when generating; content may be empty.
- `dependsOn` is an optional field on each `goals` item. Its value is an array of 0-based indexes of earlier Goals; when omitted, it defaults to depending on the previous Goal; write `[]` when there are explicitly no prerequisites.
- `writeScope` is an optional field on each `goals` item. Its value is an array of module/directory-level globs (e.g. `src/api/**`); do not list exact files. When omitted, the write range is unknown and the scheduler will conservatively serialize it.
- Chinese titles use `G<N>-goal.md`; English titles may slug, e.g. `G1-login-ui.md`.
- `flow.semantic.json` must be a JSON object with only top-level `title` and `goals`; do not write `source`, `schemaVersion`, `status`, `currentGoal`, `parallelRun`, `checks`, or other runtime fields.
- The `goals` array order is the execution order. Each item only needs `title`, `role`, `file`, and optional `dependsOn` / `writeScope`. Do not write `index`; the extension recalculates 0-based indexes from order.
- The only Goal in a single-step Flow and each non-final Goal in a multi-step Flow use role `normal`; the last Goal in a multi-step Flow uses role `final_acceptance`, and `final_acceptance` may appear only once; do not use `implementation`.
- Each `file` must be a relative path inside the current Flow directory, and the referenced Goal markdown file must exist.
- Do not copy the original request verbatim into each Goal; distill it into objective, scope, steps, and success criteria. The extension writes the real source into canonical `flow.json` from the current request.
- Only multi-step Flow writes a final acceptance Goal. It must read all Handoffs, review `criteriaChanged`, run global verification, check whether docs / AGENTS.md need updates, and close out. Its Steps cover all prior Goals' deliverables and differ from regular Goals.
  Reference Steps structure (adjust to actual scope):
  - [ ] **Read all Handoffs**: confirm each Goal's deliverables and open issues one by one
  - [ ] **Global verification**: run global verification command, confirm end-to-end flow exits 0
  - [ ] **Doc close-out**: check docs / AGENTS.md for affected module descriptions; update if needed
  - [ ] **Confirm no loose ends**: no open issues, no unresolved TODO/FIXME
- After writing `flow.semantic.json` and all Goal markdown files, stop. The extension will assemble the complete Flow state and run structural validation (`{{validateCommand}} {{flowPath}}`). Do not replace real tool output with "self-check", and do not manually simulate extension validation.
- Do not do deep alignment now; generate directly from current context and user input.
- Ask one blocking question only when the target is missing, requirements conflict, or an irreversible decision cannot be reasonably assumed. End the question with `<!-- pi-flow:need-input -->` on its own line.
- If a question can be answered by reading the codebase, docs, or existing `.flow` files, inspect them instead of asking the user.

Minimal `flow.semantic.json` skeleton with optional parallel fields:

```json
{
  "title": "Task title",
  "goals": [
    { "title": "First Goal", "role": "normal", "file": "G1-goal.md", "dependsOn": [], "writeScope": ["src/api/**"] },
    { "title": "Second Goal", "role": "normal", "file": "G2-goal.md", "dependsOn": [], "writeScope": ["src/ui/**"] },
    { "title": "Final acceptance", "role": "final_acceptance", "file": "G3-final-acceptance.md", "dependsOn": [0, 1] }
  ]
}
```

Flow directory:
{{flowPath}}

Original user request:
{{originalRequest}}

Source:
{{source}}

{{restoredAlignmentContext}}

Current language:
{{language}}
