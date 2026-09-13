For any front-end, UI, or visual / creative-coding task, ALWAYS pick the relevant skills and invoke them via the Skill tool BEFORE writing code or starting work. Do this even for libraries you think you know well.

This applies to front-end work in general (HTML/CSS, React, Vue, Svelte, Angular, Next.js, components, layout, styling, accessibility, performance) and ESPECIALLY to visual design, animation, graphics, and creative-coding libraries, including but not limited to:

- 3D / WebGL / WebGPU: Three.js, WebGL, WebGPU, shaders / GLSL, Spline, Babylon.js
- Animation / motion: GSAP, Motion (Framer Motion), CSS transitions, anime.js, Remotion, scroll-driven animation, Makepad/Robius motion
- Data viz / generative / canvas: D3, canvas, Plotly, algorithmic & generative art
- Design systems / UI quality: Tailwind, shadcn and its registries (Aceternity, Beautiful UI, Vengeance UI, Magic UI), Radix, design tokens, DESIGN.md, high-end visual design

## The routing table

The full skill-by-stage and connector table is `ui-design-routing.md`. A UserPromptSubmit hook injects it automatically when a prompt looks like UI, front-end or design work; `#design` in a prompt forces it and `#nodesign` skips it. On the main PC hook and table live in `~/.claude/hooks/` (registered in `~/.claude/settings.json`). On other machines they come from the `ui-design` plugin (`hooks/ui-design-routing.md` inside its folder under `~/.claude/plugins/cache/`), and there the skills carry the `ui-design:` prefix and the MCP servers are named `plugin:ui-design:<name>`. The hook's keyword matching misses some terse feedback prompts, so this rule is the safety net: if the task is front-end work and the table is not in context, Read it before starting.

Core skills: `impeccable`, `frontend-design`, `design-taste-frontend` and the other Leonxlnx taste skills, `ui-ux-pro-max`, Emil Kowalski's skills (`emil-design-eng`, `improve-animations`, `apple-design`, `animate`, …), `transitions-dev` and `transitions-polish`, the `21st-ui-*` skills, the `gsap-*` skills, `vengeance-ui`, `shadcn`, `stop-slop`, and the Superpowers process skills (`brainstorming`, `writing-plans`, `verification-before-completion`). Specific skills (`threejs-shaders`, `gsap-scrolltrigger`) beat generic ones. `review-animations`, `prototype` and `pick-ui-library` have model invocation disabled: suggest them to the user as slash commands instead of calling them. The `ui-a11y` / `ui-component` / `ui-page` family follows StyleSeed conventions: use it only in StyleSeed projects.

MCP connectors for UI work: `21st.dev` (claude.ai connector), `magicuidesign`, `ui-layouts-mcp`, `originkit`, `mobbin`, `shadcn`, plus `context7` for docs. Their tools are deferred: load them with ToolSearch before calling.

## How to apply

1. Pick 1–3 skills that fit the stage of the work and say in one line which ones and why. If none clearly match, say so and proceed.
2. Project direction beats skill defaults: DESIGN.md, PRODUCT.md, CLAUDE.md / AGENTS.md and project memory win over any skill's taste (for example a client who asked for few animations).
3. Search the component connectors before hand-writing a component that likely exists, then adapt what you take to the project's tokens.
4. This complements the Context7 rule: Context7 for up-to-date library docs and API surface, skills for technique, patterns, and visual quality.
