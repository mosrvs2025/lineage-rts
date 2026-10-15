/** Tiny SVG preview of a map, drawn from the real generated terrain (cached per map). */
import { MAPS } from '../data/maps';
import { createWorld } from '../sim/world';

const cache = new Map<string, string>();
const GROUND: Record<string, string> = { autumn: '#5f8a3a', lush: '#4f9a44', tundra: '#b9c2c0', steppe: '#b9a364', badlands: '#c49a62' };
const TREE: Record<string, string> = { autumn: '#c0702a', lush: '#256a2a', tundra: '#2f5a46', steppe: '#7a7a3a', badlands: '#6a7a3a' };

export function mapThumb(id: string): string {
  const hit = cache.get(id); if (hit) return hit;
  const w = createWorld('human', 7, id), b = MAPS[id].biome;
  let r = '';
  for (let y = 0; y < w.H; y++) {
    let x = 0;
    while (x < w.W) {           // run-length rows keep the SVG small
      const c = w.terrain[y][x]; let n = 1; while (x + n < w.W && w.terrain[y][x + n] === c) n++;
      if (c !== '.') r += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${c === '^' ? (b === 'badlands' ? '#a8573a' : '#6e6a66') : c === '=' ? '#7fb6c8' : c === 'L' ? '#4a86b4' : '#2f6f9a'}"/>`;
      x += n;
    }
  }
  for (const n of w.nodes) r += `<rect x="${n.x}" y="${n.y}" width="1" height="1" fill="${n.kind === 'tree' ? TREE[b] : n.kind === 'rock' ? '#d8d8d8' : n.kind === 'fish' ? '#9fe0ff' : '#d84a4a'}"/>`;
  for (const u of w.units) if (u.kind === 'mammoth') r += `<circle cx="${u.x}" cy="${u.y}" r="1.6" fill="#5a3a22" stroke="#fff" stroke-width=".35"/>`;
  const svg = `<svg viewBox="0 0 ${w.W} ${w.H}" preserveAspectRatio="none"><rect width="${w.W}" height="${w.H}" fill="${GROUND[b]}"/>${r}<circle cx="10.5" cy="23" r="2.2" fill="#27b7c6" stroke="#fff" stroke-width=".6"/><circle cx="56" cy="36" r="2.2" fill="#d84a36" stroke="#fff" stroke-width=".6"/><path d="M66 6l2 3.5h-4z" fill="#ffd54a"/></svg>`;
  cache.set(id, svg); return svg;
}
