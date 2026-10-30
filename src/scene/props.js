import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeArtTexture, makeGlobeTexture, makeRugTexture, makeTileTexture } from './textures.js';

/* ------------------------------------------------------------------ */
/*  Palette                                                            */
/* ------------------------------------------------------------------ */

export const C = {
  oak: 0xc99a6a,
  oakDark: 0x9a6c45,
  oakLight: 0xdcb58a,
  walnut: 0x6f4a33,
  cream: 0xf2e6d4,
  creamDeep: 0xe4d2b8,
  clay: 0xc2603f,
  claySoft: 0xd98f6a,
  sage: 0x8fae7d,
  sageDeep: 0x6f8f61,
  slate: 0x7f8fa6,
  slateDeep: 0x5c6b80,
  butter: 0xd9a24b,
  plum: 0xa98bc4,
  white: 0xfbf6ec,
  ink: 0x3b2f28,
  metal: 0xb9b2a6,
  dark: 0x2f2a26,
};

/* ------------------------------------------------------------------ */
/*  Materials & primitives                                             */
/* ------------------------------------------------------------------ */

const MATERIALS = new Map();

export function material(color, opts = {}) {
  // Textures cannot be JSON-stringified into a cache key, so skip caching
  // for materials that carry maps.
  const cacheable = !opts.map && !opts.alphaMap && !opts.emissiveMap;
  const key = `${color}|${JSON.stringify(opts)}`;

  if (!cacheable) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.86,
      metalness: 0.02,
      ...opts,
    });
  }

  let m = MATERIALS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.86,
      metalness: 0.02,
      ...opts,
    });
    MATERIALS.set(key, m);
  }
  return m;
}

export function mesh(geometry, color, opts = {}) {
  const { castShadow = true, receiveShadow = true, material: customMat, ...matOpts } = opts;
  const m = new THREE.Mesh(geometry, customMat || material(color, matOpts));
  m.castShadow = castShadow;
  m.receiveShadow = receiveShadow;
  return m;
}

export function box(w, h, d, color, opts = {}) {
  return mesh(new THREE.BoxGeometry(w, h, d), color, opts);
}

export function rbox(w, h, d, r, color, opts = {}) {
  const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return mesh(new RoundedBoxGeometry(w, h, d, 3, radius), color, opts);
}

export function cyl(rTop, rBottom, h, color, opts = {}, seg = 24) {
  return mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, opts);
}

export function at(obj, x, y, z) {
  obj.position.set(x, y, z);
  return obj;
}

// One shared tile canvas, cloned per use so each backsplash can pick its own
// repeat without uploading the same 512px pattern twice per strip.
let TILE_SOURCE = null;
function tileMap(repeatX, repeatY) {
  if (!TILE_SOURCE) TILE_SOURCE = makeTileTexture();
  const map = TILE_SOURCE.clone();
  map.repeat.set(repeatX, repeatY);
  map.needsUpdate = true;
  return map;
}

function addLegs(group, w, d, h, color, r = 0.035) {
  const inset = 0.06;
  const positions = [
    [-w / 2 + inset, -d / 2 + inset],
    [w / 2 - inset, -d / 2 + inset],
    [-w / 2 + inset, d / 2 - inset],
    [w / 2 - inset, d / 2 - inset],
  ];
  for (const [x, z] of positions) {
    const leg = cyl(r, r * 0.85, h, color);
    leg.position.set(x, h / 2, z);
    group.add(leg);
  }
}

/* ------------------------------------------------------------------ */
/*  Books                                                              */
/* ------------------------------------------------------------------ */

const BOOK_COLORS = [0xb5654a, 0x8fae7d, 0x5d7f8c, 0xd9a24b, 0xa98bc4, 0x7c8f5e, 0xc2603f, 0x9c7a5b];

function bookRow(width, height, seed = 1) {
  const group = new THREE.Group();
  let x = -width / 2;
  let i = 0;
  while (x < width / 2 - 0.04) {
    const w = 0.035 + ((seed * 13 + i * 7) % 5) * 0.012;
    const h = height * (0.68 + ((seed + i * 3) % 7) * 0.04);
    const d = 0.16 + ((seed + i) % 3) * 0.02;
    const b = box(w, h, d, BOOK_COLORS[(seed + i) % BOOK_COLORS.length]);
    b.position.set(x + w / 2, h / 2, 0);
    b.rotation.z = ((seed + i) % 4 === 0 ? 1 : 0) * 0.06;
    group.add(b);
    x += w + 0.006 + ((seed + i) % 6 === 0 ? 0.05 : 0);
    i++;
  }
  return group;
}

export function bookStack(count = 3, scale = 1) {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < count; i++) {
    const w = (0.28 - i * 0.015) * scale;
    const d = (0.2 - i * 0.01) * scale;
    const h = 0.045 * scale;
    const b = box(w, h, d, BOOK_COLORS[(i + 2) % BOOK_COLORS.length]);
    b.position.set((i % 2) * 0.01, y + h / 2, 0);
    b.rotation.y = (i % 3) * 0.08;
    g.add(b);
    y += h;
  }
  return g;
}

/* ------------------------------------------------------------------ */
/*  Rug                                                                */
/* ------------------------------------------------------------------ */

export function rug(w, d, rotation = 0, variant = 0) {
  const g = new THREE.Group();

  // A slab, not a decal. A zero-thickness plane loses its edge completely once
  // the camera looks along the floor, and it z-fights with anything else laid
  // flat — the entry mat used to sit at exactly the same height as the rugs.
  const mat = new THREE.MeshStandardMaterial({
    map: makeRugTexture(variant),
    roughness: 1,
    metalness: 0,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, d), mat);
  body.position.y = 0.009;
  body.receiveShadow = true;
  g.add(body);

  // Tassels on the two short ends. Capped so a 4 m rug doesn't spawn a
  // hundred meshes for 2 cm of fluff.
  const strands = Math.min(13, Math.max(5, Math.round(w / 0.16)));
  const fringeMat = material(C.creamDeep);
  for (let i = 0; i < strands; i++) {
    const x = -w / 2 + (i + 0.5) * (w / strands);
    for (const s of [-1, 1]) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.007, 0.05), fringeMat);
      strand.position.set(x, 0.0045, s * (d / 2 + 0.026));
      g.add(strand);
    }
  }

  g.rotation.y = rotation;
  return g;
}

/* ---------------- slippers ---------------- */

export function slippers(color = C.claySoft) {
  const g = new THREE.Group();

  for (const s of [-1, 1]) {
    const one = new THREE.Group();

    const sole = rbox(0.1, 0.026, 0.23, 0.012, C.creamDeep);
    sole.position.y = 0.013;
    one.add(sole);

    const vamp = rbox(0.095, 0.05, 0.11, 0.024, color);
    vamp.position.set(0, 0.042, -0.05);
    one.add(vamp);

    // Slight toe-out, the way shoes land when you step out of them.
    one.position.x = s * 0.068;
    one.rotation.y = s * -0.09;
    g.add(one);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/*  Seating                                                            */
/* ------------------------------------------------------------------ */

export function sofa(width = 2.4, color = 0xb9785a) {
  const g = new THREE.Group();

  const body = rbox(width, 0.4, 0.95, 0.09, color);
  body.position.y = 0.4;
  g.add(body);

  const seat = rbox(width - 0.36, 0.2, 0.74, 0.07, C.creamDeep);
  seat.position.set(0, 0.63, 0.06);
  g.add(seat);

  const back = rbox(width, 0.66, 0.2, 0.08, color);
  back.position.set(0, 0.8, -0.4);
  g.add(back);

  for (const x of [-width / 4, width / 4]) {
    const cushion = rbox(width / 2 - 0.16, 0.4, 0.15, 0.06, C.creamDeep);
    cushion.position.set(x, 0.84, -0.25);
    cushion.rotation.x = -0.1;
    g.add(cushion);
  }

  for (const s of [-1, 1]) {
    const arm = rbox(0.24, 0.48, 0.95, 0.08, color);
    arm.position.set(s * (width / 2 - 0.12), 0.6, 0);
    g.add(arm);
  }

  addLegs(g, width - 0.1, 0.85, 0.22, C.walnut, 0.032);

  const pillow = rbox(0.36, 0.36, 0.13, 0.05, C.butter);
  pillow.position.set(-width / 3, 0.82, 0.06);
  pillow.rotation.set(-0.18, 0.1, 0.14);
  g.add(pillow);

  const pillow2 = rbox(0.32, 0.32, 0.12, 0.05, C.sage);
  pillow2.position.set(width / 3.4, 0.8, 0.05);
  pillow2.rotation.set(-0.12, -0.2, -0.1);
  g.add(pillow2);

  return g;
}

export function armchair(color = 0x8fae7d) {
  const g = new THREE.Group();

  const body = rbox(1.0, 0.38, 0.9, 0.1, color);
  body.position.y = 0.4;
  g.add(body);

  const seat = rbox(0.7, 0.18, 0.7, 0.07, C.creamDeep);
  seat.position.set(0, 0.62, 0.05);
  g.add(seat);

  const back = rbox(1.0, 0.62, 0.18, 0.08, color);
  back.position.set(0, 0.78, -0.38);
  back.rotation.x = -0.08;
  g.add(back);

  for (const s of [-1, 1]) {
    const arm = rbox(0.2, 0.42, 0.88, 0.08, color);
    arm.position.set(s * 0.42, 0.58, 0);
    g.add(arm);
  }

  addLegs(g, 0.85, 0.8, 0.22, C.walnut, 0.03);

  const pillow = rbox(0.3, 0.3, 0.11, 0.05, C.claySoft);
  pillow.position.set(0.05, 0.78, 0.02);
  pillow.rotation.set(-0.2, 0.1, 0.05);
  g.add(pillow);

  return g;
}

export function stool(color = C.oakDark) {
  const g = new THREE.Group();

  const seat = cyl(0.19, 0.19, 0.07, C.creamDeep);
  seat.position.y = 0.62;
  g.add(seat);

  const ring = mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 20), C.walnut);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.26;
  g.add(ring);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = cyl(0.018, 0.022, 0.6, color);
    leg.position.set(Math.cos(a) * 0.14, 0.3, Math.sin(a) * 0.14);
    leg.rotation.z = Math.cos(a) * 0.07;
    leg.rotation.x = -Math.sin(a) * 0.07;
    g.add(leg);
  }

  return g;
}

