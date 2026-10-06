import { terrainPolygons } from '../core/terrain';
import type { Segment } from '../core/types';

export const contourSvg = (piece: Segment, lane?: number) =>
  `<svg class="terrain-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${terrainPolygons(piece).map(p => `<polygon points="${p.map(([x,l]) => `${x/piece.length*100},${lane === undefined ? (l+0.5)*25 : (l-lane+0.5)*100}`).join(' ')}"/>`).join('')}</svg>`;
