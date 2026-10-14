/** Post-processing: bloom, tilt-shift depth of field, colour grading and vignette. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }, uRes: { value: new THREE.Vector2(1, 1) }, uTilt: { value: 0.9 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1.08 }, uVig: { value: 0.55 }, uContrast: { value: 1.06 }, uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTilt, uSat, uVig, uContrast, uTime; uniform vec3 uTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      // tilt-shift: blur the top and bottom bands to give a miniature, painterly depth of field
      float m = smoothstep(0.26, 0.0, uv.y) * 0.55 + smoothstep(0.76, 1.0, uv.y);
      m = clamp(m, 0.0, 1.0) * uTilt;
      if (m > 0.02) {
        vec3 acc = c; float tot = 1.0; float r = m * 3.2;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853982; vec2 o = vec2(cos(a), sin(a)) * r / uRes * vec2(1.0, 1.0);
          acc += texture2D(tDiffuse, uv + o).rgb; acc += texture2D(tDiffuse, uv + o * 2.0).rgb * 0.6; tot += 1.6;
        }
        c = mix(c, acc / tot, clamp(m * 1.2, 0.0, 1.0));
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c *= uTint;
      c = (c - 0.18) * uContrast + 0.18;
      float v = smoothstep(0.95, 0.28, distance(uv, vec2(0.5)) * 1.25);
      c *= mix(1.0, v, uVig);
      c += (hash(uv * uRes + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, dpr: number) {
    const target = new THREE.WebGLRenderTarget(Math.max(2, w * dpr), Math.max(2, h * dpr), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(dpr); this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.6, 0.88);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize(w, h, dpr);
  }
  resize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr); this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w * dpr, h * dpr);
  }
  setLook(opts: { bloom: boolean; tilt: number; tint: [number, number, number]; vig: number; sat: number; time: number }) {
    this.bloom.enabled = opts.bloom;
    const u = this.grade.uniforms; u.uTilt.value = opts.tilt; u.uTint.value.set(...opts.tint); u.uVig.value = opts.vig; u.uSat.value = opts.sat; u.uTime.value = opts.time;
  }
  render(dt: number) { this.composer.render(dt); }
}
