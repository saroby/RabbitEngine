# Current task: merge evaluation and memory fixes

## Acceptance criteria
- Commit only the reviewed evaluation, memory, regression test, and task record changes.
- `npm test`, `npm run types`, and staged whitespace checks pass.
- Land the source commit on the remote's actual default branch without rewriting history.
- Confirm the live remote ref matches the fetched ref and contains the source commit.

## Checklist
- [x] Inspect repository instructions, worktrees, remotes, branch, and complete diff.
- [x] Review the affected behavior and regression coverage.
- [x] Run validation and inspect the staged slice.
- [x] Commit the intended slice.
- [x] Fetch, land, and verify the remote default branch.
- [x] Record results.

## Working notes
- Source branch: `fix/evaluation-state-memory`; `origin/HEAD` resolves to `origin/main`.
- No checked-out default-branch worktree; the other worktree is `AC-209/prompt-editor`.
- Real model evaluation requires API credentials; the CLI regression uses local fetch fixtures.
- `fitBudget` is called by `assemble` and reached through `selectMemory`; the new test covers all four placements. The CLI test exercises malformed judging, extraction failure, forbidden outcomes, and interrupted calls.

## Results
- `979d1e5` contains the five reviewed evaluation and memory files. `git diff --cached --check`, `npm test` (269 passed), and `npm run types` passed.
- Fast-forwarded `979d1e5` to `origin/main`; a fresh fetch, `git ls-remote --heads`, and an ancestry check confirmed the live ref.
- Real model calls were not run because they require external API credentials and are manual evaluations.
