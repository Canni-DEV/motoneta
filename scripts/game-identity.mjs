import { readFileSync } from 'node:fs';
export const identity = JSON.parse(
  readFileSync(new URL('../src/identity.json', import.meta.url), 'utf8'),
);
export const browserIdentity = {
  settingsKey: `${identity.id}.settings.v2`,
  debugKey: `__${identity.id}`,
};
export const evidenceRoot = `docs/media/${identity.id}`;
