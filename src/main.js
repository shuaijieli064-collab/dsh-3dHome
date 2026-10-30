import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildHome, CAMERA_PRESETS, ZONE_LABELS } from './scene/home.js';
import { createLabels } from './ui/labels.js';
import { initHUD } from './ui/hud.js';
import { connectBridge } from './bridge.js';
import { DEMO_SCRIPT } from './data/demo.js';

/* ------------------------------------------------------------------ */
/*  Renderer / scene / camera                                          */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(...CAMERA_PRESETS.overview.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...CAMERA_PRESETS.overview.target);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 6.5;
controls.maxDistance = 38;
controls.minPolarAngle = 0.28;
controls.maxPolarAngle = Math.PI * 0.44;
controls.autoRotateSpeed = 0.5;
controls.update();

/* ------------------------------------------------------------------ */
/*  Home                                                               */
/* ------------------------------------------------------------------ */

const home = buildHome(scene, renderer);

/* ------------------------------------------------------------------ */
/*  HUD + labels                                                       */
/* ------------------------------------------------------------------ */

const hud = initHUD();
hud.setTime('dusk');
hud.setPresetActive('overview');
hud.setConnection('connecting');

// Deep-link a view: http://localhost:5173/#kitchen
const initialPreset = location.hash.replace('#', '').trim();
if (CAMERA_PRESETS[initialPreset]) {
  applyPresetLimits(initialPreset);
  camera.position.set(...CAMERA_PRESETS[initialPreset].pos);
  controls.target.set(...CAMERA_PRESETS[initialPreset].target);
  controls.update();
  hud.setPresetActive(initialPreset);
}

const labels = createLabels(
  document.getElementById('labels'),
  ZONE_LABELS,
  camera,
  (preset) => flyTo(preset),
  home.occluders
);

/* ------------------------------------------------------------------ */
/*  Camera flights                                                     */
/* ------------------------------------------------------------------ */

let flight = null;
let autoRotateEnabled = false;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// Per-preset zoom range: the character stage needs to be inspected up close.
function applyPresetLimits(name) {
  const preset = CAMERA_PRESETS[name];
  controls.minDistance = preset?.near ?? 6.5;
  controls.maxDistance = preset?.far ?? 38;
}

function flyTo(name) {
  const preset = CAMERA_PRESETS[name];
  if (!preset) return;

  applyPresetLimits(name);

  flight = {
    t: 0,
    duration: 0.95,
    fromPos: camera.position.clone(),
    toPos: new THREE.Vector3(...preset.pos),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(...preset.target),
  };

  controls.enabled = false;
  controls.autoRotate = false;
  hud.setPresetActive(name);
}

function finishFlight() {
  flight = null;
  controls.enabled = true;
  controls.autoRotate = autoRotateEnabled;
}

/* ------------------------------------------------------------------ */
/*  Controls binding                                                   */
/* ------------------------------------------------------------------ */

document.querySelectorAll('#dock button').forEach((btn) => {
  btn.addEventListener('click', () => flyTo(btn.dataset.preset));
});

document.querySelectorAll('#time-switch button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.time;
    home.setTimeOfDay(mode);
    hud.setTime(mode);
  });
});

const rotateBtn = document.getElementById('rotate-btn');
rotateBtn.addEventListener('click', () => {
  autoRotateEnabled = !autoRotateEnabled;
  controls.autoRotate = autoRotateEnabled;
  hud.setRotateActive(autoRotateEnabled);
});

const labelsBtn = document.getElementById('labels-btn');
labelsBtn.addEventListener('click', () => {
  labels.setVisible(!labels.visible);
  hud.setLabelsActive(labels.visible);
});
hud.setLabelsActive(true);

const PRESET_KEYS = ['overview', 'living', 'kitchen', 'study', 'workshop', 'loft', 'character'];

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  const index = Number(e.key);
  if (index >= 1 && index <= PRESET_KEYS.length) {
    flyTo(PRESET_KEYS[index - 1]);
    return;
  }

  const key = e.key.toLowerCase();
  if (key === 'r') {
    autoRotateEnabled = !autoRotateEnabled;
    controls.autoRotate = autoRotateEnabled;
    hud.setRotateActive(autoRotateEnabled);
  }
  if (key === 'l') {
    labels.setVisible(!labels.visible);
    hud.setLabelsActive(labels.visible);
  }
  if (key === 'd') {
    home.setTimeOfDay('day');
    hud.setTime('day');
  }
  if (key === 'u') {
    home.setTimeOfDay('dusk');
    hud.setTime('dusk');
  }
  if (key === 'n') {
    home.setTimeOfDay('night');
    hud.setTime('night');
  }
});

