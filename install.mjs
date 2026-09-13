#!/usr/bin/env node
// Installa su questa macchina la toolchain UI di Claude Code esportata dal PC principale:
// hook di routing, regole, skill, connettori MCP e plugin ECC. Si può rilanciare quando si vuole:
// salta ciò che è già a posto e salva una copia di ciò che sostituisce.
//
// Uso: node install.mjs [--dry-run] [--yes] [--no-skills] [--no-mcp] [--no-ecc]
//                       [--keep-existing-skills] [--force-mcp] [--config-dir <cartella>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  copyDir,
  hashDir,
  hashFile,
  parseArgs,
  readJson,
  removeStaleStaging,
  resolveConfigDir,
  writeJsonAtomic,
} from './lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PAYLOAD = path.join(ROOT, 'payload');
const ROUTER = 'ui-design-router.js';
const IS_WINDOWS = process.platform === 'win32';
const KNOWN_FLAGS = new Set(['dry-run', 'yes', 'no-skills', 'no-mcp', 'no-ecc', 'keep-existing-skills', 'force-mcp']);

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), KNOWN_FLAGS);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { flags, values } = parsed;
const DRY = flags.has('dry-run');
const INTERACTIVE = Boolean(process.stdin.isTTY) && !flags.has('yes');
const CFG = resolveConfigDir(values.configDir);
if (values.configDir) process.env.CLAUDE_CONFIG_DIR = CFG; // anche i comandi claude lanciati da qui usano quella cartella
const STAMP = `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${process.pid}`;
const BACKUP = path.join(CFG, 'ui-toolchain-backups', STAMP);

const report = { done: [], skipped: [], warnings: [], todo: [] };
let backupUsed = false;

const say = (msg) => console.log(`${DRY ? '[prova] ' : ''}${msg}`);
const lastLine = (text) => (text || '').trim().split(/\r?\n/).pop() || 'nessun messaggio';

function backup(target, rel) {
  if (DRY) return;
  const dest = path.join(BACKUP, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(target, dest, { recursive: true, dereference: true });
  backupUsed = true;
}

function preflight() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error(`serve Node.js 20 o superiore, trovato ${process.versions.node}`);
  if (!fs.existsSync(path.join(PAYLOAD, 'lock.json'))) {
    throw new Error('payload/lock.json mancante: sul PC principale lancia prima node export.mjs');
  }
  console.log(`Toolchain UI di Claude Code -> ${CFG}`);
  console.log(`${process.platform} ${process.arch}, Node ${process.versions.node}${DRY ? ', modalità prova: nessuna scrittura' : ''}\n`);
}

function installFile(kind, name) {
  const src = path.join(PAYLOAD, kind, name);
  const dst = path.join(CFG, kind, name);
  if (!fs.existsSync(src)) return report.warnings.push(`${kind}/${name} manca nel payload`);
  if (hashFile(src) === hashFile(dst)) return report.skipped.push(`${kind}/${name} già uguale`);
  if (fs.existsSync(dst)) backup(dst, path.join(kind, name));
  say(`${kind}/${name}`);
  if (!DRY) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  report.done.push(`${kind}/${name}`);
}

function installSkills(names) {
  const count = { added: 0, updated: 0, same: 0, kept: 0 };
  if (!DRY) {
    for (const dir of removeStaleStaging(path.join(CFG, 'skills'), new Set(names))) {
      report.warnings.push(`cartella di appoggio ${dir} rimasta da un'installazione interrotta: eliminala a mano`);
    }
  }
  for (const name of names) {
    const src = path.join(PAYLOAD, 'skills', name);
    const dst = path.join(CFG, 'skills', name);
    if (!fs.existsSync(src)) {
      report.warnings.push(`skill ${name} manca nel payload`);
      continue;
    }
    // Una skill illeggibile o bloccata non deve fermare le altre né il resto dell'installazione.
    try {
      const exists = fs.existsSync(dst);
      if (exists && hashDir(src) === hashDir(dst)) {
        count.same++;
        continue;
      }
      if (exists && flags.has('keep-existing-skills')) {
        count.kept++;
        continue;
      }
      if (exists) backup(dst, path.join('skills', name));
      const leftover = DRY ? null : copyDir(src, dst);
      if (leftover) report.warnings.push(`skill ${name}: la copia vecchia ${leftover} non si è cancellata, eliminala a mano`);
      say(`skill ${name} ${exists ? 'aggiornata' : 'aggiunta'}`);
      count[exists ? 'updated' : 'added']++;
    } catch (err) {
      const locked = ['EBUSY', 'EPERM', 'EACCES'].includes(err.code);
      const why = locked ? 'la cartella è bloccata: chiudi terminali, editor o sincronizzazioni aperti lì dentro' : err.message;
      report.warnings.push(`skill ${name}: lasciata com'era (${why}). Poi rilancia l'installer`);
    }
  }
  report.done.push(
    `skill: ${count.added} aggiunte, ${count.updated} aggiornate, ${count.same} già uguali` +
      (count.kept ? `, ${count.kept} diverse lasciate com'erano` : ''),
  );
}

