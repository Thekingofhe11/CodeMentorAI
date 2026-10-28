# Liquid Glass JS

Source: https://github.com/dashersw/liquid-glass-js
Pinned revision: `78cb6ccb0b9987bb60a88b14ccbd13a9e6e8ab2a`
License: MIT, reproduced in `LICENSE`.

`container.upstream.js` is the original Container implementation. The build adds
an ES module export in memory. No demo styles or scripts are
included. The npm package named `liquid-glass-js` belongs to a different project
and is intentionally not used.

Our `liquid-glass.js` wrapper subclasses Container to replace page capture with a
texture supplied by our own ShaderGradient canvas. It never samples LeetCode or
captures a document. The wrapper supplies local coordinates, bounded dimensions,
explicit disposal, and no global scroll handler. Its shader compiler reduces the
blur and tint sampling loops for this small ambient surface. The glass texture is
refreshed at most four times a second, on a maximum 240 × 180 drawing surface.
This is an isolated adaptation of the upstream renderer, not a full-page backdrop
implementation. CSS supplies the readable glass surfaces and fallback.
