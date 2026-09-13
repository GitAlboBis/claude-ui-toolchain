# Routing UI, front-end e design

Iniettato dall'hook `~/.claude/hooks/ui-design-router.js` perché il prompt riguarda UI, front-end o design.

## Come usarlo

1. In ogni lavoro di UI segui questa checklist con il tool Skill, e per ogni fase scrivi in una riga quali skill usi e perché:
   - **Inizio, direzione:** invoca `impeccable` e leggi i documenti di design elencati in fondo a questo blocco. Aggiungi una skill di stile della tabella solo se il progetto non ha già una direzione scritta.
   - **Costruzione, tecnica:** invoca 1 o 2 skill specifiche della tecnica che userai: `gsap-scrolltrigger` per lo scroll, `transitions-dev` per le transizioni CSS, `threejs-*` per il 3D, e così via.
   - **Prima di ogni componente nuovo:** cercalo nei connettori (21st.dev, Magic UI, ui-layouts, OriginKit, shadcn; Mobbin per i riferimenti) e di' in una riga cosa hai trovato e perché lo usi o no. Adatta quello che prendi ai token del progetto. Per una coreografia o un effetto senza componenti nuovi basta dirlo.
   - **Fine, revisione:** invoca 1 o 2 skill di revisione adatte a ciò che hai toccato: `improve-animations` o `fixing-motion-performance` per il motion, `21st-ui-review` o `baseline-ui` per la UI, `fixing-accessibility` per l'accessibilità. Poi `verification-before-completion`, con verifica nel browser (Browser pane o chrome-devtools), prima di dire che è fatto.
2. Le direttive del progetto battono i gusti di default delle skill. In fondo a questo blocco l'hook elenca i documenti di design trovati nel progetto (DESIGN.md, PRODUCT.md, brand guide, spec di design, token): leggili con Read prima di proporre o scrivere UI, insieme ad AGENTS.md e alla memoria del progetto. Se il cliente ha chiesto poche animazioni, le skill di motion servono a rifinire o a togliere, non ad aggiungere effetti.
3. I tool MCP sono differiti: caricali con ToolSearch (per esempio `+magicuidesign search`) prima di chiamarli.
4. Se una skill o un connettore non c'è in questa sessione (non elencato, MCP non connesso), vai avanti senza e dillo una volta.
5. Il rilevatore di design di Impeccable si attiva per progetto, non a livello globale. Se il lavoro di UI è sostanziale e nel `.claude/settings.local.json` del progetto non c'è un hook di Impeccable, proponi all'utente di attivarlo con la skill `impeccable` e l'argomento `hooks on`. Scrive `.impeccable/` nel progetto, quindi serve il suo sì. La copia globale (4.3 e successive) usa il launcher `scripts/impeccable` (su Windows `impeccable.cmd`), che al primo avvio scarica un binario. Se il progetto ha una sua copia più vecchia di Impeccable in `.claude/skills` o `.agents/skills`, non dare per scontato il launcher: usa `impeccable` con l'argomento `doctor`.

## Skill per fase

| Fase | Skill |
|---|---|
| Direzione e build di UI nuova | `impeccable` (la principale: legge PRODUCT.md e DESIGN.md), `frontend-design`, `design-taste-frontend`, `21st-ui-build`, `ecc:frontend-design-direction` |
| Uno stile preciso | `high-end-visual-design`, `minimalist-ui`, `industrial-brutalist-ui`, `gpt-taste` |
| Varianti da confrontare | `21st-ui-explore`, `design` (canvas), `stitch-design-taste` |
| Redesign e rifinitura dell'esistente | `redesign-existing-projects`, `impeccable` (critique, audit, polish), `emil-design-eng`, `ecc:make-interfaces-feel-better`, `21st-ui-review`, `baseline-ui` |
| Palette, font, dati UX | `ui-ux-pro-max`, `theme-factory` |
| Principi di motion | `emil-design-eng`, `apple-design`, `motion-design`; per dare il nome giusto a un effetto `animation-vocabulary` |
| Motion in CSS | `transitions-dev`, poi `transitions-polish` per durate, easing e stagger; `animate` |
| Motion con GSAP | `gsap-core`, `gsap-react` (`useGSAP`), `gsap-scrolltrigger`, `gsap-timeline`, `gsap-plugins`, `gsap-utils`, `gsap-frameworks`, `gsap-performance`, `awwwards-animations`, `scroll-experience` |
| Motion SVG | `svg-animations` |
| Motion in React | `ecc:motion-foundations`, poi `ecc:motion-patterns` o `ecc:motion-advanced`; `motion-framer`; React Native: `animate-expo` |
| Audit del motion | `improve-animations`, `find-animation-opportunities`, `fixing-motion-performance` |
| 3D e shader | `threejs-*`, `shader-programming-glsl`, `3d-web-experience`, `spline-3d-integration` |
| Componenti da libreria | `shadcn`, `vengeance-ui`, `21st-cli-use`, `ask-sonner` per i toast |
| Design system e DESIGN.md | `impeccable` (document), `design-md`, `ecc:design-system`, `tailwind-design-system`, `tailwind-patterns` |
| Accessibilità e qualità | `fixing-accessibility`, `ecc:accessibility`, `ecc:frontend-a11y`, `web-design-guidelines`, `uxui-principles`, `lighthouse` (audit con la CLI di Lighthouse) |
| Testi dell'interfaccia | `stop-slop`, `avoid-ai-writing` |
| Processo (Superpowers) | `brainstorming` prima di feature o redesign non banali, `writing-plans`, `verification-before-completion` |

