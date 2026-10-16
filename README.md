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

* **Stack:** TypeScript + Vite; **Three.js (WebGL)** for a tilted-perspective 3D view; plain DOM for the HUD and a 2D overlay canvas for health bars and order lines. Terrain texture, height field and environment models (low-poly trees, tents, longhouse, watch tower, people, deer, wolves) are generated in code (`src/render/art.ts`, `models.ts`). Vitest for tests.
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

### Clans and maps

Pick a clan and a land on the new-game screen (data in `src/data/species.ts` and `src/data/maps.ts`):

* **Humans** — gatherers +10%; unique **Slinger**. **Neanderthals** — sturdier fighters, −35% cold damage; unique **Brute**. **Denisovans** — stone and wood +20%, −20% cold, +1 sight; unique **Stalker** (fast javelin hunter). Each has its own look, voice pitch and default rival.
* **Ember Valley** (Standard): the original winding river, defended pass and autumn woods.
* **Glasswater** (Harsh): a huge lake splits the land into two narrow shore lanes. Winter comes early; the lake **freezes solid** so you can cross the ice, and so can the rival (and when spring comes the ice breaks and anyone still on it is pushed ashore and hurt). Ice-fishing spots ring the shore.
* **The Isles** (Gentle): an archipelago joined by shallow causeways. Every route is a chokepoint, **fishing spots** give food that regenerates forever, and the rival moves slower.
* **Mammoth Canyon** (Deadly): red-rock canyons around a central basin. **Mammoths** graze there: peaceful until struck, then a stampede (380 HP, 22 damage); one carcass is 260 food.

Each map has its own generator (`src/sim/mapgen.ts`), start positions and landmarks (`src/data/maps.ts`), terrain palette and tree mix. Rules that apply everywhere: you can't build on a spot nobody can reach, can't wall your own camp in, units trapped by new construction are lifted out, trained units never spawn on a sealed ledge, and an unfinished building with no builder for 6 seconds recruits the nearest free gatherer. Resources never block the routes between camps and landmarks.

### Upgrades, units and research

* **Building upgrades** (select a finished building → gold button on the command card; data in `src/data/buildings.ts` `upgrades`): Hearth → Great hearth → Clan hall (housing, warmth, knowledge; gated by Cooking / Smoke preservation) · Shelter → Longhouse · Stockpile → Storehouse (winter spoilage −45%) · Toolshelter → Flint workshop → Hafting bench · Hunting lodge → War lodge (unlocks Champions) · Teaching circle → Elders' circle (research ×1.5, +knowledge) · Smoking rack → Smokehouse (6 food → 9 provisions) · Watch post → Archer post → Great tower (the post shoots enemies) · Palisade → Reinforced. Upgraded buildings get new 3D models, and cancelling refunds 75%.
* **New units** (`src/data/units.ts`): **Elder** (heals nearby clan members, speeds research) · **Slinger** (human ranged skirmisher) · **Brute** (Neanderthal heavy, crushes buildings) · **Champion** (elite spearman, needs a War lodge). Each has its own model and attack animation.
* **Research** (`src/data/techs.ts`): Woven baskets, Flint-edged weapons, Hide armour, Fleet-footed, Herbal remedies, Fur wraps — researched at the building that owns them; effects are read by the simulation.
* **Veterancy:** fighters earn Veteran (3 kills) and Elite (7 kills) ranks with more damage and health, shown as chevrons.

### Phone portrait layout

On narrow portrait screens (≤ 560 px wide), an always-visible action dock sits at the bottom safe area. Selection details and common unit commands sit immediately above it; Move, Work/Attack, Build, Stop, Retreat and leader Rally remain visible as appropriate. **More** reveals advanced Queue, Hold and Patrol actions. Building training/upgrade actions are always available when a building is selected. Camera insets and the minimap account for the current selection card height. Older saved floating-card positions no longer move these core controls; Jobs and Objectives can still be repositioned. Landscape and desktop keep the classic console.

Resource counters are tappable buttons opening live summary sheets. Food shows gathered/harvested rate (before cooking bonuses), meal demand, workers and spoilage; all resources show stored stock and recent net stock change. Rates use simulation time and reset on load/rewind. Population opens housing/worker totals, season opens timing and winter rules, and the idle counter cycles individual idle gatherers. Counter buttons remain mounted across updates to preserve focus.

### Command conveniences (Warcraft-style)

* **Rally points** — select a hearth, lodge or circle and press *Rally* (Y) then tap the map, or simply right-click: recruits walk there; rally onto a tree, bush or rock and new gatherers go straight to work. The flag and its trail show while the building is selected.
* **Attack alerts** — when anything of yours is hit, the minimap pulses red at the spot and an *Under attack* button appears; tap it or press **F** to jump there.
* **Order queue** — hold **Shift** (or toggle *Queue* on touch) to chain orders; queued waypoints show as a numbered trail. A plain order replaces the queue.
* **Patrol** (P, then a point) — fighters walk back and forth, engaging anything on the way.
* **Health bars** — smart by default (selected or wounded); hold **Alt** to see every bar, or set *Always* in Settings.
* **Cooldown spirals** on the leader's Rally and on training buttons; a badge counts queued recruits.
* **Unit voices** — short spoken acknowledgements on select and order via the browser's speech synthesis (deeper for Neanderthals; click a unit too often and it complains). Toggle in Settings.
* **Control groups** — Ctrl+1–9 to set, 1–9 to select, press twice quickly to centre the camera on the group.
* Windows: Jobs and Objectives can be dragged, pinned/minimised and closed; the selection card has a Clear button; a map tap while a menu is open only dismisses it.

