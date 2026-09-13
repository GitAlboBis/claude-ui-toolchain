#!/usr/bin/env node
// Da lanciare sul PC dove la toolchain è configurata. Ricostruisce il plugin ui-design (hook, elenco,
// skill, connettori MCP) e il marketplace a partire da ~/.claude e da manifest.json, copia le regole
// e alza la versione del plugin quando il contenuto cambia: così le altre macchine si aggiornano.
// Prima di toccare il repo controlla che non ci siano segreti e che git pubblicherebbe ogni file.
//
// Uso: node export.mjs [--dry-run] [--config-dir <cartella>]
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyDir,
  hashDir,
  hashFile,
  listFiles,
  parseArgs,
  readJson,
  resolveConfigDir,
  scanForSecrets,
  writeJsonAtomic,
} from './lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROUTER = 'ui-design-router.js';
// File del repo da controllare oltre a quelli copiati. lib.mjs no: contiene le espressioni dei segreti.
const REPO_FILES = ['manifest.json', 'README.md', 'install.mjs', 'export.mjs', '.gitignore', '.gitattributes'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), new Set(['dry-run']));
} catch (err) {
  fail(err.message);
}
const DRY = parsed.flags.has('dry-run');
const CFG = resolveConfigDir(parsed.values.configDir);
const manifest = readJson(path.join(ROOT, 'manifest.json'));
if (!manifest?.plugin?.name) fail('manifest.json mancante o senza la sezione "plugin".');
if (!manifest.hooks.includes(ROUTER)) fail(`manifest.json: "hooks" deve contenere ${ROUTER}.`);
const allowlist = new Set(manifest.secretAllowlist || []);

const slash = (p) => p.replace(/\\/g, '/');
const PLUGIN_DIR = `plugins/${manifest.plugin.name}`;
const items = [
  ...manifest.hooks.map((name) => ({ name, dir: false, src: path.join(CFG, 'hooks', name), key: `${PLUGIN_DIR}/hooks/${name}` })),
  ...manifest.skills.map((name) => ({ name, dir: true, src: path.join(CFG, 'skills', name), key: `${PLUGIN_DIR}/skills/${name}` })),
  ...manifest.rules.map((name) => ({ name, dir: false, src: path.join(CFG, 'rules', name), key: `rules/${name}` })),
].map((it) => ({ ...it, dst: path.join(ROOT, it.key) }));

const missing = items.filter((it) => !fs.existsSync(it.src)).map((it) => slash(path.relative(CFG, it.src)));
if (missing.length) fail(`Su questo PC mancano:\n  ${missing.join('\n  ')}\nInstallali o toglili da manifest.json.`);

// Ogni file che finirà nel repo, con il percorso relativo che avrà.
const files = [];
for (const it of items) {
  if (!it.dir) files.push({ abs: it.src, key: it.key });
  else for (const rel of listFiles(it.src)) files.push({ abs: path.join(it.src, rel), key: `${it.key}/${rel}` });
}

const leaks = [];
for (const file of [...files, ...REPO_FILES.map((name) => ({ abs: path.join(ROOT, name), key: name }))]) {
  if (!fs.existsSync(file.abs) || allowlist.has(file.key)) continue;
  for (const label of scanForSecrets(file.abs)) leaks.push(`${label}: ${file.key}`);
}
if (leaks.length) {
  fail(
    `Export annullato, possibili segreti:\n  ${leaks.join('\n  ')}\n` +
      'Se è solo un esempio di documentazione, aggiungi il percorso a "secretAllowlist" in manifest.json.',
  );
}

// File generati dal manifest.
const generated = {
  [`${PLUGIN_DIR}/hooks/hooks.json`]: {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${ROUTER}"`, timeout: 10 }] }],
    },
  },
  [`${PLUGIN_DIR}/.mcp.json`]: { mcpServers: manifest.mcpServers },
};

// Un file che git ignora finirebbe nel lock ma non sulle altre macchine. Senza git il controllo non si salta.
const toPublish = [
  ...files.map((f) => f.key),
  ...Object.keys(generated),
  `${PLUGIN_DIR}/.claude-plugin/plugin.json`,
  '.claude-plugin/marketplace.json',
  'lock.json',
];
const check = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: toPublish.join('\n'), encoding: 'utf8' });
if (check.error) fail('Serve git nel PATH per controllare cosa verrà pubblicato.');
if (check.status === 0) {
  fail(`Git ignorerebbe questi file, che sulle altre macchine mancherebbero:\n${check.stdout}Rinominali o cambia la regola nel .gitignore, poi rilancia.`);
}
if (check.status !== 1) fail(`Controllo di git non riuscito (${check.stderr.trim()}). La cartella è un repo? Lancia prima git init -b main.`);

