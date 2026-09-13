// Funzioni condivise da install.mjs ed export.mjs. Solo moduli di Node, nessuna dipendenza.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Cache e file di sistema che non fanno parte di una skill.
export const EXCLUDE = new Set(['__pycache__', '.DS_Store', 'Thumbs.db', 'node_modules', '.git']);

export const MAX_SCAN_BYTES = 5 * 1024 * 1024;

// Il repo sta su GitHub: meglio fermarsi per un falso allarme che pubblicare una chiave.
export const SECRET_PATTERNS = [
  ['chiave OriginKit', /cmp_live_[A-Za-z0-9_]{12,}/],
  ['chiave Context7', /ctx7sk[-_][A-Za-z0-9_-]{16,}/],
  ['token GitHub', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['token GitHub fine-grained', /\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['chiave sk-', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['chiave Stripe', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['token Supabase', /\bsbp_[A-Za-z0-9]{32,}/],
  ['token npm', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['token Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['chiave Google', /\bAIza[0-9A-Za-z_-]{35}/],
  ['chiave AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['chiave privata', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['header Bearer con valore', /Bearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/],
];

// Un'opzione sbagliata non deve mai trasformare una prova in un'installazione vera: meglio fermarsi.
export function parseArgs(argv, known) {
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config-dir' || arg.startsWith('--config-dir=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
      if (!value || value.startsWith('--')) throw new Error('--config-dir vuole il percorso di una cartella');
      values.configDir = value;
    } else if (arg.startsWith('--') && known.has(arg.slice(2))) {
      flags.add(arg.slice(2));
    } else {
      const valid = [...known].map((k) => `--${k}`).join(', ');
      throw new Error(`opzione sconosciuta: ${arg}. Valide: ${valid}, --config-dir <cartella>`);
    }
  }
  return { flags, values };
}

export function resolveConfigDir(explicit) {
  return path.resolve(explicit || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// Ordine per codice carattere, non per locale: lo stesso hash su ogni macchina.
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Segue i link come fa copyDir, così quello che si controlla è quello che si copia.
// Si ferma solo sui link che puntano a una cartella antenata, che sarebbero un ciclo.
export function listFiles(dir) {
  const out = [];
  const walk = (current, rel, ancestors) => {
    const real = fs.realpathSync(current);
    if (ancestors.has(real)) return;
    const inside = new Set(ancestors).add(real);
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort(byName)) {
      if (EXCLUDE.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(current, entry.name);
      let kind = entry;
      if (entry.isSymbolicLink()) {
        try {
          kind = fs.statSync(abs);
        } catch {
          continue; // link rotto
        }
      }
      if (kind.isDirectory()) walk(abs, relPath, inside);
      else if (kind.isFile()) out.push(relPath);
    }
  };
  walk(dir, '', new Set());
  return out;
}

export function hashDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const hash = crypto.createHash('sha256');
  for (const rel of listFiles(dir)) {
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(dir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function hashFile(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function decodeText(buffer) {
  const even = (start) => buffer.subarray(start, start + ((buffer.length - start) & ~1));
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return even(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(even(2)).swap16().toString('utf16le');
  return buffer.toString('utf8');
}

// Restituisce le etichette dei segreti trovati. Un file troppo grande da controllare conta come sospetto.
export function scanForSecrets(file) {
  if (fs.statSync(file).size > MAX_SCAN_BYTES) return ['file troppo grande per il controllo dei segreti'];
  const text = decodeText(fs.readFileSync(file));
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);
}

function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    return true;
  } catch {
    return false;
  }
}

// Copia a specchio senza mai lasciare una cartella a metà: copia accanto, poi scambia.
// Se la destinazione è bloccata (terminale o editor aperti lì, antivirus, OneDrive) resta com'era
// e l'errore risale. Restituisce il percorso della vecchia copia se non si è riusciti a cancellarla.
export function copyDir(src, dst) {
  const parent = path.dirname(dst);
  const staged = path.join(parent, `.${path.basename(dst)}.new-${process.pid}`);
  const old = path.join(parent, `.${path.basename(dst)}.old-${process.pid}`);
  fs.mkdirSync(parent, { recursive: true });
  removeQuietly(staged);
  try {
    fs.cpSync(src, staged, { recursive: true, dereference: true, filter: (p) => !EXCLUDE.has(path.basename(p)) });
    if (fs.existsSync(dst)) fs.renameSync(dst, old);
  } catch (err) {
    removeQuietly(staged);
    throw err;
  }
  try {
    fs.renameSync(staged, dst);
  } catch (err) {
    if (fs.existsSync(old) && !fs.existsSync(dst)) {
      try {
        fs.renameSync(old, dst);
      } catch {
        // resta in old: removeStaleStaging la toglie al prossimo giro e la skill torna dal payload
      }
    }
    removeQuietly(staged);
    throw err;
  }
  return removeQuietly(old) ? null : old;
}

// Cartelle di appoggio lasciate da una copia interrotta: Claude Code le caricherebbe come skill doppie.
// Restituisce quelle che non si è riusciti a cancellare.
export function removeStaleStaging(parent, names) {
  let entries;
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return [];
  }
  const failed = [];
  for (const entry of entries) {
    const match = /^\.(.+)\.(?:new|old)-\d+$/.exec(entry);
    if (!match || !names.has(match[1])) continue;
    if (!removeQuietly(path.join(parent, entry))) failed.push(path.join(parent, entry));
  }
  return failed;
}
