#!/usr/bin/env node
// Hook UserPromptSubmit globale. Quando il prompt riguarda UI, front-end o design,
// inietta nel contesto il routing di skill e connettori scritto in ui-design-routing.md.
// "#design" nel prompt lo forza, "#nodesign" lo salta. Non blocca mai il prompt:
// qualsiasi errore termina con exit 0 senza output.
//
// Punteggio: un segnale forte vale 2, uno debole 1. Di norma servono 2 punti; ne basta 1
// se la cartella di lavoro è un progetto front-end o se nella stessa sessione c'è stato
// un prompt di design negli ultimi 30 minuti.
//
// Prova a mano:  node ui-design-router.js --test "rifai la hero con scritte più grandi"
//                node ui-design-router.js --test --cwd C:/progetto "sistema la home"
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROUTING_FILE = path.join(__dirname, 'ui-design-routing.md');
const STATE_DIR = path.join(os.tmpdir(), 'claude-ui-design-router');
const FULL_EVERY = 6; // blocco completo al primo prompt di design e poi ogni 6
const FULL_AFTER_MS = 30 * 60 * 1000; // ...o se l'ultimo blocco completo ha più di 30 minuti
const STICKY_MS = 30 * 60 * 1000; // finestra in cui basta un segnale debole
const STATE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// Le liste sono tarate sui set di prova della verifica del 2026-09-13: prima di aggiungere
// una parola controlla che non faccia scattare prompt di backend (colonna, tab, mouse, look...).
const STRONG = [
  /\bui\b/, /\bux\b/, /\bfront[\s-]?end\b/, /\bcss\b/, /\btailwind/, /\bshadcn\b/, /\baceternity\b/,
  /\bmagic\s?ui\b/, /\bradix\b/, /\bvengeance\s?ui\b/, /\bbeautiful\s?ui\b/, /\bui[\s-]?layouts\b/, /\boriginkit\b/,
  /\blayout\b/, /\blanding\b/, /\bhero\b/, /\bnav[\s-]?ba?r\b/, /\bpreloader\b/, /\bcta\b/,
  // motion
  /\banim(azion|at|are\b|a\b)/, /\bgsap\b/, /\bscroll\s?trigger\b/, /\bframer\b/, /\bmotion\b(?!\s+to\s)/, /\blenis\b/,
  /\bparall(ax|ass)/, /\btransizion/, /\b(view|page|route|css|smooth|fade|slide|scroll)[\s-]?transitions?\b/,
  /\bmicro[\s-]?(interazion|interaction)/, /\bfade/, /\bmake (it|this|them) pop\b/,
  // tipografia e colore
  /\bfont\b/, /\btipograf/, /\btypograph/, /\b(interlinea|line[\s-]?height|kerning|letter[\s-]?spacing)\b/,
  /\bpalette\b/, /\bgradient(?![\s-]?(?:descent|boost|clipping|checkpoint|accumulation))/,
  /(?<!\b(?:in|by)\s)\bcontrast\b/,
  // layout e componenti
  /(?<!\bnot\s)\bresponsive\b/, /\bmockup\b/, /\bwireframe\b/, /\bfigma\b/, /\brestyl/, /\bre-?design/,
  /\bestetic/, /\baesthetic/, /\b(dark|light)\s?mode\b/,
  /\bbottone\b/, /\bbottoni\b/, /\bpulsant[ei]\b/, /\bbuttons?\b/, /(?<!\bverb[oi]\s)\bmodal[ei]?\b/, /\bhover\b/,
  /\btooltip/, /\bdropdown/, /\bsidebar\b/, /\bcarosell/, /\bcarousel/, /\bslider\b/,
  /\b(accordion|marquee|popover|drawer|breadcrumbs?|toasts?|sonner)\b/, /\bskeleton[\s-]?(loader|loading|screen|state)s?\b/,
  /\bpadding\b(?![\s-]*(?:pkcs|oracle|scheme))/, /\bmargini\b/, /\bflexbox\b/, /\bspaziatur/, /\bspacing\b/,
  /(?<!\b(?:meta|facebook|fb|tiktok|linkedin|pinterest|tracking|conversion)\s)\bpixel\b/, /\b\d+\s?px\b/,
  /\bombr[ae]\b|\b(box|drop|text)[\s-]?shadow/, /\bborder[\s-]?radius\b|\brounded-(none|sm|md|lg|xl|2xl|3xl|full)\b/,
  /\bglassmorph/, /\bneumorph/, /\bbento\b/,
  // feedback estetico
  /\b(piu|meno)\s+(premium|elegant\w*|pulit\w*|minimal\w*|arios\w*|aria|lusso)\b/,
  /\b(more|less)\s+(elegant|polished|minimal|airy|luxurious)\b/,
  /\btroppo\s+(vuot\w*|attaccat\w*|strett\w*|bianc\w*|scur\w*|chiar\w*|sgranat\w*)\b/, /\bsgranat/,
  /\bvisiv[aoei]\b/, /(?<!\bsched[ae]\s)\bgrafic[aoh]/, /\blook\s(and|&)\sfeel\b/,
  /\b(goldengoal|lusion|codrops|tympanus|awwwards|dribbble|mobbin)\b/,
  // 3D
  /\bthree\.?js\b/, /\bwebgl\b/, /\bwebgpu\b/, /\bshader/, /\bglsl\b/, /\bspline(?:\.design|\s+3d)\b/, /\blottie\b/,
  /\bsvg\b/, /\b3d\b(?![\s-]?secure)/, /\bparticell/, /\b(pmrem|hdri|tone[\s-]?mapping)\b|\bbloom\b(?![\s-]?filter)/,
  // accessibilità
  /\baccessibilit/, /\ba11y\b/, /\bwcag\b/, /\balt[\s-](text|tag|attribut\w*)\b/,
  /\btabulazion|\btab[\s-]?index\b|\btab[\s-]?order\b/,
  // strumenti e skill
  /\bdesign[\s-]?system\b/, /\bdesign\.md\b/, /\bdesign\s?tokens?\b/, /\bimpeccable\b/, /\bslop\b/, /\btaste\b/,
  /\bjsx\b/, /\btsx\b/, /\bstorybook\b/, /\b(lucide|heroicons|phosphor|iconsax|tabler icons|font\s?awesome)\b/,
];