### Atmosphere

Slow cloud shadows drift across the land, and a screen-space sun-shaft pass adds light streaks at dawn and dusk on the high quality tier. Soft contact shadows ground trees, rocks, buildings and people. Unexplored land is veiled by drifting animated mist (a fog-of-war shader with moving noise) rather than flat black, an open sea surrounds the island, and **footpaths** wear into the grass wherever your clan walks (a render-only wear texture the ground shader reads; it is not saved).

### How the premise is modelled

* **Observe → Investigate → Apply → Preserve** is shown for every discovery across three eras in the Discoveries panel, including *why* something is blocked (missing clue, generation gate, building, resource…) and which unit is the current **specialist** for unpreserved knowledge.
* **Three-Era Discovery Network:**
  * **Era I — Foundational Knowledge (Gen 1+):** **Smoke preservation** (unlocks smoking racks → non-spoiling provisions), **Cooking** (+25% delivered food value), **Portable fire** (wolves flee from torch-bearers and leave nearby workers alone).
  * **Era II — Lineage Expansion (Gen 2+):** **Controlled heat** (+25% weapon damage), **Pottery** (−60% winter food spoilage, +6 supply range, +2 provisions per smoking rack batch), **Seed cultivation** (unlocks buildable **Crop fields** that harvest food every 5s and doubles berry bush regrowth), **Reed & dugout boats** (+40% movement speed along shorelines/fords, +50% fishing rate, −35% expedition provision burn).
  * **Era III — Ancestral Mastery (Gen 3+):** **High-heat kilns** (+35% building max HP, +3 warmth radius, +30% Watch tower damage), **Seasonal irrigation** (Crop fields yield +60% and suffer no winter penalty, +25% food gathering rate, 2.5× berry bush regrowth).
* **Specialist Knowledge Risk:** When a gatherer completes an investigation, they become that discovery's **specialist** (marked with a golden badge in the HUD and Discoveries panel). If that specialist dies before the discovery is **preserved** at a Teaching circle, the knowledge immediately **fades** and must be relearned at 40% cost.
* **Multi-Generational Inheritance (Gen 1 → 2 → 3+):** Buildings, stores, and territory carry over across generations, and players can continue past victory into **Generation III+** (`Continue into Gen III+`). *Preserved* discoveries persist; *known-but-untaught* ones fade. Preserving parent discoveries grants a 30% ancestral mastery discount (`0.7×`) in Gen 2+, and preserving both parent and grandparent discoveries grants a **45% deep ancestral mastery discount (`0.55×`)** in Gen 3+, alongside cumulative ancestral lineage bonuses (logistics, reconnaissance, and teaching).

## What was verified, and how

Verified in this environment (Linux, headless **Chromium 141 via Playwright**, WebGL provided by software SwiftShader — no GPU):

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | clean |
| `npm test` — 43 tests (covering economy, building, training, orders, hit-testing, discovery/teaching/succession, specialist knowledge risk, Gen 3+ & deep ancestral mastery, pottery/farming/boats/kiln/irrigation effects, upgrades, unit gating, elders, research, archer posts, veterancy, save round-trip, and full bot playthroughs): | pass |
| Scripted-bot full playthroughs on every map and all three clans (`tests/playthrough.test.ts`): gather → build → discover → teach → survive winter → succeed → expedition → victory, for **both** species | wins at ≈ 13.6 min and ≈ 21 min of game time |
| Browser flow `scripts/e2e.cjs` — 43 checks through the real input path: start, select, order gather, build panel + placement, construction, training, discovery panel + investigation, pause/speed, save → mutate → load, corrupt-save handling, winter, succession dialog, victory screen, restart, box-select, wheel/pinch zoom, one-finger pan, drag-select mode, no console errors | 43 / 43 pass on the 3D renderer (one earlier run timed out only because two heavy jobs were sharing the software-rendered browser; the clean re-run passed). The run takes several minutes because 3D is drawn in software here |

Viewports exercised: **desktop 1280×800 (mouse)** and **phone landscape 844×390 @2× (touch)**.

> **Mobile testing here is simulated.** The phone runs use Chromium's touch/viewport *emulation* (touch events injected over CDP), **not a physical device**. Real-device behaviour — iOS Safari / Android Chrome performance, safe-area insets, gesture conflicts with browser chrome, thermal throttling — is **untested**. Firefox and desktop Safari are also untested. Per the concept doc, minimum supported browsers/hardware should be defined only after measuring on real devices.

## Implemented vs. the brief

