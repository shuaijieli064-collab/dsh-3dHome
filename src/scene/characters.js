import * as THREE from 'three';
import { C } from './props.js';
import { makeToonGradientMap, makeSignTexture } from './characterTextures.js';
import { loadModelIntoStage, CHARACTER_MODEL_URL } from './characterModel.js';

/* ------------------------------------------------------------------ */
/*  展示台 + 住客调色板。                                               */
/*  小拾本身只有模型化一条路线（src/scene/assets/xiaoshi.glb，由        */
/*  characterModel.js 加载并注入到台子上）；程序化拼装的版本已删除。    */
/* ------------------------------------------------------------------ */

export const CHAR_PALETTES = {
  marvis: { hair: 0x2a3f7e, tip: 0x5fb4dd, dress: 0x2e4470, sleeve: 0x273a63, fin: 0x5f8fd6, finLight: 0x9fd0f2, whale: '#8fb6e2' },
  file: { hair: 0x6f8f61, tip: 0xb6d99b, dress: 0x44543a, sleeve: 0x394830, fin: 0x8fae7d, finLight: 0xc3e0ab, whale: '#9dbb88' },
  computer: { hair: 0x79839a, tip: 0xc3cbd8, dress: 0x454d5e, sleeve: 0x3a4150, fin: 0x9aa5b8, finLight: 0xd4dae4, whale: '#a4adbe' },
  app: { hair: 0xd98f6a, tip: 0xf7c9a8, dress: 0x82503a, sleeve: 0x6d4130, fin: 0xe8a87f, finLight: 0xf8d0ae, whale: '#e5a57d' },
  browser: { hair: 0x9b7cb8, tip: 0xd8c4ec, dress: 0x5d4877, sleeve: 0x4e3c63, fin: 0xb996d6, finLight: 0xe0ccef, whale: '#b593d1' },
  search: { hair: 0x54a0c4, tip: 0xa6d9ee, dress: 0x39647a, sleeve: 0x2f5265, fin: 0x7dc2dd, finLight: 0xc0e6f4, whale: '#8cc4dc' },
};

/* ------------------------------------------------------------------ */
/*  Shared materials & helpers                                         */
/* ------------------------------------------------------------------ */

let GRAD = null;
function gradMap() {
  if (!GRAD) GRAD = makeToonGradientMap();
  return GRAD;
}

function toonMat(color, opts = {}) {
  // MeshToonMaterial has no roughness/metalness; dropping them here keeps
  // the console clean instead of emitting a warning per material.
  const { roughness, metalness, ...rest } = opts;
  return new THREE.MeshToonMaterial({ color, gradientMap: gradMap(), ...rest });
}

const OUTLINE_COLOR = 0x372e3e;
let outlineMats = null;
function outlineMat() {
  if (!outlineMats) outlineMats = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  return outlineMats;
}

/* Inverted-hull outline: same geometry, BackSide, inflated.             */
function outline(source, thick = 1.055) {
  const o = new THREE.Mesh(source.geometry, outlineMat());
  o.position.copy(source.position);
  o.quaternion.copy(source.quaternion);
  o.scale.copy(source.scale).multiplyScalar(thick);
  o.castShadow = false;
  o.receiveShadow = false;
  source.parent.add(o);
  return o;
}

/* ------------------------------------------------------------------ */
/*  Display stage — podium + nameplate + showcase lights.              */
/* ------------------------------------------------------------------ */

