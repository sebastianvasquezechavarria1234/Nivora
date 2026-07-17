import * as THREE from 'three';

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function createNoiseTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(Math.random() * 256);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const noiseTexture = createNoiseTexture();

const RENDER_SCALE = 0.7;
const rtA = new THREE.WebGLRenderTarget(
  Math.floor(window.innerWidth * RENDER_SCALE),
  Math.floor(window.innerHeight * RENDER_SCALE),
  { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
);

const SC = 250.0;

function terrainLJS(x, z) {
  const p0x = x * 0.003 / SC;
  const p0z = z * 0.003 / SC;
  let a = 0.0, b = 1.0;
  let px = p0x, pz = p0z;
  const m = [0.8, -0.6, 0.6, 0.8];
  function hash(ix, iz) {
    let n = (ix | 0) * 374761393 + (iz | 0) * 668265263;
    n = (n ^ (n >> 13)) * 1274126177 | 0;
    return ((n ^ (n >> 16)) & 0x7fffffff) / 0x7fffffff;
  }
  for (let i = 0; i < 3; i++) {
    const ix = Math.floor(px) & 255;
    const iz = Math.floor(pz) & 255;
    const fx = px - Math.floor(px);
    const fz = pz - Math.floor(pz);
    const uu = fx * fx * (3.0 - 2.0 * fx);
    const vv = fz * fz * (3.0 - 2.0 * fz);
    const val = hash(ix, iz) + (hash(ix + 1, iz) - hash(ix, iz)) * uu +
      (hash(ix, iz + 1) - hash(ix, iz)) * vv +
      (hash(ix, iz) - hash(ix + 1, iz) - hash(ix, iz + 1) + hash(ix + 1, iz + 1)) * uu * vv;
    a += b * val;
    b *= 0.5;
    const npx = m[0] * px + m[1] * pz;
    const npz = m[2] * px + m[3] * pz;
    px = npx * 2.0;
    pz = npz * 2.0;
  }
  return SC * 120.0 * a;
}

const terrainVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const terrainFragmentShader = `
precision highp float;

uniform vec3 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;
uniform vec3 uCameraPos;
uniform vec3 uCameraTarget;

varying vec2 vUv;

#define SC 250.0

vec3 noised(in vec2 x) {
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  vec2 p = floor(x);
  float a = texture(iChannel0, (p + vec2(0.0, 0.0) + 0.5) / 256.0).x;
  float b = texture(iChannel0, (p + vec2(1.0, 0.0) + 0.5) / 256.0).x;
  float c = texture(iChannel0, (p + vec2(0.0, 1.0) + 0.5) / 256.0).x;
  float d = texture(iChannel0, (p + vec2(1.0, 1.0) + 0.5) / 256.0).x;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
              du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}

const mat2 m2 = mat2(0.8, -0.6, 0.6, 0.8);

float terrainH(in vec2 x) {
  vec2 p = x * 0.003 / SC;
  float a = 0.0;
  float b = 1.0;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    vec3 n = noised(p);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = m2 * p * 2.0;
  }
  return SC * 120.0 * a;
}

float terrainM(in vec2 x) {
  vec2 p = x * 0.003 / SC;
  float a = 0.0;
  float b = 1.0;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    vec3 n = noised(p);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = m2 * p * 2.0;
  }
  return SC * 120.0 * a;
}

float terrainLow(in vec2 x) {
  vec2 p = x * 0.003 / SC;
  float a = 0.0;
  float b = 1.0;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 n = noised(p);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = m2 * p * 2.0;
  }
  return SC * 120.0 * a;
}

float raycast(in vec3 ro, in vec3 rd, in float tmin, in float tmax) {
  float t = tmin;
  for (int i = 0; i < 120; i++) {
    vec3 pos = ro + t * rd;
    float h = pos.y - terrainM(pos.xz);
    if (abs(h) < (0.0015 * t) || t > tmax) break;
    t += 0.4 * h;
  }
  return t;
}

float softShadow(in vec3 ro, in vec3 rd, float dis) {
  float minStep = clamp(dis * 0.01, SC * 0.5, SC * 50.0);
  float res = 1.0;
  float t = 0.001;
  for (int i = 0; i < 30; i++) {
    vec3 p = ro + t * rd;
    float h = p.y - terrainM(p.xz);
    res = min(res, 16.0 * h / t);
    t += max(minStep, h);
    if (res < 0.001 || p.y > (SC * 200.0)) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 calcNormal(in vec3 pos, float t) {
  vec2 eps = vec2(0.001 * t, 0.0);
  return normalize(vec3(terrainH(pos.xz - eps.xy) - terrainH(pos.xz + eps.xy),
                        2.0 * eps.x,
                        terrainH(pos.xz - eps.yx) - terrainH(pos.xz + eps.yx)));
}

float fbm(vec2 p) {
  float f = 0.0;
  f += 0.5000 * texture(iChannel0, p / 256.0).x;
  p = m2 * p * 2.02;
  f += 0.2500 * texture(iChannel0, p / 256.0).x;
  p = m2 * p * 2.03;
  f += 0.1250 * texture(iChannel0, p / 256.0).x;
  return f / 0.875;
}

const float kMaxT = 5000.0 * SC;

mat3 setCamera(in vec3 ro, in vec3 ta, float cr) {
  vec3 cw = normalize(ta - ro);
  vec3 cp = vec3(sin(cr), cos(cr), 0.0);
  vec3 cu = normalize(cross(cw, cp));
  vec3 cv = normalize(cross(cu, cw));
  return mat3(cu, cv, cw);
}

vec4 render(in vec3 ro, in vec3 rd) {
  vec3 light1 = normalize(vec3(-0.8, 0.4, -0.3));
  float tmin = 1.0;
  float tmax = kMaxT;

  float maxh = 250.0 * SC;
  float tp = (maxh - ro.y) / rd.y;
  if (tp > 0.0) {
    if (ro.y > maxh) tmin = max(tmin, tp);
    else tmax = min(tmax, tp);
  }

  float sundot = clamp(dot(rd, light1), 0.0, 1.0);
  vec3 col;
  float t = raycast(ro, rd, tmin, tmax);

  if (t > tmax) {
    col = vec3(0.3, 0.5, 0.85) - rd.y * rd.y * 0.5;
    col = mix(col, 0.85 * vec3(0.7, 0.75, 0.85), pow(1.0 - max(rd.y, 0.0), 4.0));
    col += 0.25 * vec3(1.0, 0.8, 0.6) * pow(sundot, 64.0);
    col += 0.2 * vec3(1.0, 0.8, 0.6) * pow(sundot, 512.0);
    vec2 sc = ro.xz + rd.xz * (SC * 1000.0 - ro.y) / rd.y;
    col = mix(col, vec3(1.0, 0.95, 1.0), 0.5 * smoothstep(0.5, 0.8, fbm(0.0005 * sc / SC)));
    col = mix(col, 0.68 * vec3(0.4, 0.65, 1.0), pow(1.0 - max(rd.y, 0.0), 16.0));
    t = -1.0;
  } else {
    vec3 pos = ro + t * rd;
    vec3 nor = calcNormal(pos, t);
    vec3 ref = reflect(rd, nor);
    float fre = clamp(1.0 + dot(rd, nor), 0.0, 1.0);
    vec3 hal = normalize(light1 - rd);

    float r = texture(iChannel0, (7.0 / SC) * pos.xz / 256.0).x;
    col = (r * 0.25 + 0.75) * 0.9 * mix(vec3(0.08, 0.05, 0.03), vec3(0.10, 0.09, 0.08),
                                         texture(iChannel0, 0.00007 * vec2(pos.x, pos.y * 48.0) / SC).x);
    col = mix(col, 0.20 * vec3(0.45, 0.30, 0.15) * (0.50 + 0.50 * r), smoothstep(0.70, 0.9, nor.y));
    col = mix(col, 0.15 * vec3(0.30, 0.30, 0.10) * (0.25 + 0.75 * r), smoothstep(0.95, 1.0, nor.y));
    col *= 0.1 + 1.8 * sqrt(fbm(pos.xz * 0.04) * fbm(pos.xz * 0.005));

    float h = smoothstep(55.0, 80.0, pos.y / SC + 25.0 * fbm(0.01 * pos.xz / SC));
    float e = smoothstep(1.0 - 0.5 * h, 1.0 - 0.1 * h, nor.y);
    float o = 0.3 + 0.7 * smoothstep(0.0, 0.1, nor.x + h * h);
    float s = h * e * o;
    col = mix(col, 0.29 * vec3(0.62, 0.65, 0.7), smoothstep(0.1, 0.9, s));

    float amb = clamp(0.5 + 0.5 * nor.y, 0.0, 1.0);
    float dif = clamp(dot(light1, nor), 0.0, 1.0);
    float bac = clamp(0.2 + 0.8 * dot(normalize(vec3(-light1.x, 0.0, light1.z)), nor), 0.0, 1.0);
    float sh = 1.0;
    if (dif >= 0.0001) sh = softShadow(pos + light1 * SC * 0.05, light1, t);
    vec3 lin = vec3(0.0);
    lin += dif * vec3(8.00, 5.00, 3.00) * 1.3 * vec3(sh, sh * sh * 0.5 + 0.5 * sh, sh * sh * 0.8 + 0.2 * sh);
    lin += amb * vec3(0.40, 0.60, 1.00) * 1.2;
    lin += bac * vec3(0.40, 0.50, 0.60);
    col *= lin;

    col += (0.7 + 0.3 * s) * (0.04 + 0.96 * pow(clamp(1.0 + dot(hal, rd), 0.0, 1.0), 5.0)) *
           vec3(7.0, 5.0, 3.0) * dif * sh *
           pow(clamp(dot(nor, hal), 0.0, 1.0), 16.0);
    col += s * 0.65 * pow(fre, 4.0) * vec3(0.3, 0.5, 0.6) * smoothstep(0.0, 0.6, ref.y);

    float fo = 1.0 - exp(-pow(0.001 * t / SC, 1.5));
    vec3 fco = 0.65 * vec3(0.4, 0.65, 1.0);
    col = mix(col, fco, fo);
  }

  col += 0.3 * vec3(1.0, 0.7, 0.3) * pow(sundot, 8.0);
  col = sqrt(col);
  return vec4(col, t);
}

void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  vec3 ro = uCameraPos;
  vec3 ta = uCameraTarget;
  mat3 cam = setCamera(ro, ta, 0.0);
  float fl = 3.0;
  vec2 p = (-iResolution.xy + 2.0 * fragCoord) / iResolution.y;
  vec3 rd = cam * normalize(vec3(p, fl));
  vec4 res = render(ro, rd);
  gl_FragColor = vec4(res.xyz, 1.0);
}
`;

const postVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const postFragmentShader = `
precision highp float;

uniform sampler2D iChannel0;
uniform vec3 iResolution;

varying vec2 vUv;

void main() {
  vec3 col = texture(iChannel0, vUv).xyz;

  col *= 0.5 + 0.5 * pow(16.0 * vUv.x * vUv.y * (1.0 - vUv.x) * (1.0 - vUv.y), 0.1);
  col = clamp(col, 0.0, 1.0);
  col = col * 0.6 + 0.4 * col * col * (3.0 - 2.0 * col) + vec3(0.0, 0.0, 0.04);
  gl_FragColor = vec4(col, 1.0);
}
`;

const terrainUniforms = {
  iTime: { value: 0 },
  iResolution: { value: new THREE.Vector3(window.innerWidth, window.innerHeight, 1) },
  iChannel0: { value: noiseTexture },
  uCameraPos: { value: new THREE.Vector3() },
  uCameraTarget: { value: new THREE.Vector3() }
};

const terrainMaterial = new THREE.ShaderMaterial({
  vertexShader: terrainVertexShader,
  fragmentShader: terrainFragmentShader,
  uniforms: terrainUniforms
});

const postUniforms = {
  iChannel0: { value: null },
  iResolution: { value: new THREE.Vector3(window.innerWidth, window.innerHeight, 1) }
};

const postMaterial = new THREE.ShaderMaterial({
  vertexShader: postVertexShader,
  fragmentShader: postFragmentShader,
  uniforms: postUniforms
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), terrainMaterial);
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial);

