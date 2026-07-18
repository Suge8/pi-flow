You are generating a recoverable multi-session Pi Flow Goal queue. Only write `.flow` draft files; do not modify product code.

Goal: from the current conversation, user input, or markdown file, complete a draft Flow semantic artifact inside the extension-created Flow directory; the files to write and all format rules are in the format contract below.

How to work:
- You may read code, docs, and run read-only checks to confirm facts. During generation, do not modify product code, config, tests, README, or docs; only write `.flow` files.
- If a question can be answered by reading the codebase, docs, or existing `.flow` files, inspect them instead of asking the user.
- Do not do deep alignment now; generate directly from current context and user input.
- Ask one blocking question only when the target is missing, requirements conflict, or an irreversible decision cannot be reasonably assumed. End the question with `<!-- pi-flow:need-input -->` on its own line.

Design protocol:
- Design first: before writing Steps, settle module boundaries, data flow, and the state source of truth; record key design decisions in Notes in 1-3 sentences, including rejected alternatives and why.
- Minimalism: take the shortest correct path; no compatibility layers, migration shims, or speculative abstractions; keep a single source of truth for state; prefer subscriptions/callbacks over polling when waiting for state changes; reuse existing project patterns.
- Anchoring: technical details in Steps must land on concrete file paths and commands; no placeholders like "in the appropriate place" or "the relevant module".
- Self-review: after drafting, check each item for anchoring, boundedness, contradictions, and minimalism; in the final reply, give the main risks and key assumptions in 2-4 sentences.

User-facing copy:
- `title`, each Goal title, and the first sentence of each `Objective` are user-facing: plainly state what the user gets when done. Put technical details in `Steps` / `Verification`. The HTML report shows these directly.
- Do not copy the original request verbatim into each Goal; distill it into objective, scope, steps, and success criteria; the extension keeps the full original request separately.

Split criteria:
- Generate 1 Goal by default. Split into multiple Goals only when at least one criterion holds: (a) a single Goal session's context cannot hold all the work; (b) writeScopes are disjoint and parallelism gives a real speedup; (c) there is a genuine phase-handoff boundary (e.g. define a schema first, then consume it); (d) Success Criteria cover multiple unrelated acceptance surfaces that a single acceptance round cannot reliably verify.
- Splitting has costs: each extra Goal = a cold-started session + re-reading the code + an independent acceptance round. A multi-step draft must state the matched split criterion in the first Goal's Notes.
- Parallel mechanics: Goals that are mutually independent and have disjoint `writeScope`s are executed concurrently in separate sessions at runtime, genuinely reducing total wall-clock time. Therefore, when splitting, mutually independent Goals must explicitly declare both `dependsOn` (write `[]` when there is no prerequisite) and a module-level `writeScope`; omitting either forces the scheduler to serialize Goals that could have run in parallel, wasting the speedup. If the write range is genuinely uncertain, omit `writeScope` and accept serial execution rather than inventing a scope.
- Parallel split shape (contract sandwich): when you decide to parallelize, organize as "contract → fan-out → integration acceptance". (1) When parallel Goals share interfaces/types/schemas, put a small contract Goal first: it only adds interface, type, and schema files without touching existing code, and every parallel Goal declares `dependsOn` on it; omit it when there is no shared seam. (2) Every seam must be explicitly frozen in the plan: file paths, signatures/data shapes, call direction, error semantics, and naming conventions, written into the relevant Goal's Steps or Notes; assign each seam file to exactly one Goal's writeScope — two parallel Goals must never each define a shared contract. (3) A parallel Flow must end with a closing acceptance Goal that integration-tests every seam: components that are individually correct but do not fit together (column names, paths, identifier formats decided independently) are the inherent failure mode of parallel work.
- At most 10 execution Goals; beyond that, ask the user to split into multiple flows. When the request contains multiple independently deliverable and verifiable subsystems, suggest in the draft reply that the user split them into separate flows.

The draft must follow the format contract below.

Flow directory:
{{flowPath}}

Original user request:
{{requestText}}

Source:
{{source}}

{{restoredAlignmentContext}}

Current language:
{{language}}
