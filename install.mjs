#!/usr/bin/env node
// Installa su questa macchina la toolchain UI di Claude Code come plugin: aggiunge il marketplace del
// repo privato, installa il plugin ui-design (hook, elenco, skill, connettori MCP) chiedendo le chiavi,
// attiva l'aggiornamento automatico, installa ECC e copia le regole globali. Si può rilanciare.
//
// Uso: node install.mjs [--dry-run] [--yes] [--no-rules] [--no-ecc] [--local-marketplace] [--config-dir <cartella>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hashFile, parseArgs, readJson, resolveConfigDir, writeJsonAtomic } from './lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROUTER = 'ui-design-router.js';
const IS_WINDOWS = process.platform === 'win32';
const KNOWN_FLAGS = new Set(['dry-run', 'yes', 'no-rules', 'no-ecc', 'local-marketplace']);

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
const manifest = readJson(path.join(ROOT, 'manifest.json'));
const PLUGIN = manifest?.plugin?.name;
const MARKETPLACE = manifest?.name;
const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
// Dal repo su GitHub, così l'aggiornamento automatico arriva da lì; in locale solo per le prove.
const MARKETPLACE_SOURCE = flags.has('local-marketplace') ? ROOT : manifest?.marketplaceSource;

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
  if (!PLUGIN || !MARKETPLACE || !MARKETPLACE_SOURCE) throw new Error('manifest.json mancante o incompleto');
  if (!fs.existsSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'))) {
    throw new Error('.claude-plugin/marketplace.json mancante: sul PC principale lancia prima node export.mjs');
  }
  console.log(`Toolchain UI di Claude Code, plugin ${PLUGIN_ID} -> ${CFG}`);
  console.log(`${process.platform} ${process.arch}, Node ${process.versions.node}${DRY ? ', modalità prova: nessuna scrittura' : ''}\n`);
}

function installRule(name) {
  const src = path.join(ROOT, 'rules', name);
  const dst = path.join(CFG, 'rules', name);
  if (!fs.existsSync(src)) return report.warnings.push(`rules/${name} manca nel repo`);
  if (hashFile(src) === hashFile(dst)) return report.skipped.push(`regola ${name} già uguale`);
  if (fs.existsSync(dst)) backup(dst, path.join('rules', name));
  say(`regola ${name}`);
  if (!DRY) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  report.done.push(`regola ${name}`);
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

const knownMarketplaces = () => readJson(path.join(CFG, 'plugins', 'known_marketplaces.json')) || {};
const installedPlugins = () => readJson(path.join(CFG, 'plugins', 'installed_plugins.json'))?.plugins || {};

function addMarketplace(bin) {
  if (knownMarketplaces()[MARKETPLACE]) {
    say(`marketplace ${MARKETPLACE}: aggiorno dal repo`);
    if (!DRY) {
      const result = runClaude(bin, ['plugin', 'marketplace', 'update', MARKETPLACE]);
      if (result.code !== 0) report.warnings.push(`marketplace ${MARKETPLACE}: aggiornamento non riuscito (${lastLine(result.out)})`);
    }
    report.done.push(`marketplace ${MARKETPLACE} aggiornato`);
    return true;
  }
  say(`marketplace ${MARKETPLACE} da ${MARKETPLACE_SOURCE}`);
  if (!DRY) {
    const result = runClaude(bin, ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE]);
    if (result.code !== 0) {
      report.warnings.push(
        `marketplace ${MARKETPLACE}: non aggiunto (${lastLine(result.out)}). Per il repo privato serve l'accesso git: gh auth login e poi gh auth setup-git`,
      );
      return false;
    }
  }
  report.done.push(`marketplace ${MARKETPLACE}`);
  return true;
}

// Claude Code aggiorna da solo, all'avvio, i marketplace con autoUpdate: le modifiche fatte sul PC arrivano senza comandi.
function enableAutoUpdate() {
  if (DRY) return report.done.push(`attiverebbe l'aggiornamento automatico di ${MARKETPLACE}`);
  const file = path.join(CFG, 'settings.json');
  const settings = readJson(file);
  const entry = settings?.extraKnownMarketplaces?.[MARKETPLACE];
  if (!entry) {
    return report.warnings.push(`${MARKETPLACE} non è in settings.json: aggiornamento automatico non attivato, attivalo da /plugin`);
  }
  if (entry.autoUpdate === true) return report.skipped.push('aggiornamento automatico già attivo');
  backup(file, 'settings.json');
  writeJsonAtomic(file, {
    ...settings,
    extraKnownMarketplaces: { ...settings.extraKnownMarketplaces, [MARKETPLACE]: { ...entry, autoUpdate: true } },
  });
  say('aggiornamento automatico attivato');
  report.done.push(`aggiornamento automatico di ${MARKETPLACE} attivato`);
}

