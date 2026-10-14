# Lineage

An evolution RTS with inherited discoveries, branching civilizations, and browser-first mobile and desktop play.

**Ancestors discover something; later generations discover what else it can do.**

This repository contains the first playable vertical slice, **The First Winter** (see [`lineage-rts-concept.md`](lineage-rts-concept.md) for the design and [`CLAUDE.md`](CLAUDE.md) for the development brief).

## Play it

```bash
npm install
npm run dev          # http://localhost:5173 (also reachable from a phone on your LAN with `npm run dev -- --host`)
```

Press **New Campaign**, choose a clan (Humans or Neanderthals) and **Begin**. A "How to play" card appears on first launch and is always available from the menu.

### The scenario (≈ 20–30 minutes)

1. **Generation 1.** Gather food and wood, build a stockpile, toolmaking shelter and hunting lodge, send a scout to the Ember Cave, and investigate discoveries. Winter arrives at 7:00: loose food rots, units away from warmth take cold damage, wolves and a rival clan raid you.
2. Discover **smoke preservation**, build **smoking racks** (food → provisions that never spoil) and **teach** the discovery at a **Teaching circle** so it survives succession.
3. Survive until spring (12:00), review inheritance, and choose a **successor** (logistics / recon / teaching).
4. **Generation 2.** The settlement, stores and *preserved* discoveries are inherited (un-taught ones fade and must be relearned at 40% cost). Stock 60 provisions and raise an **outpost at the Far Meadow** beyond the valley (victory). Beyond your *supply range* (dotted rings) units burn provisions or take exposure damage. The quiet north ford has wolves; the direct pass is held by the rival clan — fight, sneak, or **gift** them food for three minutes of peace.

Defeat: the clan hearth is destroyed or everyone dies.

### Controls

| Action | Touch | Mouse / keyboard |
|---|---|---|
| Select | Tap unit/building; double-tap = all of that type on screen; **Drag-select** toggle for box select; *Idle* / *Army* buttons | Click; drag box; Ctrl+1–9 sets / 1–9 recalls groups; `.` idle gatherer |
| Order | With units selected, tap: ground = move, tree/berry/rock = gather, enemy = attack, building site = build | Right-click (same contexts); or press **Move / Attack** then left-click; `M` `A` `H` `S` `R` |
| Camera | One-finger drag pans, pinch zooms (tilted 3D view) | Wheel zoom; middle/right drag, WASD, arrows or screen edge pan |
| Build | **Build** (right dock) → choose → drag the ghost → **Place** | **Build** (`B`) → choose → click to place (palisades keep placing; `Esc` cancels) |
| Other | Jobs popover, Discoveries (`D`), Pause/speed 1–3×, Menu (save/load/export/import/restart) | `Space` pause |

Mouse users are never forced to right-click, and nothing relies on hover. While placing a building, dragging moves the ghost instead of panning.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` (Node ≥ 18) |
| Development server | `npm run dev` |
| Type-check | `npm run typecheck` |
| Unit / simulation tests | `npm test` |
| Production build | `npm run build` → static site in `dist/` |
| Preview the production build | `npm run preview` |
| Browser end-to-end check | `node scripts/e2e.cjs http://localhost:4173/ ./shots` (needs `playwright` + a Chromium; set `CHROMIUM_PATH` if it is not on Playwright's default path) |

## Deploy to Vercel

The app is a static Vite build; `vercel.json` already describes it (framework `vite`, `npm run build`, output `dist`, immutable caching for hashed assets).

* **Dashboard:** *Add New → Project → import `mosrvs2025/lineage-rts`* and press Deploy. No environment variables are needed. Every push then deploys a preview; the default branch deploys to production.
* **CLI:** `npm i -g vercel && vercel` (preview) or `vercel --prod`.

> Status: the production build and `vite preview` of that exact output were verified locally, but **no deployment has been made from this environment** (no Vercel credentials were available), so there is no live URL yet.

## Technology and architecture

