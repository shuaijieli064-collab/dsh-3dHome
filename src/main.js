import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildHome, CAMERA_PRESETS, ZONE_LABELS } from './scene/home.js';
import { CHAR_PALETTES } from './scene/characters.js';
import { createResident } from './agents/controller.js';
import { createBubble } from './ui/bubble.js';
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
/*  住客：小拾（唯一模型，屋里的活人）                                   */
/* ------------------------------------------------------------------ */

const resident = createResident({
  scene,
  home,
  zones: home.zones,
  palette: CHAR_PALETTES.marvis,
});

// 障碍盒从已建好的房屋推导一次，据此剪掉穿模的走边。
const navInfo = resident.deriveBlockers();
window.__navInfo = navInfo;

const bubble = createBubble({
  container: document.getElementById('bubble-layer'),
  camera,
  occluders: home.occluders,
  getAnchor: (out) => resident.getHeadPoint(out),
  getState: () => resident.getState(),
});

// 小拾还没加载好之前，别让它挡住视线
resident.loading.then((ok) => {
  if (!ok) console.warn('[home] 小拾未就位（模型加载失败）');
});

// 点击聚焦用的隐形代理：真网格 91 万顶点，直接 raycast 每帧遍历三角形会卡，
// 所以拿一个粗贴身的盒子代替（three 只在点击时测一次，盒子足够）。
const hitProxy = new THREE.Mesh(
  new THREE.BoxGeometry(0.75, 1.15, 0.75),
  new THREE.MeshBasicMaterial({ visible: false })
);
hitProxy.name = 'resident-hit-proxy';
scene.add(hitProxy);

const pickRay = new THREE.Raycaster();
const pickNdc = new THREE.Vector2();
let downAt = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  // 拖过就算转镜头，不当作点击
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5 || !resident.ready) return;

  pickNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pickRay.setFromCamera(pickNdc, camera);
  if (!pickRay.intersectObject(hitProxy, false).length) return;

  resident.getBodyPoint(followPoint);
  focusOn(followPoint);
  followResident = true;
});

/** 拉近到某个世界点（不改预设态，只飞镜头）。 */
function focusOn(point, distance = 2.6) {
  const dir = new THREE.Vector3().subVectors(camera.position, point);
  dir.y = Math.max(dir.y, 0.9);
  dir.normalize().multiplyScalar(distance);
  const toPos = new THREE.Vector3().addVectors(point, dir);

  controls.minDistance = 1.2;
  controls.maxDistance = 30;

  flight = {
    t: 0,
    duration: 0.7,
    fromPos: camera.position.clone(),
    toPos,
    fromTarget: controls.target.clone(),
    toTarget: point.clone(),
  };
  controls.enabled = false;
  controls.autoRotate = false;
  hud.setPresetActive(null);
}

/* ------------------------------------------------------------------ */
/*  Camera flights                                                     */
/* ------------------------------------------------------------------ */

let flight = null;
let autoRotateEnabled = false;
let followResident = false;
const followPoint = new THREE.Vector3();

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

  // 主动切预设就退出跟随，否则镜头刚拉走又被跟回来，两边打架
  followResident = false;
  hud.setFollowActive(false);

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

const followBtn = document.getElementById('follow-btn');
followBtn?.addEventListener('click', () => {
  followResident = !followResident;
  hud.setFollowActive(followResident);
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
  if (key === 'f') {
    followResident = !followResident;
    hud.setFollowActive?.(followResident);
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
// 收到过真实会话事件 → 演示剧本永久让位，不再擅自启动。
let sawLiveEvent = false;
// 日志里是否已经留下演示剧本的记录（首次真事件时清掉）。
let demoLogsShown = false;

function stopLocalDemo() {
  if (!demoStarted) return;
  demoStarted = false;
  sawLiveEvent = true;
  demoIndex = 0;
  if (demoTimer) {
    window.clearTimeout(demoTimer);
    demoTimer = null;
  }
}

function applyEvent(ev) {
  if (!ev || !ev.type) return;

  // 真事件来了：立刻停掉可能在跑的演示剧本（否则假消息会混进会话日志）
  if (!isDemoEvent(ev)) {
    if (demoStarted) stopLocalDemo();
    else sawLiveEvent = true;
    // 首次见到真事件时，把之前演示留下的记录清掉
    if (demoLogsShown) {
      demoLogsShown = false;
      hud.clearDemoLogs();
    }
  } else {
    demoLogsShown = true;
  }

  // 住客先拿事件：它自己区分 snapshot / agent.state / session.end
  resident.onEvent(ev);

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

/** 演示剧本产生的事件打个临时标记，用来和真实会话区分。 */
function isDemoEvent(ev) {
  return ev.__demo === true;
}

function startLocalDemo() {
  // 已经收到过真实会话 → 绝不再跑假剧本
  if (demoStarted || sawLiveEvent) return;
  demoStarted = true;

  const tick = () => {
    if (demoIndex >= DEMO_SCRIPT.length) demoIndex = 0;

    const step = DEMO_SCRIPT[demoIndex];
    applyEvent({ ...step.event, __demo: true });
    demoIndex += 1;

    if (demoIndex >= DEMO_SCRIPT.length) {
      demoTimer = window.setTimeout(tick, 6000);
      return;
    }

    // 脚本跑到一半真会话来了，也要能立刻停
    if (sawLiveEvent) {
      stopLocalDemo();
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
    // 只有从未见过真实事件时才允许降级到演示剧本；见过的永不回退。
    if (status === 'demo' && !sawLiveEvent) startLocalDemo();
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
  resident.update(t, dt);
  updateDust(t);

  if (resident.ready) {
    resident.getBodyPoint(hitProxy.position);
    hitProxy.visible = true;
  } else {
    hitProxy.visible = false;
  }

  if (followResident) {
    // 跟随：把轨道中心平滑挪到小拾身上，镜头本身不动，用户仍可自由旋转
    resident.getBodyPoint(followPoint);
    controls.target.lerp(followPoint, 1 - Math.pow(0.002, dt));
  }

  if (flight) {
    flight.t += dt / flight.duration;
    const k = easeInOutCubic(Math.min(flight.t, 1));
    camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
    if (flight.t >= 1) finishFlight();
  }

  controls.update();
  labels.update();
  bubble.update();
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

window.homeScene = {
  scene,
  camera,
  controls,
  home,
  hud,
  flyTo,
  resident,
  bubble,
  focusOn,
  /** 调试：当前是否跟随小拾 */
  get following() {
    return followResident;
  },
};
