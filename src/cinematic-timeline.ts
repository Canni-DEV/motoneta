import type { Recording } from './core/game';

export type CinematicEventType = 'start' | 'jump' | 'land' | 'crash' | 'duel' | 'lap' | 'finish';
export interface CinematicEvent {
  frame: number;
  type: CinematicEventType;
  lap: number;
}
export interface SlowMotionWindow {
  lap: number;
  start: number;
  end: number;
}
export interface CinematicPose {
  frame: number;
  x: number;
  y: number;
  z: number;
}
export interface CinematicMoment {
  type: 'jump' | 'duel' | 'crash' | 'finish';
  lap: number;
  start: number;
  peak: number;
  end: number;
  score: number;
}
export interface CinematicTimeline {
  events: CinematicEvent[];
  moments: CinematicMoment[];
  poses: CinematicPose[];
  lapEnds: number[];
  slowMotion: SlowMotionWindow[];
  lastFrame: number;
}

/** Analysis runs away from the render loop and never changes the saved recording. */
export function analyzeRecording(recording: Recording): Promise<CinematicTimeline> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cinematic.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ timeline?: CinematicTimeline; error?: string }>) => {
      worker.terminate();
      event.data.timeline ? resolve(event.data.timeline) : reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'No se pudo preparar la repetición.'));
    };
    worker.postMessage(recording);
  });
}
