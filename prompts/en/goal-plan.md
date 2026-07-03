You are generating an executable single-session Pi Goal plan. Only write `.flow` draft files; do not modify product code.

Goal: from the current conversation, user input, or markdown file, create a draft Goal plan:

```text
.flow/goals/<id>/
  goal.semantic.json
  plan.md
  goal.html  # rendered by the extension; do not write it
```

Rules:
- You may read code, docs, and run read-only checks to confirm facts.
- During generation, do not modify product code, config, tests, README, or docs; only write `.flow` files.
- Only write `goal.semantic.json` and `plan.md`; do not create, handwrite, or fill canonical `goal.json` / runtime state fields. The extension assembles and validates the complete `goal.json` artifact.
- Do not write or test `goal.html`; the extension renders it after validation with its built-in renderer. Do not copy HTML report templates or candidate structures into `plan.md`.
- Goal directory names use the next max G number under `.flow/goals`, format `G1-xxx`; use `task` when no English/numeric slug exists.
- Output language must use current language: `{{language}}`. Use English for `en`; use Chinese for `zh`.
- `title` and the first sentence of `Objective` are user-facing: plainly state what the user gets when done. Put technical details in `Steps` / `Verification`.
- The Goal must fit one session. If clearly too large, do not create a Goal; recommend `/flow`, tell the user they can run `/flow` or narrow `/goal <scope>`, and end with `<!-- pi-flow:recommend-flow -->` on its own line.
- `goal.semantic.json` must be a JSON object with only `title` and `source`; `title` is a non-empty string, and `source` remains an object (use `{}` if unsure). The extension overwrites the real source from the current request.
- Do not copy the original request verbatim into `plan.md`; distill it into objective, scope, steps, and success criteria.
- `plan.md` must contain: `Objective / Scope / Steps / Success Criteria / Verification / Notes / Outcome`.
- `Steps` and `Verification` must use checkboxes, initially only `[ ]`; `Verification` needs an objectively verifiable command or explicit manual verification step.
  (e.g. `- [ ] \`npm test -- --testPathPattern=auth\` exit 0`; avoid `- [ ] check that the feature works` which cannot be objectively judged)
- `Steps` are runtime todo items, not coarse phases. Prefer 3–12 small items; smaller tasks may use fewer. Each item must be independently actionable and updatable; avoid items like "implement feature" or "final check" that can only complete at the end.
- Write each Step as `- [ ] **Short title**: technical detail`; short title <= 20 Chinese chars or concise English, user-readable; detail can be technical for the execution AI.
  (e.g. `- [ ] **Add verifyToken**: implement verifyToken(token) in auth.ts, handle TokenExpiredError and invalid signature, return parsed payload`)
- Do not do deep alignment now; generate directly from current context, aligned summary, and user input.
- Ask one blocking question only when the target is missing, requirements conflict, or an irreversible decision cannot be reasonably assumed. End the question with `<!-- pi-flow:need-input -->` on its own line.
- If a question can be answered by reading the codebase, docs, or existing `.flow` files, inspect them instead of asking the user.
- If you already recommended `/flow`, only an explicit `/flow` command converts it; do not treat natural language like "ok" as consent. The extension only recognizes `<!-- pi-flow:recommend-flow -->`.
- After writing `goal.semantic.json` and `plan.md`, stop. The extension will assemble the complete state and run structural validation (`{{validateCommand}} <Goal directory>`). Do not replace real tool output with "self-check", and do not manually simulate extension validation.

Minimal `goal.semantic.json` skeleton:

```json
{
  "title": "Task title",
  "source": {}
}
```

Original user request:
{{originalRequest}}

Source:
{{source}}

Current language:
{{language}}
