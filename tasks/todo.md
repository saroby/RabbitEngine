# Prompt preview regions

## Acceptance criteria
- [x] Current and saved previews show separate, labeled system prompt and conversation message regions.
- [x] Message numbering and roles remain visible without appearing inside the system prompt.
- [x] Preview comparison and error states remain accurate.

## Plan
- [x] Locate preview rendering, styles, and existing checks.
- [x] Split both preview outputs with the smallest shared rendering helper.
- [x] Verify browser presentation and run the relevant project checks.
- [x] Record results and limitations.

## Working notes
- `turn.render()` returns `{ system, messages }`; `formatted()` currently joins them into one `<pre>`.
- The current comparison uses the joined display string, so it should compare rendered data after the split.
- The `.git` file points to a worktree metadata directory that no longer exists; Git status is unavailable in this checkout.

## Results
- `editor/index.js` now renders system and conversation messages as separate labeled sections in current and saved previews. Message roles and numbers are headings outside the actual message text.
- Preview status reports system characters and message count, while equality compares the rendered system and messages. Failed previews clear stale output.
- Verified in Snack internal browser tab 11 with a screenshot, comparison expansion, and empty console. `node --check editor/index.js` passed; `npm test` passed (268/268).
- Git diff/status could not run because this checkout's `.git` file references deleted worktree metadata.
- The saved comparison view in this earlier result was superseded by the later request to use revert and save controls.

# Separate saved-profile list and editor

## Acceptance criteria
- [x] Opening the standalone page shows a saved-profile list without the editor controls.
- [x] Selecting a profile opens its editor; returning to the list respects unsaved changes.
- [x] Create, save, duplicate, delete, import, and export remain usable in their appropriate screens.
- [x] The editor offers save and last-saved-state revert; the separate saved-output comparison is removed.
- [x] Keyboard navigation and narrow-screen layout remain usable.

## Plan
- [x] Trace current selection, storage, editor lifecycle, and unsaved-change flows.
- [x] Split standalone markup and wire list-to-editor navigation.
- [x] Replace the saved-output comparison with last-saved-state revert and save controls.
- [x] Verify list, edit, return, revert, and CRUD flows in the internal browser; run relevant checks.
- [x] Record results and remaining limits.

## Working notes
- `choose(id)` copies the persisted profile, resets dirty state, and mounts the editor with the saved value as comparison reference.
- New, duplicate, and import currently persist before opening the new profile. Delete recreates a default profile when deleting the last item.
- `editor.destroy()` clears the preview timer and DOM. Use a button for each list item and a visible return control.
- The user wants revert to the last persisted profile instead of a separate saved-output panel. `editor.setValue()` can restore blocks while preserving preview sample input.

## Results
- `editor/index.html` and `editor/standalone.js` now show the registered-profile list first and mount the editor only after selection. A return button applies the existing unsaved-change guard; create/import open a new edit view, and delete returns to the list.
- `editor/index.js` no longer renders a saved-output comparison. The editor toolbar has save and last-saved-state revert; revert restores the saved name and profile through `setValue()` while retaining preview sample data. `editor/README.md` and generated `dist-types/editor/index.d.ts` reflect the UI contract.
- Snack internal browser verified list/edit navigation, save then updated list, revert of both name and block template, duplicate, delete, import, and the unsaved-change confirmation. Export remained wired and visible but was not downloaded. Main tab 11 remains on the list. The browser console showed dialog events and no script errors.
- `node --check` passed for both editor scripts, `npm run types` passed, and `npm test` passed (268/268). Keyboard access uses native buttons and focusable headings; narrow layout was checked from CSS but not by resizing the browser.
- Git status/diff remains unavailable because this checkout's `.git` file points to deleted worktree metadata.

# Commit prompt editor work

## Acceptance criteria
- [x] Restore a trustworthy Git base and identify the exact prompt-editor changes.
- [x] Commit only the related source, tests, and task records on `AC-209/prompt-editor`.
- [x] Confirm the commit and working-tree state without pushing.