const WEAK = [
  /\breact\b/, /\bnext\.?js\b/, /\bvue\b/, /\bsvelte\b/, /\bastro\b/, /\bangular\b/, /\bhtml\b(?!\s*[:=])/,
  /\bpagin[ae]\b/, /\bpages?\b/, /\bhome\s?page\b/, /\bhome\b/, /\bsit[oi]\b/, /\bwebsite\b/, /\bsezion[ei]\b/, /\bsections?\b/,
  /\bcomponent/, /\bstil[ei]\b/, /\bstyl/, /\bcards?\b/, /\bform\b/, /\bheader\b/, /\bfooter\b/, /\bmenu\b/,
  /\blog(o|os|hi)\b/, /\bbrand/, /\bicon/, /\bimmagin/, /\bfoto\b/, /\bimages?\b/, /\bcolor[ei]\b/, /\bcolou?rs?\b/,
  /\bdashboard\b/, /\bmobile?\b/, /(?<![\\/])\bdesktop\b(?![\\/])/, /\btablet\b/, /\bscherm[oi]\b/, /\bscreens?\b/,
  /\bscreenshot/, /\bscroll/, /\bcursor/, /\bscritt[ae]\b/, /\btitol[oi]\b/, /\btesto\b/, /\ballinea/, /\bcentrat/,
  /\bgriglia\b/, /\bgrid\b/, /\bmargin\b/, /\btema\b/, /\btheme\b/, /\bviewport\b/, /\bbrowser\b/,
  /\bpricing\b/, /\bpremium\b/, /\belegan/, /\bmodern[oaie]?\b/, /\bminimal/, /\bpulit[oaie]\b/, /\bclean\b/,
  /\bbell[oaie]\b/, /\bbeautiful\b/, /\bpretty\b/, /\bpolish/, /\bbrutt[oaie]\b/, /\bugly\b/, /\bcarin[oaie]\b/,
  /\baccattivant/, /\bsbilanciat/, /\bcontrasto\b/, /\bspline\b/,
  /\btransitions?\b/, /\b(retina|iphone|ipad|android|safari)\b/, /\beffett[oi]\b/, /\bscorr(e|ono|ere|imento|evole)\b/,
  /\b(360|375|390|414|768|1024|1280|1440|1920)\b/, /\bfocus\b/, /\b(tastiera|keyboard)\b/, /\boverflow\b/,
  /\b(verde|rosso|blu|nero|bianco|grigio|giallo|arancione|viola|beige|crema)\b/, /\bsfond[oi]\b/, /\bbackground\b/,
  /\btemplate\b/, /\b(arrotondat|stondat)\w*/, /\bbord[oi]\b|\bborders?\b/, /\brespir/, /\bparagraf/,
  /\bpiu\s+(grand|piccol|larg|strett|spess|sottil|visibil|leggibil)/,
  /\b(segue|segua|seguire|follows?|following)\s+(il\s+|the\s+)?mouse\b|\bmouse\s?(move|over|enter|leave|follow)\w*/,
  /\b(feels?|looks?|sembra|sembrano)\s+(?:(?:a\s+bit|too|troppo|molto|less|more|un\s+po)\s+)?(cheap|heavy|weird|dated|generic|cluttered|busy|flat|bland|vuot\w*|vecchi\w*|datat\w*|pesant\w*|economic\w*|generic\w*)\b/,
  /\b(cls|lcp|inp)\b/, /\bgaller/, /\bparticles?\b/, /\btabs?\b/, /\bsched[ae]\b/, /\beditorial/, /\blook\b/,
];