* **Stack:** TypeScript + Vite; **Three.js (WebGL)** for a tilted-perspective 3D view; plain DOM for the HUD and a 2D overlay canvas for health bars and order lines. No image assets: terrain texture, height field and all models (low-poly trees, tents, longhouse, watch tower, people, deer, wolves) are generated in code (`src/render/art.ts`, `models.ts`). Vitest for tests.
* **Simulation is separate from rendering.** `src/sim/*` is a deterministic fixed-step (20 Hz), seeded, JSON-serializable simulation with no DOM access; it runs headlessly in tests. `src/render/*` draws a `World` in 3D (it never changes it); `src/ui/*` is input, HUD and the game loop.
* **Data-driven content:** units (`src/data/units.ts`), buildings (`src/data/buildings.ts`) and the discovery network (`src/data/discoveries.ts`) are tables; objectives live in `src/sim/objectives.ts`.
* **Saves:** `localStorage` (manual + autosave slots) in a versioned envelope `{format:"lineage-rts-save", version:1, world}`; export/import as a JSON file. Loading validates structure, version and entity ids, and reports errors instead of crashing (see `src/sim/save.ts`).

```
src/
  data/      units, buildings, discoveries (data tables)
  sim/       world, step, units (orders/combat/gathering), econ, discovery, succession, ai, fog, grid (A*), save
  render/    perspective camera, Three.js renderer, procedural terrain + models, minimap
  ui/        game loop, input (mouse/touch), HUD and panels
tests/       vitest: rules, save/load, and full scripted playthroughs
scripts/     e2e.cjs (Playwright browser check)
```

### Interface

An RTS-style console: resource plates with live flashes and low-food warnings, a season medallion with a winter timeline, a quest-style objectives tracker with contextual hints, a minimap in an ornate frame, a selection panel (portrait, health, status, training queue, grouped multi-select), a contextual **command card** of icon buttons with hotkeys, costs and tooltips (desktop), a tool dock (Build, Discover, Jobs, Idle, Army, Select, Home, Gift), a visual construction menu, a **discovery tech tree** (Observe → Investigate → Apply → Preserve), screen-edge alert flashes when you are attacked, and a cinematic title screen over a live orbiting 3D camera. Sound effects and ambient wind are synthesized in code (no audio files); the speaker button mutes.

### Upgrades, units and research

* **Building upgrades** (select a finished building → gold button on the command card; data in `src/data/buildings.ts` `upgrades`): Hearth → Great hearth → Clan hall (housing, warmth, knowledge; gated by Cooking / Smoke preservation) · Shelter → Longhouse · Stockpile → Storehouse (winter spoilage −45%) · Toolshelter → Flint workshop → Hafting bench · Hunting lodge → War lodge (unlocks Champions) · Teaching circle → Elders' circle (research ×1.5, +knowledge) · Smoking rack → Smokehouse (6 food → 9 provisions) · Watch post → Archer post → Great tower (the post shoots enemies) · Palisade → Reinforced. Upgraded buildings get new 3D models, and cancelling refunds 75%.
* **New units** (`src/data/units.ts`): **Elder** (heals nearby clan members, speeds research) · **Slinger** (human ranged skirmisher) · **Brute** (Neanderthal heavy, crushes buildings) · **Champion** (elite spearman, needs a War lodge). Each has its own model and attack animation.
* **Research** (`src/data/techs.ts`): Woven baskets, Flint-edged weapons, Hide armour, Fleet-footed, Herbal remedies, Fur wraps — researched at the building that owns them; effects are read by the simulation.
* **Veterancy:** fighters earn Veteran (3 kills) and Elite (7 kills) ranks with more damage and health, shown as chevrons.

### Phone portrait layout

On narrow portrait screens (≤ 560 px wide) the interface switches to a thumb-friendly layout: resources on one row, clock and controls on the next; the dock becomes a single **action bubble** you can drag anywhere (position remembered) that fans its eight actions out in an arc that always stays on screen; and the selection + commands live in a **floating card** with a drag handle, a *pin* (keeps it open with nothing selected) and a *fold* button. Construction sites show a ground progress ring, dust and wood chips; upgrades and research show their own rings. Landscape phones and desktop keep the classic console.

### Atmosphere

Slow cloud shadows drift across the land, and a screen-space sun-shaft pass adds light streaks at dawn and dusk on the high quality tier. Soft contact shadows ground trees, rocks, buildings and people. Unexplored land is veiled by drifting animated mist (a fog-of-war shader with moving noise) rather than flat black, an open sea surrounds the island, and **footpaths** wear into the grass wherever your clan walks (a render-only wear texture the ground shader reads; it is not saved).

### How the premise is modelled