## Plan
- [x] Diagnose the broken worktree reference and recover Git access safely.
- [x] Inspect the full diff, separate unrelated changes, and check whitespace.
- [x] Stage the intended files and review the staged diff.
- [x] Commit and verify the resulting SHA and status.

## Working notes
- The `.git` file points to deleted metadata under `session-86b5189-fixes`.
- Earlier status identified branch `AC-209/prompt-editor` with a larger uncommitted prompt-editor feature. The user asked to commit, not push.
- The current files match 83 tracked paths at `5a63ca1`; the 10 modified tracked paths and four untracked groups all belong to the prompt-profile editor feature and its task record.
- Recreated linked-worktree metadata against the surviving bare repository, restoring the `AC-209/prompt-editor` branch and index without changing working files. `git diff --check` passes.

## Results
- Staged 18 prompt-profile editor, integration, test, and task-record files; generated `dist-types/` remains ignored by the repository policy.
- `git diff --cached --check`, `npm run types`, and `npm test` passed; the suite reports 268 tests passed, 0 failed.

# System prompt capsule composer

## Acceptance criteria
- [x] Edit the system prompt as one multiline document with insertable, visibly distinct, draggable block capsules and free text.
- [x] The preview and `buildTurn` use that document to produce the actual system prompt; message-position blocks remain separate.
- [x] Existing saved v1 profiles still compile as before; save, revert, import, and export preserve the new document.
- [x] Unknown, repeated, or missing required block capsules fail validation before host LLM work.

## Plan
- [x] Add an optional system document to the profile contract and compile it into literal and source blocks.
- [x] Replace the system block list UI with a multiline capsule composer, drag/drop and keyboard movement, and retain controls for message-position blocks.
- [x] Update types/docs, add focused compiler tests, and check editor interactions in a browser.
- [x] Run typecheck, tests, and a browser flow for inserting, moving, saving, and reverting capsules.

## Working notes
- A native `<textarea>` cannot style an inline capsule. Use a multiline editable textbox with noneditable capsule nodes and a plain string wire format.
- Keep source blocks separate in the compiled output so the system cache prefix still stops before dynamic content.
- The saved v1 contract remains valid when the optional document is absent; it is created only when the new composer changes.
- Keep a caret stop after each noneditable capsule. Reorder capsule nodes among existing text slots so moving them does not consume paragraph separators.

## Results
- The optional `systemTemplate` compiles inline text, names, and system block capsules into the same `system` that `buildTurn` and the preview return. Legacy profiles without it retain the previous output and hash.
- The editor inserts capsules at the caret, supports pointer drag and Alt+arrow reordering, and allows direct typing after inserted or moved capsules. Browser save and revert preserved the document in the standalone profile flow.
- Snack browser verified capsule insertion, free text, preview, save, revert, and a clean console. A Chrome pointer drag verified block order and paragraph spacing; clicking or typing after the moved capsule updated the system preview at that position. The Snack editor is left open in kept tab 19.
- `npm test` passed (273/273), `npm run types` passed, and `git diff --check` passed.

# Rating heading consistency

## Acceptance criteria
- [x] Every rating instruction uses `[묘사 범위]` as its section heading.
- [x] Rating behavior and the directive text stay the same.

## Plan
- [x] Trace the displayed rating text to its source and callers.
- [x] Change the shared rating instruction text and update its golden fixture.
- [x] Run validation and verify the preview in a browser, then record the result.

## Working notes
- `buildTurn` passes `ratingInstruction(rating)` into the `rating` system block. `scene/rating.js` owns the current `묘사 범위:` prefix for all three ratings.
- The existing `127.0.0.1` Snack browser origin reused an old module despite hard reload. Opening the same local server through `localhost` fetched the new text; tab 21 shows the result.

## Results
- `scene/rating.js` now emits `[묘사 범위]` followed by the same rating instruction on the next line for `all`, `teen`, and `adult`. The directive strings are unchanged.
- Updated the golden fixture and added a heading assertion for all three ratings. `npm test` passed (273/273), `npm run types` passed, and `git diff --check` passed.
- Snack browser tab 21 displays `[묘사 범위]` in the assembled system prompt with no console errors.
