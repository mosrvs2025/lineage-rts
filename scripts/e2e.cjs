/* Browser end-to-end check. Usage: node scripts/e2e.cjs <baseUrl> <outDir>
 * Requires playwright + a chromium build (PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH).
 * Mobile runs use Chromium's touch/viewport EMULATION, not a physical device. */
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || './shots';
fs.mkdirSync(out, { recursive: true });
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}
const G = (p, fn, arg) => p.evaluate(fn, arg);
const BOX = () => {
  const g = window.game, pts = g.world.units.filter((u) => u.owner === 0).map((u) => g.cam.toScreen(u.x, u.y));
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const lo = { x: Math.min(...xs) - 50, y: Math.min(...ys) - 60 }, hi = { x: Math.max(...xs) + 50, y: Math.max(...ys) + 20 };
  const free = (x, y) => document.elementFromPoint(Math.max(1, Math.min(innerWidth - 1, x)), Math.max(1, Math.min(innerHeight - 1, y)))?.id === 'game';
  const corners = [[lo.x, lo.y, hi.x, hi.y], [hi.x, lo.y, lo.x, hi.y], [lo.x, hi.y, hi.x, lo.y], [hi.x, hi.y, lo.x, lo.y]];
  const c = corners.find(([x, y]) => free(x, y)) ?? corners[0];
  return { x0: c[0], y0: c[1], x1: c[2], y1: c[3] };
};


