// Modèle de scène v3 : project = { width, height, fps, frameCount, objects[], imageDataUrls{}, recentColors[] }
//
// Un OBJET est une entité globale qui existe sur toute la timeline.
// - static: propriétés non animées (text, font, points, shape, imgId)
// - tracks: { propName: [{ f, v, easing }, ...] } triés par f, propriétés animables
// - visibleRanges: [[startF, endF], ...] | null (null = toujours visible)
// - parentId: pour les groupes (null = top-level)
//
// evaluateScene(project, f) → renderableItems[] : produit des items "à plat"
// pour le rendu, en interpolant les tracks au temps f. C'est l'équivalent du
// frames[f] de l'ancien modèle, mais dérivé.

import { applyEasing } from './easing.js';

export const SCENE_VERSION = 3;

// --- Création / IDs ---
function randomId() {
  return Math.random().toString(36).substring(2, 9);
}

function defaultName(type, id) {
  const map = { text: 'Texte', image: 'Image', drawing: 'Tracé', shape: 'Forme', group: 'Groupe', pacman: 'Pacman' };
  return `${map[type] || type} ${id.slice(0, 4)}`;
}

export function createEmptyProject({ width, height, fps = 20, frameCount = 1 } = {}) {
  return {
    version: SCENE_VERSION,
    width,
    height,
    fps,
    frameCount: Math.max(1, frameCount),
    objects: [],
    imageDataUrls: {},
    recentColors: ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800'],
  };
}

// Crée un objet vide. Le caller doit ensuite poser ses propres keyframes initiaux
// via setKeyframe(obj, prop, 0, value). On ne pose RIEN par défaut pour rester
// explicite : un objet sans keyframes n'a pas de position définie.
export function createObject(type, opts = {}) {
  const id = opts.id || randomId();
  return {
    id,
    name: opts.name || defaultName(type, id),
    type,
    visible: true,
    locked: false,
    parentId: opts.parentId || null,
    static: { ...defaultStatic(type), ...(opts.static || {}) },
    tracks: {},
    visibleRanges: opts.visibleRanges || null,
  };
}

function defaultStatic(type) {
  // flipX/flipY sont des propriétés statiques (booleans) — appliquées au rendu
  // via ctx.scale(-1, 1) / ctx.scale(1, -1) autour du centre du bbox. La
  // rotation, en revanche, est animable et vit dans tracks.rotation (en degrés).
  switch (type) {
    case 'text':    return { text: '', font: '"JetBrains Mono", monospace', flipX: false, flipY: false };
    case 'image':   return { imgId: null, flipX: false, flipY: false };
    case 'drawing': return { points: [], flipX: false, flipY: false };
    case 'shape':   return { shape: 'rect', flipX: false, flipY: false };
    // pacman : color = couleur du corps. x/y (centre), size (rayon) et rotation
    // sont animés via tracks — les keyframes x[0]/x[dernier] définissent le
    // début et la fin du déplacement.
    case 'pacman':  return { color: '#ffe14d', flipX: false, flipY: false };
    case 'group':   return {};
  }
  return {};
}

// --- Manipulation de keyframes ---
export function setKeyframe(obj, prop, f, v, easing = 'linear') {
  if (!obj.tracks[prop]) obj.tracks[prop] = [];
  const track = obj.tracks[prop];
  const idx = track.findIndex(k => k.f === f);
  const kf = { f, v, easing };
  if (idx !== -1) track[idx] = kf;
  else {
    track.push(kf);
    track.sort((a, b) => a.f - b.f);
  }
}

// Restreint la visibilité d'un objet à [f, +∞) — utilisé quand on crée un objet
// sur une frame > 0 pour qu'il ne s'affiche pas avant. La borne supérieure
// `null` signifie "pas de borne max" (cf. isVisibleAt).
export function setVisibleFrom(obj, f) {
  if (!obj) return;
  if (f > 0) obj.visibleRanges = [[f, null]];
  else obj.visibleRanges = null;
}

export function removeKeyframe(obj, prop, f) {
  const track = obj.tracks[prop];
  if (!track) return;
  const idx = track.findIndex(k => k.f === f);
  if (idx !== -1) track.splice(idx, 1);
  if (track.length === 0) delete obj.tracks[prop];
}

// --- Évaluation d'une track à une frame f ---
export function getValueAt(track, f, fallback) {
  if (!track || track.length === 0) return fallback;
  if (track.length === 1) return track[0].v;
  if (f <= track[0].f) return track[0].v;
  if (f >= track[track.length - 1].f) return track[track.length - 1].v;
  // Recherche du segment encadrant f. Vu le faible nb de keyframes par track
  // (typiquement < 10), une recherche linéaire est largement suffisante.
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (f >= a.f && f <= b.f) {
      const tt = (f - a.f) / (b.f - a.f);
      const eased = applyEasing(tt, b.easing || a.easing || 'linear');
      return interpolate(a.v, b.v, eased);
    }
  }
  return fallback;
}

