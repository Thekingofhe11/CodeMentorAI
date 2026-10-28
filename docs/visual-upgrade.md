# Dark glass visual upgrade

The mentor and toolbar popup now use charcoal surfaces, violet/cyan reflections, clearer focus states, and consistent spacing. The mentor includes an expandable brief from the detected problem description. Existing problem extraction, service-worker requests, progressive hints, solutions, history, and API keys remain in their original architecture. Reopening a conversation scrolls to its latest reply.

## Libraries

| Dependency | Version | Role |
| --- | --- | --- |
| React / React DOM | 18.3.1 | Isolated decorative root inside the panel's Shadow DOM |
| @shadergradient/react | 2.4.20 | Ambient plane with animated violet and blue shading |
| @react-three/fiber | 8.18.0 | Renderer used by ShaderGradient, with a controlled 12 FPS frame budget |
| three | 0.169.0 | One deduplicated Three.js runtime |
| camera-controls | 2.9.0 | Compatible ShaderGradient renderer dependency |
| three-stdlib | 2.30.1 | Compatible ShaderGradient dependency |
| esbuild | 0.25.12 | Local production bundle |
| Liquid Glass JS | commit `78cb6ccb0b9987bb60a88b14ccbd13a9e6e8ab2a` | Adapted upstream refraction renderer |

Liquid Glass's official repository has a browser-global `Container` implementation, rather than an npm module. Its pinned MIT source is retained under `frontend/vendor/liquid-glass/`; the build adds a module export in memory. The wrapper disables its page capture and global scroll/render hooks. It samples only our own shader canvas, with a maximum 240 × 180 glass canvas refreshed at 4 FPS and reduced shader sampling. This creates ambient refraction; CSS supplies the readable translucent panel surfaces. It does not capture LeetCode or the editor.

The lazy visual bundle is about 1.2 MB before compression. The panel loads it only when opened, after checking motion preferences and WebGL2. Closing the panel or hiding the page disposes the scene. Reduced motion, forced colors, unavailable WebGL, and context loss retain the CSS fallback. Resizing preserves the frame budget. No CDN scripts, page-world React root, remote textures, extra extension permissions, or frontend keys were introduced.

## Run

```powershell
npm.cmd ci
npm.cmd run build
backend\venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
backend\venv\Scripts\python.exe tools\preview.py
```

Open <http://127.0.0.1:4173/problems/two-sum/>. If that port is already occupied, use `tools\preview.py --port 4174` and open <http://127.0.0.1:4174/problems/two-sum/>. The toolbar popup fixture is at `/popup/`.

For Chrome, load the existing `extension` folder as unpacked, or reload its existing card after a build, then refresh LeetCode. The local fixture uses the same panel code and real backend through a loopback proxy; it is not a live LeetCode extension installation.

## Changed files

- Existing: `package.json`, `extension/manifest.json`, `extension/content.js`, `extension/styles.css`, `extension/popup.css`, `extension/popup.html`, `tools/preview.html`, `tools/preview.py`, `README.md`.
- Added: `package-lock.json`, `frontend/`, `tools/build.mjs`, `extension/visual-loader.js`, `extension/tests/visual-loader.test.cjs`, `extension/assets/`, `docs/dark-mentor-demo.jpg`, and these notes.
- Backend API code was not changed.

## Verification

The build checks for one Three.js runtime and rejects unresolved runtime imports. On October 28, 2026, `npm.cmd run build`, `npm.cmd run check`, all 38 JavaScript tests, and all 34 backend tests passed. Nine new loader tests cover fallback, cancellation, import races, visibility and preference changes, and listener cleanup. Node prints an experimental VM-loader warning for that test fixture. Production dependency audit reported zero vulnerabilities.

Live Gemini requests in the local browser preview returned a progressive hint and a Python solution with explanation and complexity. The solution preserved the 1/3 hint level. The browser restored history after refresh and after switching to Valid Parentheses and back. The extracted problem brief and empty-approach validation worked. The shader and glass canvases rendered without console errors and were removed on close. Desktop (1440 × 900) and narrow (390 × 844) layouts were inspected; a narrow-screen scrollbar clipping issue was fixed. Installed Chrome extension behavior against the current live LeetCode layout remains a separate smoke test.
