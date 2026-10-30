import * as THREE from 'three';
import {
  C,
  armchair,
  at,
  bookStack,
  bookshelf,
  box,
  cat,
  chair,
  clock,
  coffeeTable,
  consoleTable,
  curtain,
  cyl,
  desk,
  diningTable,
  fireplace,
  fireTools,
  floorLamp,
  fridge,
  globe,
  headboard,
  kitchenCounter,
  kitchenIsland,
  ladder,
  laptop,
  logBasket,
  loftBed,
  material,
  mirror,
  pictureFrame,
  placeSetting,
  plant,
  railing,
  rbox,
  rug,
  serverRack,
  slippers,
  sofa,
  stool,
  stringLights,
  succulent,
  tableLamp,
  telescope,
  throwBlanket,
  vaseWithBranches,
  wallShelf,
  windowSeat,
  workbench,
  pegboard,
} from './props.js';
import { makeFloorTexture, makeOutsideTexture, makeWallTexture } from './textures.js';
import { buildCharacterStage, CHAR_PALETTES, loadModelIntoStage } from './characters.js';

/* ------------------------------------------------------------------ */
/*  Layout constants                                                   */
/* ------------------------------------------------------------------ */

export const HOUSE = {
  width: 12,
  depth: 9,
  wallHeight: 3.8,
  wallThickness: 0.2,
  // High enough that the study nook underneath stays visible from the
  // default three-quarter camera. 2.55 hid the whole room behind the deck.
  loftY: 2.9,
};

export const ZONES = {
  main: { room: '客厅', anchor: [4.2, 0, -2.15], desk: [4.2, 0, -2.15] },
  file: { room: '书房', anchor: [-4.2, 0, -2.2], desk: [-5.0, 0, -2.2] },
  computer: { room: '工具间', anchor: [-3.9, 0, 2.6], desk: [-4.9, 0, 2.6] },
  app: { room: '厨房', anchor: [3.3, 0, 3.35], desk: [3.3, 0, 3.35] },
  browser: { room: '飘窗', anchor: [2.1, 0, -3.5], desk: [2.1, 0, -3.5] },
  search: { room: '阁楼', anchor: [-3.6, HOUSE.loftY, -2.4], desk: [-3.0, HOUSE.loftY, -1.8] },
};

export const CAMERA_PRESETS = {
  overview: { pos: [14.4, 13.0, 16.4], target: [0.1, 1.1, 0] },
  living: { pos: [2.6, 6.8, 9.2], target: [3.9, 0.9, -2.2] },
  // Framed from inside the room: the kitchen's cabinet fronts and tap now face
  // the room, so an outside view would only show the back panels.
  kitchen: { pos: [2.2, 3.9, 0.6], target: [4.4, 0.85, 3.7] },
  study: { pos: [1.8, 3.1, 7.6], target: [-4.5, 1.2, -2.4] },
  workshop: { pos: [-3.2, 5.8, 9.4], target: [-4.3, 0.95, 2.3] },
  loft: { pos: [4.6, 9.2, 6.4], target: [-3.7, 3.0, -2.4] },
  // 小拾现在住在屋里，不再站屋外展示台：这里对准它的常驻落脚点（客厅）。
  character: { pos: [4.9, 2.5, 3.4], target: [4.2, 0.95, -2.15], near: 1.2, far: 26 },
};

export const ZONE_LABELS = [
  { id: 'living', text: '客厅', sub: '主 Agent', pos: [4.3, 3.05, -2.2], preset: 'living' },
  { id: 'browser', text: '飘窗', sub: 'Browser', pos: [1.5, 2.75, -3.85], preset: 'living' },
  { id: 'file', text: '书房', sub: 'File', pos: [-4.2, 2.12, -2.2], preset: 'study' },
  { id: 'computer', text: '工具间', sub: 'Computer', pos: [-3.9, 2.55, 2.6], preset: 'workshop' },
  { id: 'app', text: '厨房', sub: 'App', pos: [3.5, 2.65, 2.6], preset: 'kitchen' },
  { id: 'search', text: '阁楼', sub: 'Search', pos: [-3.6, 4.15, -2.4], preset: 'loft' },
];

