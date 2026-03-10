// /pr command — Create a PR with enforced issue linkage
//
// When agent or user runs `/pr`, this command:
// 1. Checks for uncommitted changes
// 2. Asks for the related issue number (or creates one)
// 3. Reads the PR template from .github/pull_request_template.md
// 4. Creates the PR with the template filled in and issue linked
//
// Usage: /pr
// Usage: /pr 42          (link to issue #42)
// Usage: /pr --create    (create a new issue first)
//
// TODO: Full implementation — currently a placeholder documenting intent.
//       The .opencode/rules/git.md rule enforces issue linkage in the meantime.
