// Phase 6 — Timeline globale scrubbable.
// Remplace la frame strip de thumbs par : règle de frames + curseur (playhead)
// + lignes de keyframes des tracks de l'objet sélectionné.
//
// Stateless : rappeler renderGlobalTimeline() à chaque changement.

const TRACKS_BY_TYPE = {
  text:    ['x', 'y', 'size', 'rotation', 'color', 'opacity'],
  image:   ['x', 'y', 'scale', 'rotation', 'opacity'],
  drawing: ['x', 'y', 'rotation', 'opacity'],
  shape:   ['x1', 'y1', 'x2', 'y2', 'rotation', 'color', 'opacity'],
  group:   ['x', 'y', 'opacity'],
  pacman:  ['x', 'y', 'size', 'rotation', 'opacity'],
};

const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bounce'];

// --- Context menu (réutilisé pour easing + delete) ---

let _activeMenu = null;
function closeMenu() {
  if (_activeMenu) {
    if (_activeMenu._cleanup) _activeMenu._cleanup();
    _activeMenu.remove();
    _activeMenu = null;
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

function showMenu(anchorEl, items, coord) {
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
      btn.className = 'kf-menu-item' + (item.danger ? ' danger' : '');
      btn.textContent = item.label;
      btn.addEventListener('click', e => { e.stopPropagation(); closeMenu(); item.action(); });
      menu.appendChild(btn);
    }
  }
  document.body.appendChild(menu);
  _activeMenu = menu;
  // Positionnement : coord fournie (contextmenu = au curseur) sinon ancre sur
  // le rectangle de l'élément (long-press sur dot = sous le dot).
  const mw = 180;
  let left, top;
  if (coord) {
    left = coord.x;
    top = coord.y;
  } else {
    const rect = anchorEl.getBoundingClientRect();
    left = rect.left;
    top = rect.bottom + 6;
  }
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
  if (top + 280 > window.innerHeight) top = Math.max(8, top - 280);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  // Outside-tap close : on attache le listener au prochain frame pour éviter
  // que le pointerup du long-press en cours (qui synthétise un click sur le
  // dot) ferme immédiatement le menu juste ouvert.
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

function pct(f, total) {
  if (total <= 1) return '0%';
  return `${(f / (total - 1)) * 100}%`;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   project, currentFrame: number, selectedObj?,
 *   callbacks: {
 *     onSeek(f), onAddKf(prop, f), onMoveKf(prop, oldF, newF), onRemoveKf(prop, f),
 *   }
 * }} opts
 */
export function renderGlobalTimeline(container, { project, currentFrame, selectedObj, callbacks }) {
  if (!container) return;
  container.innerHTML = '';
  container.classList.add('gtl-root');

  const frameCount = Math.max(1, project.frameCount);

  // --- Règle (ruler) avec ticks et labels.
  // Important : la règle doit s'aligner pixel-pixel avec les lanes en dessous,
  // donc on reproduit la même structure (label spacer à gauche + zone à droite)
  // pour que les positions en pourcentage matchent.
  const rulerWrap = document.createElement('div');
  rulerWrap.className = 'gtl-ruler-wrap';
  const rulerSpacer = document.createElement('span');
  rulerSpacer.className = 'gtl-track-label';
  rulerSpacer.setAttribute('aria-hidden', 'true');
  rulerWrap.appendChild(rulerSpacer);
  const ruler = document.createElement('div');
  ruler.className = 'gtl-ruler';

  // Cadence des labels : tous les N pour rester lisible
  const labelEvery = frameCount <= 10 ? 1 : frameCount <= 30 ? 5 : frameCount <= 80 ? 10 : 20;
  for (let f = 0; f < frameCount; f++) {
    const tick = document.createElement('div');
    tick.className = 'gtl-tick';
    if (f === currentFrame) tick.classList.add('active');
    if (f % labelEvery === 0 || f === frameCount - 1) tick.classList.add('major');
    tick.style.left = pct(f, frameCount);
    if (f % labelEvery === 0 || f === frameCount - 1) {
      const lbl = document.createElement('span');
      lbl.className = 'gtl-tick-label';
      lbl.textContent = String(f);
      tick.appendChild(lbl);
    }
    ruler.appendChild(tick);
  }

  // Playhead vertical (au-dessus de la ruler ET des lanes)
  const playhead = document.createElement('div');
  playhead.className = 'gtl-playhead';
  playhead.style.left = pct(currentFrame, frameCount);
  ruler.appendChild(playhead);

  // Drag scrub : pointer sur la ruler met à jour la frame courante en live
  attachScrub(ruler, frameCount, callbacks.onSeek);

  // Menu contextuel (clic droit / touch long-press → contextmenu) sur la
  // ruler : actions au niveau frame (dupliquer / supprimer / vider l'objet).
  attachTimelineContextMenu(ruler, frameCount, !!selectedObj, callbacks);

  rulerWrap.appendChild(ruler);
  container.appendChild(rulerWrap);

  // --- Lanes par track de l'objet sélectionné
  const lanesWrap = document.createElement('div');
  lanesWrap.className = 'gtl-lanes';

  if (!selectedObj) {
    const hint = document.createElement('p');
    hint.className = 'gtl-hint';
    hint.textContent = 'Sélectionne un objet pour voir ses keyframes ici.';
    lanesWrap.appendChild(hint);
  } else {
    const props = TRACKS_BY_TYPE[selectedObj.type] || [];
    for (const prop of props) {
      const kfs = (selectedObj.tracks && selectedObj.tracks[prop]) || [];
      lanesWrap.appendChild(buildTrackRow(prop, kfs, frameCount, currentFrame, callbacks));
    }
  }

  container.appendChild(lanesWrap);
}

