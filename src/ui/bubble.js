/**
 * 头顶气泡 —— 小拾当前在干什么，一眼看见。
 *
 * 用 DOM 而不是贴图：文字永远清晰、换文案零成本、不受模型是单网格的限制。
 * 投影与遮挡剔除的做法和 ui/labels.js 一致（相机投影 + 墙体射线遮挡判断），
 * 所以小拾走到阁楼楼板下、或被墙挡住时气泡不会浮在屋外。
 */
import * as THREE from 'three';

/** 状态 → 图标 + 中文短语。 */
const GLYPH = {
  idle: { icon: '☕', word: '歇着' },
  planning: { icon: '🗒', word: '盘算' },
  walking: { icon: '🚶', word: '走过去' },
  working: { icon: '⌨', word: '干活' },
  thinking: { icon: '💭', word: '想想' },
  waiting_confirm: { icon: '❓', word: '等你确认' },
  done: { icon: '✔', word: '搞定' },
  error: { icon: '！', word: '出错了' },
};

const TASK_MAX = 26; // 按字符数截断，中文不会被腰斩

function clip(text) {
  if (!text) return '';
  const s = String(text).trim();
  const chars = Array.from(s);
  return chars.length > TASK_MAX ? `${chars.slice(0, TASK_MAX).join('')}…` : s;
}

export function createBubble({ container, camera, occluders = [], getAnchor, getState }) {
  const el = document.createElement('div');
  el.className = 'bubble is-idle';
  el.innerHTML =
    '<span class="bub-icon"></span>' +
    '<span class="bub-body"><span class="bub-word"></span><span class="bub-task"></span>' +
    '<span class="bub-bar"><i></i></span></span>';
  container.appendChild(el);

  const iconEl = el.querySelector('.bub-icon');
  const wordEl = el.querySelector('.bub-word');
  const taskEl = el.querySelector('.bub-task');
  const barEl = el.querySelector('.bub-bar');
  const barFill = barEl.querySelector('i');

  const projected = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const anchor = new THREE.Vector3();

  let lastKey = '';
  let hidden = false;

  function occluded(p) {
    if (!occluders.length) return false;
    rayOrigin.copy(camera.position);
    rayDir.copy(p).sub(rayOrigin);
    const dist = rayDir.length();
    if (dist < 0.2) return false;
    raycaster.set(rayOrigin, rayDir.normalize());
    raycaster.far = dist - 0.25;
    return raycaster.intersectObjects(occluders, false).length > 0;
  }

  function paint(state) {
    const g = GLYPH[state] || GLYPH.idle;
    // 只在内容真变了才写 DOM，避免每帧触发布局
    const info = getState();
    const task = clip(info.task);
    const progress = typeof info.progress === 'number' ? Math.max(0, Math.min(1, info.progress)) : null;
    const key = `${state}|${task}|${progress === null ? '-' : progress.toFixed(2)}`;
    if (key === lastKey) return;
    lastKey = key;

    el.className = `bubble is-${state}`;
    iconEl.textContent = g.icon;
    wordEl.textContent = g.word;
    taskEl.textContent = task;
    taskEl.style.display = task ? '' : 'none';
    if (progress === null) {
      barEl.style.display = 'none';
    } else {
      barEl.style.display = '';
      barFill.style.width = `${(progress * 100).toFixed(1)}%`;
    }
  }

  return {
    update() {
      if (hidden) return;
      const info = getState();
      paint(info.state);

      getAnchor(anchor);
      projected.copy(anchor).project(camera);
      const onScreen =
        projected.z > -1 && projected.z < 1 &&
        projected.x > -1.1 && projected.x < 1.1 &&
        projected.y > -1.1 && projected.y < 1.1;

      if (!onScreen || occluded(anchor)) {
        el.style.opacity = '0';
        return;
      }

      const w = window.innerWidth;
      const h = window.innerHeight;
      const x = (projected.x * 0.5 + 0.5) * w;
      const y = (-projected.y * 0.5 + 0.5) * h;
      el.style.opacity = '1';
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    },
    setVisible(next) {
      hidden = !next;
      el.style.display = hidden ? 'none' : '';
    },
    remove() {
      el.remove();
    },
  };
}

export { GLYPH };