// "design" conta solo se resta qualcosa dopo aver tolto il design di sistema, API, database o code.
const DESIGN_WORD = /\b(?:ri)?(?:design|disegn)/;
const BACKEND_NOUNS =
  '(?:system|software|api|endpoints?|database|db|schema|backend|back-end|architecture|architettura|protocol|' +
  'data model|tables?|tabelle|class|object|queues?|coda|code|workers?|jobs?|pipelines?|webhooks?|cache|sistema|' +
  'infrastruttura|infrastructure)';
const NON_UI_DESIGN = new RegExp(
  `\\b${BACKEND_NOUNS}\\s+design\\b` +
    `|\\bdesign\\s+(?:[a-z0-9]+['’]\\s*|[a-z0-9]+\\s+){0,2}${BACKEND_NOUNS}\\b` +
    '|\\bdesign\\s+(?:patterns?|docs?|document|decisions?)\\b',
  'g',
);
// Le cartelle di un percorso Windows non devono portare punti (Desktop, sito...); il nome del file sì.
const WINDOWS_DIRS = /(?<![a-z])[a-z]:[\\/](?:[^\s\\/]+[\\/])+/g;

const FRONTEND_FILES = [
  'components.json', 'DESIGN.md', 'index.html', 'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs',
  'tailwind.config.cjs', 'astro.config.mjs', 'svelte.config.js', 'nuxt.config.ts', 'vite.config.ts', 'vite.config.js',
];
const FRONTEND_DEPS =
  /^(react|react-dom|next|vue|nuxt|svelte|@sveltejs\/kit|astro|@angular\/core|solid-js|preact|gatsby|@remix-run\/react|tailwindcss|@tailwindcss\/postcss|@tailwindcss\/vite|gsap|three|@react-three\/fiber|framer-motion|motion|lenis|expo|react-native)$/;

