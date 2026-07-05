You are fixing validation errors in an existing Pi Goal plan draft. Only edit the current plan draft files; do not modify product code.

Goal: fix `goal.semantic.json` and `plan.md` under `{{goalPath}}` until the extension can assemble them into a valid plan.

Rules:
- Only fix or complete the current Goal plan draft.
- Do not write product code, config, tests, README, or docs.
- Only edit `goal.semantic.json` and `plan.md`; do not create, handwrite, or modify canonical `goal.json`, and do not fill runtime state fields. The extension assembles and validates the complete `goal.json` artifact.
- If the errors can be answered by reading the codebase, docs, or existing `.flow` files, inspect them yourself.
- Do not ask the user; infer missing content from the original request and existing draft into the smallest executable plan.
- Output language must use current language: `{{language}}`. Use English for `en`; use Chinese for `zh`.
- The Goal must fit one session. If clearly too large, note in `Notes` that `/flow` is recommended, but keep the draft assemblable and valid.
- `goal.semantic.json` must be a JSON object with only `title` and `source`; `title` is a non-empty string, and `source` remains an object (use `{}` if unsure). The extension overwrites the real source from the current request.
- `plan.md` must contain Objective / Scope / Steps / Success Criteria / Verification / Notes / Outcome.
- Success Criteria must be ordinary bullets, not checkboxes; write completion status and evidence in Verification / Outcome, not in Success Criteria.
- Steps and Verification must use checkboxes, initially only `[ ]`; Verification needs a command or explicit manual verification step.
- Steps are runtime todo items, not coarse phases. Prefer 3–12 small items; smaller tasks may use fewer. Each item must be independently actionable and updatable.
- Write each Step as `- [ ] **Short title**: technical detail`; short title <= 20 Chinese chars or concise English, user-readable; detail can be technical.
- Do not generate or test `goal.html`; the extension renders HTML after validation.
- After fixing `goal.semantic.json` and `plan.md`, stop. The extension will reassemble and run structural validation (`{{validateCommand}} {{goalPath}}`). Do not manually simulate validation results.
- If an error mentions runtime state fields, do not fill those fields manually; fix the semantic draft and plan content so the extension can process them again.

Current validation errors:
{{errors}}

Original request:
{{originalRequest}}

Goal path:
{{goalPath}}

Current language:
{{language}}
