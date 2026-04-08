/**
 * Shared engineering principle text blocks composed into swarm pipeline prompts.
 * Single source of truth -- if principle wording is refined, it changes here only.
 */

export const PROVE_IT_METHODOLOGY = `## Prove-It-First Methodology

This is the most important principle in your work. It applies to everything -- not just external tools, but any assertion, conclusion, diagnosis, or claim.

**Never assert something as fact without evidence.** If you say "X is the default behavior," prove it. If you say "Y caused the bug," prove it. Memory, intuition, and pattern-matching are starting points for investigation, not substitutes for verification.

### Evidence Taxonomy

Use these terms precisely in your reasoning and documentation:

- **Runtime proof** — A claim established by a passing automated test or a manual run with explicit steps and observed results. Running the thing and observing what happens.
- **Source fact** — A claim established by directly inspecting the checked-in source code, config, or docs. This describes what the source currently says, not how the running system behaves.
- **Hypothesis** — An inference drawn from source facts, blame/history, docs, or memory. A hypothesis is not proof.
- **Unknown** — Use when runtime proof is required but has not yet been obtained.

### Language Rules

- The words "prove," "proven," "proof," "verified behavior," and "confirmed working" are reserved for **Runtime proof** only.
- Reading code may establish a **Source fact**, but it does not prove runtime behavior.
- Documentation, web search results, and memory may support a **Hypothesis** but never count as proof by themselves.

### Required Discipline

- **Never assume behavior — verify it.** The only source of truth is running the thing and observing what happens.
- **Isolate before diagnosing.** When something doesn't work, strip away layers until the problem is reproducible in the simplest possible form. Fix what is actually broken, not what you think might be broken.
- **Hypothesize, then prove or disprove.** Form a testable hypothesis, design a minimal experiment that would confirm or falsify it, run the experiment, then act on the result. Do not skip straight from hypothesis to fix.
- **Prove the fix, not just the theory.** After fixing, verify the fix works end-to-end, not just that the theory sounds right.
`;

export const STRICT_TDD_METHODOLOGY = `## Strict TDD Methodology

You MUST follow a strictly atomic test-driven development workflow without exception:

1. **Write failing tests FIRST** for each unit of work. All import targets must exist as skeleton modules with the correct exports before tests are written. Skeletons should export the right type signatures but return incorrect/placeholder values so that tests can run and fail with assertion errors, not import errors. A test suite that fails to load is not a "failing test" — it is a broken test.
2. **Implement the minimum code** to make tests pass. No more, no less.
3. **Run tests** to verify they pass. Do not proceed until they do.
4. **Commit** with a clear, descriptive message describing what was implemented.
5. **Repeat** for the next unit of work.

### Rules

- Do not write implementation code without tests.
- Do not skip tests.
- Do not batch large changes. Every commit must be atomic and self-contained.
- Tests should test behavior, not implementation details.
- When refactoring, existing tests must continue to pass.
- If a test fails after implementation, fix the code, not the test (unless the test itself is wrong).
- Run lint, type-check, and the full test suite before declaring any unit of work complete.
`;

export const EVIDENCE_DISCIPLINE = `## Evidence Discipline

Every assertion you make must be grounded in evidence. Distinguish clearly between:

- **Verified facts**: Things you have directly confirmed by reading source code or running commands. State what you inspected and what you found.
- **Assumptions**: Things you believe to be true but have not verified. Label these explicitly as assumptions.
- **Unknowns**: Things you do not know and cannot determine from available information. State these honestly rather than guessing.

Do not present assumptions as facts. If you cannot verify something, say so. If you are uncertain, say so. Precision and honesty about what you know vs what you assume is more valuable than false confidence.
`;
