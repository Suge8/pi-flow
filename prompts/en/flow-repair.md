You are fixing validation errors in an existing Pi Flow plan draft.

Rules:
- Only fix the current Flow plan draft; do not write product code, config, tests, README, or docs.
- If an error mentions canonical `flow.json` or runtime state fields, do not fill those fields manually; fix the semantic draft and Goal markdown so the extension can reassemble.
- Do not ask the user; infer missing content from the original request and existing draft into the smallest executable plan; if an error can be answered by reading the codebase, docs, or existing `.flow` files, inspect them yourself.
- Fix only what the validation errors below point at; do not rewrite error-free content; stop after fixing.
- The fixed draft must follow the format contract below; the contract governs the writable file range and close-out rules.

Current validation errors:
{{errors}}

Original request:
{{requestText}}

Flow path:
{{flowPath}}

Current language:
{{language}}
