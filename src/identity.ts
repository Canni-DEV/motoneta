import identity from './identity.json';

export const GAME_ID = identity.id;
export const GAME_NAME = identity.name;
export const GAME_TITLE = identity.words.join('');
export const GAME_LOGO = `<img class="brand-mark" src="${import.meta.env?.BASE_URL ?? './'}branding/motoneta-on-dark.svg" alt="" aria-hidden="true"><span class="sr-only">${GAME_TITLE}</span>`;
export const SETTINGS_KEY = `${GAME_ID}.settings.v2`;
export const DATABASE_NAME = `${GAME_ID}-game`;
export const DEBUG_KEY = `__${GAME_ID}`;
export const FORMAT_VERSION = 1;
export const RULESET = `${GAME_ID}-2`;
export const FILE_HEADER = { game: GAME_ID, version: FORMAT_VERSION } as const;
export function mapFilename(name: string) {
  const slug =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'circuito';
  return `${GAME_ID}-mapa-${slug}.json`;
}
