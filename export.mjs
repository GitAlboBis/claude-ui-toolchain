#!/usr/bin/env node
// Da lanciare sul PC dove la toolchain è già configurata. Copia in payload/ gli hook, le regole e
// le skill elencati in manifest.json e scrive payload/lock.json. Prima di toccare il payload
// controlla che non ci siano segreti e che git pubblicherebbe davvero ogni file.
//
// Uso: node export.mjs [--dry-run] [--config-dir <cartella>]
import { spawnSync } from 'node:child_process';
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
const PAYLOAD = path.join(ROOT, 'payload');
// File del repo da controllare oltre al payload. lib.mjs no: contiene le espressioni dei segreti.
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
if (!manifest) fail('manifest.json mancante o non valido.');
const allowlist = new Set(manifest.secretAllowlist || []);

const items = [
  ...manifest.hooks.map((name) => ({ kind: 'hooks', name, dir: false })),
  ...manifest.rules.map((name) => ({ kind: 'rules', name, dir: false })),
  ...manifest.skills.map((name) => ({ kind: 'skills', name, dir: true })),
].map((it) => ({ ...it, src: path.join(CFG, it.kind, it.name), dst: path.join(PAYLOAD, it.kind, it.name) }));

const missing = items.filter((it) => !fs.existsSync(it.src)).map((it) => `${it.kind}/${it.name}`);
if (missing.length) fail(`Su questo PC mancano:\n  ${missing.join('\n  ')}\nInstallali o toglili da manifest.json.`);

// Ogni file che finirà nel repo, con il percorso relativo che avrà dentro payload/.
const files = [];
for (const it of items) {
  if (!it.dir) files.push({ abs: it.src, key: `${it.kind}/${it.name}` });
  else for (const rel of listFiles(it.src)) files.push({ abs: path.join(it.src, rel), key: `${it.kind}/${it.name}/${rel}` });
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

// Un file che git ignora finirebbe nel lock ma non sul portatile. Senza git il controllo non si salta.
const check = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
  cwd: ROOT,
  input: files.map((f) => `payload/${f.key}`).join('\n'),
  encoding: 'utf8',
});
if (check.error) fail('Serve git nel PATH per controllare cosa verrà pubblicato.');
if (check.status === 0) {
  fail(`Git ignorerebbe questi file, che sul portatile mancherebbero:\n${check.stdout}Rinominali o cambia la regola nel .gitignore, poi rilancia.`);
}
if (check.status !== 1) fail(`Controllo di git non riuscito (${check.stderr.trim()}). La cartella è un repo? Lancia prima git init -b main.`);

const lock = { hooks: {}, rules: {}, skills: {} };
let changed = 0;
for (const it of items) {
  const srcHash = it.dir ? hashDir(it.src) : hashFile(it.src);
  lock[it.kind][it.name] = srcHash;
  if (srcHash === (it.dir ? hashDir(it.dst) : hashFile(it.dst))) continue;
  changed++;
  console.log(`${DRY ? '[prova] ' : ''}aggiorno ${it.kind}/${it.name}`);
  if (DRY) continue;
  if (it.dir) {
    copyDir(it.src, it.dst);
  } else {
    fs.mkdirSync(path.dirname(it.dst), { recursive: true });
    fs.copyFileSync(it.src, it.dst);
  }
}

// Skill tolte dal manifest (e cartelle di appoggio di copie interrotte): vanno tolte dal payload.
const listed = new Set(manifest.skills);
const payloadSkills = path.join(PAYLOAD, 'skills');
for (const name of fs.existsSync(payloadSkills) ? fs.readdirSync(payloadSkills) : []) {
  if (listed.has(name)) continue;
  changed++;
  console.log(`${DRY ? '[prova] ' : ''}tolgo dal payload skills/${name}`);
  if (!DRY) fs.rmSync(path.join(payloadSkills, name), { recursive: true, force: true });
}

const lockFile = path.join(PAYLOAD, 'lock.json');
const previous = readJson(lockFile);
const sameLock = previous && JSON.stringify(previous.items) === JSON.stringify(lock);
if (!DRY && (!sameLock || changed)) {
  writeJsonAtomic(lockFile, { exportedAt: new Date().toISOString(), items: lock });
}

console.log(
  changed
    ? `\n${changed} elementi ${DRY ? 'da aggiornare' : 'aggiornati'} in payload/. Ora:\n  git add -A\n  git commit -m "aggiorna la toolchain"\n  git push`
    : '\nIl payload è già allineato a questo PC.',
);
