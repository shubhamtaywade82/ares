# Repository Guidelines

## Project Structure & Module Organization
This is a Node.js + TypeScript project with source code in `src/`. The entrypoint is `src/main.ts`. Delta Exchange integration lives under `src/delta/` and shared configuration is in `src/config/`. Build artifacts compile to `dist/` (generated). There is no dedicated tests directory yet.

## Build, Test, and Development Commands
- `npm run dev`: Run the app in watch mode via `tsx` using `src/main.ts`.
- `npm run build`: Compile TypeScript into `dist/`.
- `npm run start`: Run the compiled output from `dist/main.js`.
- `npm run lint`: Type-check only (`tsc --noEmit`).
- `npm run clean`: Remove `dist/`.

## Coding Style & Naming Conventions
- TypeScript strict mode is enabled. Prefer explicit types at boundaries and avoid `any`.
- Use 2-space indentation and ES module imports with explicit `.js` extensions for local paths (required by `moduleResolution: NodeNext`).
- File naming uses dot-separated suffixes for roles, e.g., `rest.client.ts`, `ws.client.ts`.

## Testing Guidelines
No test framework is configured yet. If you add tests, document the runner and update this section with:
- how to run tests (e.g., `npm test`)
- naming conventions (e.g., `*.test.ts`)
- any coverage thresholds

## Commit & Pull Request Guidelines
Recent commits follow a lightweight Conventional Commits style (e.g., `chore: ...`). Prefer:
- `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
Keep the subject short and specific.

Pull requests should include:
- a brief summary of changes
- any configuration changes (env vars, flags)
- validation notes (commands run and results)

## Security & Configuration Tips
Environment variables are required for Delta Exchange access. Use `.env.example` as a template and avoid committing secrets. Key variables include:
- `DELTA_API_KEY`, `DELTA_API_SECRET`
- `DELTA_BASE_URL`, `DELTA_WS_URL`
- `TRADING_MODE`, `LOG_LEVEL`
