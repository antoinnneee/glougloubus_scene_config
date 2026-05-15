// Phase 3 — Panneau de calques.
// Liste les objets de project.objects[] dans l'ordre INVERSE (top = avant-plan).
// Stateless : rappeler renderLayersPanel() à chaque changement.

const TYPE_ICONS = {
  text:    '🅣',
  image:   '🖼',
  drawing: '✏️',
  shape:   '▢',
  group:   '📁',
  pacman:  '🟡',
};

function shapeIcon(shape) {
  switch (shape) {
    case 'line':         return '╱';
    case 'rect':         return '▣';
    case 'rect-outline': return '▢';
    case 'ellipse':      return '◯';
    default:             return '▢';
  }
}

function objectIcon(obj) {
  if (obj.type === 'shape') return shapeIcon(obj.static && obj.static.shape);
  return TYPE_ICONS[obj.type] || '◆';
}

// Sous-titre court à droite du nom. Vide si le nom contient déjà l'info utile.
function objectSummary(obj) {
  if (obj.type === 'drawing') return `${(obj.static.points || []).length} pts`;
  return '';
}

// --- Menu ---

let _activeMenu = null;

function closeMenu() {
  if (_activeMenu) { _activeMenu.remove(); _activeMenu = null; }
}

document.addEventListener('click', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

function showRowMenu(anchorEl, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'kf-menu';

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'kf-menu-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', e => { e.stopPropagation(); closeMenu(); item.action(); });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  _activeMenu = menu;

  const rect = anchorEl.getBoundingClientRect();
  const mw = 180;
  let left = rect.right - mw;
  let top = rect.bottom + 6;
  if (left < 8) left = 8;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
  if (top + 240 > window.innerHeight) top = rect.top - 240;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

// --- Public API ---

/**
 * @param {HTMLElement} container
 * @param {{
 *   project, selectedIds: Set<string>,
 *   callbacks: {
 *     onSelect(id, modifier: boolean), onToggleVisible(id), onToggleLock(id),
 *     onRename(id, name), onReorder(fromIdx, toIdx),
 *     onDuplicate(id), onDelete(id),
 *     onSendToTop(id), onSendToBottom(id)
 *   }
 * }} opts
 *
 * Convention z-order : project.objects[0] est rendu EN PREMIER (= en arrière).
 * Le panneau affiche les calques de haut en bas dans l'ordre "avant-plan d'abord",
 * c'est-à-dire l'inverse de l'ordre du tableau.
 */
export function renderLayersPanel(container, { project, selectedIds, callbacks }) {
  if (!container) return;
  container.innerHTML = '';

  const selSet = selectedIds || new Set();

  const objs = project.objects;
  if (!objs || objs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Aucun objet. Ajoute du texte, une image, ou trace au pinceau.';
    container.appendChild(empty);
    return;
  }

  // Construit l'ordre visuel : groupes au top, enfants juste après, indentés.
  const visualOrder = buildVisualOrder(objs);
  for (const { obj, depth, idx } of visualOrder) {
    container.appendChild(buildRow(obj, idx, selSet, callbacks, objs.length, depth));
  }
}

// Top-first traversal qui place chaque objet juste après son parent (pour
// regrouper visuellement les enfants sous leur groupe). Les groupes top-level
// + objets racine sont itérés à l'envers (avant-plan d'abord), et chaque groupe
// "tire" ses enfants en cascade.
function buildVisualOrder(objs) {
  const visited = new Set();
  const order = [];
  const childrenOf = new Map();
  for (const o of objs) {
    if (o.parentId) {
      if (!childrenOf.has(o.parentId)) childrenOf.set(o.parentId, []);
      childrenOf.get(o.parentId).push(o);
    }
  }

  function emit(o, depth) {
    if (visited.has(o.id)) return;
    visited.add(o.id);
    const idx = objs.indexOf(o);
    order.push({ obj: o, depth, idx });
    if (o.type === 'group') {
      const kids = (childrenOf.get(o.id) || []).slice();
      // Top-first parmi les enfants (= ordre objects[] inversé)
      kids.sort((a, b) => objs.indexOf(b) - objs.indexOf(a));
      for (const k of kids) emit(k, depth + 1);
    }
  }

  // Itère les top-level (parentId=null) en backwards (top-first)
  for (let i = objs.length - 1; i >= 0; i--) {
    if (!objs[i].parentId) emit(objs[i], 0);
  }
  // Cas dégénéré : enfants orphelins (parent introuvable) — render à la fin
  for (let i = objs.length - 1; i >= 0; i--) {
    if (!visited.has(objs[i].id)) emit(objs[i], 0);
  }
  return order;
}

// --- Private ---

function buildRow(obj, idx, selectedIds, callbacks, total, depth = 0) {
  const row = document.createElement('div');
  row.className = 'layer-row';
  row.dataset.id = obj.id;
  row.dataset.idx = String(idx);
  if (depth > 0) {
    row.style.marginLeft = `${depth * 14}px`;
    row.classList.add('layer-child');
  }
  if (obj.type === 'group') row.classList.add('layer-group-row');
  if (selectedIds.has(obj.id)) row.classList.add('selected');
  if (!obj.visible) row.classList.add('hidden-layer');
  if (obj.locked)   row.classList.add('locked-layer');

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'layer-handle';
  handle.textContent = '⠿';
  handle.title = 'Glisser pour réordonner';
  row.appendChild(handle);

  // Visibility toggle
  const eye = document.createElement('button');
  eye.className = 'layer-toggle' + (obj.visible ? '' : ' off');
  eye.textContent = obj.visible ? '👁' : '⌀';
  eye.title = obj.visible ? 'Masquer' : 'Afficher';
  eye.addEventListener('click', e => { e.stopPropagation(); callbacks.onToggleVisible(obj.id); });
  row.appendChild(eye);

  // Lock toggle
  const lock = document.createElement('button');
  lock.className = 'layer-toggle' + (obj.locked ? ' on' : '');
  lock.textContent = obj.locked ? '🔒' : '🔓';
  lock.title = obj.locked ? 'Déverrouiller' : 'Verrouiller';
  lock.addEventListener('click', e => { e.stopPropagation(); callbacks.onToggleLock(obj.id); });
  row.appendChild(lock);

  // Type icon
  const icon = document.createElement('span');
  icon.className = 'layer-icon';
  icon.textContent = objectIcon(obj);
  row.appendChild(icon);

  // Name (click → select, dblclick → rename)
  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = obj.name || obj.type;
  const summary = objectSummary(obj);
  if (summary) {
    const sub = document.createElement('span');
    sub.className = 'layer-summary';
    sub.textContent = ' · ' + summary;
    name.appendChild(sub);
  }
  row.appendChild(name);

  // ⋯ menu button
  const menuBtn = document.createElement('button');
  menuBtn.className = 'layer-menu-btn';
  menuBtn.textContent = '⋯';
  menuBtn.title = 'Plus';
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    openRowMenu(menuBtn, obj, idx, total, callbacks);
  });
  row.appendChild(menuBtn);

  // Click row (sauf sur les boutons) → select
  // Long-press (≥500ms sans bouger) = additif (toggle), équivalent tactile de Shift-clic
  let pressTimer = null;
  let longPressFired = false;
  let pressStart = null;

  const cancelPress = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStart = null;
  };

  row.addEventListener('pointerdown', e => {
    if (e.target === handle) return;
    if (e.target.closest('button')) return;
    if (row.classList.contains('renaming')) return;
    longPressFired = false;
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      longPressFired = true;
      pressTimer = null;
      if (navigator.vibrate) try { navigator.vibrate(25); } catch {}
      callbacks.onSelect(obj.id, true);
    }, 500);
  });
  row.addEventListener('pointermove', e => {
    if (!pressStart) return;
    const dx = e.clientX - pressStart.x;
    const dy = e.clientY - pressStart.y;
    if (dx * dx + dy * dy > 64) cancelPress();
  });
  row.addEventListener('pointerup', cancelPress);
  row.addEventListener('pointercancel', cancelPress);
  row.addEventListener('pointerleave', cancelPress);

  row.addEventListener('click', e => {
    if (e.target === handle) return;
    if (e.target.closest('button')) return;
    if (e.target === name && row.classList.contains('renaming')) return;
    if (longPressFired) { longPressFired = false; return; }
    const modifier = e.shiftKey || e.ctrlKey || e.metaKey;
    callbacks.onSelect(obj.id, modifier);
  });

  // Stash refs pour permettre au menu "Renommer" de relancer le rename inline
  row._startRename = () => startRename(row, name, obj, callbacks);

  // Dblclick name → rename inline
  name.addEventListener('dblclick', e => {
    e.stopPropagation();
    row._startRename();
  });

  // Drag-to-reorder via pointer events (HTML5 dnd ne marche pas bien sur touch)
  attachReorderHandle(handle, row, callbacks);

  return row;
}