const isRouterHook = (hook) => typeof hook?.command === 'string' && hook.command.includes(ROUTER);

function registerHook() {
  const file = path.join(CFG, 'settings.json');
  const command = `node "${path.join(CFG, 'hooks', ROUTER).replace(/\\/g, '/')}"`;
  let settings = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    try {
      settings = raw.trim() ? JSON.parse(raw) : {};
    } catch (err) {
      return report.warnings.push(`settings.json non è JSON valido (${err.message}): hook NON registrato, correggi il file e rilancia`);
    }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return report.warnings.push('settings.json non contiene un oggetto: hook NON registrato');
  }
  // Forme che non riconosciamo: meglio avvisare che riscriverle.
  if (settings.hooks != null && (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) {
    return report.warnings.push('settings.json: "hooks" non è un oggetto, hook NON registrato');
  }
  const hooks = settings.hooks || {};
  if (hooks.UserPromptSubmit != null && !Array.isArray(hooks.UserPromptSubmit)) {
    return report.warnings.push('settings.json: hooks.UserPromptSubmit non è una lista, hook NON registrato');
  }
  const groups = hooks.UserPromptSubmit || [];
  const routers = groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : [])).filter(isRouterHook);
  if (routers.length === 1 && routers[0].command === command && routers[0].timeout === 10) {
    return report.skipped.push('hook già registrato in settings.json');
  }
  // Toglie solo le registrazioni del router (percorso vecchio, doppioni) e ne aggiunge una.
  const others = [];
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) {
      others.push(group);
      continue;
    }
    const kept = group.hooks.filter((h) => !isRouterHook(h));
    if (kept.length === group.hooks.length) others.push(group);
    else if (kept.length > 0) others.push({ ...group, hooks: kept });
  }
  settings.hooks = { ...hooks, UserPromptSubmit: [...others, { hooks: [{ type: 'command', command, timeout: 10 }] }] };
  if (fs.existsSync(file)) backup(file, 'settings.json');
  say(`hook registrato in ${file}`);
  if (!DRY) writeJsonAtomic(file, settings);
  report.done.push('hook registrato in settings.json');
}

