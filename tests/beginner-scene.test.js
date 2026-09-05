import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEGINNER_DEFAULTS, buildBeginnerMessage, managedBeginnerObject, buildBeginnerTemplate, applyBeginnerTemplate, managedBeginnerObjects, beginnerTemplateReady } from '../modules/beginner-scene.js';
import { createEmptyProject, getValueAt, evaluateScene } from '../modules/scene.js';

const measure = (text, size) => text.length * size * 0.6;

test('a static message fits the panel and is centered', () => {
  const result = buildBeginnerMessage({ text: 'Bienvenue à bord !' }, measure);
  assert.ok(result.width <= 184);
  assert.equal(result.object.tracks.y[0].v, 16);
  assert.equal(result.object.tracks.x[0].v, Math.round((192 - result.width) / 2));
  assert.equal(result.frameCount, 1);
});

test('scrolling retains legible text size and wraps only offscreen', () => {
  const result = buildBeginnerMessage({ text: 'Un long message pour le panneau du GlouGlouBus', effect: 'scroll', seconds: 8 }, measure, 30);
  assert.equal(result.frameCount, 240);
  assert.equal(result.fittedSize, 24);
  const track = result.object.tracks.x;
  assert.ok(getValueAt(track, 119) + result.width < 0);
  assert.ok(getValueAt(track, 120) > 192);
  assert.equal(getValueAt(track, 0), getValueAt(track, 239));
});

test('breathing loops smoothly without making the message completely disappear', () => {
  const { object, frameCount } = buildBeginnerMessage({ text: 'Bonjour', effect: 'pulse', seconds: 5 }, measure);
  const track = object.tracks.opacity;
  assert.equal(getValueAt(track, 0), 1);
  assert.ok(Math.abs(getValueAt(track, 50) - 0.15) < 1e-9);
  assert.equal(getValueAt(track, frameCount - 1), 1);
});

test('multiline text becomes one line and input length is bounded', () => {
  const { object } = buildBeginnerMessage({ text: 'Bonjour\nà bord' }, measure);
  assert.equal(object.static.text, 'Bonjour à bord');
  assert.equal(buildBeginnerMessage({ text: 'x'.repeat(200) }, measure).object.static.text.length, 120);
});

test('guided metadata survives saving but advanced edits revoke preset ownership', () => {
  const p = createEmptyProject();
  const { object } = buildBeginnerMessage({ text: 'Bonjour' }, measure);
  p.objects.push(object);
  p.beginner = { objectId: object.id, signature: JSON.stringify(object) };
  const restored = JSON.parse(JSON.stringify(p));
  assert.equal(managedBeginnerObject(restored), restored.objects[0]);
  restored.objects[0].tracks.x.push({ f: 20, v: 100, easing: 'linear' });
  assert.equal(managedBeginnerObject(restored), null);
  assert.equal(managedBeginnerObject(p), object);
});

test('existing projects without guided metadata are never claimed', () => {
  const p = createEmptyProject();
  p.objects.push(buildBeginnerMessage({ text: 'Existant' }, measure).object);
  assert.equal(managedBeginnerObject(p), null);
});

test('a maximum-length static message stays inside the panel', () => {
  const result = buildBeginnerMessage({ text: 'W'.repeat(120) }, measure);
  assert.ok(result.width <= 184);
  assert.ok(result.object.tracks.x[0].v >= 0);
});

const twoTextOptions = { ...BEGINNER_DEFAULTS, template: 'double', text: 'GlouGlouBus', text2: 'Bienvenue !' };

test('two texts fit separate rows and have independent colors', () => {
  const r = buildBeginnerTemplate(twoTextOptions, measure);
  assert.equal(r.objects.length, 2);
  assert.deepEqual(r.objects.map(o => getValueAt(o.tracks.y, 0)), [8, 24]);
  assert.deepEqual(r.objects.map(o => getValueAt(o.tracks.color, 0)), ['#f3c94f', '#ffffff']);
  assert.ok(r.fittedSizes.every(s => s <= 14));
  assert.equal(r.frameCount, 1);
});

test('alternating messages never overlap or leave a blank frame', () => {
  const r = buildBeginnerTemplate({ ...twoTextOptions, template: 'alternate' }, measure);
  for (let f = 0; f < r.frameCount; f++) {
    const visible = evaluateScene({ objects: r.objects }, f);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].text, f < 50 ? 'GlouGlouBus' : 'Bienvenue !');
    assert.equal(visible[0].y, 16);
  }
});

