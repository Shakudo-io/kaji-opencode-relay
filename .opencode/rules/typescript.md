## TypeScript Standards

- Strict mode enforced via tsconfig.json
- NEVER use `as any`, `@ts-ignore`, or `@ts-expect-error`
- NEVER use empty catch blocks
- Use named exports only (no default exports)
- Import SDK types through `./types.ts` re-exports, not directly from SDK
- Use explicit types on public API boundaries; inference OK internally
- Error handling: always narrow `unknown` in catch blocks
- No `console.log` in library code — use the Logger interface
- No rendering/UI dependencies — this is a headless library
