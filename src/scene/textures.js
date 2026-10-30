import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Small deterministic helpers                                        */
/* ------------------------------------------------------------------ */

function canvasOf(size = 512) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  Wooden floor                                                       */
/* ------------------------------------------------------------------ */

export function makeFloorTexture() {
  const s = 1024;
  const c = canvasOf(s);
  const g = c.getContext('2d');
  const rand = rng(11);

  const palette = ['#c99a6a', '#c2925f', '#d0a273', '#bd8a58', '#cfa070', '#c69667'];
  const rows = 8;
  const rowH = s / rows;

  g.fillStyle = palette[0];
  g.fillRect(0, 0, s, s);

  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    g.fillStyle = palette[r % palette.length];
    g.fillRect(0, y, s, rowH);

    // grain
    for (let i = 0; i < 46; i++) {
      const gy = y + rand() * rowH;
      g.strokeStyle = `rgba(86, 52, 28, ${0.025 + rand() * 0.055})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, gy);
      g.bezierCurveTo(
        s * 0.32, gy + (rand() - 0.5) * 7,
        s * 0.68, gy + (rand() - 0.5) * 7,
        s, gy + (rand() - 0.5) * 5
      );
      g.stroke();
    }

    // soft sheen band
    const grad = g.createLinearGradient(0, y, 0, y + rowH);
    grad.addColorStop(0, 'rgba(255, 240, 215, 0.10)');
    grad.addColorStop(0.45, 'rgba(255, 240, 215, 0.02)');
    grad.addColorStop(1, 'rgba(60, 32, 14, 0.10)');
    g.fillStyle = grad;
    g.fillRect(0, y, s, rowH);

    // plank seam
    g.fillStyle = 'rgba(68, 40, 22, 0.42)';
    g.fillRect(0, y, s, 2);

    // butt joints
    const joints = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < joints; j++) {
      const x = rand() * s;
      g.fillStyle = 'rgba(68, 40, 22, 0.30)';
      g.fillRect(x, y, 2, rowH);
    }
  }

  return finish(c, 3.2, 2.4);
}

/* ------------------------------------------------------------------ */
/*  Walls                                                              */
/* ------------------------------------------------------------------ */

export function makeWallTexture() {
  const s = 512;
  const c = canvasOf(s);
  const g = c.getContext('2d');
  const rand = rng(23);

  g.fillStyle = '#f2e6d4';
  g.fillRect(0, 0, s, s);

  const grad = g.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, 'rgba(255, 252, 245, 0.35)');
  grad.addColorStop(0.7, 'rgba(255, 250, 240, 0.0)');
  grad.addColorStop(1, 'rgba(160, 130, 100, 0.10)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);

  for (let i = 0; i < 2600; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const a = rand() * 0.05;
    g.fillStyle = rand() > 0.5 ? `rgba(120, 95, 70, ${a})` : `rgba(255, 255, 255, ${a * 1.4})`;
    g.fillRect(x, y, 1.5, 1.5);
  }

  return finish(c, 2, 2);
}

/* ------------------------------------------------------------------ */
/*  Rug                                                                */
/* ------------------------------------------------------------------ */

// Four colourways, so the four rooms don't lay down four identical rugs.
// `motif` picks the pattern so the variants also differ in weave, not only hue.
const RUG_LOOKS = [
  { ground: '#e9d5b8', border: '#b5654a', accent: '#d9a24b', motif: 'diamond' },
  { ground: '#dcdcc6', border: '#7d8f6a', accent: '#c9bd92', motif: 'stripes' },
  // The study rug kept blowing out to white under the sun, so its ground sits
  // a couple of stops darker than the others.
  { ground: '#d6c6ac', border: '#71809a', accent: '#b8915c', motif: 'lattice' },
  { ground: '#e7d5b8', border: '#c98a52', accent: '#9aa87f', motif: 'diamond' },
];

export function makeRugTexture(variant = 0) {
  const look = RUG_LOOKS[variant % RUG_LOOKS.length];
  const s = 512;
  const c = canvasOf(s);
  const g = c.getContext('2d');

  g.fillStyle = look.ground;
  g.fillRect(0, 0, s, s);

  // border
  g.strokeStyle = look.border;
  g.lineWidth = 26;
  g.strokeRect(22, 22, s - 44, s - 44);
  g.strokeStyle = look.accent;
  g.lineWidth = 8;
  g.strokeRect(46, 46, s - 92, s - 92);

  if (look.motif === 'stripes') {
    // woven banding: alternating thin stripes instead of a diamond field
    g.save();
    g.beginPath();
    g.rect(60, 60, s - 120, s - 120);
    g.clip();
    for (let y = 60; y < s - 60; y += 26) {
      g.fillStyle = y % 52 === 60 % 52 ? look.accent : 'rgba(125,143,106,0.16)';
      g.fillRect(60, y, s - 120, 5);
    }
    g.restore();
  } else if (look.motif === 'lattice') {
    // fine grid: reads as a flat-weave kilim from the dollhouse distance
    g.strokeStyle = 'rgba(138,148,168,0.28)';
    g.lineWidth = 2.5;
    for (let i = 76; i < s - 60; i += 34) {
      g.beginPath();
      g.moveTo(i, 60);
      g.lineTo(i, s - 60);
      g.moveTo(60, i);
      g.lineTo(s - 60, i);
      g.stroke();
    }
  } else {
    // diamond lattice
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(Math.PI / 4);
    g.strokeStyle = 'rgba(181, 101, 74, 0.35)';
    g.lineWidth = 5;
    for (let i = -3; i <= 3; i++) {
      g.strokeRect(i * 90 - 30, -230, 60, 460);
    }
    g.restore();
  }

  // small motifs
  g.fillStyle = look.border;
  g.globalAlpha = 0.5;
  for (let x = 90; x < s - 60; x += 84) {
    for (let y = 90; y < s - 60; y += 84) {
      g.beginPath();
      g.moveTo(x, y - 8);
      g.lineTo(x + 8, y);
      g.lineTo(x, y + 8);
      g.lineTo(x - 8, y);
      g.closePath();
      g.fill();
    }
  }
  g.globalAlpha = 1;

  // weave noise
  const rand = rng(41);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(120, 90, 60, ${rand() * 0.06})`;
    g.fillRect(rand() * s, rand() * s, 1, 1);
  }

  return finish(c, 1, 1);
}

