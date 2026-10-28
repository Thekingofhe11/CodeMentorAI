(function () {
  "use strict";

  const attachments = new WeakMap();
  const surfaceProperties = ["--glass-x", "--glass-y"];
  const localProperties = ["--glass-local-x", "--glass-local-y"];

  function attach(surface) {
    if (!surface?.ownerDocument || typeof surface.addEventListener !== "function") {
      throw new TypeError("CodeMentorGlass.attach requires a surface element.");
    }
    if (attachments.has(surface)) return attachments.get(surface);

    const document = surface.ownerDocument;
    const window = document.defaultView;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const forcedColors = window.matchMedia("(forced-colors: active)");
    const media = [finePointer, reducedMotion, forcedColors];
    const hovered = new Set();
    let pending = null;
    let frame = null;
    let destroyed = false;

    surface.setAttribute("data-glass-surface", "");

    const enabled = () => !destroyed && !document.hidden && finePointer.matches &&
      !reducedMotion.matches && !forcedColors.matches;

    function clearLocal(element) {
      element.removeAttribute("data-glass-hover");
      for (const property of localProperties) element.style.removeProperty(property);
    }

    function reset() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      pending = null;
      surface.removeAttribute("data-glass-active");
      for (const property of surfaceProperties) surface.style.removeProperty(property);
      for (const element of hovered) clearLocal(element);
      hovered.clear();
    }

    function isDisabled(path) {
      return [surface, ...path].some((element) => element.matches(":disabled") ||
        element.getAttribute("aria-disabled") === "true");
    }

    function eventPath(event) {
      const path = [];
      const candidates = typeof event.composedPath === "function" ? event.composedPath() : null;
      if (candidates) {
        for (const element of candidates) {
          if (element === surface) return path;
          if (element?.nodeType === 1 && surface.contains(element)) path.push(element);
        }
      } else {
        for (let element = event.target; element; element = element.parentElement) {
          if (element === surface) return path;
          if (element.nodeType === 1) path.push(element);
        }
      }
      return null;
    }

    function render() {
      frame = null;
      const next = pending;
      pending = null;
      if (!next || !enabled() || isDisabled(next.path) ||
          next.path.some((element) => !surface.contains(element))) {
        reset();
        return;
      }

      // Read geometry before any writes; never inspect page text or input values.
      const bounds = surface.getBoundingClientRect();
      const reactive = next.path.filter((element) => element.hasAttribute("data-glass-reactive"));
      const localBounds = reactive.map((element) => [element, element.getBoundingClientRect()]);
      const current = new Set(reactive);
      for (const element of hovered) {
        if (!current.has(element)) clearLocal(element);
      }
      hovered.clear();

      surface.style.setProperty("--glass-x", `${next.x - bounds.left}px`);
      surface.style.setProperty("--glass-y", `${next.y - bounds.top}px`);
      surface.setAttribute("data-glass-active", "");
      for (const [element, rect] of localBounds) {
        element.style.setProperty("--glass-local-x", `${next.x - rect.left}px`);
        element.style.setProperty("--glass-local-y", `${next.y - rect.top}px`);
        element.setAttribute("data-glass-hover", "");
        hovered.add(element);
      }
    }

    function move(event) {
      if (!enabled() || event.pointerType !== "mouse" ||
          !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        reset();
        return;
      }
      const path = eventPath(event);
      if (!path || isDisabled(path)) {
        reset();
        return;
      }
      pending = { x: event.clientX, y: event.clientY, path };
      if (frame === null) frame = window.requestAnimationFrame(render);
    }

    function mediaChanged() {
      if (!enabled()) reset();
    }

    function visibilityChanged() {
      if (document.hidden) reset();
    }

    const pointerOptions = { passive: true };
    surface.addEventListener("pointermove", move, pointerOptions);
    surface.addEventListener("pointerleave", reset, pointerOptions);
    surface.addEventListener("pointercancel", reset, pointerOptions);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibilityChanged);
    for (const query of media) {
      if (typeof query.addEventListener === "function") query.addEventListener("change", mediaChanged);
      else query.addListener(mediaChanged);
    }

    function destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      surface.removeEventListener("pointermove", move, pointerOptions);
      surface.removeEventListener("pointerleave", reset, pointerOptions);
      surface.removeEventListener("pointercancel", reset, pointerOptions);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibilityChanged);
      for (const query of media) {
        if (typeof query.removeEventListener === "function") query.removeEventListener("change", mediaChanged);
        else query.removeListener(mediaChanged);
      }
      attachments.delete(surface);
    }

    const controller = { reset, destroy };
    attachments.set(surface, controller);
    return controller;
  }

  globalThis.CodeMentorGlass = Object.freeze({ attach });
})();