async function installMainPlugin(bin) {
  if (installedPlugins()[PLUGIN_ID]) {
    return report.skipped.push(`plugin ${PLUGIN_ID} già installato (per cambiare le chiavi: /plugin configure ${PLUGIN_ID})`);
  }
  const args = ['plugin', 'install', PLUGIN_ID, '--scope', 'user', '--yes'];
  const { userConfig = {}, install = {} } = manifest.plugin;
  for (const [key, spec] of Object.entries(userConfig)) {
    const required = (install.required || []).includes(key);
    const env = install.env?.[key];
    const question = `${spec.title}${required ? '' : ' (facoltativa, invio per saltare)'}: `;
    const value = (env && process.env[env]) || (INTERACTIVE && !DRY ? await askSecret(question) : '');
    if (value) args.push('--config', `${key}=${value}`);
    else if (required) {
      report.todo.push(`${spec.title} non data: ${install.withoutKey?.[key] || 'quella parte non funziona'}. Impostala con /plugin configure ${PLUGIN_ID}`);
    }
  }
  say(`plugin ${PLUGIN_ID}`);
  if (!DRY) {
    const result = runClaude(bin, args);
    if (result.code !== 0) return report.warnings.push(`plugin ${PLUGIN_ID}: non installato (${lastLine(result.out)})`);
  }
  report.done.push(`plugin ${PLUGIN_ID}`);
}

function installOtherPlugin(bin, plugin) {
  if (knownMarketplaces()[plugin.marketplace.name]) {
    report.skipped.push(`marketplace ${plugin.marketplace.name} già presente`);
  } else {
    say(`marketplace ${plugin.marketplace.name}`);
    if (!DRY) {
      const result = runClaude(bin, ['plugin', 'marketplace', 'add', plugin.marketplace.source]);
      if (result.code !== 0) return report.warnings.push(`marketplace ${plugin.marketplace.name}: non aggiunto (${lastLine(result.out)})`);
    }
    report.done.push(`marketplace ${plugin.marketplace.name}`);
  }
  if (installedPlugins()[plugin.id]) return report.skipped.push(`plugin ${plugin.id} già installato`);
  say(`plugin ${plugin.id}`);
  if (!DRY) {
    const result = runClaude(bin, ['plugin', 'install', plugin.id, '--scope', 'user', '--yes']);
    if (result.code !== 0) return report.warnings.push(`plugin ${plugin.id}: non installato (${lastLine(result.out)})`);
  }
  report.done.push(`plugin ${plugin.id}`);
  report.todo.push(`${plugin.id}: se il plugin ha opzioni da impostare, in Claude Code lancia /plugin configure ${plugin.id}`);
}

// La stessa toolchain installata anche a file farebbe scattare l'hook due volte e duplicherebbe le skill.
function checkLooseInstall() {
  const groups = readJson(path.join(CFG, 'settings.json'))?.hooks?.UserPromptSubmit;
  const looseHook =
    Array.isArray(groups) &&
    groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(ROUTER)));
  if (looseHook) {
    report.warnings.push("in settings.json c'è anche l'hook installato a file: con il plugin scatterebbe due volte. Togli quella voce da hooks.UserPromptSubmit");
  }
  const duplicates = manifest.skills.filter((name) => fs.existsSync(path.join(CFG, 'skills', name)));
  if (duplicates.length) {
    report.todo.push(`${duplicates.length} skill esistono anche fuori dal plugin in ${path.join(CFG, 'skills')}: compariranno due volte, con e senza prefisso ${PLUGIN}:`);
  }
}