export function chair(color = C.oak) {
  const g = new THREE.Group();

  const seat = rbox(0.44, 0.07, 0.44, 0.03, C.creamDeep);
  seat.position.y = 0.46;
  g.add(seat);

  const back = rbox(0.42, 0.44, 0.06, 0.03, color);
  back.position.set(0, 0.72, -0.19);
  back.rotation.x = -0.08;
  g.add(back);

  addLegs(g, 0.4, 0.4, 0.44, color, 0.022);

  return g;
}

/* ------------------------------------------------------------------ */
/*  Tables                                                             */
/* ------------------------------------------------------------------ */

export function coffeeTable(w = 1.5, d = 0.82) {
  const g = new THREE.Group();

  const top = rbox(w, 0.09, d, 0.03, C.oak);
  top.position.y = 0.42;
  g.add(top);

  const shelf = rbox(w - 0.16, 0.05, d - 0.14, 0.02, C.oakLight);
  shelf.position.y = 0.16;
  g.add(shelf);

  addLegs(g, w - 0.1, d - 0.1, 0.4, C.walnut, 0.028);

  const books = bookStack(3, 1.1);
  books.position.set(-0.32, 0.47, 0.06);
  g.add(books);

  const mug = makeMug(C.clay);
  mug.position.set(0.36, 0.47, -0.1);
  g.add(mug);

  const bowl = mesh(new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), C.sage);
  bowl.rotation.x = Math.PI;
  bowl.position.set(0.28, 0.52, 0.2);
  g.add(bowl);

  return g;
}

export function diningTable(w = 1.7, d = 0.95) {
  const g = new THREE.Group();

  const top = rbox(w, 0.08, d, 0.03, C.oak);
  top.position.y = 0.74;
  g.add(top);

  addLegs(g, w - 0.14, d - 0.14, 0.72, C.oakDark, 0.035);

  const runner = box(w - 0.3, 0.012, 0.3, C.claySoft);
  runner.position.y = 0.785;
  g.add(runner);

  const vase = cyl(0.07, 0.1, 0.22, C.cream);
  vase.position.set(0, 0.9, 0);
  g.add(vase);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const stem = cyl(0.006, 0.006, 0.22, C.sageDeep);
    stem.position.set(Math.cos(a) * 0.04, 1.09, Math.sin(a) * 0.04);
    stem.rotation.z = Math.cos(a) * 0.35;
    stem.rotation.x = -Math.sin(a) * 0.35;
    g.add(stem);

    const bloom = mesh(new THREE.SphereGeometry(0.035, 10, 8), i % 2 ? C.clay : C.butter);
    bloom.position.set(Math.cos(a) * 0.1, 1.2, Math.sin(a) * 0.1);
    g.add(bloom);
  }

  return g;
}

export function consoleTable(w = 1.7) {
  const g = new THREE.Group();

  const top = rbox(w, 0.07, 0.36, 0.025, C.oak);
  top.position.y = 0.8;
  g.add(top);

  addLegs(g, w - 0.08, 0.28, 0.78, C.oakDark, 0.025);

  const basket = cyl(0.14, 0.11, 0.16, C.butter);
  basket.position.set(-0.5, 0.92, 0);
  g.add(basket);

  const books = bookStack(2, 0.9);
  books.position.set(0.45, 0.84, 0);
  g.add(books);

  const vase = cyl(0.06, 0.08, 0.2, C.sage);
  vase.position.set(0.1, 0.94, 0);
  g.add(vase);

  return g;
}

/* ------------------------------------------------------------------ */
/*  Lighting props                                                     */
/* ------------------------------------------------------------------ */

export function floorLamp(shadeColor = 0xf3d9b0) {
  const g = new THREE.Group();

  const base = cyl(0.16, 0.2, 0.05, C.walnut);
  base.position.y = 0.025;
  g.add(base);

  const pole = cyl(0.018, 0.018, 1.55, C.metal, { metalness: 0.55, roughness: 0.4 });
  pole.position.y = 0.8;
  g.add(pole);

  const shade = mesh(
    new THREE.CylinderGeometry(0.17, 0.3, 0.34, 24, 1, true),
    shadeColor,
    { side: THREE.DoubleSide, roughness: 0.95, emissive: 0xffb066, emissiveIntensity: 0.25 }
  );
  shade.position.y = 1.58;
  g.add(shade);

  const bulb = mesh(new THREE.SphereGeometry(0.06, 12, 10), 0xfff1cf, {
    emissive: 0xffd08a,
    emissiveIntensity: 2.2,
    castShadow: false,
  });
  bulb.position.y = 1.52;
  g.add(bulb);

  const light = new THREE.PointLight(0xffc98a, 16, 7, 2);
  light.position.set(0, 1.5, 0);
  light.userData.isLamp = true;
  light.userData.baseIntensity = 16;
  light.userData.scale = 1;
  g.add(light);

  return g;
}

// Small table lamp — replaces the hanging pendants that used to dangle from a
// ceiling this dollhouse does not have.
export function tableLamp(shadeColor = 0xf3d9b0, baseColor = C.oakDark) {
  const g = new THREE.Group();

  const base = cyl(0.082, 0.092, 0.025, baseColor);
  base.position.y = 0.012;
  g.add(base);

  const stem = cyl(0.012, 0.012, 0.26, C.metal, { metalness: 0.55, roughness: 0.35 });
  stem.position.y = 0.15;
  g.add(stem);

  const shade = mesh(
    new THREE.CylinderGeometry(0.1, 0.155, 0.16, 20, 1, true),
    shadeColor,
    { side: THREE.DoubleSide, roughness: 0.95, emissive: 0xffb066, emissiveIntensity: 0.25 }
  );
  shade.position.y = 0.33;
  g.add(shade);

  const cap = cyl(0.1, 0.1, 0.008, shadeColor, { roughness: 0.9 });
  cap.position.y = 0.41;
  g.add(cap);

  const bulb = mesh(new THREE.SphereGeometry(0.036, 10, 8), 0xfff1cf, {
    emissive: 0xffd08a,
    emissiveIntensity: 2.2,
    castShadow: false,
  });
  bulb.position.y = 0.3;
  g.add(bulb);

  const light = new THREE.PointLight(0xffc98a, 9, 4.5, 2);
  light.position.set(0, 0.3, 0);
  light.userData.isLamp = true;
  light.userData.baseIntensity = 9;
  light.userData.scale = 1;
  g.add(light);

  return g;
}

export function pendantLamp(shadeColor = 0xd98f6a, cordTop = 3.55, hangY = 2.42) {
  const g = new THREE.Group();

  const shadeTop = hangY + 0.14;
  const cord = cyl(0.008, 0.008, cordTop - shadeTop, 0x3a322b);
  cord.position.y = cordTop - (cordTop - shadeTop) / 2;
  g.add(cord);

  const shade = mesh(
    new THREE.ConeGeometry(0.28, 0.28, 24, 1, true),
    shadeColor,
    { side: THREE.DoubleSide, roughness: 0.8, emissive: 0xffb066, emissiveIntensity: 0.2 }
  );
  shade.position.y = hangY;
  shade.rotation.x = Math.PI;
  g.add(shade);

  const bulb = mesh(new THREE.SphereGeometry(0.055, 12, 10), 0xfff1cf, {
    emissive: 0xffd08a,
    emissiveIntensity: 2.4,
    castShadow: false,
  });
  bulb.position.y = hangY - 0.1;
  g.add(bulb);

  const light = new THREE.PointLight(0xffc98a, 11, 6, 2);
  light.position.set(0, hangY - 0.16, 0);
  light.userData.isLamp = true;
  light.userData.baseIntensity = 11;
  light.userData.scale = 1;
  g.add(light);

  return g;
}