export function buildCharacterStage(group, palette = CHAR_PALETTES.marvis, opts = {}) {
  const { pos = [11.8, 0, 4.65], scale = 1.6, spin = true } = opts;

  const stage = new THREE.Group();
  stage.position.set(...pos);
  group.add(stage);

  // plinth matching the house base
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.5, 2.0),
    toonMat(C.oakDark)
  );
  plinth.position.y = -0.25;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  stage.add(plinth);

  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.88, 0.09, 36),
    toonMat(C.oak)
  );
  podium.position.y = 0.03;
  podium.castShadow = true;
  podium.receiveShadow = true;
  stage.add(podium);

  const trim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.86, 0.86, 0.02, 36),
    toonMat(C.oakLight)
  );
  trim.position.y = 0.082;
  stage.add(trim);

  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(0.52, 36),
    toonMat(0xe9dcc6, { roughness: 1 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.095;
  rug.receiveShadow = true;
  stage.add(rug);

  // nameplate
  const plaqueGeo = new THREE.BoxGeometry(0.38, 0.19, 0.03);
  const plaqueMat = [
    toonMat(0x9a6c45),
    toonMat(0x9a6c45),
    toonMat(0x9a6c45),
    toonMat(0x9a6c45),
    new THREE.MeshToonMaterial({ map: makeSignTexture(), gradientMap: gradMap() }),
    toonMat(0x9a6c45),
  ];
  const plaque = new THREE.Mesh(plaqueGeo, plaqueMat);
  plaque.position.set(0, 0.14, 0.81);
  plaque.rotation.x = -0.2;
  plaque.castShadow = true;
  stage.add(plaque);
  [plaque].forEach((m) => outline(m, 1.04));

  // The star of the stage is the modeled GLB (xiaoshi.glb). It is loaded
  // asynchronously by loadModelIntoStage() and lands in
  // stage.userData.character below; the podium stays empty until then.

  // showcase lights (independent of house lamps so night keeps the glow)
  const spotlight = new THREE.SpotLight(0xfff2de, 9, 9, 0.6, 0.75, 1.5);
  spotlight.position.set(0.35, 3.1, 1.5);
  spotlight.target.position.set(0, 0.85, 0);
  spotlight.castShadow = false;
  spotlight.userData.isLamp = true;
  spotlight.userData.baseIntensity = 9;
  spotlight.userData.scale = 1;
  stage.add(spotlight);
  stage.add(spotlight.target);

  // soft frontal fill — the spot alone sculpted a hard bright mask on the face
  const stageFill = new THREE.DirectionalLight(0xfff6ea, 0.7);
  stageFill.position.set(0.6, 1.5, 2.6);
  stageFill.target.position.set(0, 0.9, 0);
  stageFill.userData.isLamp = true;
  stageFill.userData.baseIntensity = 0.7;
  stageFill.userData.scale = 1;
  stage.add(stageFill);
  stage.add(stageFill.target);

  const stageHemi = new THREE.HemisphereLight(0xfff3e4, 0xd8b79b, 0.5);
  stageHemi.position.set(0, 1.4, 0);
  stage.add(stageHemi);

  const rim = new THREE.DirectionalLight(0xa8ccff, 0.85);
  rim.position.set(-1.6, 2.0, -1.5);
  rim.target.position.set(0, 0.7, 0);
  rim.userData.isLamp = true;
  rim.userData.baseIntensity = 0.85;
  rim.userData.scale = 1;
  stage.add(rim);
  stage.add(rim.target);

  // The active character lives on stage.userData.character so a modeled
  // GLB can be swapped in without touching the animation loop. The stage
  // tick always delegates to whatever character is live (null until the
  // model finishes loading).
  stage.userData.character = null;
  stage.userData.charScale = scale;
  stage.userData.tick = (t, dt) => {
    const c = stage.userData.character;
    if (c && typeof c.userData.animate === 'function') c.userData.animate(t, dt);
    if (spin && c) {
      // slow sway around the front pose; always shows the face to the camera
      c.rotation.y = Math.sin(t * 0.28) * 0.38;
    }
  };

  // `character` is a live getter so debug entries like
  // window.homeScene.home.characterStage.character.userData.setExpression(...)
  // keep working after a modeled swap.
  const api = { stage };
  Object.defineProperty(api, 'character', { get: () => stage.userData.character });
  return api;
}

/* Modeled-character entry points (see characterModel.js). Re-exported so
   callers can pull everything character-related from this module. */
export { loadModelIntoStage, CHARACTER_MODEL_URL };