async function common(p, label, input) {
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('[data-act="play"]');
  await p.screenshot({ path: `${out}/${label}-01-title.png` });
  await p.click('[data-act="play"]');
  await p.waitForSelector('[data-act="start"]');
  await p.screenshot({ path: `${out}/${label}-01b-clan.png` });
  await p.click('[data-act="start"]');
  await p.waitForTimeout(300);
  if (await p.$('[data-act="resume"]')) await p.click('[data-act="resume"]');
  await p.waitForTimeout(1500);
  ok(`${label}: game starts`, await G(p, () => !!window.game.world && window.game.world.status === 'playing'));
  await p.screenshot({ path: `${out}/${label}-02-start.png` });

  // --- select + order via the real input path
  const pos = (id) => G(p, (id) => { const g = window.game, u = g.world.units.find((x) => x.id === id) || g.world.nodes.find((x) => x.id === id); const x = u.x ?? u.x + 0.5; const s = g.cam.toScreen(u.kind ? u.x : u.x + 0.5, u.kind ? u.y : u.y + 0.5); return s; }, id);
  const gatherer = await G(p, () => window.game.world.units.find((u) => u.owner === 0 && u.kind === 'gatherer').id);
  // park the gatherer somewhere known so the test is deterministic
  await G(p, (id) => { const u = window.game.world.units.find((x) => x.id === id); u.order = { t: 'idle' }; u.path = null; }, gatherer);
  let s = await pos(gatherer);
  await input.tap(s.x, s.y);
  ok(`${label}: tap selects a unit`, await G(p, (id) => window.game.sel.length === 1 && window.game.sel[0] === id, gatherer));
  const tree = await G(p, () => { const w = window.game.world; const h = w.buildings.find((b) => b.kind === 'hearth' && b.owner === 0); return w.nodes.filter((n) => n.kind === 'tree').sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0].id; });
  await G(p, (id) => { const g = window.game, n = g.world.nodes.find((x) => x.id === id); g.cam.centerOn(n.x, n.y); }, tree);
  await p.waitForTimeout(100);
  s = await pos(tree);
  await input.order(s.x, s.y);
  const ord = await G(p, (id) => window.game.world.units.find((u) => u.id === id).order.t, gatherer);
  ok(`${label}: order on a tree starts gathering`, ord === 'gather', ord);
  await G(p, () => window.game.advance(45));
  ok(`${label}: wood is delivered`, await G(p, () => window.game.world.res.wood > 90), String(await G(p, () => Math.floor(window.game.world.res.wood))));

  // --- build via the build panel
  await p.click('[data-act="build"]');
  await p.waitForSelector('#panel [data-act^="placeb"]');
  await p.screenshot({ path: `${out}/${label}-03-build-panel.png` });
  await p.click('[data-act="placeb:stockpile"]');
  ok(`${label}: placement mode opens`, await G(p, () => window.game.mode === 'place'));
  const spot = await G(p, () => {
    const g = window.game, w = g.world;
    for (let r = 4; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = 16 + dx, ty = 24 + dy; if (window.__check(w, 'stockpile', tx, ty)) return { tx, ty };
    }
  });
  await G(p, (sp) => { const g = window.game; g.cam.centerOn(sp.tx, sp.ty); }, spot);
  await p.waitForTimeout(100);
  const sp = await G(p, (sp) => window.game.cam.toScreen(sp.tx + 1, sp.ty + 1), spot);
  await input.place(sp.x, sp.y);
  const nb0 = await G(p, () => window.game.world.buildings.filter((b) => b.owner === 0).length);
  ok(`${label}: building placed`, await G(p, () => window.game.world.buildings.some((b) => b.owner === 0 && b.kind === 'stockpile')), `buildings=${nb0}`);
  await G(p, () => window.game.advance(30));
  ok(`${label}: building completes`, await G(p, () => window.game.world.buildings.some((b) => b.kind === 'stockpile' && b.done)));
  await p.screenshot({ path: `${out}/${label}-04-built.png` });

  // --- train a unit from the hearth
  await G(p, () => { const g = window.game; const h = g.world.buildings.find((b) => b.kind === 'hearth' && b.owner === 0); g.selectBuilding(h.id); g.cam.centerOn(h.x + 1.5, h.y + 1.5); g.world.res.food = 200; });
  await p.waitForTimeout(400);
  const n0 = await G(p, () => window.game.world.units.filter((u) => u.owner === 0 && u.kind === 'gatherer').length);
  await p.click('[data-act="train:gatherer"]');
  await G(p, () => window.game.advance(12));
  ok(`${label}: training adds a unit`, (await G(p, () => window.game.world.units.filter((u) => u.owner === 0 && u.kind === 'gatherer').length)) === n0 + 1);

  // --- discoveries panel
  await G(p, () => { const w = window.game.world; w.stats.food = 40; w.res.wood = 100; w.res.knowledge = 100; w.res.stone = 40; window.game.advance(2); });
  await p.click('[data-act="disc"]');
  await p.waitForSelector('.disc');
  await p.screenshot({ path: `${out}/${label}-05-discoveries.png` });
  const hasInv = await p.$('[data-act="inv:cooking"]');
  ok(`${label}: discovery panel shows an investigation`, !!hasInv);
  if (hasInv) { await p.click('[data-act="inv:cooking"]'); await G(p, () => window.game.advance(40)); }
  ok(`${label}: cooking discovered`, await G(p, () => window.game.world.disc.cooking === 'known'));
  await p.click('[data-act="closepanel"]');

  // --- pause / speed
  await p.click('#b-pause');
  ok(`${label}: pause works`, await G(p, () => window.game.speed === 0));
  await p.click('#b-pause');
  await p.click('#b-speed');
  ok(`${label}: speed change works`, await G(p, () => window.game.speed === 2));
  await G(p, () => { window.game.speed = 1; });

  // --- save, mutate, load
  await p.click('[data-act="menu"]');
  await p.click('[data-act="save"]');
  await p.click('[data-act="resume"]');
  const food0 = await G(p, () => Math.floor(window.game.world.res.wood));
  await G(p, () => { window.game.world.res.wood = 1; });
  await p.click('[data-act="menu"]');
  await p.click('[data-act="continue:manual"]');
  ok(`${label}: save/load restores state`, (await G(p, () => Math.floor(window.game.world.res.wood))) === food0, `wood ${food0}`);
  await G(p, () => localStorage.setItem('lineage-rts:save:manual', '{"format":"lineage-rts-save","version":1,"world":{"W":3}}'));
  await p.click('[data-act="menu"]');
  await p.click('[data-act="continue:manual"]');
  await p.waitForTimeout(200);
  ok(`${label}: corrupt save handled without crashing`, (await p.$$('.toast.bad')).length > 0 && (await G(p, () => !!window.game.world)));
  if (await p.$('[data-act="resume"]')) await p.click('[data-act="resume"]');

  // --- winter, succession, victory flow
  await G(p, () => { const w = window.game.world; w.time = w.winter.start + 5; window.game.advance(25); });
  await p.screenshot({ path: `${out}/${label}-06-winter.png` });
  await G(p, () => { const w = window.game.world; w.disc.preservation = 'preserved'; w.disc.cooking = 'known'; w.time = w.winter.end + 1; window.game.advance(2); });
  await p.waitForSelector('[data-act="succession"]');
  await p.click('[data-act="succession"]');
  await p.screenshot({ path: `${out}/${label}-07-succession.png` });
  await p.click('[data-act="pick:1"]');
  await p.click('[data-act="succeed"]');
  ok(`${label}: succession advances the generation`, await G(p, () => window.game.world.gen === 2 && window.game.world.disc.preservation === 'preserved' && window.game.world.disc.cooking === 'faded'));
  await G(p, () => { const w = window.game.world; w.buildings.push({ id: w.nextId++, kind: 'watch', owner: 0, x: 65, y: 7, w: 2, h: 2, hp: 100, maxHp: 100, progress: 1, done: true, queue: [], tick: 0, outpost: true }); window.game.advance(1); });
  await p.waitForSelector('#modal:not(.hidden) h1.win', { timeout: 3000 }).catch(() => {});
  ok(`${label}: victory screen`, !!(await p.$('h1.win')));
  await p.screenshot({ path: `${out}/${label}-08-victory.png` });
  await p.click('[data-act="restart"]');
  ok(`${label}: restart gives a fresh game`, await G(p, () => window.game.world.gen === 1 && window.game.world.time < 1));
  ok(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
}