/* ------------------------------------------------------------------ */
/*  Kitchen tiles                                                      */
/* ------------------------------------------------------------------ */

export function makeTileTexture() {
  const s = 512;
  const c = canvasOf(s);
  const g = c.getContext('2d');
  const rand = rng(57);

  g.fillStyle = '#e9ddc9';
  g.fillRect(0, 0, s, s);

  const n = 4;
  const t = s / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const shade = 238 + Math.floor(rand() * 12);
      g.fillStyle = `rgb(${shade}, ${shade - 10}, ${shade - 26})`;
      g.fillRect(i * t + 4, j * t + 4, t - 8, t - 8);
    }
  }

  g.strokeStyle = 'rgba(150, 128, 100, 0.35)';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, s); g.stroke();
    g.beginPath(); g.moveTo(0, i * t); g.lineTo(s, i * t); g.stroke();
  }

  return finish(c, 1, 1);
}

/* ------------------------------------------------------------------ */
/*  Outside view through windows                                       */
/* ------------------------------------------------------------------ */

export function makeOutsideTexture() {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#a9c9e8');
  sky.addColorStop(0.55, '#d9e6ee');
  sky.addColorStop(0.72, '#ffe3b8');
  sky.addColorStop(1, '#ffcf9b');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // sun
  const sun = g.createRadialGradient(w * 0.7, h * 0.34, 6, w * 0.7, h * 0.34, 90);
  sun.addColorStop(0, 'rgba(255, 246, 214, 0.95)');
  sun.addColorStop(0.4, 'rgba(255, 226, 160, 0.45)');
  sun.addColorStop(1, 'rgba(255, 226, 160, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);

  // distant hills
  g.fillStyle = 'rgba(122, 148, 120, 0.35)';
  g.beginPath();
  g.moveTo(0, h * 0.76);
  g.bezierCurveTo(w * 0.22, h * 0.66, w * 0.4, h * 0.8, w * 0.6, h * 0.72);
  g.bezierCurveTo(w * 0.78, h * 0.64, w * 0.9, h * 0.75, w, h * 0.7);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();

  g.fillStyle = 'rgba(90, 120, 92, 0.4)';
  g.beginPath();
  g.moveTo(0, h * 0.86);
  g.bezierCurveTo(w * 0.3, h * 0.78, w * 0.55, h * 0.9, w, h * 0.82);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  Wall art                                                           */
/* ------------------------------------------------------------------ */

const ART_PALETTES = [
  ['#c2603f', '#e3b47c', '#7f9c86', '#f3e4cd'],
  ['#5d7f8c', '#d9a24b', '#efe0c8', '#b5654a'],
  ['#8f6f9c', '#e7c07f', '#cfd8c2', '#f6ecdc'],
  ['#7c8f5e', '#d98f6a', '#f0dcc0', '#3f4a3a'],
];

export function makeArtTexture(seed = 0) {
  const s = 512;
  const c = canvasOf(s);
  const g = c.getContext('2d');
  const rand = rng(101 + seed * 37);
  const pal = ART_PALETTES[seed % ART_PALETTES.length];

  g.fillStyle = pal[3];
  g.fillRect(0, 0, s, s);

  const style = seed % 3;

  if (style === 0) {
    // sun + hills
    g.fillStyle = pal[1];
    g.beginPath();
    g.arc(s * 0.62, s * 0.34, s * 0.16, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = pal[0];
    g.beginPath();
    g.moveTo(0, s * 0.72);
    g.bezierCurveTo(s * 0.3, s * 0.56, s * 0.55, s * 0.82, s, s * 0.66);
    g.lineTo(s, s);
    g.lineTo(0, s);
    g.closePath();
    g.fill();

    g.fillStyle = pal[2];
    g.beginPath();
    g.moveTo(0, s * 0.84);
    g.bezierCurveTo(s * 0.35, s * 0.74, s * 0.6, s * 0.94, s, s * 0.82);
    g.lineTo(s, s);
    g.lineTo(0, s);
    g.closePath();
    g.fill();
  } else if (style === 1) {
    // abstract arches
    g.strokeStyle = pal[0];
    g.lineWidth = 26;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(s * 0.5, s * 0.72, s * (0.14 + i * 0.09), Math.PI, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = pal[1];
    g.fillRect(s * 0.16, s * 0.72, s * 0.68, s * 0.05);
  } else {
    // blobs
    for (let i = 0; i < 5; i++) {
      g.fillStyle = pal[i % pal.length];
      g.globalAlpha = 0.75;
      g.beginPath();
      g.ellipse(
        s * (0.25 + rand() * 0.5),
        s * (0.25 + rand() * 0.5),
        s * (0.08 + rand() * 0.14),
        s * (0.08 + rand() * 0.14),
        rand() * Math.PI,
        0,
        Math.PI * 2
      );
      g.fill();
    }
    g.globalAlpha = 1;
  }

  // paper grain
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(90, 70, 50, ${rand() * 0.05})`;
    g.fillRect(rand() * s, rand() * s, 1, 1);
  }

  return finish(c, 1, 1);
}

/* ------------------------------------------------------------------ */
/*  Globe                                                              */
/* ------------------------------------------------------------------ */

export function makeGlobeTexture() {
  const s = 512;
  const c = canvasOf(s);
  const g = c.getContext('2d');
  const rand = rng(71);

  const sea = g.createLinearGradient(0, 0, 0, s);
  sea.addColorStop(0, '#7fb0cf');
  sea.addColorStop(1, '#5d8fae');
  g.fillStyle = sea;
  g.fillRect(0, 0, s, s);

  g.fillStyle = '#8fae7d';
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    const x = rand() * s;
    const y = rand() * s;
    g.ellipse(x, y, 20 + rand() * 60, 12 + rand() * 40, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  g.lineWidth = 2;
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.moveTo(0, (s / 8) * i);
    g.lineTo(s, (s / 8) * i);
    g.stroke();
  }

  return finish(c, 1, 1);
}