function verifyPlugin(bin) {
  if (DRY) return;
  const entry = installedPlugins()[PLUGIN_ID];
  const installPath = (Array.isArray(entry) ? entry[0] : entry)?.installPath;
  if (!installPath || !fs.existsSync(installPath)) return report.warnings.push(`plugin ${PLUGIN_ID} non trovato tra quelli installati: verifica saltata`);

  if (!onPath(IS_WINDOWS ? 'node.exe' : 'node')) {
    report.warnings.push("node non è nel PATH: l'hook del plugin non partirà. Riapri il terminale o reinstalla Node.js");
  }
  const sessionId = `installer-check-${process.pid}`;
  const hook = spawnSync(process.execPath, [path.join(installPath, 'hooks', ROUTER)], {
    input: JSON.stringify({ session_id: sessionId, cwd: ROOT, prompt: 'rifai la navbar mobile' }),
    encoding: 'utf8',
    timeout: 10000,
  });
  fs.rmSync(path.join(os.tmpdir(), 'claude-ui-design-router', `${sessionId}.json`), { force: true });
  let context = '';
  try {
    context = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  } catch {
    context = '';
  }
  if (context.startsWith('# Routing') && context.includes('Prefisso del plugin')) report.done.push("prova dell'hook del plugin superata");
  else report.warnings.push(`prova dell'hook del plugin fallita: ${lastLine(hook.stderr || hook.stdout)}`);

  const details = runClaude(bin, ['plugin', 'details', PLUGIN_ID]).out;
  const count = (label) => Number(new RegExp(`${label} \\((\\d+)\\)`).exec(details)?.[1] ?? -1);
  const skills = count('Skills');
  const servers = count('MCP servers');
  const hooks = count('Hooks');
  const expectedServers = Object.keys(manifest.mcpServers).length;
  if (skills === manifest.skills.length && servers === expectedServers && hooks >= 1) {
    report.done.push(`contenuto del plugin verificato: ${skills} skill, ${servers} connettori, hook presente`);
  } else {
    report.warnings.push(`contenuto del plugin inatteso: skill ${skills}/${manifest.skills.length}, connettori ${servers}/${expectedServers}, hook ${hooks}`);
  }
}

function printReport() {
  const section = (title, list) => list.length && console.log(`\n${title}\n${list.map((l) => `  - ${l}`).join('\n')}`);
  section(DRY ? 'Farebbe' : 'Fatto', report.done);
  section('Già a posto', report.skipped);
  section('Attenzione', report.warnings);
  const todo = [
    ...report.todo,
    "apri una nuova sessione di Claude Code: il plugin si carica all'avvio",
    `le skill del plugin si invocano con il prefisso ${PLUGIN}: (per esempio /${PLUGIN}:review-animations)`,
    `mobbin: autenticalo con /mcp (il server si chiama plugin:${PLUGIN}:mobbin; serve un piano Mobbin Pro o superiore)`,
    `le modifiche fatte sul PC arrivano da sole all'avvio di Claude Code; per averle subito: claude plugin marketplace update ${MARKETPLACE}`,
    'le regole globali non sono nel plugin: se cambiano, git pull e rilancia node install.mjs',
    ...(IS_WINDOWS
      ? ["se l'app Claude desktop era aperta mentre installavi Node, chiudila del tutto (anche dall'area di notifica) e riaprila: hook e MCP con npx usano node e npx dal suo PATH"]
      : []),
    "il connettore 21st.dev arriva dall'account claude.ai: non serve installarlo",
    'Impeccable scarica il suo motore al primo uso (serve la rete); ui-ux-pro-max e motion-framer usano Python 3; la skill lighthouse usa la CLI di Lighthouse',
  ];
  if (backupUsed) todo.push(`copia di ciò che è stato sostituito: ${BACKUP}`);
  section('Da fare', todo);
  console.log('');
}

async function main() {
  preflight();
  const bin = findClaude();
  if (!bin) throw new Error('comando claude non trovato: installa Claude Code (irm https://claude.ai/install.ps1 | iex), riapri il terminale e rilancia');
  if (!flags.has('no-rules')) for (const name of manifest.rules) installRule(name);
  if (addMarketplace(bin)) {
    enableAutoUpdate();
    await installMainPlugin(bin);
  }
  checkLooseInstall();
  if (!flags.has('no-ecc')) for (const plugin of manifest.plugins) installOtherPlugin(bin, plugin);
  verifyPlugin(bin);
  printReport();
  if (report.warnings.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(`\nInstallazione interrotta: ${err.message}`);
  if (backupUsed) console.error(`Copia di ciò che era già stato sostituito: ${BACKUP}`);
  process.exit(1);
});
