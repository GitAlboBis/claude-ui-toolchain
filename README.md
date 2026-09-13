# Toolchain UI di Claude Code

Questo repo è un marketplace privato di Claude Code con un plugin, `ui-design`, che contiene:

- **Hook di routing:** sui prompt di UI inietta l'elenco di skill e connettori e i documenti di design del progetto; `#design` lo forza, `#nodesign` lo salta.
- **97 skill:** Impeccable, Taste, UI UX Pro Max, Emil Kowalski, GSAP, transitions.dev, 21st.dev, Superpowers, stop-slop, Three.js e altre.
- **Connettori MCP:** `originkit`, `mobbin`, `ui-layouts-mcp`, `shadcn`, `magicuidesign`, `context7`.

L'installer aggiunge anche il plugin ECC e le regole globali (`frontend-visual-skills.md`, `context7.md`), che un plugin non può contenere.

Il repo deve restare **privato**: contiene la tua configurazione. Le chiavi non ci finiscono: `export.mjs` controlla i file prima di copiarli e si ferma se ne trova una.

## Sul portatile (Windows ARM64)

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

2. Dai a git l'accesso al repo privato:

   ```powershell
   gh auth login
   gh auth setup-git
   ```

3. Scarica il repo e lancia l'installer:

   ```powershell
   gh repo clone GitAlboBis/claude-ui-toolchain
   cd claude-ui-toolchain
   node install.mjs
   ```

   Ti chiede la chiave di OriginKit (necessaria: senza, il connettore risponde 401) e, se vuoi, quella di Context7; mentre la scrivi non compare. Puoi anche impostarle prima con `$env:ORIGINKIT_API_KEY = "..."` e `$env:CONTEXT7_API_KEY = "..."`. Claude Code le conserva nelle sue credenziali, non in `settings.json`.

4. Apri una nuova sessione di Claude Code, lancia `/mcp` e autentica `plugin:ui-design:mobbin`. Se ECC lo chiede, lancia `/plugin configure ecc@ecc`.

## Il prefisso del plugin

Sul portatile le skill arrivano dal plugin e hanno il suo prefisso: `ui-design:impeccable`, `ui-design:emil-design-eng`, e come comando slash `/ui-design:review-animations`. I connettori si chiamano `plugin:ui-design:<nome>`. L'hook lo dice a Claude da solo, quindi le skill vengono scelte e invocate lo stesso.

## Aggiornare

Sul PC, dopo una modifica a hook, elenco, skill o manifest. I comandi git partono solo se l'export riesce, e l'export alza la versione del plugin:

```powershell
cd C:\Users\alber\claude-ui-toolchain
node export.mjs
if ($?) { git add -A; git commit -m "aggiorna la toolchain"; git push }
```

Sul portatile non serve niente: il marketplace ha l'aggiornamento automatico, quindi Claude Code scarica la versione nuova al primo avvio. Per averla subito:

```powershell
claude plugin marketplace update claude-ui-toolchain
```

Le regole globali non sono nel plugin: se cambiano, sul portatile lancia `git pull` e poi di nuovo `node install.mjs`.

- **Cambiare le chiavi:** `/plugin configure ui-design@claude-ui-toolchain`.
- **Spegnere il plugin:** `/plugin`, oppure `claude plugin disable ui-design@claude-ui-toolchain`.
- **Aggiungere o togliere skill:** modifica `manifest.json` sul PC prima di `export.mjs`.
- **Falso allarme di "segreto":** se l'export si ferma su un esempio di documentazione, aggiungi il percorso indicato (per esempio `plugins/ui-design/skills/<nome>/SKILL.md`) a `secretAllowlist` in `manifest.json`.

## Sul PC principale

Il PC resta com'è: hook, elenco e skill stanno in `~/.claude` e sono la fonte da cui `export.mjs` costruisce il plugin. Non installare il plugin sul PC: l'hook scatterebbe due volte e ogni skill comparirebbe con e senza prefisso. Se succede, l'installer lo segnala.

## Ricreare il repo da zero (sul PC)

```powershell
cd C:\Users\alber\claude-ui-toolchain
git init -b main
node export.mjs
if ($?) { git add -A; git commit -m "toolchain UI di Claude Code"; gh repo create GitAlboBis/claude-ui-toolchain --private --source . --push }
```

## Opzioni di install.mjs

| Opzione | Effetto |
|---|---|
| `--dry-run` | mostra cosa farebbe, senza scrivere niente |
| `--yes` | non fa domande: le chiavi si leggono solo dalle variabili d'ambiente |
| `--no-rules`, `--no-ecc` | salta quella parte |
| `--local-marketplace` | usa questa cartella come marketplace invece del repo su GitHub; serve per le prove, e così gli aggiornamenti non arrivano da GitHub |
| `--config-dir <cartella>` | installa in un'altra cartella di configurazione, per provare senza toccare quella vera; usa un percorso corto, perché con percorsi molto lunghi il clone di ECC fallisce |

Un'opzione scritta male ferma l'installer invece di essere ignorata.

## Cosa tocca e cosa no

- **`settings.json`:** il marketplace e l'attivazione del plugin li registra il comando `claude plugin`. L'installer aggiunge solo `autoUpdate` al marketplace, dopo averne salvato una copia in `~/.claude/ui-toolchain-backups/<data>/`.
- **Cosa non copia:** memoria dei progetti, i server MCP `blender` e `supabase-all`, altri plugin (vercel, supabase, github), connettori claude.ai.
- **Librerie di progetto:** `gsap`, `thinking-orbs` e i componenti shadcn si installano per progetto, non da qui.

## Da sapere

- I connettori `ui-layouts-mcp`, `shadcn` e `magicuidesign` partono con `cmd /c npx`: il plugin è pensato per Windows.
- Impeccable scarica il suo motore al primo uso: su ARM64 prova la build arm64, altrimenti usa quella x64 in emulazione.
- ui-ux-pro-max e motion-framer usano Python 3 per i loro script; la skill lighthouse usa la CLI di Lighthouse.
- Durante l'installazione la chiave compare per qualche secondo sulla riga di comando di `claude plugin install`.
