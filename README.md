# Toolchain UI di Claude Code

Porta su un'altra macchina la configurazione UI, front-end e design del PC principale:

- **Hook di routing:** sui prompt di UI inietta l'elenco di skill e connettori e i documenti di design del progetto.
- **Regole globali:** `frontend-visual-skills.md` e `context7.md`.
- **97 skill:** Impeccable, Taste, UI UX Pro Max, Emil Kowalski, GSAP, transitions.dev, 21st.dev, Superpowers, stop-slop, Three.js e altre.
- **Connettori MCP:** `originkit`, `mobbin`, `ui-layouts-mcp`, `shadcn`, `magicuidesign`, `context7`.
- **Plugin ECC.**

Hook, regole, skill e MCP sono file locali (`~/.claude` e `~/.claude.json`) e non seguono l'account. Arriva da solo solo il connettore 21st.dev, che vive nell'account claude.ai.

Il repo deve restare **privato**: contiene la tua configurazione. Le chiavi invece non ci finiscono: `export.mjs` controlla i file prima di copiarli e si ferma se ne trova una.

## Prima volta sul PC: crea il repo

Già fatto per `GitAlboBis/claude-ui-toolchain`. Serve solo se devi ricrearlo da zero:

```powershell
cd C:\Users\alber\claude-ui-toolchain
git init -b main
node export.mjs
if ($?) { git add -A; git commit -m "toolchain UI di Claude Code"; gh repo create GitAlboBis/claude-ui-toolchain --private --source . --push }
```

## Prima volta sul portatile (Windows ARM64)

1. In PowerShell installa i prerequisiti:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   winget install GitHub.cli
   irm https://claude.ai/install.ps1 | iex
   ```

   Chiudi e riapri PowerShell, poi controlla:

   ```powershell
   node --version
   claude --version
   ```

   Se `claude` non viene riconosciuto, aggiungi al PATH la cartella dell'installazione nativa e riapri PowerShell:

   ```powershell
   [Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'User') + ";$env:USERPROFILE\.local\bin", 'User')
   ```

   Se l'app Claude desktop era aperta durante queste installazioni, chiudila del tutto (anche dall'area di notifica) e riaprila.

2. Scarica il repo e lancia l'installer:

   ```powershell
   gh auth login
   gh repo clone GitAlboBis/claude-ui-toolchain
   cd claude-ui-toolchain
   node install.mjs
   ```

   Ti chiede la chiave di OriginKit e, se vuoi, quella di Context7; mentre la scrivi non compare. Puoi anche impostarle prima con `$env:ORIGINKIT_API_KEY = "..."` e `$env:CONTEXT7_API_KEY = "..."`. Se le lasci vuote, OriginKit si autentica con `/mcp` e Context7 funziona con limiti più bassi.

3. Apri una nuova sessione di Claude Code, lancia `/mcp` e autentica `mobbin` (e `originkit` se non hai dato la chiave).

## Aggiornare dopo una modifica sul PC

Sul PC, i comandi git partono solo se l'export riesce:

```powershell
cd C:\Users\alber\claude-ui-toolchain
node export.mjs
if ($?) { git add -A; git commit -m "aggiorna la toolchain"; git push }
```

Sul portatile:

```powershell
cd claude-ui-toolchain
git pull
node install.mjs
```

Per aggiungere skill, modifica `manifest.json` sul PC prima di lanciare `export.mjs`. Una skill tolta dal manifest sparisce dal repo ma non dal portatile: cancellala a mano da `~/.claude/skills/<nome>`.

Se l'export si ferma per un "segreto" che in realtà è un esempio di documentazione, aggiungi il percorso indicato (per esempio `skills/<nome>/SKILL.md`) alla lista `secretAllowlist` in `manifest.json`.

## Opzioni di install.mjs

| Opzione | Effetto |
|---|---|
| `--dry-run` | mostra cosa farebbe, senza scrivere niente |
| `--yes` | non fa domande: le chiavi si leggono solo dalle variabili d'ambiente |
| `--no-skills`, `--no-mcp`, `--no-ecc` | salta quella parte |
| `--keep-existing-skills` | lascia com'è una skill già presente con contenuto diverso |
| `--force-mcp` | reinstalla i connettori già presenti. Prima salva `.claude.json`, e quella copia contiene le chiavi in chiaro. Un connettore con chiave resta com'è se non ne dai una nuova |
| `--config-dir <cartella>` | installa in un'altra cartella di configurazione, per provare senza toccare quella vera; usa un percorso corto, perché con percorsi molto lunghi il clone di ECC fallisce |

Un'opzione scritta male ferma l'installer invece di essere ignorata.

## Cosa tocca e cosa no

- **Copie di sicurezza:** ogni file o skill che sostituisce finisce prima in `~/.claude/ui-toolchain-backups/<data>/`. Una skill bloccata (terminale o editor aperti nella sua cartella) resta com'era e viene segnalata.
- **`settings.json`:** aggiunge solo la voce dell'hook e lascia il resto com'è.
- **Cosa non copia:** chiavi e token, memoria dei progetti, i server MCP `blender` e `supabase-all`, altri plugin (vercel, supabase, github), connettori claude.ai.
- **Librerie di progetto:** `gsap`, `thinking-orbs` e i componenti shadcn si installano per progetto, non da qui.

## Da sapere

- Impeccable scarica il suo motore al primo uso: su ARM64 prova la build arm64, altrimenti usa quella x64 in emulazione.
- ui-ux-pro-max e motion-framer usano Python 3 per i loro script; la skill lighthouse usa la CLI di Lighthouse.
- L'hook scatta sui prompt di UI; `#design` nel prompt lo forza, `#nodesign` lo salta.
- Mentre registra OriginKit e Context7, la chiave compare per qualche secondo sulla riga di comando di `claude mcp add`; poi resta in `~/.claude.json`, come quando aggiungi un connettore a mano.
