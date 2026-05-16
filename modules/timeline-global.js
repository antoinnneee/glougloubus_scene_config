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

// Position en % à l'intérieur de la fenêtre visible [viewStart, viewStart+viewFrames-1].
// Ne renvoie une position valide que pour f dans la fenêtre ; sinon le caller
// doit filtrer en amont avant d'appeler pct().
function pct(f, viewStart, viewFrames) {
  if (viewFrames <= 1) return '0%';
  return `${((f - viewStart) / (viewFrames - 1)) * 100}%`;
}

// --- Auto-repeat pan : timers stockés au niveau module, pas sur le bouton.
// Le bouton qui héberge l'event est détruit à chaque renderTimeline() (innerHTML
// = ''), donc un setInterval attaché localement devient orphelin et continue à
// firer à l'infini sans qu'on puisse l'arrêter — d'où la boucle infinie en
// bout de timeline. Avec un timer module-level + listeners pointerup/cancel
// sur window, le cleanup marche peu importe où la sourie est relâchée.
let _panStopTimer = null;
let _panRepeatTimer = null;
function stopPanRepeat() {
  if (_panStopTimer) { clearTimeout(_panStopTimer); _panStopTimer = null; }
  if (_panRepeatTimer) { clearInterval(_panRepeatTimer); _panRepeatTimer = null; }
}
window.addEventListener('pointerup', stopPanRepeat);
window.addEventListener('pointercancel', stopPanRepeat);

// Formate une frame en temps (secondes), avec suffixe `s` et zéros traînants
// supprimés. Exemples : 0 → "0s", 0.50 → "0.5s", 1.00 → "1s", 1.55 → "1.55s".
function fmtTime(f, fps) {
  const s = f / Math.max(1, fps);
  const t = s.toFixed(2).replace(/\.?0+$/, '');
  return `${t}s`;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   project, currentFrame: number, selectedObj?,
 *   viewStart?: number, viewFrames?: number,
 *   callbacks: {
 *     onSeek(f), onAddKf(prop, f), onMoveKf(prop, oldF, newF), onRemoveKf(prop, f),
 *     onPan?(delta),
 *   }
 * }} opts
 */
