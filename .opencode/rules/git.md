## Git Conventions

### Commits
Use Conventional Commits: `<type>(scope): description`
- Types: feat, fix, docs, test, refactor, chore, ci, build, perf, revert
- Scopes: client, store, router, adapter, debug, schemas, files, types
- Example: `feat(adapter): add onFileAttachment callback`
- Breaking changes: add `!` after scope or `BREAKING CHANGE:` footer

### Pull Requests
- PR title MUST follow conventional commit format
- PR body MUST use the template at `.github/pull_request_template.md`
- **Every PR MUST reference a GitHub issue.** Use `Closes #<number>` in the Summary section.
- If no issue exists for the work being done:
  1. Ask the user which issue this relates to
  2. If none exists, create one with `gh issue create` before opening the PR
  3. NEVER open a PR without an issue reference

### Branches
- Branch from `main`
- Name format: `<type>/<short-description>` (e.g. `feat/file-attachments`)
