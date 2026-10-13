# LINEAGE — An Evolution RTS

*Working title. Game concept and first playable scope.*

## The pitch

Build a clan into a civilization across generations. Gather resources, construct settlements, command armies, and research new techniques—but every generation begins with the discoveries, traditions, and consequences left by its ancestors.

You can play humans, Neanderthals, and eventually other ancestral or fictional species. There is no required path toward modern humans. Different environments, discoveries, and decisions create different civilizations and alternate histories.

The main experience is an RTS: an overhead camera, workers, buildings, unit production, exploration, and tactical battles. Named leaders and family lines give your civilization a personal history.

**The defining feature: an ancestor discovers something; later generations discover what else it can do.**

## What a session looks like

You begin beside a river with a small clan, a few shelters, and inherited knowledge of maintaining fire.

Assign gatherers to food and timber. Send scouts into unexplored territory. Build a hearth and a toolmaking shelter. Train hunters to protect workers from predators.

A hunter notices that food left near smoke lasts longer. You assign a knowledgeable clan member to investigate. After successful experiments, your clan can construct smoking racks. Preserved food lets expeditions travel farther and helps the settlement survive winter.

A rival Neanderthal clan occupies the forest pass. You can trade for access, claim another route, or train a warband and fight over it. Winning territory gives you resources, but losses leave fewer people to gather food and teach the next generation.

When the generation changes, your settlement remains. Children become adults, elders leave behind trained apprentices, and you choose a new leader. The next generation already understands food smoking and can investigate more advanced uses of controlled heat.

Your history changes both your economy and your available tactics.

## Core loop

**Explore → gather → build → experiment → teach → expand → fight or negotiate → pass knowledge onward.**

There are two connected timescales:

- **Immediate RTS decisions:** worker assignments, construction, scouting, production, positioning, and combat.
- **Generational decisions:** apprenticeships, inherited knowledge, leadership, cultural specialization, and long-term adaptation.

Generational transitions occur at clear campaign milestones. Players can review succession and inheritance before advancing. A single battle does not suddenly age everyone decades.

## Economy and population

Start with four readable resources:

| Resource | Main uses |
|---|---|
| Food | Feed the clan, support population growth, provision expeditions |
| Wood | Buildings, tools, fuel, defenses |
| Stone | Tools, weapons, construction |
| Knowledge | Represents recorded observations and shared understanding; supports investigations |

Knowledge alone cannot buy every discovery. Research also needs appropriate materials, facilities, observations, and people.

Population is shared between the economy and military. Training a gatherer as a warrior improves defense but reduces production. Units carry names and histories, while routine controls still operate on squads and job groups.

Food shortages, interrupted supply routes, and loss of skilled teachers should create recoverable problems. Avoid spirals where one setback makes the campaign impossible to continue.

## Buildings

Buildings turn discoveries into usable systems. An early settlement might include:

| Building | Gameplay role |
|---|---|
| Clan hearth | Settlement center, warmth, gathering point, succession |
| Shelters | Population capacity and protection |
| Stockpile | Resource drop-off and local storage |
| Toolmaking shelter | Tools, basic weapons, crafting investigations |
| Hunting lodge | Train hunters and organize expeditions |
| Teaching circle | Apprenticeships and knowledge preservation |
| Smoking racks | Preserve food after the technique is discovered |
| Watch post | Reveal territory and warn of threats |
| Palisade and gate | Control movement and protect workers |

Placement matters: woodcutters near forests, food storage near hunting routes, defenses at chokepoints. Expand with outposts that need protection and supplies.

Later eras add farming, pottery, specialized workshops, roads, fortifications, and other branches. Each addition should change a decision or tactic, rather than merely raise a number.

## Discovery and research

Use a branching discovery network with four stages:

1. **Observe:** Exploration or ordinary work produces a clue.
2. **Investigate:** Assign people, materials, and a suitable facility to test it.
3. **Apply:** Construct something or train units to use the technique.
4. **Preserve:** Teach apprentices so future generations retain it.

