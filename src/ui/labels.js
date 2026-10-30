import * as THREE from 'three';

/**
 * Screen-space labels anchored to 3D points. Cheap alternative to CSS2DRenderer
 * and keeps the DOM styling in our own hands.
 */
export function createLabels(container, items, camera, onSelect, occluders = []) {
  const entries = items.map((item) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'zone-label';
    el.dataset.zone = item.id;
    el.innerHTML = `<span class="zl-main">${item.text}</span><span class="zl-sub">${item.sub}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect?.(item.preset, item);
    });
    container.appendChild(el);

    return {
      el,
      pos: new THREE.Vector3(...item.pos),
      preset: item.preset,
    };
  });

  const projected = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  let visible = true;

  // Hide a label when a wall or the loft deck sits between the camera and the
  // anchor point. Otherwise the 书房 chip floats on top of the loft floor.
  function occluded(pos) {
    if (!occluders.length) return false;

    rayOrigin.copy(camera.position);
    rayDir.copy(pos).sub(rayOrigin);
    const dist = rayDir.length();
    if (dist < 0.2) return false;

    raycaster.set(rayOrigin, rayDir.normalize());
    raycaster.far = dist - 0.2;
    return raycaster.intersectObjects(occluders, false).length > 0;
  }

  return {
    update() {
      if (!visible) return;

      const w = window.innerWidth;
      const h = window.innerHeight;

      for (const entry of entries) {
        projected.copy(entry.pos).project(camera);
        const onScreen =
          projected.z > -1 &&
          projected.z < 1 &&
          projected.x > -1.25 &&
          projected.x < 1.25 &&
          projected.y > -1.25 &&
          projected.y < 1.25;

        if (!onScreen || occluded(entry.pos)) {
          entry.el.style.opacity = '0';
          entry.el.style.pointerEvents = 'none';
          continue;
        }

        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;

        entry.el.style.opacity = '1';
        entry.el.style.pointerEvents = 'auto';
        entry.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    },
    setVisible(next) {
      visible = next;
      container.classList.toggle('is-hidden', !next);
    },
    get visible() {
      return visible;
    },
  };
}
