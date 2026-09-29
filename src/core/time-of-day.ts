export const TIMES_OF_DAY = ['morning', 'afternoon', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
export const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
};

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return TIMES_OF_DAY.includes(value as TimeOfDay);
}

/** Validate the environment required by current MotoNeta maps. */
export function readTimeOfDay(value: unknown): TimeOfDay {
  if (!isTimeOfDay(value)) throw new Error('Horario inválido: elegí Mañana, Tarde o Noche.');
  return value;
}