For example, the fictional gameplay branch for fire could be:

```text
Maintain fire
├── Cooking → better food efficiency
├── Smoke preservation → expedition supplies → longer campaigns
├── Portable fire → predator deterrence and tactical options
└── Controlled heat → material experiments → later crafting branches
```

This is a game progression model, not a claim that real history followed this exact sequence.

Players see available clues and why an investigation is blocked. Avoid requiring random, obscure item combinations. Once a technique has been discovered, applying it should be predictable.

Inherited expertise makes familiar research easier. New uses still require fresh evidence or prerequisites. A later generation can refine a technique, combine it with another discovery, or take it down a different branch.

## Generations and inheritance

At a generation transition, carry forward:

- Settlements, territory, surviving infrastructure, and stored resources.
- Discoveries, with their preservation status.
- Relationships with neighboring clans.
- Family histories and leadership traditions.
- Cultural specializations earned through sustained choices.

Choose a successor from a small set of descendants with different strengths. One improves logistics, another excels at reconnaissance, and another supports teaching or battlefield leadership.

Preserved knowledge survives reliably. Knowledge practiced by only one specialist is vulnerable if that person dies before teaching an apprentice. Leave clues or surviving artifacts that allow recovery; players should not have to repeat the entire opening game.

Biological adaptation is a separate, slower system. Learning a technique does not change genes. Major species divergence belongs to long campaign timescales or explicitly fictional alternate-history rules.

## Species and cultures

Species provides a starting physical profile. Culture develops through play and determines much of the faction's strategic identity.

For the prototype, humans and Neanderthals use the same core economy and construction rules. Their differences should be modest, clearly explained, and treated as balance choices rather than stereotypes or historical rankings.

Over time, either species might develop into:

- Mountain settlements with strong defenses and cold-weather logistics.
- Coastal communities with fishing, boats, and trade routes.
- Mobile hunting clans with flexible camps and scouting advantages.
- River settlements with dense production and agricultural branches.

Specializations should involve costs and alternatives. No culture should simply become better at everything.

## Units and combat

Start with a small roster whose roles are easy to read:

| Unit | Role | Limitation |
|---|---|---|
| Gatherer | Economy, construction, emergency repairs | Vulnerable without protection |
| Scout | Vision, tracking, finding routes and clues | Weak in direct combat |
| Hunter | Ranged pressure and wildlife hunting | Vulnerable when caught at close range |
| Spear guard | Holds approaches and protects other units | Can be outmaneuvered |
| Raider | Threatens workers, supply routes, and exposed ranged units | Struggles against prepared defenses |
| Clan leader | Leads a squad and provides a limited tactical ability | Valuable and costly to lose |

Use terrain, vision, formation, morale, and supply to create depth. Forests conceal movement; narrow passes reward defensive positioning; unsupported expeditions need to retreat or secure provisions.

Commands include move, attack, hold, patrol, follow, retreat, and focus target. Squads can adopt aggressive, defensive, or evasive behavior.

Named leaders add personality without requiring direct character control. An optional close camera can show battles, but the main controls remain RTS controls.

## Warcraft and StarCraft influences

- **From Warcraft:** settlements with character, memorable leaders, distinct unit roles, and meaningful active abilities.
- **From StarCraft:** scouting, economic tradeoffs, readable counters, production choices, and territory pressure.
- **From the evolution concept:** discoveries that accumulate, generations that inherit consequences, and civilizations that branch through play.

Keep active abilities limited. Mobile players should be able to win through preparation and tactical choices without constantly activating individual units.

## Campaigns, timelines, and victory

The main mode is a persistent lineage campaign made of regional scenarios. Each scenario has a clear objective: survive a winter, establish a second settlement, secure a migration route, or defeat a hostile coalition.

Campaign milestones advance generations and sometimes eras. Earlier inventions continue to matter through upgrades, supply systems, and cultural choices.

