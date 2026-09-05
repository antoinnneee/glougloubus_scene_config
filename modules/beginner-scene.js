import { makeTextObject, makePacmanObject, setKeyframe } from './scene.js';

export const BEGINNER_DEFAULTS = { template: 'single', text: '', text2: '', color: '#f3c94f', color2: '#ffffff', font: 'Arial, sans-serif', size: 24, effect: 'still', seconds: 5, eatenText: 'second' };

export const BEGINNER_TEMPLATES = [
  { id: 'single', label: 'Un texte', description: 'Un message en grand', example: ['Bienvenue à bord !', ''] },
  { id: 'double', label: 'Deux textes', description: 'Deux lignes à la fois', example: ['GlouGlouBus', 'Bienvenue à bord !'] },
  { id: 'pacman', label: 'Pacman gourmand', description: 'Il mange le texte de votre choix', example: ['GlouGlouBus', 'À croquer !'] },
  { id: 'alternate', label: 'En alternance', description: 'Deux messages, chacun son tour', example: ['Bienvenue à bord !', 'C’est la fête !'] },
];

export function templateNeedsSecondText(options) { return options.template !== 'single'; }
export function beginnerTemplateReady(options) {
  return !!options.text.trim() && (!templateNeedsSecondText(options) || !!options.text2.trim());
}

// The guided editor produces ordinary scene objects, usable by the full studio.
export function buildBeginnerMessage(options, measureText, fps = 20) {
  const o = { ...BEGINNER_DEFAULTS, ...options };
  const text = o.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
  let size = Number(o.size);
  let width = measureText(text, size, o.font);
  if (o.effect !== 'scroll') {
    while (width > 184 && size > 1) width = measureText(text, --size, o.font);
  }
  const x = Math.round((192 - width) / 2);
  const obj = makeTextObject({ text, font: o.font, x, y: 16, size, color: o.color });
  const frameCount = o.effect === 'still' ? 1 : Math.max(2, Math.round(o.seconds * fps));
  if (o.effect === 'scroll') {
    // Start with a readable message. Wrap only while the text is off the panel.
    const half = Math.floor(frameCount / 2);
    setKeyframe(obj, 'x', half - 1, -Math.ceil(width) - 1);
    setKeyframe(obj, 'x', half, 193);
    setKeyframe(obj, 'x', frameCount - 1, x);
  } else if (o.effect === 'pulse') {
    setKeyframe(obj, 'opacity', 0, 1);
    setKeyframe(obj, 'opacity', Math.floor(frameCount / 2), 0.15, 'ease-in-out');
    setKeyframe(obj, 'opacity', frameCount - 1, 1, 'ease-in-out');
  }
  return { object: obj, frameCount, fittedSize: size, width };
}

export function managedBeginnerObjects(project) {
  const meta = project.beginner;
  if (!meta) return null;
  if (!meta.objectIds) {
    const obj = project.objects.find(o => o.id === meta.objectId);
    return obj && JSON.stringify(obj) === meta.signature ? [obj] : null;
  }
  const objects = project.objects.filter(o => meta.objectIds.includes(o.id));
  // Treat the whole template as one edit: a changed/deleted/reordered part
  // means the composition now belongs to Studio and must be preserved.
  return objects.length === meta.objectIds.length && JSON.stringify(objects) === meta.signature ? objects : null;
}

export function managedBeginnerObject(project) { return managedBeginnerObjects(project)?.[0] || null; }

export function buildBeginnerTemplate(options, measureText, fps = 20) {
  const o = { ...BEGINNER_DEFAULTS, ...options };
  const twoLines = ['double', 'pacman'].includes(o.template);
  const ownAnimation = ['pacman', 'alternate'].includes(o.template);
  const frameCount = ownAnimation ? Math.max(6, Math.round(o.seconds * fps)) : null;
  const result = [];
  const roles = [];
  const fittedSizes = [];
  for (let i = 0; i < (o.template === 'single' ? 1 : 2); i++) {
    const text = i ? o.text2 : o.text;
    if (!text.trim()) continue;
    const message = buildBeginnerMessage({ ...o, text, color: i ? o.color2 : o.color,
      size: twoLines ? Math.min(14, o.size / 2) : o.size,
      effect: ownAnimation ? 'still' : o.effect,
    }, measureText, fps);
    setKeyframe(message.object, 'y', 0, twoLines ? (i ? 24 : 8) : 16);
    if (o.template === 'alternate') {
      const half = Math.floor(frameCount / 2);
      message.object.visibleRanges = i ? [[half, frameCount - 1]] : [[0, half - 1]];
    }
    result.push(message.object);
    roles.push(i ? 'second' : 'first');
    fittedSizes.push(message.fittedSize);
  }
  if (o.template === 'pacman' && result.length === 2) {
    const target = o.eatenText === 'first' ? 0 : 1;
    const pacman = makePacmanObject({ x1: -8, x2: 200, y1: target ? 24 : 8, y2: target ? 24 : 8,
      fStart: Math.round(frameCount * 0.2), fEnd: Math.round(frameCount * 0.8), size: 7 });
    // Draw the survivor last: Pacman's eraser and crumbs cannot damage it.
    return { objects: [result[target], pacman, result[1 - target]],
      roles: [roles[target], 'pacman', roles[1 - target]], fittedSizes, frameCount };
  }
  return { objects: result, roles, fittedSizes,
    frameCount: result.length ? (frameCount ?? (o.effect === 'still' ? 1 : Math.max(2, Math.round(o.seconds * fps)))) : 1 };
}

export function applyBeginnerTemplate(project, options, measureText) {
  const existing = managedBeginnerObjects(project) || [];
  const existingIds = new Set(existing.map(o => o.id));
  const firstIndex = project.objects.findIndex(o => existingIds.has(o.id));
  const others = project.objects.filter(o => !existingIds.has(o.id));
  const result = buildBeginnerTemplate(options, measureText, project.fps);
  const oldRoles = project.beginner?.roles || ['first'];
  result.objects.forEach((obj, i) => {
    const old = existing[oldRoles.indexOf(result.roles[i])];
    if (old) obj.id = old.id;
  });
  others.splice(firstIndex < 0 ? others.length : firstIndex, 0, ...result.objects);
  project.objects = others;
  project.frameCount = others.length === result.objects.length ? result.frameCount : Math.max(project.frameCount, result.frameCount);
  project.beginner = { objectIds: result.objects.map(o => o.id), roles: result.roles,
    options: { ...BEGINNER_DEFAULTS, ...options }, fittedSizes: result.fittedSizes,
    signature: JSON.stringify(result.objects) };
  return result;
}