/* ------------------------------------------------------------------ */
/*  Dust motes                                                         */
/* ------------------------------------------------------------------ */

const DUST_COUNT = 220;
const dustBase = new Float32Array(DUST_COUNT * 3);
const dustPhase = new Float32Array(DUST_COUNT);
const dustPositions = new Float32Array(DUST_COUNT * 3);

for (let i = 0; i < DUST_COUNT; i++) {
  dustBase[i * 3] = -5.6 + Math.random() * 11.2;
  dustBase[i * 3 + 1] = 0.2 + Math.random() * 3.2;
  dustBase[i * 3 + 2] = -4.2 + Math.random() * 8.4;
  dustPhase[i] = Math.random() * Math.PI * 2;
}

const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

const dustMaterial = new THREE.PointsMaterial({
  color: 0xffe3b8,
  size: 0.035,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const dust = new THREE.Points(dustGeometry, dustMaterial);
dust.frustumCulled = false;
scene.add(dust);

function updateDust(t) {
  const pos = dustGeometry.attributes.position.array;
  for (let i = 0; i < DUST_COUNT; i++) {
    const bx = dustBase[i * 3];
    const by = dustBase[i * 3 + 1];
    const bz = dustBase[i * 3 + 2];
    const phase = dustPhase[i];

    pos[i * 3] = bx + Math.sin(t * 0.25 + phase) * 0.18;
    pos[i * 3 + 1] = 0.2 + ((by + t * 0.06) % 3.3);
    pos[i * 3 + 2] = bz + Math.cos(t * 0.2 + phase) * 0.14;
  }
  dustGeometry.attributes.position.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/*  Event pipeline                                                     */
/* ------------------------------------------------------------------ */

let demoStarted = false;
let demoTimer = null;
let demoIndex = 0;

function applyEvent(ev) {
  if (!ev || !ev.type) return;

  if (ev.type === 'snapshot') {
    hud.applySnapshot(ev);
    return;
  }

  hud.logEvent(ev);

  if (ev.type === 'agent.state' && ev.agent) {
    hud.setAgentState(ev.agent, ev.state, ev);
  }

  if (ev.type === 'confirm.request' && ev.agent) {
    hud.setAgentState(ev.agent, 'waiting_confirm', { task: ev.question });
  }

  if (ev.type === 'task.error' && ev.agent) {
    hud.setAgentState(ev.agent, 'error', ev);
  }

  if (ev.type === 'session.end') {
    hud.resetAgents();
  }
}

function startLocalDemo() {
  if (demoStarted) return;
  demoStarted = true;

  const tick = () => {
    if (demoIndex >= DEMO_SCRIPT.length) demoIndex = 0;

    const step = DEMO_SCRIPT[demoIndex];
    applyEvent(step.event);
    demoIndex += 1;

    if (demoIndex >= DEMO_SCRIPT.length) {
      demoTimer = window.setTimeout(tick, 6000);
      return;
    }

    const next = DEMO_SCRIPT[demoIndex];
    const wait = Math.max(900, next.delay - step.delay);
    demoTimer = window.setTimeout(tick, wait);
  };

  demoTimer = window.setTimeout(tick, 900);
}

const bridge = connectBridge({
  onStatus(status) {
    hud.setConnection(status);
    if (status === 'demo') startLocalDemo();
  },
  onEvent: applyEvent,
});

window.addEventListener('beforeunload', () => {
  bridge.close();
  if (demoTimer) window.clearTimeout(demoTimer);
});

/* ------------------------------------------------------------------ */
/*  Resize                                                             */
/* ------------------------------------------------------------------ */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
}

window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/*  Loop                                                               */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let firstFrame = true;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  for (const update of home.updaters) update(t, dt);
  updateDust(t);

  if (flight) {
    flight.t += dt / flight.duration;
    const k = easeInOutCubic(Math.min(flight.t, 1));
    camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
    if (flight.t >= 1) finishFlight();
  }

  controls.update();
  labels.update();
  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    window.__homeReady = true;
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('is-done');
      window.setTimeout(() => loading.remove(), 900);
    }
  }
}

animate();

window.homeScene = { scene, camera, controls, home, hud, flyTo };
