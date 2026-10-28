(function () {
  'use strict';
  let modulePromise;
  const active = new WeakMap();

  function mount(target) {
    if (!target || active.has(target)) return active.get(target) || (() => {});
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const colors = matchMedia('(forced-colors: active)');
    let closed = false;
    let cleanup;
    let generation = 0;
    let idle;
    target.setAttribute('aria-hidden', 'true');
    target.style.pointerEvents = 'none';

    function stop() {
      generation++;
      if (idle !== undefined) {
        if (globalThis.cancelIdleCallback) cancelIdleCallback(idle);
        else clearTimeout(idle);
      }
      idle = undefined;
      cleanup?.();
      cleanup = undefined;
    }

    function update() {
      stop();
      if (closed || document.hidden || motion.matches || colors.matches) {
        target.dataset.visuals = 'fallback';
        return;
      }
      const current = generation;
      const start = async () => {
        idle = undefined;
        try {
          const probe = document.createElement('canvas');
          const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
          if (!gl) { target.dataset.visuals = 'fallback'; return; }
          gl.getExtension('WEBGL_lose_context')?.loseContext();
          modulePromise ||= import(chrome.runtime.getURL('assets/visuals.js'));
          const visuals = await modulePromise;
          if (closed || current !== generation || !target.isConnected) return;
          cleanup = visuals.mount(target);
        } catch {
          modulePromise = undefined;
          target.dataset.visuals = 'fallback';
        }
      };
      target.dataset.visuals = 'loading';
      idle = globalThis.requestIdleCallback ? requestIdleCallback(start, { timeout: 600 }) : setTimeout(start, 50);
    }

    function destroy() {
      if (closed) return;
      closed = true;
      stop();
      motion.removeEventListener('change', update);
      colors.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
      active.delete(target);
    }
    active.set(target, destroy);
    motion.addEventListener('change', update);
    colors.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return destroy;
  }
  globalThis.CodeMentorVisuals = Object.freeze({ mount });
})();
