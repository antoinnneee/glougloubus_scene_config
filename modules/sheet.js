// Mobile bottom-sheet UI controller.
// - Drag the handle vertically to open/close
// - Tap a tab to switch panes (auto-opens the sheet)
// - sheetAutoOpen() lets the host code request a tab change + open from the outside

let sheetEl = null;
let handleEl = null;
let tabsEls = null;
let panesEls = null;
let appShell = null;

// Fraction de la hauteur d'écran de la sheet ouverte — sert juste de seuil pour
// le snap open/peek du drag. La hauteur réelle de la sheet est pilotée par son
// contenu + le max-height CSS (`.sheet[data-state="open"]` dans sheet.css).
const SHEET_OPEN_RATIO = 0.62;

// Le bas de l'app-shell doit s'arrêter pile en haut de la sheet, quelle que soit
// sa hauteur réelle (souvent < max-height car elle s'ajuste à son contenu). On
// recopie donc la hauteur mesurée de la sheet dans padding-bottom → le stage
// récupère tout le reste et le canvas LED reste visible.
function syncAppPaddingToSheet() {
  if (!appShell || !sheetEl) return;
  appShell.style.paddingBottom = sheetEl.offsetHeight + 'px';
}

function setState(state) {
  if (!sheetEl) return;
  sheetEl.dataset.state = state;       // 'peek' | 'open'
  sheetEl.querySelector('.sheet-body').inert = state === 'peek';
  sheetEl.style.maxHeight = '';        // clear any in-progress drag value
  // padding-bottom suivi par le ResizeObserver sur la sheet (cf. initBottomSheet)
}

function activateTab(name) {
  if (!tabsEls) return;
  tabsEls.forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
    t.tabIndex = active ? 0 : -1;
  });
  panesEls.forEach(p => { p.hidden = p.dataset.pane !== name; });
}

// Programmatically jump to a tab and open the sheet (used when an item is selected).
export function sheetAutoOpen(item) {
  if (document.body.dataset.mode === 'beginner') return;
  if (!sheetEl) return;
  if (sheetEl.dataset.state === 'open') return;
  if (!item) return;
  if (item.type === 'text') activateTab('text');
  else if (item.type === 'image') activateTab('image');
  // Pacman : on ouvre la timeline — c'est là qu'on règle le début/fin du trajet.
  else if (item.type === 'pacman') activateTab('timeline');
  else activateTab('props');
  setState('open');
}

export function initBottomSheet({ onTabChange } = {}) {
  sheetEl = document.getElementById('bottom-sheet');
  handleEl = document.getElementById('sheet-handle');
  tabsEls = document.querySelectorAll('#sheet-tabs .tab');
  panesEls = document.querySelectorAll('.tab-pane');
  appShell = document.querySelector('.app-shell');
  if (!sheetEl || !handleEl) return;
  tabsEls.forEach(t => {
    t.id = `studio-tab-${t.dataset.tab}`;
    t.setAttribute('aria-controls', `studio-pane-${t.dataset.tab}`);
    t.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const visible = [...tabsEls].filter(tab => tab.getClientRects().length);
      const index = visible.indexOf(t);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
      visible[next].click();
      visible[next].focus();
    });
  });
  panesEls.forEach(p => {
    p.id = `studio-pane-${p.dataset.pane}`;
    p.setAttribute('aria-labelledby', `studio-tab-${p.dataset.pane}`);
  });
  activateTab('timeline');
  setState(sheetEl.dataset.state || 'peek');

  // Tab click : open the sheet and switch pane
  tabsEls.forEach(t => {
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      activateTab(t.dataset.tab);
      setState('open');
      onTabChange?.(t.dataset.tab);
    });
  });

  // Drag the handle to expand/collapse
  let dragStartY = null;
  let dragStartMaxH = 0;
  let dragMoved = false;

  const onPointerDown = (e) => {
    // Tapping a tab is handled by its own click listener
    if (e.target.closest('.tab')) return;
    dragStartY = e.clientY;
    dragMoved = false;
    dragStartMaxH = sheetEl.getBoundingClientRect().height;
    handleEl.setPointerCapture(e.pointerId);
    sheetEl.style.transition = 'none';   // immediate response
  };

  const onPointerMove = (e) => {
    if (dragStartY === null) return;
    const dy = dragStartY - e.clientY;   // up = positive
    if (Math.abs(dy) > 5) dragMoved = true;
    const newH = Math.max(60, Math.min(window.innerHeight * 0.85, dragStartMaxH + dy));
    sheetEl.style.maxHeight = `${newH}px`;
    // padding-bottom suivi par le ResizeObserver sur la sheet
  };

  const onPointerUp = (e) => {
    if (dragStartY === null) return;
    const finalH = sheetEl.getBoundingClientRect().height;
    sheetEl.style.transition = '';
    sheetEl.style.maxHeight = '';

    if (!dragMoved) {
      // Tap on grip → toggle
      setState(sheetEl.dataset.state === 'open' ? 'peek' : 'open');
    } else {
      const openH = window.innerHeight * SHEET_OPEN_RATIO;
      const peekH = handleEl.getBoundingClientRect().height + 4;
      const distOpen = Math.abs(finalH - openH);
      const distPeek = Math.abs(finalH - peekH);
      setState(distOpen < distPeek ? 'open' : 'peek');
    }

    dragStartY = null;
    dragMoved = false;
    if (handleEl.hasPointerCapture(e.pointerId)) handleEl.releasePointerCapture(e.pointerId);
  };

  handleEl.addEventListener('pointerdown', onPointerDown);
  handleEl.addEventListener('pointermove', onPointerMove);
  handleEl.addEventListener('pointerup', onPointerUp);
  handleEl.addEventListener('pointercancel', onPointerUp);

  // La sheet change de hauteur via : transition open/peek, drag, ou contenu de
  // l'onglet. Un ResizeObserver garde padding-bottom de l'app-shell collé à sa
  // hauteur réelle à chaque frame → pas de trou ni de chevauchement.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncAppPaddingToSheet).observe(sheetEl);
  }
  syncAppPaddingToSheet();
}