function normalize(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function score(text) {
  const clean = text.replace(WINDOWS_DIRS, ' ');
  let points = 0;
  for (const re of STRONG) if (re.test(clean)) points += 2;
  for (const re of WEAK) if (re.test(clean)) points += 1;
  if (DESIGN_WORD.test(clean.replace(NON_UI_DESIGN, ' '))) points += 2;
  return points;
}

function classify(prompt, { lowThreshold = false } = {}) {
  const text = normalize(prompt);
  if (/#nodesign\b/.test(text)) return { hit: false, points: 0, threshold: null, reason: '#nodesign' };
  if (/#design\b/.test(text)) return { hit: true, points: 99, threshold: null, reason: '#design' };
  if (/^\s*<(task-notification|local-command|command-)/.test(prompt)) {
    return { hit: false, points: 0, threshold: null, reason: 'messaggio di sistema' };
  }
  const points = score(text);
  const threshold = lowThreshold ? 1 : 2;
  return { hit: points >= threshold, points, threshold, reason: 'punteggio' };
}

function isFrontendProject(dir) {
  if (!dir) return false;
  try {
    if (FRONTEND_FILES.some((name) => fs.existsSync(path.join(dir, name)))) return true;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return Object.keys(deps).some((name) => FRONTEND_DEPS.test(name));
  } catch {
    return false;
  }
}

function statePath(sessionId) {
  const safe = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return safe ? path.join(STATE_DIR, `${safe}.json`) : null;
}

// Uno stato illeggibile o di forma sbagliata vale come sessione nuova.
function readState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state && Number.isFinite(state.count) && Number.isFinite(state.lastFull)) {
      return { count: state.count, lastFull: state.lastFull, lastHit: Number.isFinite(state.lastHit) ? state.lastHit : 0 };
    }
  } catch {
    // file assente o corrotto
  }
  return null;
}