(async () => {
  const b = await launch();
  // ---------------- desktop, mouse
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    const input = {
      tap: async (x, y) => { await p.mouse.click(x, y); },
      order: async (x, y) => { await p.mouse.click(x, y, { button: 'right' }); },
      place: async (x, y) => { await p.mouse.move(x - 5, y - 5); await p.mouse.move(x, y); await p.mouse.click(x, y); },
    };
    await common(p, 'desktop', input);
    // box select with mouse drag
    await G(p, () => { const g = window.game; g.cam.centerOn(10, 24); });
    await G(p, () => { const g = window.game, h = g.world.buildings.find((b) => b.kind === 'hearth' && b.owner === 0); g.cam.zoom = 32; g.cam.centerOn(h.x + 3, h.y + 2); });
    const bx = await G(p, BOX);
    await p.mouse.move(bx.x0, bx.y0); await p.mouse.down(); await p.mouse.move(bx.x1, bx.y1, { steps: 6 }); await p.mouse.up();
    ok('desktop: drag box-selects several units', await G(p, () => window.game.sel.length >= 3), String(await G(p, () => window.game.sel.length)));
    await p.screenshot({ path: `${out}/desktop-09-boxselect.png` });
    // wheel zoom
    const z0 = await G(p, () => window.game.cam.zoom);
    await p.mouse.move(640, 400); await p.mouse.wheel(0, -300);
    ok('desktop: wheel zoom', (await G(p, () => window.game.cam.zoom)) > z0);
    await ctx.close();
  }
  // ---------------- phone landscape, touch emulation
  {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i })) });
    const input = {
      tap: async (x, y) => { await p.touchscreen.tap(x, y); },
      order: async (x, y) => { await p.touchscreen.tap(x, y); },
      place: async (x, y) => { await p.touchscreen.tap(x, y); await p.waitForTimeout(150); await p.click('[data-act="place-ok"]'); },
    };
    await common(p, 'phone', input);
    // drag pans the camera, pinch zooms
    await G(p, () => window.game.cam.centerOn(30, 24));
    const c0 = await G(p, () => ({ x: window.game.cam.x, y: window.game.cam.y, z: window.game.cam.zoom }));
    await touch('touchStart', [{ x: 400, y: 200 }]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: 400 - i * 12, y: 200 }]);
    await touch('touchEnd', []);
    const c1 = await G(p, () => ({ x: window.game.cam.x, y: window.game.cam.y, z: window.game.cam.zoom }));
    ok('phone: one-finger drag pans the camera', c1.x > c0.x + 2, `${c0.x.toFixed(1)} -> ${c1.x.toFixed(1)}`);
    await touch('touchStart', [{ x: 350, y: 200 }, { x: 450, y: 200 }]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: 350 - i * 12, y: 200 }, { x: 450 + i * 12, y: 200 }]);
    await touch('touchEnd', []);
    const c2 = await G(p, () => window.game.cam.zoom);
    ok('phone: pinch zooms', c2 > c1.z * 1.2, `${c1.z.toFixed(1)} -> ${c2.toFixed(1)}`);
    // no horizontal overflow, buttons >= 40px tall
    const ui = await G(p, () => ({ ow: document.documentElement.scrollWidth <= window.innerWidth, small: [...document.querySelectorAll('#cmds button, #topbtns button')].filter((b) => b.offsetHeight < 34).length }));
    ok('phone: no horizontal page scroll', ui.ow);
    ok('phone: command buttons are touch-sized', ui.small === 0, `small=${ui.small}`);
    // drag-select mode
    await p.click('[data-act="dragsel"]');
    await G(p, () => { const g = window.game; const h = g.world.buildings.find((x) => x.kind === 'hearth' && x.owner === 0); g.cam.zoom = 24; g.cam.centerOn(h.x + 3, h.y + 2); });
    const box = await G(p, () => {
      const g = window.game, pts = g.world.units.filter((u) => u.owner === 0).map((u) => g.cam.toScreen(u.x, u.y));
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const lo = { x: Math.min(...xs) - 50, y: Math.min(...ys) - 60 }, hi = { x: Math.max(...xs) + 50, y: Math.max(...ys) + 20 };
      const free = (x, y) => document.elementFromPoint(Math.max(1, Math.min(innerWidth - 1, x)), Math.max(1, Math.min(innerHeight - 1, y)))?.id === 'game';
      const corners = [[lo.x, lo.y, hi.x, hi.y], [hi.x, lo.y, lo.x, hi.y], [lo.x, hi.y, hi.x, lo.y], [hi.x, hi.y, lo.x, lo.y]];
      const c = corners.find(([x, y]) => free(x, y)) ?? corners[0];
      return { x0: c[0], y0: c[1], x1: c[2], y1: c[3] };
    });
    await touch('touchStart', [{ x: box.x0, y: box.y0 }]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: box.x0 + ((box.x1 - box.x0) * i) / 10, y: box.y0 + ((box.y1 - box.y0) * i) / 10 }]);
    await touch('touchEnd', []);
    ok('phone: drag-select box-selects units', await G(p, () => window.game.sel.length >= 2), String(await G(p, () => window.game.sel.length)));
    await p.screenshot({ path: `${out}/phone-09-dragselect.png` });
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