Tre skill di Emil Kowalski hanno l'invocazione da parte del modello disattivata, quindi il tool Skill fallisce: proponile all'utente come comando slash.
- `/review-animations`: revisione severa del motion appena scritto.
- `/prototype`: varianti diverse di un pezzo di UI da sfogliare dal vivo.
- `/pick-ui-library`: scelta della libreria giusta per un compito (grafici, toast, drag and drop…).

La famiglia `ui-a11y`, `ui-component`, `ui-page`, `ui-review`… segue le convenzioni StyleSeed: usala solo in progetti StyleSeed.

## Connettori MCP

| Connettore | A cosa serve | Attenzione |
|---|---|---|
| `21st.dev` (connettore claude.ai) | `search`, `search_picker`, `get_inspiration`, `get_theme`, `search_logo` | `get_component` consuma la quota (2 al giorno sul piano free): chiamalo solo su una scelta precisa. Niente tool di publish, edit o delete se non richiesti |
| `magicuidesign` | catalogo Magic UI: `searchRegistryItems`, `getRegistryItem`, `listRegistryItems` | |
| `ui-layouts-mcp` | ui-layouts.com: `search_components`, `get_docs`, `get_component_meta`, `get_source_code` | `get_source_code` restituisce solo il primo file del componente, tagliato a 20.000 caratteri |
| `originkit` | componenti e sezioni animate per React e Framer | piano free: 10 componenti, 10 sezioni e 1 template al giorno per account, contando anche le copie dal sito (reset alle 00:00 IST) |
| `mobbin` | riferimenti da app e siti reali: `search_screens`, `search_flows`, `search_sections` | serve OAuth: se risulta "Needs authentication", chiedi all'utente di lanciare `/mcp` in un terminale `claude` interattivo |
| `shadcn` | `search_items_in_registries`, `view_items_in_registries`, `get_add_command_for_items` | legge i registry dal `components.json` del progetto |
| `context7` | documentazione aggiornata di librerie e CLI | |

## Registry shadcn e librerie

- **Aceternity:** `npx shadcn@latest add @aceternity/<nome>`; il namespace è già nella directory ufficiale. I blocchi Pro rispondono 401, ma anche uno slug sbagliato risponde 401: controlla il nome sulla pagina del componente prima di concludere che è Pro.
- **Beautiful UI:** `@beautifui` = `https://www.beautifului.dev/r/{name}.json`. `registry.json` è un indice: non passarlo a `shadcn add`. `foundation.css` reimporta Tailwind e ridefinisce i token.
- **Vengeance UI:** `@vengeanceui` = `https://raw.githubusercontent.com/Ashutoshx7/VengeanceUI/main/public/r/{name}.json`. Il suo MCP non è pubblicato.
- **Magic UI:** tramite il connettore `magicuidesign`.
- **`thinking-orbs`:** loader animati per interfacce di AI, in React. Si installa nel singolo progetto e si usa da un file `'use client'`.
- **`gsap` e `@gsap/react`** (`useGSAP`): dipendenze del singolo progetto.
- **DESIGN.md di brand famosi:** github.com/VoltAgent/awesome-design-md, una raccolta di file da usare come riferimento (non è una skill).
- **Namespace e `cn`:** vanno dichiarati per progetto in `components.json`. Quasi tutti i componenti importano `cn` da `@/lib/utils`.
- **`npx shadcn init`:** mai in un progetto con CSS curato a mano senza un sì esplicito, perché riscrive `globals.css` e sovrascrive i token di `:root`. Prima di aggiungere un componente, di' quali file e quali dipendenze tocca. Se hai dubbi su un comando della CLI shadcn, verificalo con context7.
