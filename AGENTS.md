# PatentLens repository instructions

## Active desktop architecture

- PatentLens is an **Electron application**. The production entry point is `electron-main.js`, as declared by `package.json#main`.
- The active renderer is served by Electron's embedded HTTP server from `src/web.html` and uses the bridge exposed by `preload.js` as `window.electronAPI`.
- Use Electron main-process IPC, the preload bridge, or the existing local HTTP API for desktop integrations.

## Tauri is frozen legacy code

- `src-tauri/` is an archived, inactive implementation retained only for historical reference.
- Do not edit, build, fix, synchronize, extend, or port features to `src-tauri/`.
- Do not add new Tauri commands, Rust implementations, `__TAURI__` / `__TAURI_INTERNALS__` branches, Tauri dependencies, or Tauri scripts.
- Existing Tauri compatibility branches outside `src-tauri/` are legacy debt. Do not expand them. Remove them only in a dedicated, explicitly approved Electron-only cleanup with regression coverage.
- If a request appears to require Tauri work, stop and confirm the architecture change explicitly before touching it.

## Large renderer refactors

- Treat `src/scripts/web-app.js` as behavior-critical legacy code. Do not combine feature changes with module extraction.
- `src/scripts/web-app.js` is now frozen against additions. Future features, fixes, helpers, state, event handlers, and UI code must be created under `src/scripts/app/**` (or another explicitly approved feature module), then loaded from the HTML shell in dependency order.
- During dismantling, changes to `web-app.js` may only delete code that has been fully migrated and verified. If a change needs new glue code, put that glue in a module or platform facade; do not add it back to `web-app.js`.
- Run `npm run verify:web-app` before every commit. It fails if the working tree or index adds any line to `web-app.js`.
- If the guard fails during a bug fix, do not bypass it: extract the complete affected slice into `src/scripts/app/**`, add a characterization test, delete the legacy slice, and then fix the behavior in the new module.
- Before moving code, update the inventory and verification baseline in `docs/web-app-refactor-plan-2026-07-31.md`.
- Extract one bounded vertical slice per change. Preserve execution order, global bindings, event-listener ownership, asynchronous cancellation, cache keys, and Electron bridge behavior.
- `src/web.html` is the Electron shell. Do not assume `src/index.html` is equivalent; verify whether a change must be mirrored.
- Every extraction must pass syntax checks, automated characterization tests, Electron smoke tests, and the feature-specific manual checklist before proceeding.
