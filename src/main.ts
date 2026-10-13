import './style.css';
import { placeCheck } from './sim/commands';
import { Game } from './ui/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
const game = new Game(canvas, minimap);
(window as unknown as { game: Game }).game = game; // handy for debugging and automated play-testing
(window as unknown as { __check: typeof placeCheck }).__check = placeCheck;
game.hud.openStart();