// Cartelle del PATH lette in JS: where.exe scrive nella code page della console e storpia gli accenti.
function pathDirs() {
  return (process.env.PATH || '')
    .split(path.delimiter)
    .map((d) => d.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

const onPath = (file) => pathDirs().map((d) => path.join(d, file)).find((p) => fs.existsSync(p)) || null;

// Ordine: claude.exe nel PATH, installazione nativa, exe dentro lo shim npm, app desktop, shim .cmd.
function findClaude() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const native = path.join(os.homedir(), '.local', 'bin', IS_WINDOWS ? 'claude.exe' : 'claude');
  if (!IS_WINDOWS) return onPath('claude') || (fs.existsSync(native) ? native : null);
  const shim = onPath('claude.cmd');
  const candidates = [
    onPath('claude.exe'),
    native,
    // claude.cmd di npm lancia soltanto questo exe: chiamandolo direttamente si evita cmd.exe.
    shim && path.join(path.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (found) return found;
  const bundled = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  const versions = fs.existsSync(bundled) ? fs.readdirSync(bundled).filter((v) => fs.existsSync(path.join(bundled, v, 'claude.exe'))) : [];
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versions.length ? path.join(bundled, versions.at(-1), 'claude.exe') : shim;
}

// Solo per l'ultima risorsa claude.cmd: raddoppia le barre prima delle virgolette e neutralizza %.
const quoteForCmd = (arg) =>
  /^[A-Za-z0-9_\-.:\\/@=]+$/.test(arg)
    ? arg
    : `"${arg.replace(/(\\*)"/g, '$1$1""').replace(/(\\+)$/, '$1$1').replace(/%/g, '"^%"')}"`;

function runClaude(bin, args) {
  const result = /\.cmd$/i.test(bin)
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[bin, ...args].map(quoteForCmd).join(' ')}"`], {
        encoding: 'utf8',
        windowsVerbatimArguments: true,
      })
    : spawnSync(bin, args, { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}` };
}

// Risposta nascosta. Ctrl+C, Ctrl+D o l'input che si chiude interrompono l'installazione in modo visibile.
function askSecret(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      rl.close();
      process.stdout.write('\n');
      settle(value);
    };
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
    rl.on('SIGINT', () => finish(reject, new Error('annullata con Ctrl+C')));
    rl.on('close', () => finish(reject, new Error('inserimento chiuso senza una risposta')));
    rl.question(question, (answer) => finish(resolve, answer.trim()));
    muted = true; // da qui in poi i caratteri digitati non compaiono
  });
}

// Claude Code tiene i server MCP utente in ~/.claude.json, oppure dentro CLAUDE_CONFIG_DIR se impostata.
function userMcpFile() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(os.homedir(), '.claude.json');
}

async function installMcp(bin, servers) {
  const mcpFile = userMcpFile();
  const existing = new Set(Object.keys(readJson(mcpFile)?.mcpServers || {}));
  const force = flags.has('force-mcp');
  const mcpBackup = path.join(BACKUP, path.basename(mcpFile));
  if (force && !DRY && fs.existsSync(mcpFile)) {
    backup(mcpFile, path.basename(mcpFile));
    report.todo.push(`la copia ${mcpBackup} contiene le chiavi in chiaro: cancellala quando hai verificato che i connettori funzionano`);
  }
  for (const server of servers) {
    const present = existing.has(server.name);
    if (present && !force) {
      report.skipped.push(`MCP ${server.name} già presente`);
      continue;
    }
    const args = ['mcp', 'add', '--scope', 'user'];
    let note = server.note || '';
    let value = '';
    if (server.transport === 'http') {
      args.push('--transport', 'http', server.name, server.url);
      if (server.secretHeader) {
        const { env, prompt, header, format, withoutKey } = server.secretHeader;
        value = process.env[env] || (INTERACTIVE && !DRY ? await askSecret(`${prompt}: `) : '');
        // --header va dopo nome e URL: è variadico e altrimenti li inghiottirebbe.
        if (value) args.push('--header', `${header}: ${format.replace('{value}', value)}`);
        else note = withoutKey;
      }
    } else {
      const npx = IS_WINDOWS ? ['cmd', '/c', 'npx'] : ['npx'];
      args.push(server.name, '--', ...npx, ...server.npx);
    }
    // Reinstallare senza una chiave nuova cancellerebbe quella salvata.
    if (present && server.secretHeader && !value) {
      report.skipped.push(`MCP ${server.name} già presente e nessuna chiave nuova: lasciato com'era`);
      continue;
    }
    say(`MCP ${server.name}${present ? ' (reinstallato)' : ''}`);
    if (!DRY) {
      if (present) runClaude(bin, ['mcp', 'remove', '--scope', 'user', server.name]);
      const result = runClaude(bin, args);
      if (result.code !== 0) {
        const restore = present ? `; la configurazione precedente è in ${mcpBackup}` : '';
        report.warnings.push(`MCP ${server.name}: claude mcp add non è riuscito (${lastLine(result.out)})${restore}`);
        continue;
      }
    }
    report.done.push(`MCP ${server.name}`);
    if (note) report.todo.push(`${server.name}: ${note}`);
  }
}