export function deskLamp(color = C.sageDeep) {
  const g = new THREE.Group();

  const base = cyl(0.09, 0.1, 0.03, C.metal, { metalness: 0.5, roughness: 0.4 });
  base.position.y = 0.015;
  g.add(base);

  const arm = cyl(0.012, 0.012, 0.34, C.metal, { metalness: 0.5, roughness: 0.4 });
  arm.position.set(0.04, 0.2, 0);
  arm.rotation.z = -0.28;
  g.add(arm);

  const shade = mesh(
    new THREE.ConeGeometry(0.1, 0.12, 18, 1, true),
    color,
    { side: THREE.DoubleSide, emissive: 0xffb066, emissiveIntensity: 0.3 }
  );
  shade.position.set(0.1, 0.37, 0);
  shade.rotation.z = 0.5;
  shade.rotation.x = Math.PI;
  g.add(shade);

  const light = new THREE.PointLight(0xffc98a, 4, 2.6, 2);
  light.position.set(0.12, 0.33, 0);
  light.userData.isLamp = true;
  light.userData.baseIntensity = 4;
  light.userData.scale = 1;
  g.add(light);

  return g;
}

/* ------------------------------------------------------------------ */
/*  Fireplace                                                          */
/* ------------------------------------------------------------------ */

export function fireplace() {
  const g = new THREE.Group();

  const surround = rbox(1.9, 1.5, 0.42, 0.04, 0xd8c9b4);
  surround.position.set(0, 0.75, 0.21);
  g.add(surround);

  const opening = box(1.04, 0.92, 0.08, 0x241c18, {
    emissive: 0xff6a1f,
    emissiveIntensity: 0.25,
  });
  opening.position.set(0, 0.52, 0.43);
  g.add(opening);

  const hearth = box(2.1, 0.08, 0.66, 0xbfae97);
  hearth.position.set(0, 0.04, 0.5);
  g.add(hearth);

  const mantel = rbox(2.1, 0.1, 0.5, 0.03, C.oakDark);
  mantel.position.set(0, 1.52, 0.3);
  g.add(mantel);

  const chimney = box(1.9, 2.28, 0.3, 0xefe3d1);
  chimney.position.set(0, 2.64, 0.15);
  g.add(chimney);

  // logs
  for (let i = 0; i < 3; i++) {
    const log = cyl(0.07, 0.07, 0.5, 0x5a3a26);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i - 1) * 0.35;
    log.position.set((i - 1) * 0.12, 0.18 + i * 0.04, 0.5);
    g.add(log);
  }

  // flames
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffa347,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 4; i++) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1 + i * 0.015, 0.4 + i * 0.08, 8), flameMat);
    flame.position.set((i - 1.5) * 0.13, 0.35, 0.5);
    flame.userData.phase = i * 1.7;
    flames.push(flame);
    g.add(flame);
  }

  const light = new THREE.PointLight(0xff8a3c, 12, 7, 2);
  light.position.set(0, 0.85, 0.8);
  light.userData.isLamp = true;
  light.userData.baseIntensity = 12;
  light.userData.scale = 1;
  light.userData.flicker = true;
  g.add(light);

  g.userData.tick = (t) => {
    for (const f of flames) {
      const p = f.userData.phase;
      f.scale.y = 0.85 + Math.sin(t * 9 + p) * 0.15 + Math.sin(t * 17 + p * 2) * 0.06;
      f.scale.x = 0.9 + Math.sin(t * 11 + p) * 0.1;
    }
    light.intensity =
      light.userData.baseIntensity *
      light.userData.scale *
      (0.9 + Math.sin(t * 12.3) * 0.07 + Math.sin(t * 23.7) * 0.04);
  };

  return g;
}

/* ------------------------------------------------------------------ */
/*  Hearth accessories                                                 */
/* ------------------------------------------------------------------ */

// Woven basket of split logs standing on the hearth. Reads as "someone
// actually feeds this fire", which the bare surround did not.
export function logBasket(r = 0.24) {
  const g = new THREE.Group();

  const basket = mesh(
    new THREE.CylinderGeometry(r, r * 0.8, 0.34, 22, 1, true),
    C.butter,
    { side: THREE.DoubleSide, roughness: 0.98 }
  );
  basket.position.y = 0.17;
  g.add(basket);

  const base = cyl(r * 0.8, r * 0.8, 0.03, C.oakDark);
  base.position.y = 0.015;
  g.add(base);

  const rim = mesh(new THREE.TorusGeometry(r, 0.016, 6, 26), C.oakDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.34;
  g.add(rim);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const log = cyl(0.052, 0.055, 0.42, i % 2 ? 0x6b4429 : 0x87552f);
    log.position.set(Math.cos(a) * r * 0.42, 0.25, Math.sin(a) * r * 0.42);
    log.rotation.set(Math.sin(a) * 0.2, a, Math.cos(a) * 0.2);
    g.add(log);
  }

  return g;
}

export function fireTools() {
  const g = new THREE.Group();
  const steel = 0x3d3730;

  const base = cyl(0.09, 0.105, 0.03, steel, { metalness: 0.6, roughness: 0.45 });
  base.position.y = 0.015;
  g.add(base);

  const post = cyl(0.014, 0.014, 0.62, steel, { metalness: 0.7, roughness: 0.4 });
  post.position.y = 0.34;
  g.add(post);

  const hook = mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 16, Math.PI), steel, {
    metalness: 0.7,
    roughness: 0.4,
  });
  hook.position.y = 0.63;
  hook.rotation.y = Math.PI / 2;
  g.add(hook);

  for (const s of [-1, 1]) {
    const rod = cyl(0.008, 0.008, 0.4, steel, { metalness: 0.7, roughness: 0.4 });
    rod.position.set(s * 0.06, 0.4, 0);
    g.add(rod);

    const head = s < 0
      ? box(0.06, 0.09, 0.02, steel, { metalness: 0.6, roughness: 0.5 })
      : cyl(0.038, 0.038, 0.045, steel, { metalness: 0.6, roughness: 0.5 });
    head.position.set(s * 0.06, s < 0 ? 0.2 : 0.21, 0);
    g.add(head);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/*  Soft goods                                                         */
/* ------------------------------------------------------------------ */

// Folded throw: a pad that rests on a surface plus a length that hangs over
// the near edge (local +z), so it can be dropped on a sofa back or a bed foot.
export function throwBlanket(w = 0.62, color = C.claySoft) {
  const g = new THREE.Group();

  const pad = rbox(w, 0.07, 0.26, 0.025, color);
  pad.position.y = 0.02;
  g.add(pad);

  // A rolled fold along the top so the pad reads as cloth, not a slab.
  const roll = cyl(0.042, 0.042, w, color);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 0.075, -0.02);
  g.add(roll);

  const drape = rbox(w, 0.5, 0.05, 0.02, color);
  drape.position.set(0, -0.25, 0.13);
  g.add(drape);

  for (let i = 0; i < 5; i++) {
    const fringe = box(0.012, 0.07, 0.012, C.creamDeep);
    fringe.position.set(-w / 2 + 0.08 + i * ((w - 0.16) / 4), -0.53, 0.145);
    g.add(fringe);
  }

  return g;
}

// One place at a dining table: mat, plate, napkin and tumbler.
export function placeSetting() {
  const g = new THREE.Group();

  const mat = box(0.34, 0.006, 0.26, C.creamDeep, { roughness: 1 });
  mat.position.y = 0.003;
  g.add(mat);

  const plate = cyl(0.115, 0.115, 0.012, C.white);
  plate.position.y = 0.012;
  g.add(plate);

  const inner = cyl(0.082, 0.082, 0.006, C.creamDeep);
  inner.position.y = 0.02;
  g.add(inner);

  const napkin = box(0.1, 0.008, 0.14, C.sage);
  napkin.position.set(-0.17, 0.005, 0.02);
  g.add(napkin);

  const glass = cyl(0.032, 0.026, 0.11, 0xd8e8ea, {
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.55,
  });
  glass.position.set(0.17, 0.055, -0.02);
  g.add(glass);

  return g;
}

/* ------------------------------------------------------------------ */
/*  Bedroom                                                            */
/* ------------------------------------------------------------------ */

