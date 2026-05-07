// Mobile bottom-sheet UI controller.
// - Drag the handle vertically to open/close
// - Tap a tab to switch panes (auto-opens the sheet)
// - sheetAutoOpen() lets the host code request a tab change + open from the outside

let sheetEl = null;
let handleEl = null;
let tabsEls = null;
let panesEls = null;

function setState(state) {
  if (!sheetEl) return;
  sheetEl.dataset.state = state;       // 'peek' | 'open'
  sheetEl.style.maxHeight = '';        // clear any in-progress drag value
}

function activateTab(name) {
  if (!tabsEls) return;
  tabsEls.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  panesEls.forEach(p => { p.hidden = p.dataset.pane !== name; });
}

// Programmatically jump to a tab and open the sheet (used when an item is selected).
export function sheetAutoOpen(item) {
  if (!sheetEl) return;
  if (sheetEl.dataset.state === 'open') return;
  if (!item) return;
  if (item.type === 'text') activateTab('text');
  else if (item.type === 'image') activateTab('image');
  else activateTab('props');
}

export function initBottomSheet({ onTabChange } = {}) {
  sheetEl = document.getElementById('bottom-sheet');
  handleEl = document.getElementById('sheet-handle');
  tabsEls = document.querySelectorAll('#sheet-tabs .tab');
  panesEls = document.querySelectorAll('.tab-pane');
  if (!sheetEl || !handleEl) return;

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
      const openH = window.innerHeight * 0.78;
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
}