const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; e.preventDefault(); });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

const spherePos = new THREE.Vector3(0, terrainLJS(0, 0) + SC * 3, 0);
const cameraOffset = new THREE.Vector3(0, SC * 10, -SC * 20);
const cameraPos = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
let yaw = 0;
const moveSpeed = SC * 60;
const rotSpeed = 2.5;
let prevTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;

  if (keys['ArrowLeft'] || keys['KeyA']) yaw += rotSpeed * dt;
  if (keys['ArrowRight'] || keys['KeyD']) yaw -= rotSpeed * dt;

  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const moveDir = new THREE.Vector3();

  if (keys['ArrowUp'] || keys['KeyW']) moveDir.add(forward);
  if (keys['ArrowDown'] || keys['KeyS']) moveDir.sub(forward);

  if (moveDir.lengthSq() > 0) {
    moveDir.normalize();
    spherePos.addScaledVector(moveDir, moveSpeed * dt);
    spherePos.y = terrainLJS(spherePos.x, spherePos.z) + SC * 3;
  }

  const offset = cameraOffset.clone();
  offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  cameraPos.copy(spherePos).add(offset);
  cameraTarget.copy(spherePos);

  terrainUniforms.uCameraPos.value.copy(cameraPos);
  terrainUniforms.uCameraTarget.value.copy(cameraTarget);
  terrainUniforms.iTime.value = now * 0.001;

  renderer.setRenderTarget(rtA);
  scene.children.length = 0;
  scene.add(quad);
  renderer.render(scene, orthoCamera);

  postUniforms.iChannel0.value = rtA.texture;
  renderer.setRenderTarget(null);
  scene.children.length = 0;
  scene.add(postQuad);
  renderer.render(scene, orthoCamera);
}

animate();

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  terrainUniforms.iResolution.value.set(w, h, 1);
  postUniforms.iResolution.value.set(w, h, 1);
  renderer.setSize(w, h);
  rtA.setSize(Math.floor(w * RENDER_SCALE), Math.floor(h * RENDER_SCALE));
});