export function headboard(w = 1.56, color = C.oakDark) {
  const g = new THREE.Group();

  const panel = rbox(w, 0.62, 0.09, 0.03, color);
  panel.position.y = 0.42;
  g.add(panel);

  const cushion = rbox(w - 0.18, 0.4, 0.05, 0.03, C.creamDeep);
  cushion.position.set(0, 0.46, 0.055);
  g.add(cushion);

  for (const s of [-1, 1]) {
    const post = cyl(0.036, 0.032, 0.8, color);
    post.position.set(s * (w / 2 - 0.01), 0.4, 0);
    g.add(post);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/*  Storage / shelves                                                  */
/* ------------------------------------------------------------------ */

export function bookshelf(w = 1.8, h = 1.9, d = 0.36, seed = 3) {
  const g = new THREE.Group();

  const sideL = box(0.05, h, d, C.oakDark);
  sideL.position.set(-w / 2, h / 2, 0);
  g.add(sideL);

  const sideR = sideL.clone();
  sideR.position.x = w / 2;
  g.add(sideR);

  const back = box(w, h, 0.03, C.oakLight);
  back.position.set(0, h / 2, -d / 2 + 0.015);
  g.add(back);

  const shelves = 4;
  for (let i = 0; i <= shelves; i++) {
    const y = 0.04 + (i / shelves) * (h - 0.08);
    const shelf = box(w, 0.04, d, C.oak);
    shelf.position.set(0, y, 0);
    g.add(shelf);

    if (i < shelves) {
      const row = bookRow(w - 0.14, (h - 0.08) / shelves - 0.1, seed + i * 5);
      row.position.set(0, y + 0.04, 0.01);
      g.add(row);

      if (i % 2 === 1) {
        const stack = bookStack(2, 0.85);
        stack.position.set(w / 2 - 0.28, y + 0.04, 0.02);
        g.add(stack);
      }
    }
  }

  return g;
}

export function wallShelf(w = 1.2) {
  const g = new THREE.Group();

  const shelf = box(w, 0.05, 0.22, C.oak);
  g.add(shelf);

  for (const s of [-1, 1]) {
    const bracket = box(0.04, 0.16, 0.18, C.oakDark);
    bracket.position.set(s * (w / 2 - 0.1), -0.1, -0.02);
    g.add(bracket);
  }

  const books = bookStack(2, 0.7);
  books.position.set(-w / 3, 0.03, 0);
  g.add(books);

  const pot = cyl(0.07, 0.055, 0.1, C.clay);
  pot.position.set(w / 3, 0.08, 0);
  g.add(pot);

  return g;
}

/* ------------------------------------------------------------------ */
/*  Desk & study                                                       */
/* ------------------------------------------------------------------ */

export function desk(w = 1.5, d = 0.72) {
  const g = new THREE.Group();

  const top = rbox(w, 0.07, d, 0.025, C.oak);
  top.position.y = 0.74;
  g.add(top);

  addLegs(g, w - 0.08, d - 0.08, 0.72, C.oakDark, 0.028);

  const drawer = rbox(0.42, 0.5, d - 0.1, 0.03, C.creamDeep);
  drawer.position.set(w / 2 - 0.26, 0.4, 0);
  g.add(drawer);

  for (let i = 0; i < 2; i++) {
    const handle = box(0.16, 0.02, 0.02, C.metal, { metalness: 0.6, roughness: 0.35 });
    handle.position.set(w / 2 - 0.26, 0.52 - i * 0.22, d / 2 - 0.045);
    g.add(handle);
  }

  const lamp = deskLamp();
  lamp.position.set(-w / 2 + 0.24, 0.775, -0.1);
  g.add(lamp);

  const papers = box(0.3, 0.008, 0.22, C.white);
  papers.position.set(0.05, 0.78, 0.06);
  papers.rotation.y = 0.15;
  g.add(papers);

  const cup = cyl(0.045, 0.04, 0.1, C.clay);
  cup.position.set(w / 2 - 0.15, 0.83, 0.12);
  g.add(cup);

  for (let i = 0; i < 3; i++) {
    const pencil = cyl(0.006, 0.006, 0.2, C.butter);
    pencil.position.set(w / 2 - 0.15 + (i - 1) * 0.018, 0.94, 0.12);
    pencil.rotation.z = (i - 1) * 0.15;
    g.add(pencil);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/*  Kitchen                                                            */
/* ------------------------------------------------------------------ */

export function laptop(color = 0xdfe3e8, screenGlow = 0x8fd6ff) {
  const g = new THREE.Group();

  const base = rbox(0.36, 0.022, 0.24, 0.008, color, { roughness: 0.4, metalness: 0.25 });
  base.position.y = 0.011;
  g.add(base);

  const keys = box(0.3, 0.004, 0.14, 0x8f959c, { roughness: 0.7 });
  keys.position.set(0, 0.024, 0.015);
  g.add(keys);

  const lid = new THREE.Group();
  lid.position.set(0, 0.022, -0.12);
  lid.rotation.x = -0.28;
  g.add(lid);

  const shell = rbox(0.36, 0.23, 0.014, 0.008, color, { roughness: 0.4, metalness: 0.25 });
  shell.position.y = 0.115;
  lid.add(shell);

  const screen = box(0.31, 0.18, 0.004, screenGlow, {
    emissive: screenGlow,
    emissiveIntensity: 0.55,
    roughness: 0.3,
    castShadow: false,
  });
  screen.position.set(0, 0.118, 0.01);
  lid.add(screen);

  return g;
}

export function kitchenCounter(
  length = 4,
  { sink = true, stove = true, upstand = true, splash = 0, rail = false } = {}
) {
  const g = new THREE.Group();
  const d = 0.62;
  const topY = 0.9;
  const topH = 0.07;
  const topW = length + 0.06;
  const topD = d + 0.06;
  const surface = topY + topH / 2;

  const sinkX = -length / 2 + 0.85;
  const hobX = length / 2 - 0.95;

  const body = rbox(length, 0.86, d, 0.03, 0xe6d6bd);
  body.position.y = 0.43;
  g.add(body);

  // Counter top. With a sink the slab is split into four strips around the
  // opening, so the basin can be recessed — a plate lying on the surface never
  // read as a sink.
  const OPEN_W = 0.52;
  const OPEN_D = 0.38;
  if (sink) {
    const stripD = topD / 2 - OPEN_D / 2;
    for (const s of [-1, 1]) {
      const strip = box(topW, topH, stripD, 0xefe6d6, { roughness: 0.6 });
      strip.position.set(0, topY, s * (OPEN_D / 2 + stripD / 2));
      g.add(strip);
    }

    const leftW = sinkX - OPEN_W / 2 + topW / 2;
    const left = box(leftW, topH, OPEN_D, 0xefe6d6, { roughness: 0.6 });
    left.position.set(-topW / 2 + leftW / 2, topY, 0);
    g.add(left);

    const rightW = topW / 2 - (sinkX + OPEN_W / 2);
    const right = box(rightW, topH, OPEN_D, 0xefe6d6, { roughness: 0.6 });
    right.position.set(topW / 2 - rightW / 2, topY, 0);
    g.add(right);
  } else {
    const top = box(topW, topH, topD, 0xefe6d6, { roughness: 0.6 });
    top.position.y = topY;
    g.add(top);
  }

  // Counters that sit on the cut-away edge of the dollhouse skip the
  // backsplash so the cabinet fronts stay visible.
  if (upstand) {
    const back = box(topW, 0.5, 0.05, 0xefe6d6, { roughness: 0.6 });
    back.position.set(0, 1.18, -d / 2);
    g.add(back);
  }

  const doors = Math.max(2, Math.round(length / 0.7));
  for (let i = 0; i < doors; i++) {
    const x = -length / 2 + (i + 0.5) * (length / doors);
    const door = box(length / doors - 0.04, 0.66, 0.02, 0xefe1c9);
    door.position.set(x, 0.45, d / 2 + 0.01);
    g.add(door);

    const handle = box(0.12, 0.018, 0.02, C.metal, { metalness: 0.6, roughness: 0.35 });
    handle.position.set(x, 0.72, d / 2 + 0.03);
    g.add(handle);
  }

  if (sink) {
    const wallT = 0.02;
    const depth = 0.16;
    const basinY = surface - depth;
    const basin = 0xc6bfb2;

    for (const s of [-1, 1]) {
      const side = box(wallT, depth, OPEN_D - wallT * 2, basin, {
        metalness: 0.35,
        roughness: 0.4,
      });
      side.position.set(sinkX + s * (OPEN_W / 2 - wallT / 2), surface - depth / 2, 0);
      g.add(side);

      const face = box(OPEN_W, depth, wallT, basin, { metalness: 0.35, roughness: 0.4 });
      face.position.set(sinkX, surface - depth / 2, s * (OPEN_D / 2 - wallT / 2));
      g.add(face);
    }

    const basinFloor = box(OPEN_W, 0.02, OPEN_D, basin, { metalness: 0.35, roughness: 0.5 });
    basinFloor.position.set(sinkX, basinY + 0.01, 0);
    g.add(basinFloor);

    const drain = cyl(0.032, 0.032, 0.006, 0x6f6a62, { metalness: 0.6, roughness: 0.35 });
    drain.position.set(sinkX, basinY + 0.023, 0);
    g.add(drain);

    const faucet = cyl(0.018, 0.018, 0.3, C.metal, { metalness: 0.7, roughness: 0.25 });
    faucet.position.set(sinkX, surface + 0.145, -0.2);
    g.add(faucet);

    // Spout reaches over the basin centre, with a short drop at the tip — the
    // old one stopped 5 cm short of the basin and hovered beside it.
    const spout = cyl(0.014, 0.014, 0.24, C.metal, { metalness: 0.7, roughness: 0.25 });
    spout.rotation.x = Math.PI / 2;
    spout.position.set(sinkX, surface + 0.27, -0.08);
    g.add(spout);

    const tip = cyl(0.013, 0.013, 0.07, C.metal, { metalness: 0.7, roughness: 0.25 });
    tip.position.set(sinkX, surface + 0.235, 0.03);
    g.add(tip);

    // Drainer in the clear run left of the basin.
    const rackX = sinkX - 0.62;
    const tray = box(0.34, 0.014, 0.26, C.metal, { metalness: 0.5, roughness: 0.35 });
    tray.position.set(rackX, surface + 0.008, 0.02);
    g.add(tray);
    for (let i = 0; i < 3; i++) {
      const tine = cyl(0.007, 0.007, 0.12, C.metal, { metalness: 0.6, roughness: 0.3 });
      tine.position.set(rackX - 0.1 + i * 0.1, surface + 0.07, 0.02);
      g.add(tine);
    }
  }

  if (stove) {
    const hob = box(0.62, 0.02, 0.44, 0x33302c, { roughness: 0.4, metalness: 0.3 });
    hob.position.set(hobX, surface + 0.01, 0);
    g.add(hob);

    for (let i = 0; i < 4; i++) {
      const burner = cyl(0.07, 0.07, 0.012, 0x151311);
      burner.position.set(
        hobX + (i % 2 ? 0.15 : -0.15),
        surface + 0.026,
        i < 2 ? -0.1 : 0.1
      );
      g.add(burner);
    }

    const kettle = mesh(new THREE.SphereGeometry(0.11, 16, 12), 0xd9a24b, {
      roughness: 0.4,
      metalness: 0.35,
    });
    kettle.scale.set(1, 0.8, 1);
    kettle.position.set(hobX, surface + 0.11, 0);
    g.add(kettle);

    const spout = cyl(0.015, 0.02, 0.12, 0xd9a24b, { metalness: 0.35, roughness: 0.4 });
    spout.position.set(hobX + 0.11, surface + 0.16, 0);
    spout.rotation.z = -0.9;
    g.add(spout);
  }

  // Little jars: park them to the left of the basin. They used to sit in the
  // gap between basin and hob, directly under the rail, where they hid
  // everything hanging from it.
  let jarCx = length / 2 - 0.42;
  if (sink) jarCx = sinkX - 0.55;
  else if (stove) jarCx = hobX - 0.6;
  for (let i = 0; i < 3; i++) {
    const jar = cyl(0.05, 0.05, 0.12, [C.claySoft, C.sage, C.butter][i]);
    jar.position.set(jarCx + (i - 1) * 0.15, surface + 0.06, -0.13);
    g.add(jar);
  }

  // Tiled splash + hanging rail. Short and narrow on purpose: a full-length
  // parapet hid the whole worktop from the overview camera.
  if (splash > 0) {
    const panelW = Math.min(1.8, length - 0.4);
    const panel = mesh(new THREE.BoxGeometry(panelW, splash, 0.03), 0xffffff, {
      map: tileMap(panelW / 0.6, splash / 0.6),
      roughness: 0.8,
    });
    panel.position.set(sink && stove ? (sinkX + hobX) / 2 : 0, surface + splash / 2, -topD / 2 + 0.015);
    g.add(panel);
  }

  if (rail) {
    // Kept short and clear of the tap: at the old 1.2 m length the rod ran
    // straight across the faucet and read as one object with it. Mounted high
    // on the tiles so whatever hangs from it clears the worktop clutter.
    const railX = (sink && stove ? (sinkX + hobX) / 2 : 0) + 0.03;
    const railY = surface + 0.33;
    const railZ = -topD / 2 + 0.075;
    const rod = cyl(0.012, 0.012, 0.82, C.metal, { metalness: 0.75, roughness: 0.25 });
    rod.rotation.z = Math.PI / 2;
    rod.position.set(railX, railY, railZ);
    g.add(rod);

    for (let i = 0; i < 3; i++) {
      const hook = mesh(new THREE.TorusGeometry(0.035, 0.0055, 6, 14, Math.PI * 1.3), C.metal, {
        metalness: 0.75,
        roughness: 0.3,
      });
      hook.rotation.y = Math.PI / 2;
      hook.position.set(railX - 0.26 + i * 0.26, railY - 0.035, railZ);
      g.add(hook);
    }

    // Bare hooks read as placeholder geometry. A tea towel folded over the rod
    // — two panels plus a fold, not a single slab — sells the "in use" state.
    const towel = new THREE.Group();
    const towelFold = box(0.26, 0.026, 0.075, 0xf0e5d2, { roughness: 0.95 });
    towel.add(towelFold);

    const towelFront = box(0.26, 0.24, 0.014, 0xf0e5d2, { roughness: 0.95 });
    towelFront.position.set(0, -0.128, 0.033);
    towel.add(towelFront);

    const towelBack = box(0.26, 0.17, 0.014, 0xe6d9c3, { roughness: 0.95 });
    towelBack.position.set(0, -0.095, -0.033);
    towel.add(towelBack);

    const towelBand = box(0.262, 0.028, 0.004, C.claySoft, { roughness: 0.95 });
    towelBand.position.set(0, -0.195, 0.041);
    towel.add(towelBand);

    towel.position.set(railX - 0.02, railY, railZ);
    g.add(towel);

    // One hanging utensil on the left hook; the right hook stays empty, the
    // way a real rail is never perfectly evenly loaded.
    const tool = new THREE.Group();
    const shaft = cyl(0.007, 0.007, 0.12, C.metal, { metalness: 0.7, roughness: 0.3 });
    shaft.position.y = -0.07;
    tool.add(shaft);
    const blade = box(0.07, 0.085, 0.012, C.oakLight, { roughness: 0.8 });
    blade.position.y = -0.155;
    tool.add(blade);
    tool.position.set(railX - 0.26, railY - 0.03, railZ + 0.01);
    g.add(tool);
  }

  return g;
}

export function kitchenIsland(w = 2.0, d = 1.0) {
  const g = new THREE.Group();

  const body = rbox(w, 0.86, d, 0.04, 0xa9b79c);
  body.position.y = 0.43;
  g.add(body);

  // Breakfast-bar overhang on the seating side (-z): the stools already stand
  // 30 cm off the cabinet face, so the top has to reach out over them.
  const top = box(w + 0.08, 0.08, d + 0.34, 0xefe6d6, { roughness: 0.55 });
  top.position.set(0, 0.91, -0.13);
  g.add(top);

  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + (i + 0.5) * (w / 3);
    const door = box(w / 3 - 0.06, 0.62, 0.02, 0xb9c4ac);
    door.position.set(x, 0.44, d / 2 + 0.01);
    g.add(door);

    const handle = box(0.1, 0.018, 0.02, C.metal, { metalness: 0.6, roughness: 0.35 });
    handle.position.set(x, 0.68, d / 2 + 0.03);
    g.add(handle);
  }

  const bowl = mesh(new THREE.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), C.cream);
  bowl.rotation.x = Math.PI;
  bowl.position.set(-0.3, 1.0, 0.05);
  g.add(bowl);

  for (let i = 0; i < 4; i++) {
    const fruit = mesh(new THREE.SphereGeometry(0.055, 12, 10), [C.clay, C.butter, C.sage][i % 3]);
    fruit.position.set(-0.3 + (i - 1.5) * 0.07, 1.06, 0.05 + (i % 2) * 0.05);
    g.add(fruit);
  }

  const board = rbox(0.34, 0.025, 0.22, 0.01, C.oak);
  board.position.set(0.42, 0.96, 0.02);
  board.rotation.y = 0.2;
  g.add(board);

  return g;
}

// A fridge with real swing-out doors. The earlier version was a single box
// with a seam drawn on it, which only reads as a fridge if it never opens —
// and it was parked in the corner where a 0.8 m door could not swing past the
// front counter. Both doors now hang off a hinge group, so `setOpen()` can be
// driven by an interaction later, and the cavity is modelled (recessed liner,
// two shelf edges, a cold light strip) so an open door shows something.
export function fridge({ openTop = 0.4, openBottom = 0.14 } = {}) {
  const g = new THREE.Group();

  const W = 0.78;
  const H = 1.78;
  const D = 0.58;
  const DOOR = 0.05;
  const T = 0.03; // shell slab thickness
  const front = D / 2;
  const mouth = front - 0.075; // where the cavity opening starts
  const shellMat = { roughness: 0.45, metalness: 0.2 };

  // Hollow shell — back, two sides, top, bottom — so the doors open onto a
  // real cavity with shelves and drawers in it, not a painted-on front.
  const backPlate = box(W, H, T, 0xdfe3dc, shellMat);
  backPlate.position.set(0, H / 2, -D / 2 + T / 2);
  g.add(backPlate);

  for (const s of [-1, 1]) {
    const side = box(T, H, D - T, 0xdbdfd6, shellMat);
    side.position.set(s * (W / 2 - T / 2), H / 2, T / 2);
    g.add(side);
  }

  for (const y of [T / 2, H - T / 2]) {
    const cap = box(W - T * 2, T, D - T, 0xdbdfd6, shellMat);
    cap.position.set(0, y, T / 2);
    g.add(cap);
  }

  // Light inner liner against the back panel.
  const liner = box(W - T * 2 - 0.006, H - T * 2 - 0.006, 0.008, 0xd3dad4, { roughness: 0.8 });
  liner.position.set(0, H / 2, -D / 2 + T + 0.004);
  g.add(liner);

  // Four rails close the shell mouth and give the doors something to seal on.
  const frameD = front - mouth;
  const frameZ = (mouth + front) / 2;
  const rail = (w, h, x, y) => {
    const r = rbox(w, h, frameD, 0.012, 0xd8dcd5, { roughness: 0.5, metalness: 0.18 });
    r.position.set(x, y, frameZ);
    g.add(r);
  };
  rail(T, H, -(W / 2 - T / 2), H / 2);
  rail(T, H, W / 2 - T / 2, H / 2);
  rail(W - T * 2, T, 0, H - T / 2);
  rail(W - T * 2, T, 0, T / 2);

  // Divider between the fresh-food and freezer compartments, on the door split.
  const divider = box(W - T * 2, 0.028, 0.46, 0xc9cfc6, { roughness: 0.7 });
  divider.position.set(0, 0.66, -0.02);
  g.add(divider);

  const shelf = (y) => {
    const s = box(W - T * 2 - 0.01, 0.013, 0.44, 0xf1f5ee, { roughness: 0.55 });
    s.position.set(0, y, -0.03);
    g.add(s);
  };
  shelf(0.86);
  shelf(1.28);

  // A little stock, so an open door is worth looking into.
  const carton = box(0.09, 0.17, 0.09, 0xf8f4e8, { roughness: 0.8 });
  carton.position.set(-0.2, 0.955, 0.03);
  g.add(carton);

  const bottle = cyl(0.032, 0.038, 0.15, 0xc9ddcf, { roughness: 0.3 });
  bottle.position.set(0.0, 0.945, 0.03);
  g.add(bottle);

  const bottleCap = cyl(0.018, 0.018, 0.03, C.butter, { roughness: 0.4 });
  bottleCap.position.set(0.0, 1.035, 0.03);
  g.add(bottleCap);

  const bowl = cyl(0.075, 0.048, 0.055, C.clay, { roughness: 0.7 });
  bowl.position.set(0.2, 0.9, 0.03);
  g.add(bowl);

  const tub = cyl(0.058, 0.058, 0.07, C.sage, { roughness: 0.6 });
  tub.position.set(-0.1, 1.352, 0.03);
  g.add(tub);

  // Two freezer drawers below the divider.
  for (const [y, h] of [[0.19, 0.15], [0.46, 0.17]]) {
    const body = box(W - T * 2 - 0.02, h, 0.42, 0xe2e7df, { roughness: 0.5 });
    body.position.set(0, y, -0.02);
    g.add(body);

    const face = box(W - T * 2 - 0.01, h + 0.02, 0.018, 0xeef2ec, { roughness: 0.45 });
    face.position.set(0, y, mouth - 0.011);
    g.add(face);

    const grip = box(W - 0.32, 0.016, 0.014, C.metal, { metalness: 0.7, roughness: 0.3 });
    grip.position.set(0, y + h / 2 - 0.02, mouth - 0.001);
    g.add(grip);
  }

  const coldLight = box(W - 0.22, 0.012, 0.03, 0xdff0f6, {
    roughness: 0.35,
    emissive: 0xbfe6f2,
    emissiveIntensity: 0.85,
  });
  coldLight.position.set(0, H - 0.11, 0.03);
  g.add(coldLight);

  // Kick plate along the bottom edge, in the plane of the door frame.
  const kick = box(W - T * 2 - 0.01, 0.05, 0.012, 0x9aa09a, { roughness: 0.6 });
  kick.position.set(0, 0.03, front - 0.006);
  g.add(kick);

  const makeDoor = (h, y0, handleH, open) => {
    const pivot = new THREE.Group();
    pivot.position.set(-W / 2, 0, front);

    const panel = rbox(W, h, DOOR, 0.018, 0xe6e9e2, { roughness: 0.4, metalness: 0.22 });
    panel.position.set(W / 2, y0 + h / 2, DOOR / 2 + 0.001);
    pivot.add(panel);

    // Handle stands off the free edge, opposite the hinge.
    const bar = cyl(0.014, 0.014, handleH, C.metal, { metalness: 0.8, roughness: 0.22 });
    bar.position.set(W - 0.075, y0 + h / 2, DOOR + 0.036);
    pivot.add(bar);

    for (const s of [-1, 1]) {
      const stem = box(0.016, 0.016, 0.045, C.metal, { metalness: 0.8, roughness: 0.3 });
      stem.position.set(
        W - 0.075,
        y0 + h / 2 + s * (handleH / 2 - 0.028),
        DOOR + 0.016
      );
      pivot.add(stem);
    }

    // Door bins on the inside face — they ride into the cavity when closed,
    // which is exactly what a real fridge door does.
    for (const f of [0.32, 0.68]) {
      const bin = box(W - 0.16, 0.08, 0.018, 0xbcc6bf, { roughness: 0.65 });
      bin.position.set(W / 2, y0 + h * f, -0.055);
      pivot.add(bin);

      const lip = box(W - 0.16, 0.014, 0.03, 0xa9b4a8, { roughness: 0.6 });
      lip.position.set(W / 2, y0 + h * f - 0.04, -0.045);
      pivot.add(lip);
    }

    pivot.rotation.y = -open;
    pivot.userData.setOpen = (a) => {
      pivot.rotation.y = -a;
    };
    return pivot;
  };

  // Freezer on the bottom, fresh food above — the split a real unit uses.
  const leafTop = makeDoor(1.1, 0.66, 0.5, openTop);
  const leafBottom = makeDoor(0.64, 0.02, 0.3, openBottom);

  // Gap between the leaves, drawn as its own strip so it survives either door
  // swinging.
  const seam = box(W, 0.022, 0.012, 0xa8aea6, { roughness: 0.6 });
  seam.position.set(0, 0.66, front + DOOR + 0.002);
  g.add(seam);

  const magnets = [C.clay, C.butter, C.sage, C.slate];
  for (let i = 0; i < 4; i++) {
    const m = box(0.05, 0.05, 0.012, magnets[i]);
    m.position.set(i * 0.12 - 0.18, 1.28 + (i % 2) * 0.13, DOOR + 0.008);
    leafTop.add(m);
  }

  g.add(leafTop, leafBottom);
  g.userData.doors = { top: leafTop, bottom: leafBottom };
  g.userData.setOpen = (a, which) => {
    if (which !== 'bottom') leafTop.rotation.y = -a;
    if (which !== 'top') leafBottom.rotation.y = -a;
  };

  return g;
}

/* ------------------------------------------------------------------ */
/*  Workshop                                                           */
/* ------------------------------------------------------------------ */

export function workbench(w = 2.1, d = 0.85) {
  const g = new THREE.Group();

  const top = rbox(w, 0.1, d, 0.02, C.oakDark);
  top.position.y = 0.86;
  g.add(top);

  for (const s of [-1, 1]) {
    const panel = box(0.06, 0.82, d - 0.08, C.oak);
    panel.position.set(s * (w / 2 - 0.1), 0.41, 0);
    g.add(panel);
  }

  const shelf = box(w - 0.2, 0.05, d - 0.12, C.oakLight);
  shelf.position.y = 0.24;
  g.add(shelf);

  const toolbox = rbox(0.5, 0.24, 0.3, 0.03, 0xc2603f);
  toolbox.position.set(-0.45, 0.99, 0.02);
  g.add(toolbox);

  const handle = box(0.26, 0.03, 0.03, C.metal, { metalness: 0.7, roughness: 0.3 });
  handle.position.set(-0.45, 1.12, 0.02);
  g.add(handle);

  const vise = box(0.16, 0.14, 0.16, C.slate, { metalness: 0.5, roughness: 0.4 });
  vise.position.set(w / 2 - 0.2, 0.98, 0.05);
  g.add(vise);

  const crank = cyl(0.012, 0.012, 0.18, C.metal, { metalness: 0.7, roughness: 0.3 });
  crank.rotation.z = Math.PI / 2;
  crank.position.set(w / 2 - 0.06, 0.98, 0.05);
  g.add(crank);

  const plank = box(0.7, 0.03, 0.2, C.oakLight);
  plank.position.set(0.2, 0.93, 0.05);
  plank.rotation.y = 0.12;
  g.add(plank);

  return g;
}

export function pegboard(w = 1.8, h = 0.95) {
  const g = new THREE.Group();

  const board = box(w, h, 0.04, 0xd8c3a5);
  g.add(board);

  // ~120 peg holes: one InstancedMesh instead of 120 draw calls.
  const holes = [];
  for (let x = -w / 2 + 0.08; x < w / 2; x += 0.12) {
    for (let y = -h / 2 + 0.08; y < h / 2; y += 0.12) {
      holes.push([x, y]);
    }
  }

  const holeGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.045, 6);
  const holes3d = new THREE.InstancedMesh(holeGeo, material(0x8a7055), holes.length);
  const holeMatrix = new THREE.Matrix4();
  const holeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  const holeScale = new THREE.Vector3(1, 1, 1);

  holes.forEach(([x, y], i) => {
    holeMatrix.compose(new THREE.Vector3(x, y, 0.005), holeQuat, holeScale);
    holes3d.setMatrixAt(i, holeMatrix);
  });

  holes3d.instanceMatrix.needsUpdate = true;
  holes3d.castShadow = false;
  holes3d.receiveShadow = false;
  g.add(holes3d);

  // hammer
  const handle = box(0.035, 0.32, 0.03, C.oak);
  handle.position.set(-0.5, -0.1, 0.05);
  g.add(handle);
  const head = box(0.16, 0.06, 0.05, C.slate, { metalness: 0.6, roughness: 0.35 });
  head.position.set(-0.5, 0.07, 0.05);
  g.add(head);

  // wrench
  const bar = box(0.04, 0.3, 0.03, C.metal, { metalness: 0.7, roughness: 0.3 });
  bar.position.set(-0.15, -0.08, 0.05);
  bar.rotation.z = 0.2;
  g.add(bar);
  const ring = mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 14), C.metal, {
    metalness: 0.7,
    roughness: 0.3,
  });
  ring.position.set(-0.18, 0.08, 0.05);
  g.add(ring);

  // screwdrivers
  for (let i = 0; i < 3; i++) {
    const driver = cyl(0.012, 0.012, 0.24, C.metal, { metalness: 0.7, roughness: 0.3 });
    driver.position.set(0.25 + i * 0.09, -0.08, 0.05);
    g.add(driver);
    const grip = cyl(0.022, 0.022, 0.12, [C.clay, C.butter, C.sage][i]);
    grip.position.set(0.25 + i * 0.09, 0.07, 0.05);
    g.add(grip);
  }

  // shelf clip
  const clip = box(0.22, 0.03, 0.1, C.oakDark);
  clip.position.set(0.6, -0.24, 0.05);
  g.add(clip);

  // hand saw at the left end — the board read as half-empty there
  const blade = box(0.06, 0.4, 0.012, C.metal, { metalness: 0.65, roughness: 0.35 });
  blade.position.set(-0.76, 0, 0.05);
  g.add(blade);
  const sawGrip = box(0.1, 0.12, 0.055, C.clay);
  sawGrip.position.set(-0.76, 0.27, 0.05);
  g.add(sawGrip);

  // spirit level along the top rail
  const level = box(0.34, 0.05, 0.035, C.butter);
  level.position.set(0.02, 0.31, 0.05);
  g.add(level);
  const vial = box(0.1, 0.018, 0.02, 0x9fd0c4, { roughness: 0.2, transparent: true, opacity: 0.9 });
  vial.position.set(0.02, 0.31, 0.07);
  g.add(vial);

  // pliers, hinged on a peg
  for (const s of [-1, 1]) {
    const jaw = box(0.018, 0.2, 0.028, C.metal, { metalness: 0.7, roughness: 0.3 });
    jaw.position.set(0.74 + s * 0.026, 0.17, 0.05);
    jaw.rotation.z = s * 0.12;
    g.add(jaw);
    const gripP = box(0.03, 0.1, 0.032, C.clay);
    gripP.position.set(0.74 + s * 0.038, 0.03, 0.05);
    g.add(gripP);
  }

  // tape measure
  const tape = cyl(0.075, 0.075, 0.05, C.butter);
  tape.rotation.x = Math.PI / 2;
  tape.position.set(0.72, -0.2, 0.06);
  g.add(tape);
  const tapeHub = cyl(0.03, 0.03, 0.055, C.walnut);
  tapeHub.rotation.x = Math.PI / 2;
  tapeHub.position.set(0.72, -0.2, 0.065);
  g.add(tapeHub);

  // coil of cord
  const coil = mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 18), 0x8a7055);
  coil.position.set(-0.77, -0.34, 0.05);
  g.add(coil);

  return g;
}

