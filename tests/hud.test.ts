// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';
import { ResourceHistory } from '../src/ui/resource-summary';
import { newWorld } from './helpers';
import { step } from '../src/sim/step';
import type { Game } from '../src/ui/game';

function setup() {
  const w = newWorld(); step(w);
  const game = {
    world: w, sel: [] as number[], selB: null as number | null, mode: 'normal', place: null,
    speed: 1, queueMode: false, showcase: false, menuOpen: false, showBars: false,
    cam: { setInsets: vi.fn(), centerOn: vi.fn() },
    liveSel() { return this.sel; },
    selectUnits(ids: number[]) { this.sel = ids; },
    clearSelection() { this.sel = []; this.selB = null; },
    cancelPlace: vi.fn(),
  };
  const hud = new Hud(game as unknown as Game);
  hud.tick(1000);
  return { hud, game, w, click: (action: string) => {
    const button = document.querySelector<HTMLButtonElement>(`[data-act="${action}"]`);
    expect(button, action).not.toBeNull(); button!.click();
  } };
}

beforeEach(() => {
  (window as unknown as {happyDOM:{setViewport(v:{width:number;height:number}):void}}).happyDOM.setViewport({width:412,height:915});
  document.body.innerHTML = readFileSync('index.html','utf8').split('<body>')[1].split('<script type="module"')[0];
  document.head.innerHTML = `<style>${readFileSync('src/style.css','utf8')}</style>`;
  localStorage.clear();

});