for (const target of ['first', 'second']) {
  test(`Pacman eats the ${target} row and renders the survivor above its eraser`, () => {
    const r = buildBeginnerTemplate({ ...twoTextOptions, template: 'pacman', eatenText: target }, measure);
    assert.deepEqual(r.roles, [target, 'pacman', target === 'first' ? 'second' : 'first']);
    const start = evaluateScene({ objects: r.objects }, 0);
    const end = evaluateScene({ objects: r.objects }, r.frameCount - 1);
    assert.equal(start[1].trail.length, 0);
    assert.equal(start[1].x, -8);
    assert.equal(end[1].x, 200);
    assert.equal(end[1].y, target === 'first' ? 8 : 24);
    assert.ok(end[1].trail.length > 1);
    assert.ok(end[1].trail.every(p => p.y === end[0].y));
    assert.equal(end[2].text, target === 'first' ? 'Bienvenue !' : 'GlouGlouBus');
    assert.equal(end[2].opacity, 1);
    assert.equal(end[2].y, target === 'first' ? 24 : 8);
  });
}

test('switching templates replaces their objects and keeps unrelated work', () => {
  const p = createEmptyProject();
  const unrelated = buildBeginnerMessage({ text: 'Existant' }, measure).object;
  p.objects.push(unrelated);
  applyBeginnerTemplate(p, twoTextOptions, measure);
  const ids = [...p.beginner.objectIds];
  applyBeginnerTemplate(p, { ...twoTextOptions, template: 'pacman', eatenText: 'first' }, measure);
  assert.equal(p.objects.length, 4);
  assert.equal(p.objects[0], unrelated);
  assert.ok(ids.every(id => p.objects.some(o => o.id === id)));
  applyBeginnerTemplate(p, { ...twoTextOptions, template: 'single' }, measure);
  assert.equal(p.objects.length, 2);
  assert.equal(p.objects[1].id, ids[0]);
  assert.equal(p.objects[1].static.text, 'GlouGlouBus');
});

test('template settings and ownership survive save/load and history snapshots', () => {
  const p = createEmptyProject();
  applyBeginnerTemplate(p, { ...twoTextOptions, template: 'pacman', seconds: 8, eatenText: 'first' }, measure);
  const restored = JSON.parse(JSON.stringify(p));
  assert.equal(managedBeginnerObjects(restored).length, 3);
  assert.equal(restored.beginner.options.text2, 'Bienvenue !');
  assert.equal(restored.beginner.options.eatenText, 'first');
  assert.equal(restored.frameCount, 160);
});

test('an advanced edit to any template part preserves the whole composition', () => {
  const p = createEmptyProject();
  applyBeginnerTemplate(p, { ...twoTextOptions, template: 'pacman' }, measure);
  p.objects[1].tracks.x[1].v = 120;
  const advanced = JSON.stringify(p.objects);
  assert.equal(managedBeginnerObjects(p), null);
  applyBeginnerTemplate(p, { ...twoTextOptions, template: 'single' }, measure);
  assert.equal(p.objects.length, 4);
  assert.equal(JSON.stringify(p.objects.slice(0, 3)), advanced);
});

test('empty drafts retain their selected template, and both required texts are validated', () => {
  const p = createEmptyProject();
  const empty = { ...twoTextOptions, text: '', text2: '' };
  applyBeginnerTemplate(p, empty, measure);
  assert.deepEqual(managedBeginnerObjects(p), []);
  assert.equal(p.beginner.options.template, 'double');
  assert.equal(p.frameCount, 1);
  assert.equal(beginnerTemplateReady(empty), false);
  assert.equal(beginnerTemplateReady({ ...empty, text: 'Premier' }), false);
  assert.equal(beginnerTemplateReady(twoTextOptions), true);
});

test('projects from the original single-message editor upgrade without duplication', () => {
  const p = createEmptyProject();
  const obj = buildBeginnerMessage({ text: 'Ancien message' }, measure).object;
  p.objects.push(obj);
  p.beginner = { objectId: obj.id, options: { text: 'Ancien message' }, signature: JSON.stringify(obj) };
  applyBeginnerTemplate(p, { ...twoTextOptions, text: 'Ancien message' }, measure);
  assert.equal(p.objects.length, 2);
  assert.equal(p.objects[0].id, obj.id);
  assert.equal(managedBeginnerObjects(p).length, 2);
});