export function renderGlobalTimeline(container, { project, currentFrame, selectedObj, viewStart, viewFrames, callbacks }) {
  if (!container) return;
  container.innerHTML = '';
  container.classList.add('gtl-root');

  const frameCount = Math.max(1, project.frameCount);
  const fps = Math.max(1, project.fps || 20);
  // Fenêtre visible (par défaut = toute la timeline). Clampée à frameCount.
  const vf = Math.max(1, Math.min(viewFrames || frameCount, frameCount));
  const vs = Math.max(0, Math.min(viewStart || 0, Math.max(0, frameCount - vf)));
  const viewEnd = vs + vf - 1; // dernière frame visible (inclusive)
  const isPanned = vf < frameCount;

  // --- Barre de pan (seulement si toute la timeline ne tient pas)
  if (isPanned) {
    const panBar = document.createElement('div');
    panBar.className = 'gtl-pan-bar';
    // Helper générique : crée un bouton de navigation. Action = closure que
    // l'appelant passe. allowRepeat = true pour les pan (long-press →
    // auto-repeat 180ms compatible touch Android) ; false pour les sauts
    // début/fin où un seul firing suffit.
    const makeNavBtn = (label, aria, action, disabled, allowRepeat) => {
      const b = document.createElement('button');
      b.className = 'iconbtn gtl-pan-btn';
      b.textContent = label;
      b.disabled = disabled;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', (e) => {
        if (b.dataset.suppressClick === '1') { b.dataset.suppressClick = '0'; return; }
        e.preventDefault();
        action();
      });
      if (allowRepeat) {
        b.addEventListener('pointerdown', () => {
          stopPanRepeat();
          _panStopTimer = setTimeout(() => {
            b.dataset.suppressClick = '1';
            action();
            // À chaque action(), renderTimeline() détruit ce bouton ; le
            // setInterval module-level survit, window.pointerup l'arrête.
            _panRepeatTimer = setInterval(action, 180);
          }, 400);
        });
      }
      return b;
    };
    const halfStep = Math.max(1, Math.floor(vf / 2));
    const fastStep = Math.max(1, 10 * fps); // 10 secondes
    const atStart = vs <= 0 && currentFrame <= 0;
    const atEnd = viewEnd >= frameCount - 1 && currentFrame >= frameCount - 1;
    const onPan = (d) => callbacks.onPan && callbacks.onPan(d);
    const onJump = (f) => callbacks.onJumpTo && callbacks.onJumpTo(f);
    panBar.appendChild(makeNavBtn('⏮', 'Début',          () => onJump(0),              atStart,                false));
    panBar.appendChild(makeNavBtn('⏪', 'Reculer de 10s',  () => onPan(-fastStep),      vs <= 0,                true));
    panBar.appendChild(makeNavBtn('◀', 'Reculer',         () => onPan(-halfStep),      vs <= 0,                true));
    const info = document.createElement('span');
    info.className = 'gtl-view-info';
    info.textContent = `${fmtTime(vs, fps)} – ${fmtTime(viewEnd, fps)} / ${fmtTime(frameCount, fps)}`;
    panBar.appendChild(info);
    panBar.appendChild(makeNavBtn('▶', 'Avancer',         () => onPan(+halfStep),      viewEnd >= frameCount - 1, true));
    panBar.appendChild(makeNavBtn('⏩', 'Avancer de 10s',  () => onPan(+fastStep),      viewEnd >= frameCount - 1, true));
    panBar.appendChild(makeNavBtn('⏭', 'Fin',             () => onJump(frameCount - 1), atEnd,                  false));
    container.appendChild(panBar);
  }

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

  // Cadence des labels : adaptée à la fenêtre visible, pas au total
  const labelEvery = vf <= 10 ? 1 : vf <= 30 ? 5 : vf <= 80 ? 10 : 20;
  for (let f = vs; f <= viewEnd; f++) {
    const tick = document.createElement('div');
    tick.className = 'gtl-tick';
    if (f === currentFrame) tick.classList.add('active');
    if ((f - vs) % labelEvery === 0 || f === viewEnd) tick.classList.add('major');
    tick.style.left = pct(f, vs, vf);
    if ((f - vs) % labelEvery === 0 || f === viewEnd) {
      const lbl = document.createElement('span');
      lbl.className = 'gtl-tick-label';
      // Le dernier label collé contre le bord droit déborderait du ruler ;
      // on l'aligne à gauche du tick au lieu d'à droite.
      if (f === viewEnd) lbl.classList.add('gtl-tick-label-end');
      lbl.textContent = fmtTime(f, fps);
      tick.appendChild(lbl);
    }
    ruler.appendChild(tick);
  }

  // Playhead vertical : seulement s'il est dans la fenêtre visible
  if (currentFrame >= vs && currentFrame <= viewEnd) {
    const playhead = document.createElement('div');
    playhead.className = 'gtl-playhead';
    playhead.style.left = pct(currentFrame, vs, vf);
    ruler.appendChild(playhead);
  }

  // Drag scrub : pointer sur la ruler met à jour la frame courante en live
  attachScrub(ruler, vs, vf, callbacks.onSeek);

  // Wheel sur la ruler → pan horizontal (desktop bonus, sans capture touch).
  // On scale sur la largeur de la fenêtre pour avoir un pas raisonnable.
  if (isPanned) {
    ruler.addEventListener('wheel', (e) => {
      const dom = (e.deltaX !== 0 ? e.deltaX : e.deltaY);
      if (!dom) return;
      e.preventDefault();
      const step = Math.sign(dom) * Math.max(1, Math.floor(vf / 8));
      if (callbacks.onPan) callbacks.onPan(step);
    }, { passive: false });
  }

  // Menu contextuel (clic droit / touch long-press → contextmenu) sur la
  // ruler : actions au niveau frame (dupliquer / supprimer / vider l'objet).
  attachTimelineContextMenu(ruler, vs, vf, fps, !!selectedObj, callbacks);

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
      lanesWrap.appendChild(buildTrackRow(prop, kfs, vs, vf, fps, frameCount, currentFrame, callbacks));
    }
  }

  container.appendChild(lanesWrap);
}

// Convertit un clientX (event) en frame logique, en se basant sur la fenêtre
// visible [vs, vs+vf-1] de la timeline. Toujours clampé sur [0, frameCount-1].
function clientXToFrame(rect, clientX, vs, vf, frameCount) {
  const f = Math.round(((clientX - rect.left) / rect.width) * (vf - 1)) + vs;
  return Math.max(0, Math.min(frameCount - 1, f));
}

