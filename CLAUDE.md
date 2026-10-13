# Claude development brief

Read `lineage-rts-concept.md` before implementing. It is the agreed game design.

Build a playable browser-first RTS that works with mouse and touch on desktop, tablets, and phones. The core is gathering, building, scouting, combat, discovery, and knowledge inherited across generations. Keep the main experience an overhead RTS.

## First task

Create a small playable vertical slice of **The First Winter**. Start with camera movement, unit selection and orders, resource gathering, building placement, and a simple economy. Then add fire research, food preservation, a rival AI clan, winter pressure, and one generation transition that preserves buildings and knowledge.

Choose and document a lightweight web stack. Keep simulation separate from rendering, and discoveries, buildings, and units data-driven. Use simple readable placeholder art until the game loop works. Do not begin with multiplayer, accounts, payments, or a full MMO.

## Acceptance criteria

- Document installation, development, and production build commands in README.md.
- The player can gather resources, construct buildings, and issue unit orders.
- A discovery has a visible gameplay effect and persists through succession.
- Mouse and touch controls work without relying on hover or right-click alone.
- Add local save/load with a versioned format and graceful handling of invalid saves.
- Include a clear objective, victory/defeat feedback, pause, and restart.
- Verify the full gameplay flow and document tested browsers and viewport sizes. Distinguish simulated mobile testing from actual device testing.
- Report what is implemented, how it was verified, and remaining limitations.

Implement in small working increments. Preserve the distinctive premise: ancestors discover techniques, descendants find new applications, and species/cultures can take different paths.