/* ------------------------------------------------------------------ */
/*  Time of day                                                        */
/* ------------------------------------------------------------------ */

const MODES = {
  day: {
    sunColor: 0xfff3e0,
    sunIntensity: 2.7,
    sunPos: [9, 13, 10],
    hemiSky: 0xdfeeff,
    hemiGround: 0x9a6f4a,
    hemiIntensity: 0.6,
    fillIntensity: 0.3,
    fillColor: 0xffe4cc,
    exposure: 1.0,
    lampScale: 0.25,
    windowTint: 0xffffff,
    windowOpacity: 1,
  },
  dusk: {
    sunColor: 0xffb47a,
    sunIntensity: 1.75,
    // Keep the low warm sun but lift it a little: at y=5 the fridge and the
    // side counter threw a 5 m shadow straight across the kitchen island and
    // every vertical face went near-black.
    sunPos: [9, 9.5, 8],
    hemiSky: 0xffc9a0,
    hemiGround: 0x7b5949,
    hemiIntensity: 0.55,
    fillIntensity: 0.62,
    fillColor: 0xffd8bc,
    exposure: 1.02,
    lampScale: 1.0,
    windowTint: 0xffb98a,
    windowOpacity: 1,
  },
  night: {
    sunColor: 0x9bb8ff,
    sunIntensity: 0.35,
    sunPos: [-8, 9, -6],
    hemiSky: 0x2c3a5a,
    hemiGround: 0x1d1a24,
    hemiIntensity: 0.24,
    fillIntensity: 0.14,
    fillColor: 0x8fa8d8,
    exposure: 1.12,
    lampScale: 1.8,
    windowTint: 0x2b3d63,
    windowOpacity: 1,
  },
};

/* ------------------------------------------------------------------ */
/*  Builders                                                           */
/* ------------------------------------------------------------------ */

function wallBox(parent, mat, cx, cy, cz, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(cx, cy, cz);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.occluder = true;
  parent.add(m);
  return m;
}

function buildWindow(parent, { cx, y0, y1, w }, glassMat, outsideMat) {
  const h = y1 - y0;
  const cy = (y0 + y1) / 2;
  const z = -4.5;

  const frameColor = 0xf6ecdc;
  const fw = 0.075;
  const fd = 0.12;

  const top = box(w + fw * 2, fw, fd, frameColor);
  top.position.set(cx, y1, z + 0.02);
  parent.add(top);

  const bottom = box(w + fw * 2, fw, fd, frameColor);
  bottom.position.set(cx, y0, z + 0.02);
  parent.add(bottom);

  for (const s of [-1, 1]) {
    const side = box(fw, h, fd, frameColor);
    side.position.set(cx + s * (w / 2 + fw / 2), cy, z + 0.02);
    parent.add(side);
  }

  const mullionV = box(0.035, h, 0.06, frameColor);
  mullionV.position.set(cx, cy, z + 0.03);
  parent.add(mullionV);

  const mullionH = box(w, 0.035, 0.06, frameColor);
  mullionH.position.set(cx, cy, z + 0.03);
  parent.add(mullionH);

  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), glassMat);
  glass.position.set(cx, cy, z + 0.05);
  parent.add(glass);

  const outside = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.6, h + 1.2), outsideMat);
  outside.position.set(cx, cy, z - 0.28);
  parent.add(outside);

  const sill = box(w + 0.26, 0.06, 0.28, 0xf6ecdc);
  sill.position.set(cx, y0 - 0.06, z + 0.16);
  parent.add(sill);
}