// Scrittura atomica: file temporaneo e rename, così chi legge in parallelo non trova mezzo JSON.
function writeState(file, state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function cleanOldState(now) {
  try {
    for (const name of fs.readdirSync(STATE_DIR)) {
      const file = path.join(STATE_DIR, name);
      if (now - fs.statSync(file).mtimeMs > STATE_MAX_AGE_MS) fs.unlinkSync(file);
    }
  } catch {
    // cartella assente o non leggibile: niente da pulire
  }
}

const SHORT_REMINDER =
  'Prompt di UI/front-end/design: vale il routing di skill e connettori in ' +
  `${ROUTING_FILE.replace(/\\/g, '/')} (già iniettato in questa sessione; rileggilo con Read se non è più nel contesto). ` +
  "Invoca le skill pertinenti PRIMA di scrivere codice e di' in una riga quali usi e perché.";

// Documenti che dicono come deve essere il progetto. Claude Code carica da solo CLAUDE.md,
// non questi: l'hook li elenca (senza leggerli) e Claude li apre con Read.
const DOC_ROOT_NAMES =
  /^(design|product|brand|brand-guidelines|style-?guide|design-system|visual-identity|tone-of-voice)\.md$|^(design-tokens|tokens|components)\.json$/i;
// La parola chiave deve aprire il nome o seguire un separatore: "brand-direction.md" sì, "production-readiness.md" no.
const DOC_HINT = /(?:^|[-_. ])(?:design|product|brand|style-?guide|styles?|visual|identity|tokens)(?=[-_. ]|$)/i;
const DOC_DIRS = ['docs', 'doc', 'design', '.impeccable'];
const DOC_SCAN_BUDGET = 400; // voci di cartella al massimo, per restare veloci anche su repo grandi
const DOC_MAX_LISTED = 10;

function findDesignDocs(dir) {
  const found = new Map();
  const add = (file, root) => {
    try {
      const st = fs.statSync(file);
      if (st.isFile()) found.set(file, { file, root, size: st.size, mtime: st.mtimeMs });
    } catch {
      // sparito tra readdir e stat
    }
  };
  try {
    for (const name of fs.readdirSync(dir)) if (DOC_ROOT_NAMES.test(name)) add(path.join(dir, name), true);
  } catch {
    return [];
  }
  let budget = DOC_SCAN_BUDGET;
  const walk = (sub, depth) => {
    if (depth > 4 || budget <= 0) return;
    let entries;
    try {
      entries = fs.readdirSync(sub, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (--budget <= 0) return;
      const full = path.join(sub, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full, depth + 1);
      } else if (/\.(md|json)$/i.test(entry.name) && DOC_HINT.test(entry.name)) {
        add(full, false);
      }
    }
  };
  for (const sub of DOC_DIRS) walk(path.join(dir, sub), 1);
  return [...found.values()]
    .sort((a, b) => Number(b.root) - Number(a.root) || b.mtime - a.mtime)
    .slice(0, DOC_MAX_LISTED);
}

function designDocsSection(dir, compact) {
  const docs = findDesignDocs(dir);
  const rel = (d) => path.relative(dir, d.file).replace(/\\/g, '/');
  if (compact) {
    return docs.length ? ` Documenti di design del progetto da rispettare: ${docs.map(rel).join(', ')}.` : '';
  }
  const where = dir.replace(/\\/g, '/');
  if (!docs.length) {
    return (
      `\n\n## Documenti di design di questo progetto\n\nIn \`${where}\` non ci sono DESIGN.md, PRODUCT.md, brand guide o spec di design. ` +
      'Se il lavoro di UI è sostanziale, proponi di crearli con la skill `impeccable` prima di scegliere una direzione.'
    );
  }
  const lines = docs.map(
    (d) => `- \`${rel(d)}\` (${Math.max(1, Math.round(d.size / 1024))} KB, modificato il ${new Date(d.mtime).toISOString().slice(0, 10)})`,
  );
  return (
    `\n\n## Documenti di design di questo progetto\n\nTrovati in \`${where}\`. Leggili con Read prima di proporre o scrivere UI: ` +
    `le loro direttive battono i gusti di default delle skill.\n\n${lines.join('\n')}`
  );
}

// Dentro un plugin le skill e i connettori prendono il nome del plugin come prefisso;
// installati a mano in ~/.claude no. Il plugin si riconosce dal suo .claude-plugin/plugin.json.
function pluginName() {
  try {
    const { name } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

function pluginNote(compact) {
  const name = pluginName();
  if (!name) return '';
  if (compact) return ` Su questa macchina le skill della tabella hanno il prefisso \`${name}:\`.`;
  return (
    `\n\n## Prefisso del plugin\n\nSu questa macchina la toolchain è installata come plugin \`${name}\`. ` +
    `Le skill della tabella si invocano con il prefisso: \`${name}:impeccable\`, \`${name}:emil-design-eng\`, ` +
    `e per l'utente \`/${name}:review-animations\`. Le skill \`ecc:*\` e \`design\` restano come sono. ` +
    `I connettori MCP del plugin si chiamano \`plugin:${name}:<nome>\` (per esempio \`plugin:${name}:magicuidesign\`).`
  );
}

function handle(input) {
  if (!input || typeof input.prompt !== 'string') return null;
  const now = Date.now();
  const dir = input.cwd || process.cwd();
  const file = statePath(input.session_id);
  const state = file ? readState(file) : null;
  const sticky = Boolean(state && now - state.lastHit <= STICKY_MS);
  if (!classify(input.prompt, { lowThreshold: sticky || isFrontendProject(dir) }).hit) return null;

  const routing = fs.readFileSync(ROUTING_FILE, 'utf8');
  let full = true;
  if (file) {
    if (!state) cleanOldState(now);
    const next = state || { count: 0, lastFull: 0, lastHit: 0 };
    full = next.count % FULL_EVERY === 0 || now - next.lastFull > FULL_AFTER_MS;
    next.count += 1;
    next.lastHit = now;
    if (full) next.lastFull = now;
    if (!writeState(file, next)) full = true;
  }
  const context = full
    ? routing + pluginNote(false) + designDocsSection(dir, false)
    : SHORT_REMINDER + pluginNote(true) + designDocsSection(dir, true);
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } };
}

function main() {
  const args = process.argv.slice(2);
  const testIdx = args.indexOf('--test');
  if (testIdx !== -1) {
    let rest = args.slice(testIdx + 1);
    let cwd = null;
    if (rest[0] === '--cwd') {
      cwd = rest[1];
      rest = rest.slice(2);
    }
    const frontend = cwd ? isFrontendProject(cwd) : false;
    process.stdout.write(`${JSON.stringify({ ...classify(rest.join(' '), { lowThreshold: frontend }), frontend })}\n`);
    return;
  }

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const output = handle(JSON.parse(raw.replace(/^\uFEFF/, '')));
      if (output) process.stdout.write(JSON.stringify(output));
    } catch {
      // input illeggibile o routing mancante: il prompt passa senza contesto aggiunto
    }
  });
}

if (require.main === module || process.argv.includes('--test')) main();

module.exports = { classify, score, isFrontendProject, handle };
