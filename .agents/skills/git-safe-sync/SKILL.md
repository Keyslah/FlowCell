---
name: git-safe-sync
description: Use when the user wants a local Git repo safely synced without losing local work, especially for rejected pushes, needed pulls, local commits that must be preserved before merging remote changes, or requests like "fix my commits and pulls", "sync this repo safely", or "save my work before pulling".
---

# Git Safe Sync

Safely sync a local Git repository while preserving local work and avoiding destructive recovery commands.

Use this skill when the user wants Git help that is safety-first rather than minimal-command-only.

## Workflow

1. Inspect the repo state first.
   - Run `git status --short --branch`.
   - Read the current branch with `git branch --show-current`.
   - Read the upstream if present.
   - Show recent local commits and recent `origin/main` or upstream commits.

2. Protect the current local state before integrating remote changes.
   - Create a backup branch from the current `HEAD` named `backup-before-sync-YYYYMMDD-HHMM`.
   - Do this before merge or pull if local work matters.

3. Save uncommitted local changes before sync.
   - If the worktree is dirty, stage only intended repo files.
   - Create a plain safety commit such as `Save local changes before GitHub sync` unless the user gave a specific message.
   - Do not stage obvious local runtime state, caches, generated temp files, or ignored machine-specific folders unless the user explicitly asked.

4. Fetch and integrate remote changes safely.
   - Prefer `git fetch origin` followed by a normal `git merge origin/main` or the branch's upstream.
   - Use merge, not rebase, not reset, and never force push unless the user explicitly asks.
   - If push was rejected, fetch first, inspect divergence, then merge.

5. Resolve only narrow, safe conflicts automatically.
   - Safe examples: simple README text conflicts, add-file collisions, or case-normalization problems such as `Scriptbank` vs `ScriptBank`.
   - Keep both legitimate local content and legitimate remote additions when possible.
   - Preserve user files.
   - If conflicts are broader than obvious documentation or folder-normalization fixes, stop and report the exact files instead of guessing.

6. Verify before pushing.
   - Run `git status --short --branch`.
   - Confirm the merge completed and the worktree is clean or only contains expected intended changes.
   - Push only after verification passes.

7. Report exact results.
   - State the backup branch name.
   - State any commit hashes/messages created during the sync.
   - State which remote commits were merged.
   - State any conflicts resolved and how.
   - State whether push succeeded.

## Guardrails

- Never use `git reset --hard`, `git checkout --`, `git clean -fd`, or force push unless the user explicitly asked.
- Never delete user files to make Git easier.
- Treat case-only path differences on Windows as a real risk and normalize them carefully with tracked renames when needed.
- Honor repo-specific instructions such as `AGENTS.md`.
- If the repo has protected local-state paths, keep them out of commits and never overwrite them.

## FlowCell Note

When the repo is `D:\Dev\workspace\Codex\flowcell\`:

- Never overwrite or stage `FlowCell\local\` unless the user explicitly asks.
- Keep `PROGRAM_SUMMARY.txt` accurate if FlowCell source changes are made as part of the sync repair.
- If a merge introduces `ScriptBank` casing conflicts, normalize to one canonical path instead of leaving mixed-case tracked paths.

## Trigger Examples

- "Fix my commits and pulls first."
- "My push was rejected, sync this safely."
- "Save my local work, pull GitHub changes, and push."
- "Make sure this repo merges without deleting anything."