export function serverRack() {
  const g = new THREE.Group();

  const body = rbox(0.62, 1.15, 0.52, 0.03, 0x707880, { metalness: 0.35, roughness: 0.55 });
  body.position.y = 0.58;
  g.add(body);

  const panel = box(0.54, 1.0, 0.02, 0x4e565f);
  panel.position.set(0, 0.58, 0.265);
  g.add(panel);

  const leds = [];
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 4; i++) {
      const color = i === 0 ? 0x7fe08a : i === 1 ? 0x7fb8e0 : i === 2 ? 0xe0b36a : 0xe07f7f;
      const led = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), color, {
        emissive: color,
        emissiveIntensity: 1.6,
        castShadow: false,
      });
      led.position.set(-0.18 + i * 0.12, 0.95 - row * 0.16, 0.278);
      led.userData.phase = row * 0.8 + i * 1.3;
      leds.push(led);
      g.add(led);
    }
  }

  for (let i = 0; i < 4; i++) {
    const vent = box(0.4, 0.012, 0.005, 0x1d2024);
    vent.position.set(0, 0.14 + i * 0.035, 0.278);
    g.add(vent);
  }

  g.userData.tick = (t) => {
    for (const led of leds) {
      led.visible = Math.sin(t * 3 + led.userData.phase) > -0.25;
    }
  };

  return g;
}

