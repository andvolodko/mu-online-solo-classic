---
name: mu-solo-build
description: >-
  Use this skill whenever building, compiling, or rebuilding the MU Online Solo Classic WebAssembly server or client, and whenever bumping cache-busting asset versions.
---

# MU Online Solo Classic - Build & Cache Busting Workflow

This skill outlines the standard build, compilation, and cache-busting procedures for MU Online Solo Classic.

## 1. Rebuilding the GameServer (WebAssembly)

When C++ files in `src/server/` (e.g., `SoloDataServer.cpp`, `SoloServer.cpp`, etc.) are modified:

1. Execute the server build script via PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File src/server/build.ps1
   ```
   - This automatically activates the Emscripten SDK (`emcc`), configures with CMake (`emcmake cmake`), builds with Ninja, and compiles `muserver.wasm` / `muserver.js`.
   - The output artifacts (`muserver.js`, `muserver.wasm`, `muserver.data`) are automatically copied and deployed to `web/`.

2. When a clean build is needed:
   ```powershell
   powershell -ExecutionPolicy Bypass -File src/server/build.ps1 -Clean
   ```

## 2. Cache Busting / Version Bump Procedure

Browsers aggressively cache WebAssembly binary files, Web Workers, stylesheets, and scripts. Whenever changes are made to the server binary, client binary, or web code, bump the version token (e.g., `login102` -> `login103` -> `login104`) across all synchronized locations:

1. **`web/app.js`**:
   ```javascript
   const BUILD_VERSION = window.BUILD_VERSION = 'loginXXX';
   ```
2. **`web/server_worker.js`**:
   ```javascript
   const WORKER_VERSION = workerParams.get('v') || 'loginXXX';
   ```
3. **`web/index.html`**:
   - `<link rel="stylesheet" href="style.css?v=loginXXX">`
   - `<script src="bg_timer.js?v=loginXXX"></script>`
   - `<script src="preloader.js?v=loginXXX"></script>`
   - `<script src="app.js?v=loginXXX"></script>`
   - `<script async type="text/javascript" src="shell_login.js?t=loginXXX"></script>`
4. **`src/client/build.ps1`**:
   - `& powershell -NoProfile -File $patchScript -Token loginXXX`
5. **`src/client/link-login.bat`**:
   - `powershell -NoProfile -File "%CLIENT_DIR%\patch-login-page.ps1" -Token loginXXX`

## 3. Running & Testing Locally

1. Start the local development server (serves on port 8088 with CDN gzip simulation and appropriate MIME headers):
   ```bash
   node web/serve.cjs
   ```
2. Open the browser at **`http://localhost:8088/`**.

## 4. Rebuilding the WebGL2 Client

When client C++ sources in `src/client/` are modified:
- Run `src/client/compile-objects.bat` to compile modified translation units.
- Run `src/client/link-login.bat` or `powershell -ExecutionPolicy Bypass -File src/client/build.ps1` to link and deploy `shell_login.wasm`, `shell_login.js`, and `shell_login.data` to `web/`.