function installPlugin(bin, plugin) {
  const marketplaces = readJson(path.join(CFG, 'plugins', 'known_marketplaces.json')) || {};
  if (marketplaces[plugin.marketplace.name]) {
    report.skipped.push(`marketplace ${plugin.marketplace.name} già presente`);
  } else {
    say(`marketplace ${plugin.marketplace.name}`);
    if (!DRY) {
      const result = runClaude(bin, ['plugin', 'marketplace', 'add', plugin.marketplace.source]);
      if (result.code !== 0) {
        return report.warnings.push(`marketplace ${plugin.marketplace.name}: non aggiunto (${lastLine(result.out)})`);
      }
    }
    report.done.push(`marketplace ${plugin.marketplace.name}`);
  }
  const installedFile = path.join(CFG, 'plugins', 'installed_plugins.json');
  const installed = fs.existsSync(installedFile) ? fs.readFileSync(installedFile, 'utf8') : '';
  if (installed.includes(`"${plugin.id}"`)) return report.skipped.push(`plugin ${plugin.id} già installato`);
  say(`plugin ${plugin.id}`);
  if (!DRY) {
    const result = runClaude(bin, ['plugin', 'install', plugin.id, '--scope', 'user', '--yes']);
    if (result.code !== 0) return report.warnings.push(`plugin ${plugin.id}: non installato (${lastLine(result.out)})`);
  }
  report.done.push(`plugin ${plugin.id}`);
  report.todo.push(`${plugin.id}: se il plugin ha opzioni da impostare, in Claude Code lancia /plugin configure ${plugin.id}`);
}

function verifyHook() {
  const hook = path.join(CFG, 'hooks', ROUTER);
  if (DRY || !fs.existsSync(hook)) return;
  // L'hook registrato si lancia con "node": deve risolversi dal PATH, non solo da questo processo.
  if (!onPath(IS_WINDOWS ? 'node.exe' : 'node')) {
    report.warnings.push("node non è nel PATH: l'hook non partirà. Riapri il terminale o reinstalla Node.js, poi rilancia");
  }
  const sessionId = `installer-check-${process.pid}`;
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: sessionId, cwd: ROOT, prompt: 'rifai la navbar mobile' }),
    encoding: 'utf8',
    timeout: 10000,
  });
  fs.rmSync(path.join(os.tmpdir(), 'claude-ui-design-router', `${sessionId}.json`), { force: true });
  let ok = false;
  try {
    ok = JSON.parse(result.stdout).hookSpecificOutput.additionalContext.startsWith('# Routing');
  } catch {
    ok = false;
  }
  if (ok) report.done.push("prova dell'hook superata");
  else report.warnings.push(`prova dell'hook fallita: ${lastLine(result.stderr || result.stdout)}`);
}

function printReport() {
  const section = (title, list) => list.length && console.log(`\n${title}\n${list.map((l) => `  - ${l}`).join('\n')}`);
  section(DRY ? 'Farebbe' : 'Fatto', report.done);
  section('Già a posto', report.skipped);
  section('Attenzione', report.warnings);
  const todo = [
    ...report.todo,
    "apri una nuova sessione di Claude Code: hook, regole e skill si caricano all'avvio",
    ...(IS_WINDOWS
      ? ["se l'app Claude desktop era aperta mentre installavi Node, chiudila del tutto (anche dall'area di notifica) e riaprila: hook e MCP con npx usano node e npx dal suo PATH"]
      : []),
    "il connettore 21st.dev arriva dall'account claude.ai: non serve installarlo",
    'Impeccable scarica il suo motore al primo uso (serve la rete)',
    'ui-ux-pro-max e motion-framer usano Python 3 per i loro script; la skill lighthouse usa la CLI di Lighthouse',
  ];
  if (backupUsed) todo.push(`copia di ciò che è stato sostituito: ${BACKUP}`);
  section('Da fare', todo);
  console.log('');
}

async function main() {
  preflight();
  const manifest = readJson(path.join(ROOT, 'manifest.json'));
  if (!manifest) throw new Error('manifest.json mancante o non valido');
  for (const name of manifest.hooks) installFile('hooks', name);
  for (const name of manifest.rules) installFile('rules', name);
  if (!flags.has('no-skills')) installSkills(manifest.skills);
  registerHook();
  const needsClaude = !flags.has('no-mcp') || !flags.has('no-ecc');
  const bin = needsClaude ? findClaude() : null;
  if (needsClaude && !bin) {
    report.warnings.push('comando claude non trovato: connettori MCP e plugin saltati. Installa Claude Code e rilancia');
  }
  if (bin && !flags.has('no-mcp')) await installMcp(bin, manifest.mcpServers);
  if (bin && !flags.has('no-ecc')) for (const plugin of manifest.plugins) installPlugin(bin, plugin);
  verifyHook();
  printReport();
  if (report.warnings.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(`\nInstallazione interrotta: ${err.message}`);
  if (backupUsed) console.error(`Copia di ciò che era già stato sostituito: ${BACKUP}`);
  process.exit(1);
});