function buildWallGeometry(parent, wallMat) {
  const H = HOUSE.wallHeight;
  const T = HOUSE.wallThickness;

  // Back wall (z = -4.5), two window openings.
  const winA = { x0: -4.9, x1: -3.4, y0: 1.05, y1: 2.35 };
  const winB = { x0: 1.35, x1: 2.85, y0: 1.05, y1: 2.35 };

  // strips below and above the windows
  wallBox(parent, wallMat, 0, winA.y0 / 2, -4.5 - T / 2, HOUSE.width, winA.y0, T);
  wallBox(parent, wallMat, 0, (winA.y1 + H) / 2, -4.5 - T / 2, HOUSE.width, H - winA.y1, T);

  // piers between openings
  const piers = [
    [-6, winA.x0],
    [winA.x1, winB.x0],
    [winB.x1, 6],
  ];
  for (const [x0, x1] of piers) {
    wallBox(parent, wallMat, (x0 + x1) / 2, (winA.y0 + winA.y1) / 2, -4.5 - T / 2, x1 - x0, winA.y1 - winA.y0, T);
  }

  // Left wall (x = -6)
  wallBox(parent, wallMat, -6 - T / 2, H / 2, 0, T, H, HOUSE.depth + T);

  // Baseboards + chair rail
  const trimMat = material(C.creamDeep, { roughness: 0.7 });
  wallBox(parent, trimMat, 0, 0.07, -4.5 + 0.015, HOUSE.width, 0.14, 0.03);
  wallBox(parent, trimMat, -6 + 0.015, 0.07, 0, 0.03, 0.14, HOUSE.depth);

  const railMat = material(C.oakLight, { roughness: 0.7 });
  wallBox(parent, railMat, 0, 1.02, -4.5 + 0.02, HOUSE.width, 0.045, 0.035);
  wallBox(parent, railMat, -6 + 0.02, 1.02, 0, 0.035, 0.045, HOUSE.depth);

  // Crown moulding
  wallBox(parent, railMat, 0, H - 0.06, -4.5 + 0.02, HOUSE.width, 0.12, 0.05);
  wallBox(parent, railMat, -6 + 0.02, H - 0.06, 0, 0.05, 0.12, HOUSE.depth);

  return { winA, winB };
}

/* ------------------------------------------------------------------ */
/*  Main build                                                         */
/* ------------------------------------------------------------------ */

