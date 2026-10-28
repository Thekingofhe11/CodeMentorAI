import { Container } from './vendor/liquid-glass/container.upstream.js';

// The upstream constructor calls init(); override it so no page snapshot, global
// listener or untracked animation frame is ever installed.
class AmbientGlass extends Container {
  init() {}
  updateSizeFromDOM() {}
  capturePageSnapshot() {}
  initWebGL() {}
  startRenderLoop() {}

  constructor(source, target) {
    super({ borderRadius: 18, tintOpacity: 0.025 });
    this.source = source;
    this.resources = { programs: [], shaders: [] };
    this.createElement();
    this.element.setAttribute('aria-hidden', 'true');
    Object.assign(this.element.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden',
      opacity: '0.55', borderRadius: 'inherit',
    });
    Object.assign(this.canvas.style, { zIndex: '0', boxShadow: 'none', width: '100%', height: '100%' });
    this.canvas.width = Math.min(240, Math.max(1, source.width));
    this.canvas.height = Math.min(180, Math.max(1, source.height));
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    try {
      this.setupCanvas();
      if (!this.gl) throw new Error('Liquid Glass WebGL is unavailable');
      this.setupShader(source);
      if (!this.gl_refs.texture) throw new Error('Liquid Glass shader did not initialize');
      target.append(this.element);
      this.draw();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  getPosition() { return { x: this.source.width / 2, y: this.source.height / 2 }; }

  compileShader(gl, type, source) {
    const bounded = source
      .replaceAll('i = -6.0; i <= 6.0', 'i = -2.0; i <= 2.0')
      .replaceAll('j = -6.0; j <= 6.0', 'j = -2.0; j <= 2.0')
      .replace('x += 0.05', 'x += 0.25')
      .replace('yOffset = -5.0; yOffset <= 5.0', 'yOffset = -1.0; yOffset <= 1.0');
    const shader = super.compileShader(gl, type, bounded);
    if (shader) this.resources.shaders.push(shader);
    return shader;
  }

  createProgram(...args) {
    const program = super.createProgram(...args);
    if (program) this.resources.programs.push(program);
    return program;
  }

  draw() {
    const { gl, texture, textureSizeLoc, pageHeightLoc, viewportHeightLoc, scrollYLoc, containerPositionLoc } = this.gl_refs;
    if (!gl || gl.isContextLost()) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
    gl.uniform2f(textureSizeLoc, this.source.width, this.source.height);
    gl.uniform2f(containerPositionLoc, this.source.width / 2, this.source.height / 2);
    gl.uniform1f(pageHeightLoc, this.source.height);
    gl.uniform1f(viewportHeightLoc, this.source.height);
    gl.uniform1f(scrollYLoc, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    const gl = this.gl;
    if (gl) {
      for (const name of ['positionBuffer', 'texcoordBuffer']) if (this.gl_refs[name]) gl.deleteBuffer(this.gl_refs[name]);
      if (this.gl_refs.texture) gl.deleteTexture(this.gl_refs.texture);
      for (const program of this.resources.programs) gl.deleteProgram(program);
      for (const shader of this.resources.shaders) gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    Container.instances = Container.instances.filter((item) => item !== this);
    this.gl_refs = {};
    this.element?.remove();
    this.source = null;
  }
}

export function createAmbientGlass(source, target) {
  return new AmbientGlass(source, target);
}