describe('mobile playtest fixes through the real HUD event handlers', () => {
  it('puts the dock outside the hidden fan and keeps common unit commands outside the advanced fold', () => {
    const {hud,game,w} = setup();
    game.sel = [w.units.find(u=>u.owner===0&&u.kind==='gatherer')!.id];
    hud.tick(1200);
    expect(document.querySelector('#dock')!.parentElement!.id).toBe('app');
    const dockStyle=getComputedStyle(document.getElementById('dock')!);
    expect(dockStyle.position).toBe('fixed');
    expect(dockStyle.flexDirection).toBe('row');
    expect(getComputedStyle(document.getElementById('bubble')!).transform).toBe('none');
    expect(getComputedStyle(document.querySelector('#cmds [data-act="move"]')!).display).not.toBe('none');
    expect(getComputedStyle(document.querySelector('#cmds [data-act="queue"]')!).display).toBe('none');
    expect(document.querySelector('#bubble')!.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('#bubble')!.classList.contains('folded')).toBe(true);
    for(const act of ['move','work','stop','retreat','build']) expect(document.querySelector(`#cmds [data-act="${act}"]`)!.classList.contains('quick')).toBe(true);
    expect(document.querySelector('#cmds [data-act="queue"]')!.classList.contains('quick')).toBe(false);
    expect(document.querySelector('#cmds [data-act="hold"]')!.classList.contains('quick')).toBe(false);
    (document.getElementById('bfold') as HTMLButtonElement).click();
    expect(document.getElementById('bfold')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('bubble')!.classList.contains('folded')).toBe(false);
    expect(getComputedStyle(document.getElementById('bubble')!).display).not.toBe('none');
    expect(getComputedStyle(document.getElementById('cmdcard')!).display).not.toBe('none');
    expect(getComputedStyle(document.getElementById('cmds')!).display).toBe('grid');
    expect(getComputedStyle(document.querySelector('#cmds [data-act="queue"]')!).display).not.toBe('none');
    game.sel = [w.units.find(u=>u.owner===0&&u.kind==='leader')!.id];hud.tick(1400);
    expect(document.getElementById('bfold')!.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('#cmds [data-act="amove"]')!.classList.contains('quick')).toBe(true);
  });
  it('keeps building commands visible and restores the desktop console after rotation', () => {
    const {hud,game,w}=setup();
    game.selB=w.buildings.find(b=>b.owner===0&&b.kind==='hearth')!.id;hud.tick(1200);
    expect(document.getElementById('bubble')!.classList.contains('unit-selection')).toBe(false);
    const train=document.querySelector<HTMLElement>('#cmds [data-act="train:gatherer"]')!;
    expect(train.hasAttribute('hidden')).toBe(false);
    expect(getComputedStyle(train).display).not.toBe('none');
    (window as unknown as {happyDOM:{setViewport(v:{width:number;height:number}):void}}).happyDOM.setViewport({width:1280,height:800});
    hud.bub.apply();hud.tick(1400);
    expect(document.getElementById('selpanel')!.parentElement!.id).toBe('hud');
    expect(document.getElementById('app')!.classList.contains('pp')).toBe(false);
    expect(getComputedStyle(document.getElementById('dock')!).position).toBe('absolute');
  });
  it('ignores legacy floating/pinned positions and reserves the measured bottom controls in the camera', () => {
    localStorage.setItem('lineage.hud.v2',JSON.stringify({pos:{bubble:[.3,.4],fab:[.5,.5]},pinned:true,folded:true}));
    const {hud,game,w}=setup();game.sel=[w.units.find(u=>u.owner===0&&u.kind==='gatherer')!.id];hud.tick(1200);
    expect(document.getElementById('bubble')!.classList.contains('pinned')).toBe(false);
    expect(document.getElementById('bubble')!.style.top).toBe('');
    const rect=(height:number,bottom=height)=>({height,bottom,width:412,top:0,left:0,right:412,x:0,y:0,toJSON(){return {};}});
    vi.spyOn(document.getElementById('topbar')!,'getBoundingClientRect').mockReturnValue(rect(104));
    vi.spyOn(document.getElementById('dock')!,'getBoundingClientRect').mockReturnValue(rect(64));
    vi.spyOn(document.getElementById('bubble')!,'getBoundingClientRect').mockReturnValue(rect(180));
    hud.layout();expect(game.cam.setInsets).toHaveBeenLastCalledWith(104,252);
  });
  it('exposes resource and season sheets and preserves focused resource buttons across updates', () => {
    const {hud,w,click}=setup();
    const food = document.querySelector<HTMLButtonElement>('[data-act="inspect:food"]')!;
    food.focus();click('inspect:food');
    expect(document.getElementById('panel')!.textContent).toContain('Meal demand');
    expect(document.getElementById('panel')!.textContent).toContain('Measuring');
    w.res.food += 5;w.time += 6;hud.tick(1200);
    expect(document.querySelector('[data-act="inspect:food"]')).toBe(food);
    expect(document.activeElement).toBe(food);
    click('inspect:season');
    expect(document.getElementById('panel')!.textContent).toContain('Winter');
    click('inspect:pop');
    expect(document.getElementById('panel')!.textContent).toContain('Housing capacity');
  });
  it('cycles idle workers one at a time and applies quick commands with one click', () => {
    const {game,w,click,hud}=setup();
    const workers=w.units.filter(u=>u.owner===0&&u.kind==='gatherer');
    workers.forEach(u=>{u.order={t:'idle'};});
    click('nextidle');const first=game.sel[0];expect(game.sel).toHaveLength(1);
    click('nextidle');expect(game.sel).toHaveLength(1);expect(game.sel[0]).not.toBe(first);
    hud.tick(1200);click('work');expect(game.mode).toBe('move');
    click('move');expect(game.mode).toBe('normal');
    game.sel=[];hud.tick(1400);expect(document.getElementById('bubble')!.classList.contains('hidden')).toBe(true);
  });
  it('updates Gen I, Gen II, Gen III and unit tabs on the Clan Selection screen in-place without flashing or recreating the 3D canvas', () => {
    const {hud,click}=setup();
    hud.openClan();
    const canvasBefore = document.getElementById('clan-stage-canvas');
    expect(canvasBefore).not.toBeNull();
    expect(document.getElementById('stage-gen-banner')!.textContent).toContain('Era I');

    click('pgen:2');
    expect(document.getElementById('clan-stage-canvas')).toBe(canvasBefore);
    expect(document.getElementById('stage-kicker')!.textContent).toContain('Gen II');
    expect(document.getElementById('stage-gen-banner')!.textContent).toContain('Era II');
    expect(document.getElementById('stage-unit-info')!.textContent).toContain('+15%');

    click('pgen:3');
    expect(document.getElementById('clan-stage-canvas')).toBe(canvasBefore);
    expect(document.getElementById('stage-kicker')!.textContent).toContain('Gen III');
    expect(document.getElementById('stage-gen-banner')!.textContent).toContain('Era III');
    expect(document.getElementById('stage-unit-info')!.textContent).toContain('+30%');

    const humanStats = document.getElementById('stage-unit-info')!.textContent;
    click('species:neanderthal');
    expect(document.getElementById('clan-stage-canvas')).toBe(canvasBefore);
    expect(document.querySelector('[data-act="punit:brute"]')).not.toBeNull();
    const neanStats = document.getElementById('stage-unit-info')!.textContent;
    expect(neanStats).not.toBe(humanStats);
    expect(neanStats).toContain('-8%');

    click('species:denisovan');
    const deniStats = document.getElementById('stage-unit-info')!.textContent;
    expect(deniStats).not.toBe(humanStats);
    expect(deniStats).not.toBe(neanStats);
    expect(deniStats).toContain('+1');

    // Verify Live Loadout & Gameplay Impact Strip and Active Clan Dossier update dynamically
    expect(document.getElementById('clan-impact-pills')!.textContent).toContain('+15% Weapon DMG & Reach');
    expect(document.getElementById('clan-impact-pills')!.textContent).toContain('Unique: Stalker');
    expect(document.getElementById('active-clan-dossier')!.textContent).toContain('Solari Clan');
    expect(document.getElementById('sum-clan-label')!.textContent).toContain('Denisovans');

    // Verify mobile deck tab switching (Units & Era -> Land -> Hero & Paint)
    click('clantab:map');
    expect(document.querySelector('.modal.clan')!.getAttribute('data-tab')).toBe('map');
    click('pmap:tundra');
    expect(document.getElementById('sum-map-label')!.textContent).toContain('Glacial Steppe');
    expect(document.getElementById('clan-impact-pills')!.textContent).toContain('Early Winter');

    click('clantab:custom');
    expect(document.querySelector('.modal.clan')!.getAttribute('data-tab')).toBe('custom');
    click('ppaint:azure');
    expect(document.getElementById('sum-clan-label')!.textContent).toContain('Lapis');
    expect(document.getElementById('clan-stage-canvas')).toBe(canvasBefore);
  });

  it('supports Interactive Tutorial, Story Campaign browser, Online Chat Lobby, Building Repair, Specialist Abilities, and Stockpile Barter', () => {
    const { hud, game, w, click } = setup();

    // 1. Interactive Tutorial Coach
    hud.tutorial.start(true);
    const banner = document.getElementById('tut-banner');
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains('hidden')).toBe(false);
    expect(banner!.textContent).toContain('Guided Tutorial');
    const gatherer = w.units.find((u) => u.owner === 0 && u.kind === 'gatherer')!;
    game.sel = [gatherer.id];
    const foodBefore = w.res.food;
    hud.tutorial.update();
    // Selecting a gatherer completes Step 1 and awards bonus food
    expect(w.res.food).toBeGreaterThan(foodBefore);
    hud.tutorial.stop(true);
    expect(banner!.classList.contains('hidden')).toBe(true);

    // 2. Story Campaign Modal & Chapter switching
    hud.openCampaign();
    expect(document.getElementById('modal')!.textContent).toContain('The Ancestral Saga');
    click('camp-ch:ch3_mammoth');
    expect(document.getElementById('modal')!.textContent).toContain('Blood of the Great Mammoth');
    click('camp-diff:ancestral');
    expect(document.querySelector('[data-act="camp-diff:ancestral"]')!.classList.contains('primary')).toBe(true);

    // 3. Online Multiplayer & Chat Rooms
    hud.openMultiplayer();
    expect(document.getElementById('modal')!.textContent).toContain('Online Lobby');
    click('mp-create');
    expect(document.getElementById('modal')!.textContent).toContain('ROOM CODE');
    click('mp-leave');

    // 4. Specialist Abilities: Elder Blessing, Scout Signal Flare, and Stockpile Barter
    const elder = { ...w.units[0], id: w.nextId++, kind: 'elder' as const, name: 'Elder Kael', hp: 30, maxHp: 75, ability: 0 };
    w.units.push(elder);
    step(w);
    const knBefore = w.res.knowledge;
    game.sel = [elder.id];
    hud.tick(1600);
    click('bless');
    expect(w.res.knowledge).toBe(knBefore + 6);
    expect(elder.hp).toBeGreaterThan(30);

    const scout = w.units.find((u) => u.owner === 0 && u.kind === 'scout')!;
    game.sel = [scout.id];
    hud.tick(1800);
    click('flare');
    expect(scout.ability).toBe(30);

    // 5. Building Repair & Stockpile Barter
    const hearth = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth')!;
    hearth.hp = hearth.maxHp - 50;
    game.sel = [];
    game.selB = hearth.id;
    hud.tick(2000);
    click('repair');
    expect(w.units.some((u) => u.owner === 0 && u.kind === 'gatherer' && u.order.t === 'build' && u.order.b === hearth.id)).toBe(true);

    // 6. Ancestral Megalith (3rd landmark) exists on world
    expect(w.landmarks.some((l) => l.id === 'shrine')).toBe(true);
  });
});

describe('resource measurements', () => {
  it('uses simulation time, excludes rivals from food demand, and resets after loading or rewinding', () => {
    const history=new ResourceHistory(),w=newWorld();w.time=0;history.sample(w);
    expect(history.rates(w,'food').net).toBeNull();
    w.res.food+=10;w.stats.food+=15;w.time=10;history.sample(w);
    expect(history.rates(w,'food').net).toBe(60);
    expect(history.rates(w,'food').gathered).toBe(90);
    expect(history.rates(w,'food').foodDemand).toBe(w.units.filter(u=>u.owner===0).length*5);
    w.time=5;history.sample(w);expect(history.rates(w,'food').net).toBeNull();
    const loaded={...w,time:20};history.sample(loaded);expect(history.rates(loaded,'food').net).toBeNull();
  });
});

