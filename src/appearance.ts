/** Stable visual-only IDs. All options share the motorcycle and rider rig. */
export const BIKE_SLOTS = ['fairing', 'fender', 'seat', 'exhaust', 'plate', 'wheels'] as const;
export const RIDER_SLOTS = ['helmet', 'visor', 'torso', 'gloves', 'pants', 'boots'] as const;
export const SLOTS = [...BIKE_SLOTS, ...RIDER_SLOTS] as const;
export const VARIANTS = ['core', 'sprint', 'trail'] as const;
export type SlotId = (typeof SLOTS)[number];
export type VariantId = (typeof VARIANTS)[number];
export type Paint = { primary: string; accent: string };
export interface Appearance {
  parts: Record<SlotId, VariantId>;
  paints: Record<SlotId, Paint>;
}

export const SLOT_LABELS: Record<SlotId, string> = {
  fairing: 'Carenado', fender: 'Guardabarros', seat: 'Asiento',
  exhaust: 'Escape', plate: 'Placa frontal', wheels: 'Ruedas',
  helmet: 'Casco', visor: 'Visor', torso: 'Torso',
  gloves: 'Guantes', pants: 'Pantalón', boots: 'Botas',
};
export const VARIANT_LABELS: Record<VariantId, string> = {
  core: 'Esencial', sprint: 'Competición', trail: 'Travesía',
};
const hex = /^#[0-9a-f]{6}$/i;

export function defaultAppearance(primary = '#e05a3b'): Appearance {
  const parts = {} as Appearance['parts'];
  const paints = {} as Appearance['paints'];
  for (const slot of SLOTS) {
    parts[slot] = 'core';
    paints[slot] = { primary, accent: '#eff0ec' };
  }
  return { parts, paints };
}

export function botAppearance(index: number, color: string): Appearance {
  const value = defaultAppearance(color);
  SLOTS.forEach((slot, i) => {
    value.parts[slot] = VARIANTS[(index + i) % VARIANTS.length];
  });
  return value;
}

export function isAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== 'object') return false;
  const appearance = value as Partial<Appearance>;
  return SLOTS.every((slot) =>
    VARIANTS.includes(appearance.parts?.[slot] as VariantId) &&
    hex.test(appearance.paints?.[slot]?.primary ?? '') &&
    hex.test(appearance.paints?.[slot]?.accent ?? ''),
  );
}

export function appearanceKey(value: Appearance): string {
  return SLOTS.map((slot) => {
    const paint = value.paints[slot];
    return `${value.parts[slot]}:${paint.primary}:${paint.accent}`;
  }).join('|');
}

/** Compare the actual fields so callers can still edit an appearance in place. */
export function sameAppearance(a: Appearance, b: Appearance): boolean {
  for (const slot of SLOTS) {
    if (a.parts[slot] !== b.parts[slot] ||
      a.paints[slot].primary !== b.paints[slot].primary ||
      a.paints[slot].accent !== b.paints[slot].accent) return false;
  }
  return true;
}