function interpolate(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * t;
  }
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('#') && b.startsWith('#')) {
    return interpolateHex(a, b, t);
  }
  return t < 1 ? a : b;
}

function interpolateHex(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

export function isVisibleAt(obj, f) {
  if (!obj.visible) return false;
  if (!obj.visibleRanges) return true;
  // s ou e à null/undefined = pas de borne. Permet de stocker [f, null] pour
  // "visible à partir de f" sans dépendre de project.frameCount (Infinity ne
  // survit pas à JSON.stringify, on utilise null comme sentinelle).
  return obj.visibleRanges.some(([s, e]) => {
    const start = s == null ? -Infinity : s;
    const end   = e == null ?  Infinity : e;
    return f >= start && f <= end;
  });
}

// --- Materialize : object + frame f → item plat à rasteriser ---
// Retourne un item au format "ancien" (compatible avec drawItem) mais enrichi
// d'un sourceId pointant vers l'objet d'origine (pour la sélection).
function materialize(obj, f) {
  const out = {
    id: obj.id,
    sourceId: obj.id,
    type: obj.type,
    opacity: getValueAt(obj.tracks.opacity, f, 1),
    rotation: getValueAt(obj.tracks.rotation, f, 0),
    flipX: !!obj.static.flipX,
    flipY: !!obj.static.flipY,
  };
  if (obj.type === 'text') {
    out.text = obj.static.text;
    out.font = obj.static.font;
    out.x = getValueAt(obj.tracks.x, f, 0);
    out.y = getValueAt(obj.tracks.y, f, 0);
    out.size = getValueAt(obj.tracks.size, f, 16);
    out.color = getValueAt(obj.tracks.color, f, '#ffffff');
  } else if (obj.type === 'image') {
    out.imgId = obj.static.imgId;
    out.x = getValueAt(obj.tracks.x, f, 0);
    out.y = getValueAt(obj.tracks.y, f, 0);
    out.scale = getValueAt(obj.tracks.scale, f, 1);
  } else if (obj.type === 'drawing') {
    out.points = obj.static.points;
    out.x = getValueAt(obj.tracks.x, f, 0);
    out.y = getValueAt(obj.tracks.y, f, 0);
    out.color = getValueAt(obj.tracks.color, f, '#ffffff');
  } else if (obj.type === 'shape') {
    out.shape = obj.static.shape;
    out.x1 = getValueAt(obj.tracks.x1, f, 0);
    out.y1 = getValueAt(obj.tracks.y1, f, 0);
    out.x2 = getValueAt(obj.tracks.x2, f, 0);
    out.y2 = getValueAt(obj.tracks.y2, f, 0);
    out.color = getValueAt(obj.tracks.color, f, '#ffffff');
  } else if (obj.type === 'pacman') {
    // x/y = centre du Pacman. On enrichit l'item avec tout ce dont le rendu a
    // besoin pour être DÉTERMINISTE par frame (trace mangée, miettes, bouche,
    // œil) : frame courante + bornes d'animation + trace échantillonnée.
    out.x = getValueAt(obj.tracks.x, f, 0);
    out.y = getValueAt(obj.tracks.y, f, 0);
    out.size = getValueAt(obj.tracks.size, f, 6);
    out.color = obj.static.color || '#ffe14d';
    out.f = f;
    const xt = obj.tracks.x || [];
    const animStartF = xt.length ? xt[0].f : 0;
    const animEndF = xt.length ? xt[xt.length - 1].f : 0;
    out.animStartF = animStartF;
    out.animEndF = animEndF;
    // Trace = une position par frame entière de animStartF à min(f, animEndF).
    // C'est la zone que le Pacman a « mangée ».
    const trail = [];
    const lastF = Math.min(f, animEndF);
    for (let ff = animStartF; ff <= lastF; ff++) {
      trail.push({
        x: getValueAt(obj.tracks.x, ff, 0),
        y: getValueAt(obj.tracks.y, ff, 0),
        f: ff,
      });
    }
    out.trail = trail;
  }
  return out;
}

// Évalue toute la scène à la frame f. Retourne un tableau d'items plats,
// dans l'ordre de project.objects[] (= z-order ascendant). Les groupes
// (type 'group', parentId sur enfants) appliquent leurs transforms (x, y,
// opacity) en cascade sur leurs descendants.
export function evaluateScene(project, f) {
  const byId = new Map();
  for (const o of project.objects) byId.set(o.id, o);

  // Précalcule la chaîne de transform pour chaque objet (cumul via parents).
  // Cache local pour ne pas refaire le travail si plusieurs objets partagent
  // la même chaîne.
  const xformCache = new Map(); // id -> { tx, ty, opacity, visible }
  function getXform(obj) {
    if (xformCache.has(obj.id)) return xformCache.get(obj.id);
    const own = {
      tx: getValueAt(obj.tracks.x, f, 0),
      ty: getValueAt(obj.tracks.y, f, 0),
      opacity: getValueAt(obj.tracks.opacity, f, 1),
      visible: isVisibleAt(obj, f),
    };
    let acc = { ...own };
    if (obj.parentId) {
      const parent = byId.get(obj.parentId);
      if (parent) {
        const p = getXform(parent);
        acc.tx += p.tx;
        acc.ty += p.ty;
        acc.opacity *= p.opacity;
        acc.visible = acc.visible && p.visible;
      }
    }
    xformCache.set(obj.id, acc);
    return acc;
  }

  const out = [];
  for (const obj of project.objects) {
    if (obj.type === 'group') continue;
    const x = getXform(obj);
    if (!x.visible) continue;
    const item = materialize(obj, f);
    // Applique le transform parent : offset x/y, multiplie opacity.
    // L'objet a déjà incorporé son propre x/y via materialize; on ajoute
    // seulement la contribution des ancêtres.
    let parentTx = 0, parentTy = 0, parentOp = 1;
    if (obj.parentId) {
      const parent = byId.get(obj.parentId);
      if (parent) {
        const p = getXform(parent);
        parentTx = p.tx; parentTy = p.ty; parentOp = p.opacity;
      }
    }
    if (parentTx || parentTy) {
      if (item.x !== undefined) item.x += parentTx;
      if (item.y !== undefined) item.y += parentTy;
      if (item.x1 !== undefined) { item.x1 += parentTx; item.x2 += parentTx; }
      if (item.y1 !== undefined) { item.y1 += parentTy; item.y2 += parentTy; }
      if (item.trail) item.trail.forEach(p => { p.x += parentTx; p.y += parentTy; });
    }
    if (parentOp !== 1) item.opacity = (item.opacity ?? 1) * parentOp;
    out.push(item);
  }
  return out;
}

// --- Helpers pour les tools : crée un objet avec keyframes initiaux à f=0 ---
export function makeTextObject({ text, font, x, y, size, color, f = 0 }) {
  const name = text ? `"${text.slice(0, 16)}"` : 'Texte';
  const obj = createObject('text', { name, static: { text, font } });
  setKeyframe(obj, 'x', f, x);
  setKeyframe(obj, 'y', f, y);
  setKeyframe(obj, 'size', f, size);
  setKeyframe(obj, 'color', f, color);
  return obj;
}

export function makeImageObject({ imgId, x, y, scale, f = 0 }) {
  const obj = createObject('image', { name: 'Image', static: { imgId } });
  setKeyframe(obj, 'x', f, x);
  setKeyframe(obj, 'y', f, y);
  setKeyframe(obj, 'scale', f, scale);
  return obj;
}

export function makeDrawingObject({ points, color, f = 0 }) {
  const obj = createObject('drawing', { name: 'Tracé', static: { points: points || [] } });
  setKeyframe(obj, 'x', f, 0);
  setKeyframe(obj, 'y', f, 0);
  setKeyframe(obj, 'color', f, color);
  return obj;
}

const SHAPE_NAMES = {
  line: 'Ligne',
  rect: 'Rectangle',
  'rect-outline': 'Cadre',
  ellipse: 'Ellipse',
};
export function makeShapeObject({ shape, x1, y1, x2, y2, color, f = 0 }) {
  const obj = createObject('shape', { name: SHAPE_NAMES[shape] || 'Forme', static: { shape } });
  setKeyframe(obj, 'x1', f, x1);
  setKeyframe(obj, 'y1', f, y1);
  setKeyframe(obj, 'x2', f, x2);
  setKeyframe(obj, 'y2', f, y2);
  setKeyframe(obj, 'color', f, color);
  return obj;
}

// Crée un Pacman avec son trajet : (x1,y1) à la frame fStart, (x2,y2) à fEnd.
// Ces 2 keyframes x/y définissent le début et la fin du déplacement et restent
// éditables dans la timeline globale.
export function makePacmanObject({ x1, y1, x2, y2, fStart = 0, fEnd = 0, size = 6, color = '#ffe14d' }) {
  const obj = createObject('pacman', { name: 'Pacman', static: { color } });
  setKeyframe(obj, 'x', fStart, x1);
  setKeyframe(obj, 'x', fEnd, x2);
  setKeyframe(obj, 'y', fStart, y1);
  setKeyframe(obj, 'y', fEnd, y2);
  setKeyframe(obj, 'size', fStart, size);
  return obj;
}

// --- Mise à jour d'une propriété à la frame courante ---
// Comportement : toute modification à f > 0 crée/maj un keyframe à f, ce qui
// transforme automatiquement la modification en animation. À f === 0 (ou
// track vide), on met simplement à jour la valeur de référence.
// `getValueAt` clampe avant le premier kf et après le dernier, donc pas
// besoin d'ajouter un kf de "padding" à 0 pour préserver la valeur d'avant.
export function setPropertyAtFrame(obj, prop, f, v, easing = 'linear') {
  const track = obj.tracks[prop];
  if (!track || track.length === 0 || f === 0) {
    setKeyframe(obj, prop, 0, v, easing);
    return;
  }
  setKeyframe(obj, prop, f, v, easing);
}