/* ------------------------------------------------------------------ */
/*  Loft / bedroom                                                     */
/* ------------------------------------------------------------------ */

export function loftBed(w = 1.5, d = 2.0) {
  const g = new THREE.Group();

  const frame = rbox(w + 0.1, 0.16, d + 0.1, 0.03, C.oakDark);
  frame.position.y = 0.1;
  g.add(frame);

  const mattress = rbox(w, 0.2, d, 0.07, C.white);
  mattress.position.y = 0.26;
  g.add(mattress);

  const blanket = rbox(w - 0.06, 0.08, d * 0.58, 0.04, C.claySoft);
  blanket.position.set(0, 0.38, d * 0.2);
  g.add(blanket);

  const pillow = rbox(w * 0.62, 0.13, 0.38, 0.06, C.creamDeep);
  pillow.position.set(0, 0.42, -d / 2 + 0.32);
  g.add(pillow);

  const cushion = rbox(0.4, 0.12, 0.4, 0.05, C.butter);
  cushion.position.set(w / 2 + 0.02, 0.32, -0.2);
  cushion.rotation.z = 0.1;
  g.add(cushion);

  return g;
}

export function globe() {
  const g = new THREE.Group();

  const base = cyl(0.14, 0.18, 0.05, C.walnut);
  base.position.y = 0.025;
  g.add(base);

  const stem = cyl(0.02, 0.02, 0.28, C.metal, { metalness: 0.6, roughness: 0.35 });
  stem.position.y = 0.18;
  g.add(stem);

  const sphere = mesh(new THREE.SphereGeometry(0.26, 32, 24), 0xffffff, {
    map: makeGlobeTexture(),
    roughness: 0.75,
  });
  sphere.position.y = 0.5;
  g.add(sphere);

  const ring = mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 40), C.butter, {
    metalness: 0.5,
    roughness: 0.4,
  });
  ring.position.y = 0.5;
  ring.rotation.x = 0.4;
  g.add(ring);

  g.userData.tick = (t) => {
    sphere.rotation.y = t * 0.12;
  };

  return g;
}

