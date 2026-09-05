import { BEGINNER_DEFAULTS, BEGINNER_TEMPLATES, managedBeginnerObjects, templateNeedsSecondText, beginnerTemplateReady } from './beginner-scene.js';

export function initBeginnerEditor(api) {
  const shell = document.querySelector('.app-shell');
  const stage = document.querySelector('.stage');
  const stageHome = document.createComment('Studio preview');
  stage.before(stageHome);
  const exportPane = document.querySelector('[data-pane="export"]');
  const exportHome = document.createComment('Studio export');
  exportPane.before(exportHome);
  const modeSwitch = document.createElement('div');
  modeSwitch.className = 'mode-switch';
  modeSwitch.setAttribute('role', 'group');
  modeSwitch.setAttribute('aria-label', 'Mode de configuration');
  modeSwitch.innerHTML = '<button type="button" data-mode="beginner" aria-pressed="true">Débutant</button><button type="button" data-mode="advanced" aria-pressed="false">Studio complet</button>';
  document.querySelector('.topbar').append(modeSwitch);

  const flow = document.createElement('main');
  flow.className = 'beginner-flow';
  flow.innerHTML = `
    <nav class="guided-steps" aria-label="Étapes de configuration">
      <button data-step="0" aria-current="step"><span>1</span> Message</button>
      <button data-step="1"><span>2</span> Apparence</button>
      <button data-step="2"><span>3</span> Envoi</button>
    </nav>
    <section class="guided-preview" aria-label="Aperçu du panneau">
      <div class="preview-label"><strong>Votre panneau</strong><span>192 × 32 LED</span></div>
      <div class="guided-stage-slot"></div>
      <div class="preview-caption"><span id="guided-preview-caption">Votre message apparaîtra ici.</span><button class="btn guided-play" type="button">Lire l’animation</button></div>
    </section>
    <section class="guided-editor" aria-label="Configurer le panneau">
      <div class="guided-page" data-page="0">
        <p class="guided-step-caption">Étape 1 sur 3</p>
        <h2 tabindex="-1">Qu’allez-vous afficher ?</h2>
        <p class="guided-description">Choisissez un modèle, puis personnalisez ses textes.</p>
        <fieldset class="guided-template-picker"><legend>Votre modèle</legend><div class="guided-templates">
          ${BEGINNER_TEMPLATES.map(t => `<button type="button" data-template="${t.id}" aria-pressed="${t.id === 'single'}"><strong>${t.label}</strong><span>${t.description}</span></button>`).join('')}
        </div></fieldset>
        <p class="guided-notice" id="guided-existing" hidden>Cette scène contient déjà des éléments. Votre modèle sera ajouté à la scène. Vous pouvez tout modifier dans le studio complet.</p>
        <label class="guided-field" for="guided-text"><span id="guided-text-label">Votre message</span> <span id="guided-count">0 / 120</span></label>
        <textarea id="guided-text" rows="2" maxlength="120" placeholder="Ex. : Bienvenue à bord !" aria-describedby="guided-text-help" spellcheck="true"></textarea>
        <p id="guided-text-help" class="guided-help">Une seule ligne, comme sur le panneau. La taille s’adapte automatiquement.</p>
        <div id="guided-second-text" hidden>
          <label class="guided-field" for="guided-text2">Deuxième texte <span id="guided-count2">0 / 120</span></label>
          <textarea id="guided-text2" rows="2" maxlength="120" placeholder="Ex. : C’est la fête !" spellcheck="true" aria-describedby="guided-second-help"></textarea>
          <p class="guided-help" id="guided-second-help">Affiché sur la ligne du bas.</p>
        </div>
        <label class="guided-duration" id="guided-pacman-target" hidden>Quel texte Pacman mange-t-il ?<select id="guided-eatenText"><option value="second">Le deuxième texte (en bas)</option><option value="first">Le premier texte (en haut)</option></select></label>
        <div class="guided-examples" aria-label="Exemples de messages"><button type="button" data-message="Bienvenue à bord !">Bienvenue à bord !</button><button type="button" data-message="C’est la fête !">C’est la fête !</button><button type="button" data-message="GlouGlouBus">GlouGlouBus</button></div>
        <button type="button" class="guided-link" id="guided-open-project">Ouvrir un projet enregistré</button>
      </div>
      <div class="guided-page" data-page="1" hidden>
        <p class="guided-step-caption">Étape 2 sur 3</p>
        <h2 tabindex="-1">Donnez-lui du style.</h2>
        <p class="guided-description">Choisissez une couleur et un mouvement. L’aperçu suit vos réglages.</p>
        <fieldset><legend id="guided-color-label">Couleur du message</legend><div class="guided-colors">
          <button data-color="#f3c94f" style="--swatch:#f3c94f" aria-label="Jaune" aria-pressed="true"></button>
          <button data-color="#ffffff" style="--swatch:#ffffff" aria-label="Blanc" aria-pressed="false"></button>
          <button data-color="#ff4646" style="--swatch:#ff4646" aria-label="Rouge" aria-pressed="false"></button>
          <button data-color="#54e5a0" style="--swatch:#54e5a0" aria-label="Vert" aria-pressed="false"></button>
          <button data-color="#55bcff" style="--swatch:#55bcff" aria-label="Bleu" aria-pressed="false"></button>
          <label class="guided-custom-color" title="Couleur personnalisée"><input type="color" id="guided-color" value="#f3c94f" aria-label="Couleur personnalisée"></label>
        </div></fieldset>
        <label class="guided-second-color" id="guided-second-color" hidden>Couleur du deuxième texte<input type="color" id="guided-color2" value="#ffffff" aria-label="Couleur du deuxième texte" /></label>
        <div class="guided-settings-row"><label>Écriture<select id="guided-font"><option value="Arial, sans-serif">Classique</option><option value='"Courier New", monospace'>Monospace</option><option value="Georgia, serif">Élégante</option></select></label><label>Taille maximale<select id="guided-size"><option value="16">Petite</option><option value="24" selected>Moyenne</option><option value="28">Grande</option></select></label></div>
        <fieldset id="guided-effect-picker"><legend>Animation</legend><div class="guided-effects">
          <button data-effect="still" aria-pressed="true"><strong>Fixe</strong><span>Simple et lisible</span></button>
          <button data-effect="scroll" aria-pressed="false"><strong>Défilement</strong><span>De droite à gauche</span></button>
          <button data-effect="pulse" aria-pressed="false"><strong>Respiration</strong><span>S’allume en douceur</span></button>
        </div></fieldset>
        <p class="guided-notice" id="guided-template-motion" hidden></p>
        <label class="guided-duration" id="guided-cycle" hidden>Durée d’un cycle<select id="guided-seconds"><option value="3">3 secondes · rapide</option><option value="5" selected>5 secondes · normal</option><option value="8">8 secondes · lent</option></select></label>
        <p class="guided-help" id="guided-fit" role="status"></p>
      </div>
      <div class="guided-page" data-page="2" hidden>
        <p class="guided-step-caption">Étape 3 sur 3</p>
        <h2 tabindex="-1">À vous le panneau !</h2>
        <p class="guided-description">Relisez votre message, puis choisissez comment le transférer.</p>
        <p id="guided-summary" class="guided-summary"></p>
        <p class="guided-notice" id="guided-bluetooth-help">Allumez le panneau à proximité, connectez-le, puis lancez l’envoi.</p>
        <div class="guided-export-slot"></div>
        <button type="button" class="btn" id="guided-save">Enregistrer le projet modifiable</button>
        <p class="guided-help">Le fichier .bin est destiné au panneau. Le projet permet de reprendre vos réglages plus tard.</p>
      </div>
      <p class="guided-feedback" role="status" aria-live="polite"></p>
      <footer class="guided-actions"><button type="button" class="btn" id="guided-back">Retour</button><button type="button" class="btn primary" id="guided-next">Choisir l’apparence</button></footer>
    </section>`;
  shell.append(flow);
  const $ = selector => flow.querySelector(selector);
  let step = 0;
  let mode = 'beginner';
  let options = { ...BEGINNER_DEFAULTS };
  let editing = false;
  let previousKey = '';

  function changeStep(next, focus = true) {
    if (next > 0 && !beginnerTemplateReady(options)) {
      $('.guided-feedback').textContent = 'Complétez les textes du modèle pour continuer.';
      $(options.text.trim() ? '#guided-text2' : '#guided-text').focus();
      return;
    }
    step = next;
    api.stop();
    flow.querySelectorAll('[data-page]').forEach(p => { p.hidden = Number(p.dataset.page) !== step; });
    flow.querySelectorAll('[data-step]').forEach(b => {
      if (Number(b.dataset.step) === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    $('#guided-back').hidden = step === 0;
    $('#guided-next').hidden = step === 2;
    $('#guided-next').textContent = step === 0 ? 'Choisir l’apparence' : 'Passer à l’envoi';
    $('#guided-back').textContent = step === 2 ? 'Modifier l’apparence' : 'Retour';
    $('.guided-feedback').textContent = '';
    if (focus) $(`[data-page="${step}"] h2`).focus({ preventScroll: false });
  }

  function refresh() {
    const p = api.getProject();
    const owned = managedBeginnerObjects(p);
    const key = JSON.stringify([p.beginner, !!owned]);
    if (!editing && key !== previousKey) {
      options = { ...BEGINNER_DEFAULTS, ...(owned ? p.beginner.options : {}) };
      $('#guided-text').value = options.text;
      $('#guided-text2').value = options.text2;
      if (!beginnerTemplateReady(options) && step > 0) changeStep(0, false);
    }
    previousKey = key;
    $('#guided-existing').hidden = !p.objects.some(o => !owned?.includes(o));
    const second = templateNeedsSecondText(options);
    const ownAnimation = ['pacman', 'alternate'].includes(options.template);
    const twoLines = ['double', 'pacman'].includes(options.template);
    flow.querySelectorAll('[data-template]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.template === options.template)));
    $('#guided-second-text').hidden = !second;
    $('#guided-second-color').hidden = !second;
    $('#guided-text-label').textContent = second ? 'Premier texte' : 'Votre message';
    $('#guided-color-label').textContent = second ? 'Couleur du premier texte' : 'Couleur du message';
    $('#guided-second-help').textContent = options.template === 'alternate' ? 'Affiché après le premier message, puis la boucle recommence.' : 'Affiché sur la ligne du bas.';
    $('#guided-pacman-target').hidden = options.template !== 'pacman';
    $('#guided-eatenText').value = options.eatenText;
    $('#guided-color2').value = options.color2;
    $('#guided-count2').textContent = `${options.text2.length} / 120`;
    $('#guided-effect-picker').hidden = ownAnimation;
    $('#guided-template-motion').hidden = !ownAnimation;
    $('#guided-template-motion').textContent = options.template === 'pacman' ? 'Les deux textes sont d’abord visibles. Pacman traverse la ligne choisie et la mange, puis la boucle recommence. L’autre texte reste affiché.' : 'Chaque texte occupe tout le panneau pendant la moitié du cycle.';
    $('#guided-count').textContent = `${options.text.length} / 120`;
    $('#guided-color').value = options.color;
    $('#guided-font').value = options.font;
    $('#guided-size').value = options.size;
    $('#guided-seconds').value = options.seconds;
    flow.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === options.color)));
    flow.querySelectorAll('[data-effect]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.effect === options.effect)));
    $('#guided-cycle').hidden = !ownAnimation && options.effect === 'still';
    $('#guided-next').disabled = !beginnerTemplateReady(options);
    $('.guided-play').hidden = p.frameCount <= 1;
    document.querySelectorAll('.play-btn').forEach(b => { b.disabled = p.frameCount <= 1; });
    $('#guided-preview-caption').textContent = p.objects.length ? (api.isPlaying() ? 'Lecture en boucle' : 'Aperçu fidèle au panneau') : 'Votre message apparaîtra ici.';
    $('.guided-play').textContent = api.isPlaying() ? 'Mettre en pause' : 'Lire l’animation';
    $('.guided-play').setAttribute('aria-pressed', String(api.isPlaying()));
    const templateLabel = BEGINNER_TEMPLATES.find(t => t.id === options.template)?.label;
    const messages = [options.text.trim(), ...(second ? [options.text2.trim()] : [])];
    const motion = ownAnimation || options.effect !== 'still';
    $('#guided-summary').textContent = `${templateLabel} · ${messages.map(t => `« ${t} »`).join(' / ')}${motion ? ` · ${options.seconds} s par cycle` : ''}${options.template === 'pacman' ? ` · Pacman mange le ${options.eatenText === 'first' ? 'premier' : 'deuxième'} texte` : ''}`;
    const sizes = p.beginner?.fittedSizes || [p.beginner?.fittedSize ?? options.size];
    const fit = sizes.length ? Math.min(...sizes) : options.size;
    $('#guided-text-help').textContent = owned && fit < 7 ? 'Texte long : raccourcissez-le pour une meilleure lisibilité sur le panneau.' : (twoLines ? 'Affiché sur la ligne du haut. La taille s’adapte aux deux lignes.' : 'Une seule ligne, comme sur le panneau. La taille s’adapte automatiquement.');
    $('#guided-fit').textContent = twoLines ? 'Chaque texte est centré sur sa ligne, avec une hauteur adaptée au panneau.' : (owned && fit < options.size ? `Taille ajustée à ${fit} pixels pour afficher tout le message.` : 'Les messages sont centrés automatiquement.');

  }

  function apply(checkpoint = true) {
    editing = true;
    api.apply(options, checkpoint);
    editing = false;
    refresh();
    $('.guided-feedback').textContent = '';
  }
  function setMode(next) {
    api.stop();
    mode = next;
    document.body.dataset.mode = mode;
    document.documentElement.dataset.mode = mode;
    flow.hidden = mode !== 'beginner';
    modeSwitch.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    if (mode === 'beginner') {
      $('.guided-stage-slot').append(stage);
      $('.guided-export-slot').append(exportPane);
      exportPane.hidden = false;
      api.resetView();
    } else {
      stageHome.after(stage);
      exportHome.after(exportPane);
      exportPane.hidden = !document.querySelector('[data-tab="export"]').classList.contains('active');
    }
    try { localStorage.setItem('glougloubus-editor-mode', mode); } catch {}
    refresh();
  }
  modeSwitch.addEventListener('click', e => { if (e.target.dataset.mode) setMode(e.target.dataset.mode); });
  flow.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => changeStep(Number(b.dataset.step))));
  $('#guided-next').addEventListener('click', () => changeStep(step + 1));
  $('#guided-back').addEventListener('click', () => changeStep(step - 1));
  for (const name of ['text', 'text2']) {
    let checkpoint = false;
    $(`#guided-${name}`).addEventListener('focus', () => { checkpoint = false; });
    $(`#guided-${name}`).addEventListener('input', e => {
      options[name] = e.target.value.replace(/[\r\n]+/g, ' ');
      e.target.value = options[name];
      apply(!checkpoint);
      checkpoint = true;
    });
  }
  flow.querySelectorAll('[data-template]').forEach(b => b.addEventListener('click', () => {
    const template = BEGINNER_TEMPLATES.find(t => t.id === b.dataset.template);
    options.template = template.id;
    if (!options.text.trim()) options.text = template.example[0];
    if (template.id !== 'single' && !options.text2.trim()) {
      options.text2 = template.example[1] === options.text.trim() ? template.example[0] : template.example[1];
    }
    $('#guided-text').value = options.text;
    $('#guided-text2').value = options.text2;
    apply();
  }));
  flow.querySelectorAll('[data-message]').forEach(b => b.addEventListener('click', () => { options.text = b.dataset.message; $('#guided-text').value = options.text; apply(); }));
  flow.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => { options.color = b.dataset.color; apply(); }));
  flow.querySelectorAll('[data-effect]').forEach(b => b.addEventListener('click', () => { options.effect = b.dataset.effect; apply(); }));
  for (const name of ['color', 'color2', 'font', 'size', 'seconds', 'eatenText']) {
    $(`#guided-${name}`).addEventListener('change', e => { options[name] = ['size', 'seconds'].includes(name) ? Number(e.target.value) : e.target.value; apply(); });
  }
  $('.guided-play').addEventListener('click', () => { api.togglePlay(); refresh(); });
  $('#guided-save').addEventListener('click', () => {
    api.save();
    $('.guided-feedback').textContent = 'Téléchargement du projet lancé. Conservez ce fichier pour reprendre vos réglages.';
  });
  $('#guided-open-project').addEventListener('click', api.load);
  if (!navigator.bluetooth || !window.isSecureContext) {
    $('#guided-bluetooth-help').textContent = 'Le Bluetooth n’est pas disponible dans ce navigateur. Téléchargez le fichier du panneau, ou ouvrez cette page en HTTPS dans un navigateur compatible sur Android.';
    document.getElementById('btn-connect-ble').disabled = true;
    document.getElementById('btn-connect-ble').title = 'Bluetooth indisponible dans ce navigateur';
  }
  let savedMode;
  try { savedMode = localStorage.getItem('glougloubus-editor-mode'); } catch {}
  changeStep(0, false);
  setMode(savedMode === 'advanced' ? 'advanced' : 'beginner');
  return { refresh };
}