// La versione del plugin sale solo quando cambia qualcosa che le altre macchine devono ricevere.
const hashes = Object.fromEntries(items.map((it) => [it.key, it.dir ? hashDir(it.src) : hashFile(it.src)]));
const pluginFiles = Object.fromEntries(Object.entries(hashes).filter(([key]) => key.startsWith(`${PLUGIN_DIR}/`)));
const contentHash = crypto
  .createHash('sha256')
  .update(JSON.stringify({ owner: manifest.owner, description: manifest.description, plugin: manifest.plugin, generated, pluginFiles }))
  .digest('hex');
const lockFile = path.join(ROOT, 'lock.json');
const previous = readJson(lockFile);
const bump = (version) => {
  const [major, minor, patch] = version.split('.').map((n) => Number(n) || 0);
  return `${major}.${minor}.${patch + 1}`;
};
const version = !previous?.version ? '1.0.0' : previous.contentHash === contentHash ? previous.version : bump(previous.version);

const { install: _installOnly, ...pluginMeta } = manifest.plugin;
generated[`${PLUGIN_DIR}/.claude-plugin/plugin.json`] = {
  $schema: 'https://anthropic.com/claude-code/plugin.schema.json',
  name: pluginMeta.name,
  version,
  description: pluginMeta.description,
  author: manifest.owner,
  skills: ['./skills/'],
  userConfig: pluginMeta.userConfig,
};
generated['.claude-plugin/marketplace.json'] = {
  name: manifest.name,
  owner: manifest.owner,
  metadata: { description: manifest.description },
  plugins: [{ name: pluginMeta.name, source: `./${PLUGIN_DIR}`, description: pluginMeta.description, version }],
};

let changed = 0;
const note = (msg) => console.log(`${DRY ? '[prova] ' : ''}${msg}`);
for (const it of items) {
  if (hashes[it.key] === (it.dir ? hashDir(it.dst) : hashFile(it.dst))) continue;
  changed++;
  note(`aggiorno ${it.key}`);
  if (DRY) continue;
  if (it.dir) {
    copyDir(it.src, it.dst);
  } else {
    fs.mkdirSync(path.dirname(it.dst), { recursive: true });
    fs.copyFileSync(it.src, it.dst);
  }
}

for (const [key, data] of Object.entries(generated)) {
  const target = path.join(ROOT, key);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text) continue;
  changed++;
  note(`scrivo ${key}`);
  if (!DRY) writeJsonAtomic(target, data);
}

// Skill tolte dal manifest (e cartelle di appoggio di copie interrotte): vanno tolte dal plugin.
const listed = new Set(manifest.skills);
const pluginSkills = path.join(ROOT, PLUGIN_DIR, 'skills');
for (const name of fs.existsSync(pluginSkills) ? fs.readdirSync(pluginSkills) : []) {
  if (listed.has(name)) continue;
  changed++;
  note(`tolgo ${PLUGIN_DIR}/skills/${name}`);
  if (!DRY) fs.rmSync(path.join(pluginSkills, name), { recursive: true, force: true });
}

// Cartella dell'installer a file, sostituito dal plugin.
if (fs.existsSync(path.join(ROOT, 'payload'))) {
  changed++;
  note('tolgo payload/ (vecchio formato)');
  if (!DRY) fs.rmSync(path.join(ROOT, 'payload'), { recursive: true, force: true });
}

const lock = { version, contentHash, items: hashes };
const sameLock = previous && previous.version === version && JSON.stringify(previous.items) === JSON.stringify(hashes);
if (!DRY && (!sameLock || changed)) writeJsonAtomic(lockFile, { ...lock, exportedAt: new Date().toISOString() });

console.log(
  changed
    ? `\nPlugin ${pluginMeta.name} ${version}: ${changed} elementi ${DRY ? 'da aggiornare' : 'aggiornati'}. Ora:\n  git add -A\n  git commit -m "aggiorna la toolchain"\n  git push`
    : `\nPlugin ${pluginMeta.name} ${version}: già allineato a questo PC.`,
);
