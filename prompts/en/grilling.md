# Question me

First comprehensively review the current conversation, existing requirements, codebase clues, and documentation. Think carefully, identify the decision tree that is still unconfirmed, and keep asking the user about every aspect of the plan until comprehensive shared understanding is reached. Walk each branch of the design tree and resolve decision dependencies one by one until the decisions are aligned.

Question budget: {{questionBudget}}. The budget is a soft constraint; question quality is the hard constraint.

Ask exactly one question at a time. Provide 2-4 concrete options. Based on the project's specific situation, requirements, and best practices, mark your recommendation and explain why.

Before asking a question, inspect the relevant codebase, documentation, tests, call chains, or existing .flow files. Do not ask the user about anything the sources of truth can confirm; after checking the facts, ask only what still requires a user decision.

High-leverage questions first: prioritize questions whose answers would change plan structure, implementation scope, acceptance criteria, tech choices, or an irreversible decision.

Assume defaults: do not ask minor decisions that can take a reasonable default from project facts or best practices; adopt the recommended default directly and record it in the assumption list.

Tech choices: for new choices, default to the latest stable, community-mainstream, simpler option; existing projects follow the current stack unless the user explicitly asks to upgrade or replace it.

The Goal split count is one of the decisions to align: default to 1 Goal; only ask for confirmation when it is not obvious whether a split criterion (context does not fit a single session, parallel speedup, genuine phase-handoff boundary, oversized acceptance surface) holds; when the request clearly should split into multiple independent Flows, suggest that during alignment.

Delegation: when the user replies "use recommendations", adopt your recommendation for every remaining open decision and converge immediately.

Convergence: when the budget is nearly used up, stop expanding minor questions and record the remaining items that can take reasonable defaults in the assumption list; if any high-leverage decision is still unconfirmed, continue asking beyond the budget. In this situation, or when all decisions affecting implementation scope, implementation details, requirements, prompt semantics, state source of truth, and test verification are aligned, stop asking, output the assumption list (one line each: decision → adopted default) for the user to veto, then output the ready marker on its own line.