function openRowMenu(anchor, obj, idx, total, callbacks) {
  showRowMenu(anchor, [
    { label: '✎ Renommer', action: () => startRenameById(obj.id) },
    { label: '⎘ Dupliquer', action: () => callbacks.onDuplicate(obj.id) },
    { label: '▲ Mettre en avant', action: () => callbacks.onSendToTop(obj.id) },
    { label: '▼ Mettre en arrière', action: () => callbacks.onSendToBottom(obj.id) },
    { label: '🗑 Supprimer', danger: true, action: () => callbacks.onDelete(obj.id) },
  ]);
}

// Démarre le rename inline depuis l'extérieur (ex: bouton menu)
function startRenameById(id) {
  const row = document.querySelector(`.layer-row[data-id="${id}"]`);
  if (row && typeof row._startRename === 'function') row._startRename();
}

function startRename(row, nameEl, obj, callbacks) {
  if (row.classList.contains('renaming')) return;
  row.classList.add('renaming');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'layer-rename-input';
  input.value = obj.name || obj.type;
  // Remplace temporairement le contenu du span name
  const oldHTML = nameEl.innerHTML;
  nameEl.innerHTML = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  const commit = (save) => {
    const newName = input.value.trim();
    nameEl.innerHTML = oldHTML;
    row.classList.remove('renaming');
    if (save && newName && newName !== obj.name) {
      callbacks.onRename(obj.id, newName);
    }
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', e => e.stopPropagation());
}

// --- Reorder via drag du handle ---
//
// On évite HTML5 drag&drop pour rester compatible touch. Pendant un drag :
// - on lit la position Y du curseur
// - on calcule l'index cible en fonction des bounding rects des autres rows
// - on applique une translation visuelle "ghost" sur la row draggée
// - au up, on appelle onReorder(fromIdx, toIdx)

function attachReorderHandle(handleEl, rowEl, callbacks) {
  let dragging = null;

  handleEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    e.preventDefault();
    e.stopPropagation();
    handleEl.setPointerCapture(e.pointerId);

    const list = rowEl.parentElement;
    const allRows = [...list.querySelectorAll('.layer-row')];
    const startIdx = allRows.indexOf(rowEl);
    const startY = e.clientY;

    // Index dans project.objects (inverse de l'ordre d'affichage)
    const fromObjIdx = parseInt(rowEl.dataset.idx, 10);

    // Précomputed midpoints pour décider de la cible
    const rowRects = allRows.map(r => r.getBoundingClientRect());

    rowEl.classList.add('dragging');
    rowEl.style.zIndex = '10';

    let lastTargetIdx = startIdx;

    dragging = { fromObjIdx, fromVisualIdx: startIdx, startY, allRows, rowRects, list };

    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      rowEl.style.transform = `translateY(${dy}px)`;

      // Trouve la row dont le midpoint est croisé par ev.clientY
      let target = startIdx;
      for (let i = 0; i < allRows.length; i++) {
        if (i === startIdx) continue;
        const mid = rowRects[i].top + rowRects[i].height / 2;
        if (i < startIdx && ev.clientY < mid) { target = i; break; }
        if (i > startIdx && ev.clientY > mid) target = i;
      }
      if (target !== lastTargetIdx) {
        // Indicateur visuel : highlight de la row cible
        allRows.forEach(r => r.classList.remove('drop-target'));
        if (target !== startIdx) allRows[target].classList.add('drop-target');
        lastTargetIdx = target;
      }
    };

    const onUp = () => {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onUp);
      handleEl.removeEventListener('pointercancel', onUp);
      rowEl.classList.remove('dragging');
      rowEl.style.transform = '';
      rowEl.style.zIndex = '';
      allRows.forEach(r => r.classList.remove('drop-target'));

      if (lastTargetIdx !== startIdx) {
        // Convertit visualIdx (0=top) en objIdx (0=bottom) :
        // visualIdx = total - 1 - objIdx
        const total = allRows.length;
        const toObjIdx = total - 1 - lastTargetIdx;
        callbacks.onReorder(fromObjIdx, toObjIdx);
      }
      dragging = null;
    };

    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
    handleEl.addEventListener('pointercancel', onUp);
  });
}