export function buildHome(scene, renderer, opts = {}) {
  const group = new THREE.Group();
  scene.add(group);

  let characterStage = null;

  const floorTex = makeFloorTexture();
  const wallTex = makeWallTexture();
  const outsideTex = makeOutsideTexture();

  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.82,
    metalness: 0.02,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    roughness: 0.95,
    metalness: 0,
  });
  const outsideMat = new THREE.MeshBasicMaterial({ map: outsideTex, color: 0xffffff });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe6ee,
    transparent: true,
    opacity: 0.2,
    roughness: 0.08,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  /* ---------------- platform + floor ---------------- */

  const plinth = box(13.0, 0.5, 10.0, C.oakDark, { roughness: 0.7 });
  plinth.position.y = -0.27;
  group.add(plinth);

  const trim = box(12.35, 0.06, 9.35, C.oakLight, { roughness: 0.7 });
  trim.position.y = -0.06;
  group.add(trim);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(HOUSE.width, 0.1, HOUSE.depth), floorMat);
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  group.add(floor);

  /* ---------------- walls + windows ---------------- */

  const { winA, winB } = buildWallGeometry(group, wallMat);

  buildWindow(group, { cx: (winA.x0 + winA.x1) / 2, y0: winA.y0, y1: winA.y1, w: winA.x1 - winA.x0 }, glassMat, outsideMat);
  buildWindow(group, { cx: (winB.x0 + winB.x1) / 2, y0: winB.y0, y1: winB.y1, w: winB.x1 - winB.x0 }, glassMat, outsideMat);

  const curtains = curtain(2.0, 2.5, 0xd9b79a);
  curtains.position.set((winB.x0 + winB.x1) / 2, 0, -4.32);
  group.add(curtains);

  // No ceiling beams: the dollhouse has no roof plane, so "beams" read as
  // floating planks and they also made every ceiling fixture look unanchored.

  /* ---------------- study + loft ---------------- */

  // Anchored on the desk + chair cluster. It used to sit 1.8 m to their right,
  // so the desk stood on bare floor and the rug read as a stray mat.
  const studyRug = rug(2.2, 2.6, 0, 2);
  studyRug.position.set(-4.85, 0, -2.0);
  group.add(studyRug);

  // Right of window A (which spans x -4.9..-3.4) so the glass stays clear.
  const shelf = bookshelf(1.8, 1.9, 0.36, 5);
  shelf.position.set(-2.35, 0, -4.28);
  group.add(shelf);

  // The shelf top was a bare slab of oak. A trailing plant and a leaning stack
  // finish it, and they still clear the loft deck 0.85 m above.
  const shelfPlant = plant('small', 0.52);
  shelfPlant.position.set(-1.72, 1.9, -4.26);
  group.add(shelfPlant);

  const shelfBooks = bookStack(5, 0.9);
  shelfBooks.position.set(-2.92, 1.9, -4.24);
  group.add(shelfBooks);

  const studyDesk = desk(1.5, 0.72);
  studyDesk.position.set(-5.52, 0, -2.2);
  studyDesk.rotation.y = Math.PI / 2;
  group.add(studyDesk);

  const studyChair = chair();
  studyChair.position.set(-4.62, 0, -2.2);
  studyChair.rotation.y = -Math.PI / 2;
  group.add(studyChair);

  const studyArt = pictureFrame(0.52, 0.72, 2);
  studyArt.position.set(-5.97, 1.62, -2.2);
  studyArt.rotation.y = Math.PI / 2;
  group.add(studyArt);

  const studyClock = clock();
  studyClock.position.set(-5.97, 2.02, -3.35);
  studyClock.rotation.y = Math.PI / 2;
  group.add(studyClock);

  const fileCabinet = box(0.52, 0.72, 0.46, C.slateDeep, { roughness: 0.7 });
  fileCabinet.position.set(-1.15, 0.36, -4.15);
  group.add(fileCabinet);

  for (let i = 0; i < 2; i++) {
    const handle = box(0.2, 0.02, 0.02, C.metal, { metalness: 0.6, roughness: 0.3 });
    handle.position.set(-1.15, 0.54 - i * 0.2, -3.91);
    group.add(handle);
  }

  const cabinetPlant = succulent();
  cabinetPlant.position.set(-1.15, 0.72, -4.15);
  group.add(cabinetPlant);

  // loft platform
  const loft = box(4.8, 0.16, 4.2, C.oak, { roughness: 0.75 });
  loft.position.set(-3.6, HOUSE.loftY - 0.08, -2.4);
  loft.userData.occluder = true;
  group.add(loft);

  for (const z of [-0.42, -2.4]) {
    const post = box(0.12, HOUSE.loftY - 0.1, 0.12, C.oakDark);
    post.position.set(-1.3, (HOUSE.loftY - 0.1) / 2, z);
    group.add(post);
  }

  const loftRailSide = railing(3.9, 7);
  loftRailSide.position.set(-1.28, HOUSE.loftY, -2.4);
  loftRailSide.rotation.y = Math.PI / 2;
  group.add(loftRailSide);

  const loftRailFront = railing(2.9, 5);
  loftRailFront.position.set(-4.42, HOUSE.loftY, -0.4);
  group.add(loftRailFront);

  const loftLadder = ladder(3.05, 0.5);
  loftLadder.position.set(-1.95, 0, 0.5);
  loftLadder.rotation.x = -0.28;
  group.add(loftLadder);

  const bed = loftBed(1.5, 2.0);
  bed.position.set(-4.65, HOUSE.loftY, -2.85);
  group.add(bed);

  // The mattress simply stopped against nothing: a headboard closes the head
  // end, and a folded throw over the foot gives the bed a made-up silhouette.
  const bedHead = headboard(1.56, C.oakDark);
  bedHead.position.set(-4.65, HOUSE.loftY, -3.94);
  group.add(bedHead);

  // Folded throw at the foot. Flattened vertically so the draped length stays
  // above the loft deck instead of poking through it.
  const bedThrow = throwBlanket(0.82, C.sage);
  bedThrow.scale.set(1, 0.58, 1);
  bedThrow.position.set(-4.65, HOUSE.loftY + 0.44, -1.92);
  group.add(bedThrow);

  const loftArt = pictureFrame(0.4, 0.5, 4);
  loftArt.position.set(-5.97, HOUSE.loftY + 0.62, -2.85);
  loftArt.rotation.y = Math.PI / 2;
  group.add(loftArt);

  // Reading cushion in the free strip between the desk and the railing.
  const loftCushion = rbox(0.5, 0.14, 0.5, 0.05, C.claySoft);
  loftCushion.position.set(-2.45, HOUSE.loftY + 0.07, -2.7);
  group.add(loftCushion);

  const loftBooks = bookStack(3, 0.9);
  loftBooks.position.set(-2.45, HOUSE.loftY, -3.02);
  group.add(loftBooks);

  // A runner at the foot of the bed, centred on the bed axis instead of
  // drifting off toward the walkway.
  const loftRug = rug(2.3, 1.15, 0, 1);
  loftRug.position.set(-4.6, HOUSE.loftY, -1.3);
  group.add(loftRug);

  // Stepped out of, toes towards the railing.
  const bedSlippers = slippers(C.claySoft);
  bedSlippers.position.set(-3.62, HOUSE.loftY + 0.018, -1.02);
  bedSlippers.rotation.y = -0.35;
  group.add(bedSlippers);

  const loftGlobe = globe();
  loftGlobe.position.set(-3.45, HOUSE.loftY, -3.6);
  group.add(loftGlobe);

  // Search agent's little corner: a desk under the fairy lights.
  const loftDesk = desk(1.15, 0.55);
  loftDesk.position.set(-2.5, HOUSE.loftY, -4.12);
  group.add(loftDesk);

  const loftLaptop = laptop();
  loftLaptop.position.set(-2.4, HOUSE.loftY + 0.775, -4.08);
  loftLaptop.rotation.y = 0.08;
  group.add(loftLaptop);

  const loftChair = chair();
  loftChair.position.set(-2.5, HOUSE.loftY, -3.45);
  loftChair.rotation.y = Math.PI;
  group.add(loftChair);

  // Tucked against the side railing instead of sitting in the ladder-top
  // landing corridor: the foot of the loft ladder feeds straight into the open
  // strip between the cushion/chair and the rail, and the lamp used to occupy
  // exactly that walkway. Pulling it to x ≈ -1.5 (just inside the side rail at
  // -1.28) and a touch further back clears the path while staying on the loft
  // as a reading light.
  const loftLamp = floorLamp(0xf3d9b0);
  loftLamp.scale.setScalar(0.55);
  loftLamp.position.set(-1.5, HOUSE.loftY, -1.4);
  group.add(loftLamp);

  const loftFairy = stringLights([-5.7, 3.5, -4.42], [-1.6, 3.5, -4.42], 14, 0.3);
  group.add(loftFairy);

  /* ---------------- living room ---------------- */

  // Wide enough to reach under the armchair as well: at 3.8 m the chair stood
  // half off the edge, which read as a mistake rather than as a seating group.
  const livingRug = rug(4.25, 3.0, 0, 0);
  livingRug.position.set(3.83, 0, -2.25);
  group.add(livingRug);

  const couch = sofa(2.4, 0xb9785a);
  couch.position.set(4.45, 0, -1.35);
  couch.rotation.y = Math.PI;
  group.add(couch);

  // Throw over the sofa back: the draped length falls towards +z, which is
  // the sofa's rear face now that the couch is turned to the fireplace.
  const couchThrow = throwBlanket(0.62, C.claySoft);
  couchThrow.position.set(4.98, 1.13, -0.95);
  group.add(couchThrow);

  const table = coffeeTable(1.5, 0.82);
  table.position.set(4.4, 0, -2.85);
  group.add(table);

  const chairLiving = armchair(0x8fae7d);
  chairLiving.position.set(2.48, 0, -2.5);
  chairLiving.rotation.y = 1.35;
  group.add(chairLiving);

  const fire = fireplace();
  fire.position.set(4.85, 0, -4.5);
  group.add(fire);

  // The hearth itself was empty; a log basket on the floor and the tools
  // standing on the hearth stone make the fireplace read as in use.
  const logs = logBasket(0.24);
  logs.position.set(3.42, 0, -4.12);
  group.add(logs);

  const poker = fireTools();
  poker.position.set(5.64, 0.08, -3.9);
  group.add(poker);

  const livingLamp = floorLamp();
  livingLamp.position.set(1.95, 0, -1.1);
  group.add(livingLamp);

  const seat = windowSeat(1.7, 0.62);
  seat.position.set(2.1, 0, -4.14);
  group.add(seat);

  const scope = telescope();
  scope.position.set(1.05, 0, -3.55);
  scope.rotation.y = -0.5;
  group.add(scope);

  const livingCat = cat();
  livingCat.position.set(3.25, 0, -1.95);
  livingCat.rotation.y = -0.7;
  group.add(livingCat);

  const bigPlant = plant('monstera', 1.15);
  bigPlant.position.set(5.55, 0, -0.55);
  group.add(bigPlant);

  const livingArt = pictureFrame(0.5, 0.64, 0);
  livingArt.position.set(3.5, 2.02, -4.49);
  group.add(livingArt);

  const livingFairy = stringLights([1.25, 3.12, -4.02], [5.9, 3.12, -4.02], 12, 0.35);
  group.add(livingFairy);

  /* ---------------- workshop ---------------- */

  const shopMat = box(2.2, 0.02, 1.35, 0x77836c, { roughness: 1 });
  shopMat.position.set(-3.9, 0.015, 2.7);
  group.add(shopMat);

  const bench = workbench(2.1, 0.85);
  bench.position.set(-5.52, 0, 2.65);
  bench.rotation.y = Math.PI / 2;
  group.add(bench);

  // The bench had no lamp of its own, so the corner went flat at night.
  const benchLamp = tableLamp(0xe8c39a);
  benchLamp.position.set(-5.46, 0.91, 3.5);
  group.add(benchLamp);

  // Loose hardware in jars along the wall side of the bench top.
  for (let i = 0; i < 3; i++) {
    const jar = cyl(0.042, 0.04, 0.1, 0xdfd6c4, { roughness: 0.55 });
    jar.position.set(-5.82, 0.96, 2.02 + i * 0.16);
    group.add(jar);

    const lid = cyl(0.045, 0.045, 0.018, [C.clay, C.butter, C.sage][i]);
    lid.position.set(-5.82, 1.02, 2.02 + i * 0.16);
    group.add(lid);
  }

  const board = pegboard(1.8, 0.95);
  board.position.set(-5.96, 2.05, 2.65);
  board.rotation.y = Math.PI / 2;
  group.add(board);

  const rack = serverRack();
  rack.position.set(-5.35, 0, 4.1);
  // LED panel towards the room instead of out through the open front edge.
  rack.rotation.y = Math.PI / 2;
  group.add(rack);

  const shopStool = stool();
  shopStool.position.set(-4.35, 0, 1.95);
  group.add(shopStool);

  const shopShelf = wallShelf(1.1);
  shopShelf.position.set(-5.95, 1.85, 0.55);
  shopShelf.rotation.y = Math.PI / 2;
  group.add(shopShelf);

  /* ---------------- kitchen ---------------- */

  // The kitchen sits on the two cut-away edges, so its cabinet fronts are
  // turned into the room: doors, handles and the tap all read from inside.
  const frontCounter = kitchenCounter(2.9, {
    sink: true,
    stove: true,
    upstand: false,
    splash: 0.42,
    rail: true,
  });
  frontCounter.position.set(3.5, 0, 4.14);
  frontCounter.rotation.y = Math.PI;
  group.add(frontCounter);

  // Shortened at the north end by 0.35 m: that run of floor is the fridge's
  // swing-out aisle, and a door parked in the corner could only reach 25°.
  const sideCounter = kitchenCounter(2.15, { sink: false, stove: false, upstand: false });
  sideCounter.position.set(5.6, 0, 2.53);
  sideCounter.rotation.y = -Math.PI / 2;
  group.add(sideCounter);

  const island = kitchenIsland(2.0, 1.0);
  island.position.set(3.35, 0, 2.35);
  group.add(island);

  for (const x of [2.78, 3.92]) {
    const s = stool(C.oak);
    s.position.set(x, 0, 1.55);
    group.add(s);
  }

  // The working aisle was the only bare stretch of floor left in the house;
  // a runner picks up the sage of the island and marks the sink/stove zone.
  const kitchenRunner = rug(1.5, 0.45, 0, 1);
  kitchenRunner.position.set(3.45, 0, 3.36);
  group.add(kitchenRunner);

  // Along the east cut, clear of both counter runs. It used to be wedged into
  // the south-east corner where the front counter left it 27 cm of floor — the
  // door could not open at all. Here the aisle in front is a full metre, so
  // both leaves swing to 90° without meeting anything (verified at runtime).
  const cool = fridge();
  cool.position.set(5.68, 0, 0.98);
  cool.rotation.y = -Math.PI / 2;
  group.add(cool);

  // The corner the fridge vacated needed a low object to stop it reading as a
  // gap between the two counter runs.
  const cornerPlant = plant('small', 0.8);
  cornerPlant.position.set(5.6, 0, 4.0);
  group.add(cornerPlant);

  // No ceiling, so no hanging lamps: a floor lamp beside the island plus a
  // small lamp on the side counter carry the kitchen's warm light instead.
  const islandLamp = floorLamp(0xe8c39a);
  islandLamp.position.set(1.98, 0, 1.72);
  islandLamp.rotation.y = 0.6;
  group.add(islandLamp);

  const counterLamp = tableLamp(0xe8c39a);
  counterLamp.position.set(5.6, 0.935, 3.32);
  group.add(counterLamp);

  /* ---------------- dining + entry ---------------- */

  // The dining set had no rug, so four chairs sat on a bare patch of floor
  // between three other rug-defined zones. Sized so every chair leg lands on
  // it, and short of the doormat at the cut edge (they used to overlap, and
  // both were laid at the same height — that pair z-fought).
  const diningRug = rug(3.3, 2.45, 0, 3);
  diningRug.position.set(0, 0, 2.52);
  group.add(diningRug);

  const dining = diningTable(1.7, 0.95);
  dining.position.set(0, 0, 2.75);
  group.add(dining);

  const diningChairs = [
    { pos: [0, 0, 1.9], rot: 0 },
    { pos: [0, 0, 3.52], rot: Math.PI },
    { pos: [-1.18, 0, 2.55], rot: Math.PI / 2 },
    { pos: [1.18, 0, 2.55], rot: -Math.PI / 2 },
  ];
  for (const item of diningChairs) {
    const c = chair();
    c.position.set(...item.pos);
    c.rotation.y = item.rot;
    group.add(c);
  }

  const diningLamp = tableLamp(0xd9b08a, 0xd9a24b);
  diningLamp.position.set(0.55, 0.78, 3.0);
  group.add(diningLamp);

  // Three laid places (the fourth seat is where the lamp stands). Kept 22 cm
  // in from the table edge — at the old 2.30 the near setting hung 60% off it.
  for (const [px, pz, rot] of [
    [0, 2.5, 0],
    [0, 3.0, Math.PI],
    [-0.55, 2.75, Math.PI / 2],
  ]) {
    const ps = placeSetting();
    ps.position.set(px, 0.79, pz);
    ps.rotation.y = rot;
    group.add(ps);
  }

  const entryConsole = consoleTable(1.7);
  entryConsole.position.set(0, 0, -4.26);
  group.add(entryConsole);

  const entryMirror = mirror(0.38);
  entryMirror.position.set(0, 2.25, -4.49);
  group.add(entryMirror);

  const entryArtL = pictureFrame(0.34, 0.44, 1);
  entryArtL.position.set(-1.05, 2.05, -4.49);
  group.add(entryArtL);

  const entryArtR = pictureFrame(0.34, 0.44, 3);
  entryArtR.position.set(1.05, 2.05, -4.49);
  group.add(entryArtR);

  const entryVase = vaseWithBranches();
  entryVase.position.set(0.45, 0.86, -4.26);
  group.add(entryVase);

  // Doormat clear of the dining rug (it used to overlap it, at the same
  // height, so the two flat surfaces flickered against each other). Coir tan,
  // so it doesn't read as a second copy of the workshop's green mat.
  const entryMat = box(1.2, 0.014, 0.55, 0xbca07a, { roughness: 1 });
  entryMat.position.set(0, 0.007, 4.19);
  group.add(entryMat);

  // A flat slab in one colour read as a rectangle painted on the floor; the
  // inset panel gives it a woven border.
  const entryMatPanel = box(1.02, 0.005, 0.38, 0xcbb08c, { roughness: 1 });
  entryMatPanel.position.set(0, 0.0165, 4.19);
  group.add(entryMatPanel);

  /* ---------------- lighting ---------------- */

  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x9a6f4a, 0.6);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffe9d0, 0.12);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff3e0, 2.7);
  sun.position.set(9, 13, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -11;
  sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 11;
  sun.shadow.camera.bottom = -11;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 45;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  scene.add(sun.target);

  // Soft bounce from the opposite side. Without it every surface turned away
  // from the sun (the island front, the back of the sofa) crushed to near
  // black, which read as a hole in the room rather than as shade.
  const fill = new THREE.DirectionalLight(0xffd8bc, 0.6);
  fill.position.set(-9, 6.5, -8);
  scene.add(fill);
  scene.add(fill.target);

  /* ---------------- character showcase stage ---------------- */

  // 屋外展示台已停用：小拾现在是屋里的住客，由 agents/controller.js 接管
  // 位置与动作。buildCharacterStage 仍保留在 characters.js，demo.html 单独
  // 用它做模型预览。
  if (opts.stage) {
    characterStage = buildCharacterStage(group, CHAR_PALETTES.marvis);
    loadModelIntoStage(characterStage.stage, CHAR_PALETTES.marvis);
  }

  const lamps = [];
  group.traverse((o) => {
    if (o.isPointLight && o.userData.isLamp) lamps.push(o);
  });

  const updaters = [];
  group.traverse((o) => {
    if (typeof o.userData.tick === 'function') updaters.push(o.userData.tick);
  });

  let currentMode = 'dusk';

  function setTimeOfDay(mode) {
    const cfg = MODES[mode] || MODES.dusk;
    currentMode = mode;

    sun.color.setHex(cfg.sunColor);
    sun.intensity = cfg.sunIntensity;
    sun.position.set(...cfg.sunPos);

    hemi.color.setHex(cfg.hemiSky);
    hemi.groundColor.setHex(cfg.hemiGround);
    hemi.intensity = cfg.hemiIntensity;

    renderer.toneMappingExposure = cfg.exposure;

    fill.intensity = cfg.fillIntensity;
    fill.color.setHex(cfg.fillColor);

    for (const lamp of lamps) {
      lamp.userData.scale = cfg.lampScale;
      if (!lamp.userData.flicker) {
        lamp.intensity = lamp.userData.baseIntensity * cfg.lampScale;
      }
    }

    outsideMat.color.setHex(cfg.windowTint);
    outsideMat.opacity = cfg.windowOpacity;
  }

  setTimeOfDay(currentMode);

  const occluders = [];
  group.traverse((o) => {
    if (o.userData.occluder) occluders.push(o);
  });

  return {
    group,
    updaters,
    lamps,
    sun,
    fill,
    occluders,
    characterStage,
    setTimeOfDay,
    get mode() {
      return currentMode;
    },
    presets: CAMERA_PRESETS,
    labels: ZONE_LABELS,
    zones: ZONES,
  };
}
