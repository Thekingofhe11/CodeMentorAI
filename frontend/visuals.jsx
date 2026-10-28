import React, { Component, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '@react-three/fiber';
import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react';
import { createAmbientGlass } from './liquid-glass.js';

class VisualBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function FrameBudget({ target }) {
  const store = useStore();
  useEffect(() => {
    const get = store.getState;
    const state = get();
    state.setFrameloop('never');
    // ShaderGradientCanvas owns Canvas props. Its resize reconfiguration restores
    // R3F's default "always" loop, so enforce the budget on store changes too.
    const unsubscribe = store.subscribe((next) => {
      if (next.frameloop !== 'never') next.setFrameloop('never');
    });
    let frame = 0;
    let glass = null;
    let failedGlass = false;
    let elapsed = 0;
    const draw = () => {
      if (document.hidden || !target.isConnected) return;
      elapsed += 1 / 12;
      get().advance(elapsed, true);
      if (frame++ % 3 !== 0) return;
      try {
        if (!glass && !failedGlass) glass = createAmbientGlass(state.gl.domElement, target);
        else glass?.draw();
      } catch {
        failedGlass = true;
        glass?.destroy();
        glass = null;
        target.dataset.glass = 'fallback';
      }
    };
    const timer = setInterval(draw, 1000 / 12);
    draw();
    target.dataset.visuals = 'ready';
    return () => {
      unsubscribe();
      clearInterval(timer);
      glass?.destroy();
      state.gl.dispose();
    };
  }, [store, target]);
  return null;
}

export function mount(target) {
  const scene = document.createElement('div');
  Object.assign(scene.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  target.append(scene);
  const root = createRoot(scene);
  let disposed = false;
  let disposalScheduled = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // Remove this first: normal disposal deliberately loses the glass context.
    target.removeEventListener('webglcontextlost', onContextLost, true);
    root.unmount();
    scene.remove();
  };
  const onContextLost = () => {
    if (disposed || disposalScheduled) return;
    disposalScheduled = true;
    target.dataset.visuals = 'fallback';
    // Let Three's own canvas handler finish before releasing the React tree.
    // Capture sees the non-bubbling event from either decorative canvas.
    queueMicrotask(dispose);
  };
  target.addEventListener('webglcontextlost', onContextLost, true);
  const onFailure = () => { target.dataset.visuals = 'fallback'; };
  root.render(
    <VisualBoundary onFailure={onFailure}>
      <ShaderGradientCanvas
        style={{ position: 'absolute', inset: 0 }}
        pixelDensity={0.75} fov={45} pointerEvents="none" lazyLoad={false}
        preserveDrawingBuffer={true} powerPreference="low-power"
      >
        <ShaderGradient
          control="props" type="plane" shader="defaults" animate="on"
          color1="#25105c" color2="#154c70" color3="#7564ca"
          uSpeed={0.12} uStrength={2} uDensity={1.4} uFrequency={3.5}
          lightType="3d" brightness={0.8} grain="off" reflection={0}
          cDistance={4} cPolarAngle={90} cAzimuthAngle={180}
          positionX={-1.4} rotationY={10} rotationZ={45}
          enableTransition={false} enableCameraUpdate={false}
        />
        <FrameBudget target={target} />
      </ShaderGradientCanvas>
    </VisualBoundary>,
  );
  return dispose;
}
