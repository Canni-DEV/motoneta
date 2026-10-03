import { BUILTINS } from '../core/maps';
import type { PlayerProfile } from '../core/game';
import type { Setup } from './screens';

export function modeSetup(mode: Setup['mode'], profiles: PlayerProfile[]): Setup {
  return {
    mode,
    selected: BUILTINS[0].ref.id,
    courses: mode === 'quick' ? [structuredClone(BUILTINS[0])] : [],
    bots: mode === 'tournament' ? 3 : 0,
    difficulty: 'normal',
    players: profiles.slice(0, 2).map((p) => p.id),
    filter: 'all',
  };
}
