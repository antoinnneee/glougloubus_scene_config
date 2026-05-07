// Phase 2 — éditeur de keyframes par track pour l'onglet Anim.
// Interface stateless : rappeler renderKeyframeEditor() à chaque changement.

const TRACKS_BY_TYPE = {
  text:    ['x', 'y', 'size', 'rotation', 'color', 'opacity'],
  image:   ['x', 'y', 'scale', 'rotation', 'opacity'],
  drawing: ['x', 'y', 'rotation', 'opacity'],
  shape:   ['x1', 'y1', 'x2', 'y2', 'rotation', 'color', 'opacity'],
};

const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bounce'];

// --- Context menu ---

let _activeMenu = null;

function closeMenu() {
  if (_activeMenu) {
    if (_activeMenu._cleanup) _activeMenu._cleanup();
    _activeMenu.remove();
    _activeMenu = null;
  }
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

function showMenu(anchorEl, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'kf-menu';

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'kf-menu-sep';
      sep.textContent = item.label || '';
      menu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.className = 'kf-menu-item';
      btn.textContent = item.label;
      btn.addEventListener('click', e => { e.stopPropagation(); closeMenu(); item.action(); });
      menu.appendChild(btn);
    }
  }

  document.body.appendChild(menu);
  _activeMenu = menu;

  const rect = anchorEl.getBoundingClientRect();
  const mw = 170;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
  if (top + 240 > window.innerHeight) top = rect.top - 240;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  // Outside-tap close différé d'un frame pour éviter que le pointerup du
  // long-press qui vient d'ouvrir le menu ne le referme aussitôt.
  requestAnimationFrame(() => {
    if (_activeMenu !== menu) return;
    const onOutside = (e) => {
      if (!_activeMenu) return;
      if (_activeMenu.contains(e.target)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', onOutside, true);
    menu._cleanup = () => document.removeEventListener('pointerdown', onOutside, true);
  });
}

// --- Public API ---

/**
 * @param {HTMLElement} container
 * @param {{ obj, currentFrame: number, frameCount: number, callbacks }} opts
 *   callbacks: { onAdd(prop,f), onRemove(prop,f), onSeek(f), onMove(prop,oldF,newF), onEasing(prop,f,easing) }
 */
export function renderKeyframeEditor(container, { obj, currentFrame, frameCount, callbacks }) {
  container.innerHTML = '';

  if (!obj) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Sélectionne un item pour éditer ses keyframes.';
    container.appendChild(hint);
    return;
  }

  const tracks = TRACKS_BY_TYPE[obj.type] || [];
  for (const prop of tracks) {
    const keyframes = (obj.tracks && obj.tracks[prop]) || [];
    container.appendChild(buildTrackRow(prop, keyframes, frameCount, currentFrame, callbacks));
  }
}

// --- Private ---

function buildTrackRow(prop, keyframes, frameCount, currentFrame, callbacks) {
  const row = document.createElement('div');
  row.className = 'kf-track-row';

  const label = document.createElement('span');
  label.className = 'kf-label';
  label.textContent = prop;
  row.appendChild(label);

  row.appendChild(buildTimeline(prop, keyframes, frameCount, currentFrame, callbacks));

  const addBtn = document.createElement('button');
  addBtn.className = 'btn outline kf-add';
  addBtn.textContent = '+';
  addBtn.title = `Keyframe à f=${currentFrame}`;
  addBtn.addEventListener('click', () => callbacks.onAdd(prop, currentFrame));
  row.appendChild(addBtn);

  return row;
}

function buildTimeline(prop, keyframes, frameCount, currentFrame, callbacks) {
  const tl = document.createElement('div');
  tl.className = 'kf-timeline';

  const bar = document.createElement('div');
  bar.className = 'kf-bar';
  tl.appendChild(bar);

  const ph = document.createElement('div');
  ph.className = 'kf-playhead';
  ph.style.left = pct(currentFrame, frameCount);
  tl.appendChild(ph);

  for (const kf of keyframes) {
    tl.appendChild(buildDot(prop, kf, frameCount, tl, callbacks));
  }

  return tl;
}

function pct(f, total) {
  if (total <= 1) return '0%';
  return `${(f / (total - 1)) * 100}%`;
}

function buildDot(prop, kf, frameCount, tlEl, callbacks) {
  const dot = document.createElement('div');
  dot.className = 'kf-dot';
  dot.style.left = pct(kf.f, frameCount);
  dot.title = `f${kf.f} · ${kf.easing || 'linear'}`;

  dot.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dot.setPointerCapture(e.pointerId);

    let isDragging = false;
    let menuShown = false;
    const startClientX = e.clientX;
    const startF = kf.f;
    let pendingF = startF;

    const longPressTimer = setTimeout(() => {
      menuShown = true;
      openDotMenu(dot, prop, kf, callbacks);
    }, 500);

    function onMove(ev) {
      if (!isDragging && Math.abs(ev.clientX - startClientX) > 4) {
        clearTimeout(longPressTimer);
        isDragging = true;
      }
      if (!isDragging) return;
      const rect = tlEl.getBoundingClientRect();
      const rawF = ((ev.clientX - rect.left) / rect.width) * (frameCount - 1);
      pendingF = Math.round(Math.max(0, Math.min(frameCount - 1, rawF)));
      dot.style.left = pct(pendingF, frameCount);
    }

    function onUp() {
      clearTimeout(longPressTimer);
      dot.removeEventListener('pointermove', onMove);
      dot.removeEventListener('pointerup', onUp);
      dot.removeEventListener('pointercancel', onUp);
      if (menuShown) return;
      if (isDragging && pendingF !== startF) {
        callbacks.onMove(prop, startF, pendingF);
      } else if (!isDragging) {
        callbacks.onSeek(kf.f);
      }
    }

    dot.addEventListener('pointermove', onMove);
    dot.addEventListener('pointerup', onUp);
    dot.addEventListener('pointercancel', onUp);
  });

  dot.addEventListener('contextmenu', e => {
    e.preventDefault();
    openDotMenu(dot, prop, kf, callbacks);
  });

  return dot;
}

function openDotMenu(dot, prop, kf, callbacks) {
  showMenu(dot, [
    { label: '🗑 Supprimer', action: () => callbacks.onRemove(prop, kf.f) },
    { label: 'Easing', separator: true },
    ...EASINGS.map(e => ({
      label: (kf.easing === e || (!kf.easing && e === 'linear') ? '✓ ' : '    ') + e,
      action: () => callbacks.onEasing(prop, kf.f, e),
    })),
  ]);
}