Alternate histories emerge from simulated decisions: a surviving Neanderthal civilization, a coastal trading alliance, or a world where a key technology spreads late. Begin with authored branching events and consistent simulation rules; expand the number of possibilities as the game grows.

Additional modes can follow:

- **Skirmish:** a self-contained RTS match with a limited discovery network.
- **Co-op:** players control allied clans and exchange knowledge.
- **Competitive multiplayer:** bounded starting conditions and match-specific progression so an old campaign does not grant an unbeatable advantage.

The first release does not require an MMO world.

## Browser, mobile, and desktop

The initial product is a browser game with responsive touch and mouse controls. It should run from a link on desktop browsers and supported phone browsers. Installed desktop and mobile versions can follow, sharing the same rules and save format where practical.

### Shared control design

| Action | Desktop | Mobile |
|---|---|---|
| Select units | Click, drag box, control groups | Tap squad or portrait; optional drag selection mode |
| Give orders | Context click and hotkeys | Tap destination, then contextual command |
| Move camera | Drag, edge pan, keyboard | One-finger drag on empty terrain |
| Zoom | Mouse wheel | Pinch |
| Construct | Build panel and hotkeys | Large build panel with placement preview |
| Manage workers | Job counts and priorities | Same job counts and priorities |

Use landscape layouts on phones, large touch targets, collapsible panels, and clear selection feedback. Disable ambiguous gestures while placing a building. Tablets can show more panels simultaneously.

Single-player supports pause and adjustable speed. Multiplayer uses a shared clock and cannot give one player an individual pause advantage.

### Performance approach

Use stylized, readable visuals and a tilted overhead camera. Build the first version with a lightweight 2D or 2.5D renderer; move to more elaborate 3D only if it improves the experience within phone performance limits.

Keep simulation separate from rendering. Cap unit counts initially, group movement into squads, update distant effects less often, and limit expensive lighting and particles. Save campaigns locally first, with export/import; cloud synchronization can come later.

Browser compatibility is a requirement to verify on actual iOS, Android, and desktop devices. Define minimum supported browsers and hardware after measuring the prototype. A browser build alone does not prove good mobile performance.

## First playable prototype

**Scenario: The First Winter.**

Build a settlement, discover food preservation, protect your supplies, and pass the clan to its next generation.

Include:

- One compact map: river, forest, caves, and a contested pass.
- Humans and Neanderthals as selectable starting clans.
- Four resources, nine building types, and six unit roles.
- One rival AI clan, wildlife, fog of war, and a winter event.
- Three practical fire branches: cooking, preservation, and portable fire.
- One succession transition with inherited buildings and discoveries.
- Mouse and touch controls, local saves, and a clear victory condition.

Target a roughly 20–30 minute scenario, subject to playtesting. Start with a small population cap and measure how it performs before increasing army sizes.

The central demonstration is visible: generation one learns food smoking; generation two inherits it and can provision an expedition beyond the valley.

## Build sequence

1. **RTS foundation:** camera, selection, orders, gathering, construction, and readable combat.
2. **Discovery system:** clues, investigations, prerequisites, and applied benefits.
3. **Inheritance:** succession, apprenticeships, persistent settlement state, and knowledge preservation.
4. **Complete scenario:** rival clan, winter pressure, objectives, onboarding, and saves.
5. **Platform verification:** touch usability, phone performance, browser compatibility, and save recovery.
6. **Expansion:** more regions, cultures, discoveries, co-op, and later competitive modes.

## Design rules

- Every discovery must change a useful gameplay decision.
- Every generation must inherit something the player recognizes.
- Research must remain understandable even when its branches differ between campaigns.
- Economic and military choices must compete for resources and people.
- Species and cultures must have viable alternative paths.
- Defeat should create stories and recoverable setbacks where possible.
- The core RTS must be fun before adding more eras or online scale.

**The promise: build the civilization your ancestors made possible, then leave the next generation possibilities of its own.**