* **Observe → Investigate → Apply → Preserve** is shown for every discovery in the Discoveries panel, including *why* something is blocked (missing clue, building, resource…).
* Clues come from play: delivering food (Cooking), hunting or reaching winter (Smoke preservation), a scout visiting the Ember Cave (Portable fire), and knowing Cooking + Portable fire (Controlled heat, investigable only in a later generation).
* Effects: **Cooking** +25% food value · **Smoke preservation** unlocks racks → non-spoiling provisions that feed expeditions · **Portable fire** wolves flee from torch-bearers and leave nearby workers alone · **Controlled heat** +25% weapon damage.
* **Inheritance:** buildings, stores, and territory carry over. *Preserved* discoveries persist; *known-but-untaught* ones fade (60% cheaper to relearn). A child discovery of a preserved parent is 30% cheaper and faster in generation 2. Successor traits and a lineage list are tracked.

## What was verified, and how

Verified in this environment (Linux, headless **Chromium 141 via Playwright**, WebGL provided by software SwiftShader — no GPU):

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | clean |
| `npm test` — 24 tests (7 new for upgrades, unit gating, elders, research, archer posts and veterancy): economy, building, training, orders, hit-testing, discovery/teaching/succession, save round-trip and invalid-save rejection, discovery effects, winter spoilage, racks, wolves vs torches, truce, outpost rules, determinism | pass |
| Scripted-bot full playthrough (`tests/playthrough.test.ts`): gather → build → discover → teach → survive winter → succeed → expedition → victory, for **both** species | wins at ≈ 13.6 min and ≈ 21 min of game time |
| Browser flow `scripts/e2e.cjs` — 43 checks through the real input path: start, select, order gather, build panel + placement, construction, training, discovery panel + investigation, pause/speed, save → mutate → load, corrupt-save handling, winter, succession dialog, victory screen, restart, box-select, wheel/pinch zoom, one-finger pan, drag-select mode, no console errors | 43 / 43 pass on the 3D renderer (one earlier run timed out only because two heavy jobs were sharing the software-rendered browser; the clean re-run passed). The run takes several minutes because 3D is drawn in software here |

Viewports exercised: **desktop 1280×800 (mouse)** and **phone landscape 844×390 @2× (touch)**.

> **Mobile testing here is simulated.** The phone runs use Chromium's touch/viewport *emulation* (touch events injected over CDP), **not a physical device**. Real-device behaviour — iOS Safari / Android Chrome performance, safe-area insets, gesture conflicts with browser chrome, thermal throttling — is **untested**. Firefox and desktop Safari are also untested. Per the concept doc, minimum supported browsers/hardware should be defined only after measuring on real devices.

## Implemented vs. the brief

Implemented: camera (pan/zoom/minimap), selection and orders (move, attack-move, attack, gather, build, hold, stop, retreat, leader rally), gathering and four resources (+ provisions), 8 placeable buildings plus the hearth (shelter, stockpile, toolmaking shelter, hunting lodge, teaching circle, smoking rack, watch post, palisade), six unit roles, training queues and population cap, fog of war, wildlife (deer, wolves), a rival AI clan (garrison at the pass + periodic warbands + gift/truce), winter pressure (spoilage, cold, hunger), the fire discovery tree, one succession with inheritance, objectives/hints, victory/defeat, pause/restart/speed, versioned local save/load + export/import, species choice (modest, explained differences).

Known limitations / not yet done:

* The upgrade / unit / research systems are covered by unit tests and a visual check in headless Chromium. The scripted bot uses archer posts, upgrades and research, and the rival fortifies its watch post (≈ 8 min) and fields Slingers/Brutes/Champions later; costs and difficulty are only bot-tuned, not human-playtested.

* No **gate** (palisades block everyone, including your own units); no patrol / follow / focus-target commands, formations, squad stances or morale; no close battle camera; no audio.
* Rival AI is scripted and simple (no real economy; it ignores fog); trade is a single gift action.
* Apprenticeship is simplified to a *Teach* activity at a Teaching circle; individual specialist death does not yet cause knowledge loss mid-generation.
* Only one succession (gen 1 → 2); the second winter is mild; balance has been tuned with scripted bots, not human playtesting.
* Art is procedural, not hand-drawn; characters are small canvas-drawn figures with simple walk/work/attack animation. Units never collide, they only softly separate.
* The game now **requires WebGL** (a clear message is shown if it is unavailable). Real-GPU and phone performance is **unmeasured** — this environment only has software rendering, which is far slower than hardware. Render resolution is capped at 1.5× device pixels, shadow maps shrink on small screens, and the bundle is ≈ 617 kB (≈ 160 kB gzipped) because of Three.js.
* Not tested on real phones/tablets; performance there has not been measured (population is small — rival capped at 22, no hard cap on yours beyond housing).