// Drag horizontal sur un élément pour scrubber la frame.
// Note importante : le premier seek déclenche un renderTimeline() côté host qui
// détruit `el` (innerHTML = ''). On capture donc la geometry une fois au
// pointerdown et on écoute move/up sur window — sinon les pointermove
// suivants partent dans un élément orphelin et le drag ne marche pas.
function attachScrub(el, frameCount, onSeek) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('gtl-dot')) return; // les dots gèrent leur propre drag
    const rect = el.getBoundingClientRect();
    e.preventDefault();
    const seek = (clientX) => {
      const f = Math.round(((clientX - rect.left) / rect.width) * (frameCount - 1));
      onSeek(Math.max(0, Math.min(frameCount - 1, f)));
    };
    seek(e.clientX);
    const onMove = (ev) => seek(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// Clic-droit sur la ruler ou une lane vide → menu d'actions frame-level :
//   - Dupliquer la frame (à la position cliquée)
//   - Supprimer la frame (à la position cliquée)
//   - Vider tous les keyframes de l'objet sélectionné (si présent)
// Le menu apparaît au curseur. Sur un dot, son propre handler stopPropagation
// donc on n'arrive jamais ici depuis un keyframe.
function attachTimelineContextMenu(el, frameCount, hasSelected, callbacks) {
  el.addEventListener('contextmenu', (e) => {
    if (e.target.classList.contains('gtl-dot')) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const raw = Math.round(((e.clientX - rect.left) / rect.width) * (frameCount - 1));
    const f = Math.max(0, Math.min(frameCount - 1, raw));
    const items = [
      { label: '⎘ Dupliquer la frame', action: () => callbacks.onDuplicateFrame && callbacks.onDuplicateFrame(f) },
      { label: '🗑 Supprimer la frame', danger: true, action: () => callbacks.onDeleteFrame && callbacks.onDeleteFrame(f) },
    ];
    if (hasSelected) {
      items.push({ separator: true, label: 'Objet sélectionné' });
      items.push({
        label: `🧹 Vider les keyframes à f${f}`,
        danger: true,
        action: () => callbacks.onClearObjectKeyframesAtFrame && callbacks.onClearObjectKeyframesAtFrame(f),
      });
      items.push({
        label: '🗑 Vider tous les keyframes',
        danger: true,
        action: () => callbacks.onClearObjectKeyframes && callbacks.onClearObjectKeyframes(),
      });
    }
    showMenu(el, items, { x: e.clientX, y: e.clientY });
  });
}

function buildTrackRow(prop, kfs, frameCount, currentFrame, callbacks) {
  const row = document.createElement('div');
  row.className = 'gtl-track-row';

  const label = document.createElement('span');
  label.className = 'gtl-track-label';
  label.textContent = prop;
  row.appendChild(label);

  const lane = document.createElement('div');
  lane.className = 'gtl-lane';

  const bar = document.createElement('div');
  bar.className = 'gtl-lane-bar';
  lane.appendChild(bar);

  // Playhead local (mince ligne verticale dans la lane)
  const ph = document.createElement('div');
  ph.className = 'gtl-lane-playhead';
  ph.style.left = pct(currentFrame, frameCount);
  lane.appendChild(ph);

  // Long-press dans une zone vide de la lane → ajoute kf à l'endroit cliqué.
  // Évite de masquer le scrub : si le drag dépasse 4 px, on annule l'add et on
  // bascule sur le scrub (handlé par attachScrub plus bas).
  attachLaneInteraction(lane, prop, frameCount, callbacks);
  // Clic-droit sur la lane (zone vide) : mêmes actions frame-level que sur
  // la ruler. Les dots stoppent la propagation pour conserver leur menu.
  attachTimelineContextMenu(lane, frameCount, true, callbacks);

  // Dots des keyframes
  for (const kf of kfs) {
    lane.appendChild(buildDot(prop, kf, frameCount, lane, callbacks));
  }

  row.appendChild(lane);
  return row;
}

function attachLaneInteraction(lane, prop, frameCount, callbacks) {
  lane.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('gtl-dot')) return;
    const startX = e.clientX;
    const rect = lane.getBoundingClientRect();
    const startF = Math.round(((startX - rect.left) / rect.width) * (frameCount - 1));
    const clamped = Math.max(0, Math.min(frameCount - 1, startF));

    let didLongPress = false;
    let didDrag = false;
    const lpTimer = setTimeout(() => {
      didLongPress = true;
      callbacks.onAddKf(prop, clamped);
    }, 500);

    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 4) {
        didDrag = true;
        clearTimeout(lpTimer);
        // Bascule sur le scrub (tap normal)
        const f = Math.round(((ev.clientX - rect.left) / rect.width) * (frameCount - 1));
        callbacks.onSeek(Math.max(0, Math.min(frameCount - 1, f)));
      }
    };
    const onUp = () => {
      clearTimeout(lpTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // Tap court → seek
      if (!didLongPress && !didDrag) callbacks.onSeek(clamped);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function buildDot(prop, kf, frameCount, laneEl, callbacks) {
  const dot = document.createElement('div');
  dot.className = 'gtl-dot';
  dot.dataset.easing = kf.easing || 'linear';
  dot.style.left = pct(kf.f, frameCount);
  dot.title = `f${kf.f} · ${kf.easing || 'linear'} (drag = déplacer, long-press / clic-droit = options)`;

  function openDotMenu() {
    showMenu(dot, [
      { label: '🗑 Supprimer', danger: true, action: () => callbacks.onRemoveKf(prop, kf.f) },
      { label: 'Easing', separator: true },
      ...EASINGS.map(e => ({
        label: ((kf.easing || 'linear') === e ? '✓ ' : '    ') + e,
        action: () => callbacks.onSetEasing && callbacks.onSetEasing(prop, kf.f, e),
      })),
    ]);
  }

  dot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dot.setPointerCapture(e.pointerId);

    let dragging = false;
    let menuShown = false;
    let pendingF = kf.f;
    const startClientX = e.clientX;

    const longPressTimer = setTimeout(() => {
      menuShown = true;
      openDotMenu();
    }, 500);

    const onMove = (ev) => {
      if (!dragging && Math.abs(ev.clientX - startClientX) > 4) {
        clearTimeout(longPressTimer);
        dragging = true;
      }
      if (!dragging) return;
      const rect = laneEl.getBoundingClientRect();
      const f = Math.round(((ev.clientX - rect.left) / rect.width) * (frameCount - 1));
      pendingF = Math.max(0, Math.min(frameCount - 1, f));
      dot.style.left = pct(pendingF, frameCount);
    };
    const onUp = () => {
      clearTimeout(longPressTimer);
      dot.removeEventListener('pointermove', onMove);
      dot.removeEventListener('pointerup', onUp);
      dot.removeEventListener('pointercancel', onUp);
      if (menuShown) return;
      if (dragging && pendingF !== kf.f) {
        callbacks.onMoveKf(prop, kf.f, pendingF);
      } else if (!dragging) {
        callbacks.onSeek(kf.f);
      }
    };
    dot.addEventListener('pointermove', onMove);
    dot.addEventListener('pointerup', onUp);
    dot.addEventListener('pointercancel', onUp);
  });

  dot.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // Empêche le menu contextmenu de la lane/ruler de prendre le dessus :
    // sur un dot, c'est le menu spécifique au keyframe qu'on veut.
    e.stopPropagation();
    openDotMenu();
  });

  return dot;
}
