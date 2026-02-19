## Testing Requirements

- Run `bun test` before committing — all tests must pass
- Run `bun run typecheck` before committing — no type errors
- New features require unit tests in `tests/`
- Bug fixes require a regression test proving the fix
- ChannelAdapter interface changes must update Zod schemas in `src/schemas.ts`
- Live tests (`tests/live-*.test.ts`) require a running OpenCode server:
  `LIVE_TEST_URL=http://localhost:4096 bun test tests/live-*.test.ts`