export function ladder(height = 2.3, width = 0.5) {
  const g = new THREE.Group();

  for (const s of [-1, 1]) {
    const rail = box(0.05, height, 0.05, C.oak);
    rail.position.set(s * width / 2, height / 2, 0);
    g.add(rail);
  }

  const rungs = 7;
  for (let i = 1; i < rungs; i++) {
    const rung = cyl(0.022, 0.022, width, C.oakDark);
    rung.rotation.z = Math.PI / 2;
    rung.position.y = (i / rungs) * height;
    g.add(rung);
  }

  return g;
}

export function railing(length = 4.4, posts = 8) {
  const g = new THREE.Group();

  const top = box(length, 0.05, 0.06, C.oak);
  top.position.y = 0.92;
  g.add(top);

  for (let i = 0; i <= posts; i++) {
    const x = -length / 2 + (i / posts) * length;
    const post = cyl(0.022, 0.022, 0.9, C.oakDark);
    post.position.set(x, 0.45, 0);
    g.add(post);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/*  Plants                                                             */
/* ------------------------------------------------------------------ */

const leafShape = new THREE.Shape();
leafShape.moveTo(0, 0);
leafShape.bezierCurveTo(0.16, 0.06, 0.2, 0.24, 0, 0.44);
leafShape.bezierCurveTo(-0.2, 0.24, -0.16, 0.06, 0, 0);
const LEAF_GEO = new THREE.ShapeGeometry(leafShape, 10);

export function plant(kind = 'monstera', scale = 1) {
  const g = new THREE.Group();
  g.scale.setScalar(scale);

  const potColor = kind === 'monstera' ? C.clay : C.creamDeep;
  const pot = cyl(0.22, 0.16, 0.3, potColor);
  pot.position.y = 0.15;
  g.add(pot);

  const rim = cyl(0.23, 0.23, 0.04, potColor);
  rim.position.y = 0.3;
  g.add(rim);

  const soil = cyl(0.2, 0.2, 0.02, 0x4a3527);
  soil.position.y = 0.31;
  g.add(soil);

  const count = kind === 'monstera' ? 8 : 5;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + i * 0.6;
    const h = 0.35 + (i % 4) * 0.13;
    const lean = 0.22 + (i % 3) * 0.1;

    const stem = cyl(0.012, 0.016, h, C.sageDeep);
    stem.position.set(Math.cos(angle) * 0.06, 0.3 + h / 2, Math.sin(angle) * 0.06);
    stem.rotation.z = Math.cos(angle) * lean * 0.5;
    stem.rotation.x = -Math.sin(angle) * lean * 0.5;
    g.add(stem);

    const leaf = mesh(LEAF_GEO, kind === 'monstera' ? 0x6f8f61 : 0x8fae7d, {
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    leaf.scale.setScalar(kind === 'monstera' ? 1.15 : 0.8);
    leaf.position.set(
      Math.cos(angle) * (0.08 + lean * 0.5),
      0.3 + h,
      Math.sin(angle) * (0.08 + lean * 0.5)
    );
    leaf.rotation.y = -angle + Math.PI / 2;
    leaf.rotation.x = -0.55;
    g.add(leaf);
  }

  g.userData.tick = (t) => {
    g.rotation.z = Math.sin(t * 0.6) * 0.012;
  };

  return g;
}

export function succulent() {
  const g = new THREE.Group();

  const pot = cyl(0.1, 0.075, 0.12, C.creamDeep);
  pot.position.y = 0.06;
  g.add(pot);

  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = mesh(new THREE.SphereGeometry(0.05, 10, 8), 0x8fae7d);
    leaf.scale.set(0.7, 0.45, 1.5);
    leaf.position.set(Math.cos(a) * 0.05, 0.14, Math.sin(a) * 0.05);
    leaf.rotation.y = -a;
    leaf.rotation.z = 0.3;
    g.add(leaf);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/*  Decor                                                              */
/* ------------------------------------------------------------------ */

export function pictureFrame(w = 0.6, h = 0.8, seed = 0) {
  const g = new THREE.Group();

  const frame = box(w, h, 0.05, C.oakDark);
  g.add(frame);

  const art = mesh(new THREE.PlaneGeometry(w - 0.09, h - 0.09), 0xffffff, {
    map: makeArtTexture(seed),
    roughness: 0.95,
  });
  art.position.z = 0.027;
  g.add(art);

  return g;
}

export function mirror(radius = 0.38) {
  const g = new THREE.Group();

  const mirrorGlass = mesh(new THREE.CircleGeometry(radius, 40), 0xd7e2e6, {
    metalness: 0.45,
    roughness: 0.06,
    emissive: 0x2c3a40,
    emissiveIntensity: 0.5,
  });
  mirrorGlass.position.z = 0.02;
  g.add(mirrorGlass);

  const rim = mesh(new THREE.TorusGeometry(radius, 0.035, 8, 48), C.butter, {
    metalness: 0.4,
    roughness: 0.4,
  });
  g.add(rim);

  return g;
}

export function clock() {
  const g = new THREE.Group();

  const face = cyl(0.24, 0.24, 0.05, 0xf7efe2);
  face.rotation.x = Math.PI / 2;
  g.add(face);

  const rim = mesh(new THREE.TorusGeometry(0.245, 0.025, 8, 40), C.oakDark);
  g.add(rim);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = box(0.012, i % 3 === 0 ? 0.04 : 0.022, 0.006, C.ink);
    tick.position.set(Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0.03);
    tick.rotation.z = -a;
    g.add(tick);
  }

  const hour = box(0.018, 0.12, 0.008, C.ink);
  hour.geometry.translate(0, 0.06, 0);
  hour.position.z = 0.04;
  g.add(hour);

  const minute = box(0.014, 0.17, 0.008, C.ink);
  minute.geometry.translate(0, 0.085, 0);
  minute.position.z = 0.045;
  g.add(minute);

  const center = cyl(0.018, 0.018, 0.02, C.clay);
  center.rotation.x = Math.PI / 2;
  center.position.z = 0.05;
  g.add(center);

  g.userData.tick = () => {
    const now = new Date();
    const m = now.getMinutes() + now.getSeconds() / 60;
    const h = (now.getHours() % 12) + m / 60;
    minute.rotation.z = -(m / 60) * Math.PI * 2;
    hour.rotation.z = -(h / 12) * Math.PI * 2;
  };

  return g;
}

export function curtain(width = 1.2, height = 2.1, color = 0xd9b79a) {
  const g = new THREE.Group();

  const rod = cyl(0.025, 0.025, width + 0.5, C.walnut);
  rod.rotation.z = Math.PI / 2;
  rod.position.y = height;
  g.add(rod);

  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const r = 0.05 + (i % 2) * 0.015;
      const fold = cyl(r, r, height - 0.15, color, { roughness: 0.95 });
      fold.position.set(
        side * (width / 2 - 0.12 - i * 0.07),
        height / 2 - 0.06,
        (i % 2 ? 0.02 : -0.01)
      );
      g.add(fold);
    }
  }

  return g;
}

export function stringLights(from, to, count = 14, sag = 0.35) {
  const g = new THREE.Group();

  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);

  const points = curve.getPoints(40);
  const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x4a3f35 }));
  g.add(line);

  for (let i = 1; i < count; i++) {
    const p = curve.getPoint(i / count);
    const bulb = mesh(new THREE.SphereGeometry(0.028, 8, 6), 0xffe0a3, {
      emissive: 0xffc26b,
      emissiveIntensity: 2.4,
      castShadow: false,
    });
    bulb.position.copy(p);
    g.add(bulb);
  }

  return g;
}

