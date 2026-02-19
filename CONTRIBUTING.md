# Contributing to kaji-opencode-relay

## For Everyone (Humans & Agents)

### Quick Start
```bash
git clone https://github.com/Shakudo-io/kaji-opencode-relay.git
cd kaji-opencode-relay
bun install
bun test
```

### Commit Convention
Conventional Commits: `type(scope): description`

See `.opencode/rules/git.md` for allowed types, scopes, and branch naming.

### Code Standards
TypeScript strict mode. No type suppressions. No default exports.

See `.opencode/rules/typescript.md` for full details.

### Pull Request Process
1. Branch from `main` as `type/short-description`
2. Make changes with tests
3. Run `bun test` and `bun run typecheck`
4. Open PR with title following conventional commits
5. PR body must use the template and reference a GitHub issue
6. Use `/pr` command or `gh pr create` with issue linkage

### Every PR Must Have an Issue
No exceptions. If one doesn't exist:
- Create it: `gh issue create --title "..." --body "..."`
- Then reference it: `Closes #<number>` in PR description

## For AI Agents

### Before Starting Work
- Read `AGENTS.md` for architecture and conventions
- Read `.opencode/rules/` for mandatory standards
- Check existing tests for patterns to follow

### Building New Adapters
- Start from `src/debug/adapter.ts` — it implements every `ChannelAdapter` method
- See the "Debug Adapter" and "Building a Channel Adapter" sections in README.md
- Run the debug CLI against a live server to see the event flow before coding

### Key Constraints
- Zero UI dependencies — headless library only
- ChannelAdapter is the public contract — changes are breaking
- SyncStore mirrors TUI behavior — don't deviate without justification
- All types flow through `src/types.ts`

### Creating PRs
- Use the `/pr` command which enforces issue linkage
- If working on something without an issue, ask the user first
- NEVER open a PR with `Closes #` left empty

## For Humans

### Development Setup
- Install Bun: https://bun.sh
- Install OpenCode: https://opencode.ai (for live tests only)

### Running Live Tests
```bash
opencode serve  # start server
LIVE_TEST_URL=http://localhost:4096 bun test tests/live-*.test.ts
```

### Publishing
```bash
bun run build && npm publish
```

### Architecture Reference
See `specs/001-headless-core/spec.md` for the full design spec.
