# Lineage

An evolution RTS with inherited discoveries, branching civilizations, and browser-first mobile and desktop play.

**Ancestors discover something; later generations discover what else it can do.**

This repository contains the first playable vertical slice, **The First Winter** (see [`lineage-rts-concept.md`](lineage-rts-concept.md) for the design and [`CLAUDE.md`](CLAUDE.md) for the development brief).

## Play it

```bash
npm install
npm run dev          # http://localhost:5173 (also reachable from a phone on your LAN with `npm run dev -- --host`)
```

Pick a species, press **Begin**. A "How to play" card appears on first launch and is always available from the menu.

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
| Camera | One-finger drag pans, pinch zooms | Wheel zoom; middle/right drag, WASD, arrows or screen edge pan |
| Build | **Build** → choose → drag the ghost → **Place** | **Build** (`B`) → choose → click to place (palisades keep placing; `Esc` cancels) |
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

* **Stack:** TypeScript + Vite, HTML5 Canvas 2D for rendering, plain DOM for the HUD. No runtime dependencies (≈ 34 kB gzipped JS). Vitest for tests.
* **Simulation is separate from rendering.** `src/sim/*` is a deterministic fixed-step (20 Hz), seeded, JSON-serializable simulation with no DOM access; it runs headlessly in tests. `src/render/*` draws a `World`; `src/ui/*` is input, HUD and the game loop.
* **Data-driven content:** units (`src/data/units.ts`), buildings (`src/data/buildings.ts`) and the discovery network (`src/data/discoveries.ts`) are tables; objectives live in `src/sim/objectives.ts`.
* **Saves:** `localStorage` (manual + autosave slots) in a versioned envelope `{format:"lineage-rts-save", version:1, world}`; export/import as a JSON file. Loading validates structure, version and entity ids, and reports errors instead of crashing (see `src/sim/save.ts`).

```
src/
  data/      units, buildings, discoveries (data tables)
  sim/       world, step, units (orders/combat/gathering), econ, discovery, succession, ai, fog, grid (A*), save
  render/    camera, canvas renderer + minimap
  ui/        game loop, input (mouse/touch), HUD and panels
tests/       vitest: rules, save/load, and full scripted playthroughs
scripts/     e2e.cjs (Playwright browser check)
```

### How the premise is modelled

* **Observe → Investigate → Apply → Preserve** is shown for every discovery in the Discoveries panel, including *why* something is blocked (missing clue, building, resource…).
* Clues come from play: delivering food (Cooking), hunting or reaching winter (Smoke preservation), a scout visiting the Ember Cave (Portable fire), and knowing Cooking + Portable fire (Controlled heat, investigable only in a later generation).
* Effects: **Cooking** +25% food value · **Smoke preservation** unlocks racks → non-spoiling provisions that feed expeditions · **Portable fire** wolves flee from torch-bearers and leave nearby workers alone · **Controlled heat** +25% weapon damage.
* **Inheritance:** buildings, stores, and territory carry over. *Preserved* discoveries persist; *known-but-untaught* ones fade (60% cheaper to relearn). A child discovery of a preserved parent is 30% cheaper and faster in generation 2. Successor traits and a lineage list are tracked.

## What was verified, and how

Verified in this environment (Linux, headless **Chromium 141 via Playwright**):

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | clean |
| `npm test` — 17 tests: economy, building, training, orders, hit-testing, discovery/teaching/succession, save round-trip and invalid-save rejection, discovery effects, winter spoilage, racks, wolves vs torches, truce, outpost rules, determinism | pass |
| Scripted-bot full playthrough (`tests/playthrough.test.ts`): gather → build → discover → teach → survive winter → succeed → expedition → victory, for **both** species | wins at ≈ 13.6 min and ≈ 21 min of game time |
| Browser flow `scripts/e2e.cjs` — 43 checks through the real input path: start, select, order gather, build panel + placement, construction, training, discovery panel + investigation, pause/speed, save → mutate → load, corrupt-save handling, winter, succession dialog, victory screen, restart, box-select, wheel/pinch zoom, one-finger pan, drag-select mode, no console errors | 43 / 43 pass (3 consecutive runs) |

Viewports exercised: **desktop 1280×800 (mouse)** and **phone landscape 844×390 @2× (touch)**.

> **Mobile testing here is simulated.** The phone runs use Chromium's touch/viewport *emulation* (touch events injected over CDP), **not a physical device**. Real-device behaviour — iOS Safari / Android Chrome performance, safe-area insets, gesture conflicts with browser chrome, thermal throttling — is **untested**. Firefox and desktop Safari are also untested. Per the concept doc, minimum supported browsers/hardware should be defined only after measuring on real devices.

## Implemented vs. the brief

Implemented: camera (pan/zoom/minimap), selection and orders (move, attack-move, attack, gather, build, hold, stop, retreat, leader rally), gathering and four resources (+ provisions), 8 placeable buildings plus the hearth (shelter, stockpile, toolmaking shelter, hunting lodge, teaching circle, smoking rack, watch post, palisade), six unit roles, training queues and population cap, fog of war, wildlife (deer, wolves), a rival AI clan (garrison at the pass + periodic warbands + gift/truce), winter pressure (spoilage, cold, hunger), the fire discovery tree, one succession with inheritance, objectives/hints, victory/defeat, pause/restart/speed, versioned local save/load + export/import, species choice (modest, explained differences).

Known limitations / not yet done:

* No **gate** (palisades block everyone, including your own units); no patrol / follow / focus-target commands, formations, squad stances or morale; no close battle camera; no audio.
* Rival AI is scripted and simple (no real economy; it ignores fog); trade is a single gift action.
* Apprenticeship is simplified to a *Teach* activity at a Teaching circle; individual specialist death does not yet cause knowledge loss mid-generation.
* Only one succession (gen 1 → 2); the second winter is mild; balance has been tuned with scripted bots, not human playtesting.
* Visuals are deliberately simple placeholders (shapes and letters). Units never collide, they only softly separate.
* Not tested on real phones/tablets; performance there has not been measured (population is small — rival capped at 22, no hard cap on yours beyond housing).
