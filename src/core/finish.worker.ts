import type { Race } from './game';
import { completeRace } from './racing';
self.onmessage = (event: MessageEvent<Race>) => {
  try {
    self.postMessage({ race: completeRace(event.data) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
