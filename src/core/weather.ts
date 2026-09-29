export const WEATHERS = ['clear', 'rain', 'snow'] as const;
export type Weather = (typeof WEATHERS)[number];
export const WEATHER_LABELS: Record<Weather, string> = {
  clear: 'Despejado',
  rain: 'Lluvia',
  snow: 'Nieve',
};

export function isWeather(value: unknown): value is Weather {
  return WEATHERS.includes(value as Weather);
}

/** Validate the environment required by current MotoNeta maps. */
export function readWeather(value: unknown): Weather {
  if (!isWeather(value)) throw new Error('Clima inválido: elegí Despejado, Lluvia o Nieve.');
  return value;
}
