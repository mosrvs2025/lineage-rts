import './style.css';
import { placeCheck } from './sim/commands';
import { Game } from './ui/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
try {
  const game = new Game(canvas, minimap);
  (window as unknown as { game: Game }).game = game; // handy for debugging and automated play-testing
  (window as unknown as { __check: typeof placeCheck }).__check = placeCheck;
  game.startShowcase();
  game.hud.openStart();
} catch (e) {
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#10130f;color:#eef0e6;font:16px system-ui;padding:24px;text-align:center"><div><h2>Lineage needs WebGL</h2><p>Your browser could not start 3D graphics. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p><pre style="opacity:.6;white-space:pre-wrap">${String(e)}</pre></div></div>`);
}