// Drag horizontal sur un élément pour scrubber la frame.
// Note importante : le premier seek déclenche un renderTimeline() côté host qui
// détruit `el` (innerHTML = ''). On capture donc la geometry une fois au
// pointerdown et on écoute move/up sur window — sinon les pointermove
// suivants partent dans un élément orphelin et le drag ne marche pas.
function attachScrub(el, vs, vf, onSeek) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('gtl-dot')) return; // les dots gèrent leur propre drag
    const rect = el.getBoundingClientRect();
    // frameCount n'est pas utile ici pour le clamp (on n'est pas censé sortir
    // de la fenêtre via un drag horizontal local) — clamp sur la fenêtre.
    e.preventDefault();
    const seek = (clientX) => {
      const local = Math.round(((clientX - rect.left) / rect.width) * (vf - 1)) + vs;
      const f = Math.max(vs, Math.min(vs + vf - 1, local));
      onSeek(f);
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

// Clic-droit sur la ruler ou une lane vide → menu d'actions frame-level.
function attachTimelineContextMenu(el, vs, vf, fps, hasSelected, callbacks) {
  el.addEventListener('contextmenu', (e) => {
    if (e.target.classList.contains('gtl-dot')) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const local = Math.round(((e.clientX - rect.left) / rect.width) * (vf - 1)) + vs;
    const f = Math.max(vs, Math.min(vs + vf - 1, local));
    const tLabel = fmtTime(f, fps);
    const items = [
      { label: `⎘ Dupliquer la frame (${tLabel})`, action: () => callbacks.onDuplicateFrame && callbacks.onDuplicateFrame(f) },
      { label: `🗑 Supprimer la frame (${tLabel})`, danger: true, action: () => callbacks.onDeleteFrame && callbacks.onDeleteFrame(f) },
    ];
    if (hasSelected) {
      items.push({ separator: true, label: 'Objet sélectionné' });
      items.push({
        label: `🧹 Vider les keyframes à ${tLabel}`,
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

function buildTrackRow(prop, kfs, vs, vf, fps, frameCount, currentFrame, callbacks) {
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

  const viewEnd = vs + vf - 1;
  // Playhead local : seulement s'il est dans la fenêtre
  if (currentFrame >= vs && currentFrame <= viewEnd) {
    const ph = document.createElement('div');
    ph.className = 'gtl-lane-playhead';
    ph.style.left = pct(currentFrame, vs, vf);
    lane.appendChild(ph);
  }

  attachLaneInteraction(lane, prop, vs, vf, frameCount, callbacks);
  attachTimelineContextMenu(lane, vs, vf, fps, true, callbacks);

  // Dots : on ne rend que ceux visibles dans la fenêtre (perf + lisibilité)
  for (const kf of kfs) {
    if (kf.f < vs || kf.f > viewEnd) continue;
    lane.appendChild(buildDot(prop, kf, vs, vf, fps, frameCount, lane, callbacks));
  }

  row.appendChild(lane);
  return row;
}

function attachLaneInteraction(lane, prop, vs, vf, frameCount, callbacks) {
  lane.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('gtl-dot')) return;
    const startX = e.clientX;
    const rect = lane.getBoundingClientRect();
    const clamped = clientXToFrame(rect, startX, vs, vf, frameCount);

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
        callbacks.onSeek(clientXToFrame(rect, ev.clientX, vs, vf, frameCount));
      }
    };
    const onUp = () => {
      clearTimeout(lpTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!didLongPress && !didDrag) callbacks.onSeek(clamped);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function buildDot(prop, kf, vs, vf, fps, frameCount, laneEl, callbacks) {
  const dot = document.createElement('div');
  dot.className = 'gtl-dot';
  dot.dataset.easing = kf.easing || 'linear';
  dot.style.left = pct(kf.f, vs, vf);
  dot.title = `${fmtTime(kf.f, fps)} · ${kf.easing || 'linear'} (drag = déplacer, long-press / clic-droit = options)`;

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
      pendingF = clientXToFrame(rect, ev.clientX, vs, vf, frameCount);
      dot.style.left = pct(pendingF, vs, vf);
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