Implemented: camera (pan/zoom/minimap), selection and orders (move, attack-move, attack, gather, build, hold, stop, retreat, leader rally), gathering and four resources (+ provisions), 9 placeable buildings plus the hearth (shelter, stockpile, toolmaking shelter, hunting lodge, teaching circle, smoking rack, crop field → irrigated terrace, watch post, palisade), six unit roles, training queues and population cap, fog of war, wildlife (deer, wolves), a rival AI clan (garrison at the pass + periodic warbands + gift/truce), winter pressure (spoilage, cold, hunger), a 9-discovery 3-era tech network (fire, pottery, farming, boats, kilns, irrigation), specialist knowledge risk on death before teaching, multi-generational succession (Gen 1 → 2 → 3+ with deep ancestral mastery discounts and cumulative lineage bonuses), objectives/hints, victory/defeat + endless Era III continuation, pause/restart/speed, versioned local save/load + export/import, species choice (modest, explained differences).

Known limitations / not yet done:

* **Map balance is only bot-tested.** The scripted bot wins every map and clan on the fixed seed (8 combinations), but on random seeds its win rate is lower: a 16-game sweep (4 seeds per map) gave Ember Valley 4/4, Glasswater 3/4, The Isles 3/4 and Mammoth Canyon 2/4. The losses are games where the rival's raids wore the clan down so it never completed the Far Meadow expedition. Humans defend and adapt better than the bot, but this is unverified; expect the Deadly and Harsh maps to need a balance pass.

* The upgrade / unit / research systems are covered by unit tests and a visual check in headless Chromium. The scripted bot uses archer posts, upgrades and research, and the rival fortifies its watch post (≈ 8 min) and fields Slingers/Brutes/Champions later; costs and difficulty are only bot-tuned, not human-playtested.

* No **gate** (palisades block everyone, including your own units); no follow / focus-target commands, formations, squad stances or morale; no close battle camera.
* Rival AI is scripted and simple (no real economy; it ignores fog); trade is a single gift action.
* Balance in Generation 3+ has been verified via simulation tests, not extensive human playtesting.
* Environment art is procedural; humanoids now use adapted skinned character assets and authored animation clips. Units never collide, they only softly separate.
* The game now **requires WebGL** (a clear message is shown if it is unavailable). Real-GPU and phone performance is **unmeasured** — this environment only has software rendering, which is far slower than hardware. Render resolution is capped at 1.5× device pixels, shadow maps shrink on small screens, and the bundle is ≈ 617 kB (≈ 160 kB gzipped) because of Three.js.
* Not tested on real phones/tablets; performance there has not been measured (population is small — rival capped at 22, no hard cap on yours beyond housing).

### Animated warband characters

All eleven humanoid roles now use adapted KayKit barbarian/ranger bodies with their own native rigs and authored animations. Guards have shields, leaders and brutes wear bear pelts, brutes carry a large two-handed axe, and hunters/workers use their contextual equipment. Clan body proportions, faction colors and successor colors are retained. The existing procedural character remains visible while each shared GLB loads, and stays as a fallback if loading fails.

Movement, spear thrusts, axe attacks, ranged attacks, throws, chopping, gathering, research and death use role-specific authored clips with blended transitions. Walking and running are separate. The renderer merges the six skinned body sections into one body draw per character; instance skeletons and animation mixers remain independent. Original gradient-atlas colors are baked into vertices, so no external texture requests are needed.

- Source: KayKit Adventurers 1.0 by Kay Lousberg, CC0. See `docs/character-assets.md` and `public/assets/characters/KayKit-LICENSE.txt`.
- Rebuild adaptations: `python scripts/import-warband.py /path/to/KayKit-Character-Pack-Adventures-1.0` (NumPy/Pillow).
- Output: two shared GLBs, approximately 745 KiB each, with sixteen retained animation clips. There is no separate model download for each unit.
- Offline review: `npm run art:preview` creates `docs/warband-preview.png` from the runtime factory and actual clip poses. It includes a 58-degree overhead view, matching the game camera's pitch. This is an offline CPU render, **not a gameplay screenshot**.
- Verification: `npm test -- tests/characters.test.ts` loads the shipped GLBs, checks live bone motion, independent cloned skeletons, death transitions, normalized weights, role/command mapping, one merged body draw, equipment and neutral face colors. Production build/typecheck and existing simulation tests also pass.
- Remaining visual checks: the remote browser cannot initialize WebGL. In-game lighting, animation/equipment alignment throughout every attack, and real-phone frame rate still require GPU-browser review. These are stylized fantasy assets, not a complete Warcraft-quality art overhaul; buildings, terrain and wildlife retain their existing models.


### Mobile HUD playtest verification

`tests/hud.test.ts` exercises real HUD click handlers and responsive CSS in Happy DOM: immediate quick commands, advanced disclosure, resource/season/population sheets, stable focused counters, idle-worker cycling and measured resource rates. The suite also checks the fixed horizontal dock and that the primary command card remains displayed when advanced commands are folded. These are DOM/CSS checks, not a physical-phone or GPU-browser visual playtest. Safe-area behavior and real-device ergonomics still need on-device review.
