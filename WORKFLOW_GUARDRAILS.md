# SourceCheck Workflow Guardrails

**Purpose:** Prevent the 2-day recovery scenario from repeating.  
**Rule:** When in doubt, checkpoint. When tired, checkpoint. When confused, checkpoint.

---

## 1. Always Commit Before Any Multi-File Pass

**Before starting work:**
```bash
git status                       # See current state
git add -A && git commit -m "savepoint: before [DESCRIPTION]"
```

**Golden rule:** If your pass touches more than 2 files, commit first.

---

## 2. One Scoped Pass at a Time

**Allowed pass types:**
- `fix:` Bug fix (single issue, single layer)
- `feat:` Feature addition (scoped to one component)
- `refactor:` Code restructuring (no behavior change)
- `test:` Test additions/improvements
- `docs:` Documentation only
- `chore:` Build/config changes only

**Forbidden:**
- Mixed bugfix + visual + architecture in one pass
- "While I'm here..." changes
- Refactoring during feature work
- Feature work during bug fixes

---

## 3. Allowed Files / Locked Files Per Pass Type

### Bug Fix Pass
- **Allowed:** The specific file(s) with the bug
- **Allowed:** Test file for that component
- **Locked:** UI components, other features, architecture

### Feature Pass
- **Allowed:** The specific feature files
- **Allowed:** Related types/tests
- **Locked:** Other features, refactors, cleanups

### Refactor Pass
- **Allowed:** The specific code being refactored
- **Allowed:** Tests for that code
- **Required:** Behavior must be identical
- **Locked:** Features, bug fixes

### Release/Config Pass
- **Allowed:** Config files, build scripts
- **Allowed:** Version bumps
- **Locked:** Product code, features

---

## 4. Savepoint After Every Green Pass

**Definition of "Green":**
- Extension builds: `npm run build` passes
- Backend builds: `cd backend && npm run build` passes
- Backend tests: `cd backend && npm test` passes
- TypeScript: `tsc --noEmit` clean

**After every green state:**
```bash
git add -A && git commit -m "[type]: [description]"
```

**If tests fail:**
- STOP
- Fix or revert to last green
- Do NOT proceed with more changes

---

## 5. No Mixed Passes

**Bad commit messages (indicating mixed passes):**
```
"Fix transcript bug and improve card styling"
"Add feature and refactor state management"
"Bug fix + add tests + clean up code"
```

**Good commit messages:**
```
"fix(transcript): handle unicode in caption URLs"
"feat(ui): add error states to source cards"
"refactor(sw): extract verification queue logic"
"test(backend): add rate limit edge cases"
```

---

## 6. Stop If More Than 3 Core Files Drift Across Layers

**Core files (modifying these is high-risk):**
- `src/background/service-worker.ts`
- `src/content/transcript.ts`
- `backend/src/lib/gemini.ts`
- `backend/src/lib/prompts.ts`
- `shared/types.ts`

**Rule:** If your pass modifies >3 of these, STOP and break it into smaller passes.

**Layer crossing (dangerous):**
- Content script + Service Worker + Backend API in one pass
- Extension UI + Service Worker + Content script in one pass

**Safe pattern:**
- Change backend API → Test → Commit
- Change service worker to use new API → Test → Commit
- Change UI to display results → Test → Commit

---

## 7. Never Proceed With Broad Uncommitted Worktree

**Warning signs:**
- `git status` shows 10+ modified files
- You've been working for hours without committing
- You're not sure what all the changes do
- Mix of feature, fix, and cleanup changes

**Recovery:**
```bash
# Option 1: Save everything to a branch
git checkout -b WIP-scratch-work
git add -A && git commit -m "WIP: save progress"
git checkout main

# Option 2: Stash and return to clean
git stash push -m "WIP: experimental changes"
git checkout main
```

---

## 8. Emergency Recovery Procedures

### If Build Breaks
```bash
# Save current work
git stash push -m "broken: save before revert"

# Return to last known good
git log --oneline -5          # Find last green commit
git checkout [COMMIT_HASH]

# Verify green
npm run build
cd backend && npm run build && npm test
```

### If Tests Fail After Changes
```bash
# See what changed
git diff HEAD

# Option 1: Fix forward (if simple)
# Option 2: Partial revert
git checkout HEAD -- [file-to-revert]

# Option 3: Full revert to last green
git reset --hard HEAD         # Destroys uncommitted changes!
```

### If Lost/Confused
```bash
# 1. Stop making changes
# 2. Document current state
git status > CURRENT_STATE.txt
git diff HEAD > CURRENT_CHANGES.patch

# 3. Return to baseline
git checkout baseline-2026-03-17-recovery
```

---

## 9. Pre-Debugging Checklist (Before Any Bug Investigation)

**Run `.agents/workflows/preflight-check.md` gates:**
- [ ] Backend/host reachable and responsive (HTTP 403 from `/api/session/init`)
- [ ] Runtime healthy (no stuck processes, no LevelDB corruption)
- [ ] Build folder fresh (`dist/` timestamp matches latest source)
- [ ] No stale artifacts (rebuild if behavior doesn't match source)

**If any gate fails**: Fix infrastructure first. Do not proceed to code-level debugging.

---

## 10. Pre-Commit Checklist

Before every commit, verify:
- [ ] Change is scoped to one pass type
- [ ] Only allowed files were modified
- [ ] Build passes (`npm run build`)
- [ ] Backend tests pass (`cd backend && npm test`)
- [ ] TypeScript is clean (`tsc --noEmit`)
- [ ] Commit message follows format: `[type](scope): description`

---

## 11. Tagging Baselines

**Create a baseline tag when:**
- Major feature is complete and green
- Before starting risky/architectural work
- End of productive day (working state)
- Before any multi-day pass

```bash
# Create annotated tag
git tag -a baseline-YYYY-MM-DD-[description] -m "Working state: [what works]"

# Push tag (if needed)
git push origin baseline-YYYY-MM-DD-[description]
```

---

## Summary

| Rule | Violation Cost |
|------|----------------|
| Pre-debugging gates | Hours wasted on stale builds |
| Commit before multi-file | 2-4 hours recovery |
| One scoped pass at a time | 1-3 days recovery |
| Savepoint after green | 30 min recovery |
| No mixed passes | 1-2 days untangling |
| Stop at 3 core files | Days of debugging |
| No broad uncommitted work | Total loss of work |

**When in doubt, checkpoint. The 30 seconds to commit beats 2 days of recovery.**