export function cat(color = 0x6b5a4d) {
  const g = new THREE.Group();

  const body = mesh(new THREE.SphereGeometry(0.3, 20, 16), color);
  body.scale.set(0.95, 0.62, 1.45);
  body.position.y = 0.2;
  g.add(body);

  const head = mesh(new THREE.SphereGeometry(0.2, 18, 14), color);
  head.position.set(0, 0.27, 0.38);
  g.add(head);

  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.07, 0.12, 8), color);
    ear.position.set(s * 0.11, 0.43, 0.36);
    ear.rotation.z = s * 0.2;
    g.add(ear);
  }

  for (const s of [-1, 1]) {
    const eye = box(0.06, 0.008, 0.02, 0x2b2320);
    eye.position.set(s * 0.07, 0.3, 0.56);
    g.add(eye);
  }

  const nose = mesh(new THREE.SphereGeometry(0.018, 8, 6), 0xc98d84);
  nose.position.set(0, 0.25, 0.57);
  g.add(nose);

  const tail = mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 24, Math.PI * 1.1), color);
  tail.rotation.x = -Math.PI / 2;
  tail.rotation.z = 0.4;
  tail.position.set(-0.2, 0.12, -0.3);
  g.add(tail);

  g.userData.tick = (t) => {
    const b = 1 + Math.sin(t * 1.4) * 0.02;
    body.scale.set(0.95 * b, 0.62 * b, 1.45);
  };

  return g;
}

export function makeMug(color = C.clay) {
  const g = new THREE.Group();

  const cup = cyl(0.05, 0.042, 0.1, color);
  cup.position.y = 0.05;
  g.add(cup);

  const handle = mesh(new THREE.TorusGeometry(0.032, 0.01, 6, 12, Math.PI * 1.3), color);
  handle.rotation.z = -0.6;
  handle.position.set(0.055, 0.055, 0);
  g.add(handle);

  const coffee = cyl(0.043, 0.043, 0.005, 0x3a251a);
  coffee.position.y = 0.098;
  g.add(coffee);

  return g;
}

export function vaseWithBranches() {
  const g = new THREE.Group();

  const vase = cyl(0.09, 0.12, 0.26, C.sage);
  vase.position.y = 0.13;
  g.add(vase);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const branch = cyl(0.007, 0.009, 0.5, C.oakDark);
    branch.position.set(Math.cos(a) * 0.05, 0.45, Math.sin(a) * 0.05);
    branch.rotation.z = Math.cos(a) * 0.22;
    branch.rotation.x = -Math.sin(a) * 0.22;
    g.add(branch);

    const leaf = mesh(LEAF_GEO, C.sage, { side: THREE.DoubleSide });
    leaf.scale.setScalar(0.55);
    leaf.position.set(Math.cos(a) * 0.13, 0.72, Math.sin(a) * 0.13);
    leaf.rotation.y = -a;
    leaf.rotation.x = -0.3;
    g.add(leaf);
  }

  return g;
}

export function windowSeat(w = 1.7, d = 0.62) {
  const g = new THREE.Group();

  const base = rbox(w, 0.42, d, 0.04, C.oak);
  base.position.y = 0.21;
  g.add(base);

  const cushion = rbox(w - 0.08, 0.12, d - 0.08, 0.05, C.creamDeep);
  cushion.position.y = 0.48;
  g.add(cushion);

  for (let i = 0; i < 3; i++) {
    const p = rbox(0.32, 0.3, 0.12, 0.05, [C.claySoft, C.butter, C.sage][i]);
    p.position.set(-w / 2 + 0.28 + i * 0.55, 0.62, -d / 2 + 0.16);
    p.rotation.set(-0.18, (i - 1) * 0.15, 0.05);
    g.add(p);
  }

  return g;
}

export function telescope() {
  const g = new THREE.Group();

  const hub = cyl(0.05, 0.05, 0.08, C.slateDeep);
  hub.position.y = 0.72;
  g.add(hub);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.015, 0.02, 0.8, C.oakDark);
    leg.position.set(Math.cos(a) * 0.12, 0.38, Math.sin(a) * 0.12);
    leg.rotation.z = Math.cos(a) * 0.22;
    leg.rotation.x = -Math.sin(a) * 0.22;
    g.add(leg);
  }

  const tube = cyl(0.055, 0.075, 0.5, C.slate, { metalness: 0.4, roughness: 0.4 });
  tube.rotation.x = Math.PI / 2 - 0.45;
  tube.rotation.y = 0.2;
  tube.position.set(0, 0.82, 0.05);
  g.add(tube);

  const lens = cyl(0.058, 0.058, 0.02, 0x9fc4d8, { metalness: 0.8, roughness: 0.15 });
  lens.rotation.x = Math.PI / 2 - 0.45;
  lens.position.set(0.02, 0.92, 0.28);
  g.add(lens);

  return g;
}
