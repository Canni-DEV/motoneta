import type { Surface, Weather } from './core/types';

export type Material = 'dirt' | 'mud' | 'grass' | 'wet' | 'snow';
/** Shared by audio and VFX; never participates in handling. */
export const materialFor = (surface: Surface = 'dirt', weather: Weather = 'clear'): Material =>
  weather === 'snow'
    ? 'snow'
    : surface === 'mud' || surface === 'grass'
      ? surface
      : weather === 'rain'
        ? 'wet'
        : 'dirt';
export const landingLevel = (speed: number): 0 | 1 | 2 => (speed < 1.7 ? 0 : speed < 3.5 ? 1 : 2);
