// Paper grain, ported from the blog's paper shader (mochi-brain-blog.html) and reduced to its fine fibre term:
// per-pixel luminance noise only, monochrome, amplitude ≤ 1.2%, drawn as a transparent overlay at half
// resolution. No low-frequency mottling and no tint. Static, so it is drawn only on resize or day/night change.
const VS = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `
precision mediump float;
uniform float u_night;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
void main() {
  float n = hash(floor(gl_FragCoord.xy)) - 0.5;      // fine, per-pixel, one channel
  float amp = 0.012;                                  // at most 1.2% luminance
  float a = abs(n) * 2.0 * amp;
  float lum = n > 0.0 ? 1.0 : 0.0;                    // a lighter or darker fibre, never a colour
  if (u_night < 0.5 && n > 0.0) a *= 0.5;             // by day mostly darker fibres
  gl_FragColor = vec4(vec3(lum) * a, a);
}`;

export function paper(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true, alpha: true });
  if (!gl) return null;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uNight = gl.getUniformLocation(prog, 'u_night');
  return {
    resize() {
      const s = Math.min(devicePixelRatio || 1, 1.5) * 0.5; // half resolution
      canvas.width = Math.ceil(canvas.clientWidth * s); canvas.height = Math.ceil(canvas.clientHeight * s);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw(night: number) {
      gl.uniform1f(uNight, night);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
