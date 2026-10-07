import { acceptResult, advanceSession, standings } from './core/competition';
import {
  recordKey,
  localProfile,
  raceProfile,
  type CompetitionSession,
  type PersonalRecord,
  type LocalProfile,
  type Recording,
} from './core/game';
import { emptyDesign, validateMap, type MapDesign } from './core/maps';
import { DATABASE_NAME, FILE_HEADER } from './identity';
import { defaultAppearance } from './appearance';
import { compatibleLoopGeometry } from './core/loop-geometry';

export interface SaveState {
  game: string;
  version: 4;
  profiles: LocalProfile[];
  activeProfile: string;
  maps: MapDesign[];
  records: PersonalRecord[];
  sessions: Partial<Record<'tournament' | 'versus', CompetitionSession>>;
  motonetaSessions: Record<string, CompetitionSession>;
  tanqueSessions: Record<string, CompetitionSession>;
  draft: MapDesign;
}
const initial = (): SaveState => ({
  ...FILE_HEADER,
  profiles: [localProfile({ id: 'player-1', name: 'Jugador 1', color: '#e05a3b', appearance: defaultAppearance('#e05a3b') })],
  activeProfile: 'player-1',
  maps: [],
  records: [],
  sessions: {},
  motonetaSessions: {},
  tanqueSessions: {},
  draft: emptyDesign(),
});
export class GameStore {
  state = initial();
  private db: IDBDatabase | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  async open() {
    this.db?.close();
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 5);
      let upgrading: IDBDatabase | null = null, blockedTimer: ReturnType<typeof setTimeout> | undefined, failed = false;
      const fail = (error: Error | DOMException | null) => {
        failed = true;
        clearTimeout(blockedTimer);
        upgrading?.close();
        reject(error);
      };
      request.onupgradeneeded = (event) => {
        const db = upgrading = request.result;
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
        if (!db.objectStoreNames.contains('replays')) db.createObjectStore('replays');
        if (event.oldVersion > 0 && event.oldVersion < 4) {
          request.transaction!.objectStore('data').clear();
          request.transaction!.objectStore('replays').clear();
        }
        if (event.oldVersion === 4) {
          const tx = request.transaction!, data = tx.objectStore('data'), read = data.get('state');
          // One upgrade transaction commits maps, progression and replay removal together.
          read.onsuccess = () => {
            try {
              const stored = read.result as SaveState | undefined;
              if (stored) {
                data.put({ ...stored, ...FILE_HEADER,
                  maps: stored.maps.map(validateMap), draft: validateMap(stored.draft),
                  records: [], sessions: {}, motonetaSessions: {}, tanqueSessions: {} }, 'state');
              }
              tx.objectStore('replays').clear();
            } catch { tx.abort(); }
          };
        }
      };
      request.onsuccess = () => {
        clearTimeout(blockedTimer);
        if (failed) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      // A closing connection can briefly block an upgrade until its transaction finishes.
      request.onblocked = () => {
        blockedTimer ??= setTimeout(() => fail(new Error('Cerrá otras pestañas del juego para actualizar el guardado.')), 1000);
      };
    });
    this.db.onversionchange = () => this.db?.close();
    const stored = await this.get<SaveState>('data', 'state');
    if (stored) {
      this.state = structuredClone(stored);
      this.state.profiles = stored.profiles.map(localProfile);
      this.state.motonetaSessions ??= {};
      this.state.tanqueSessions ??= {};
      await this.invalidateObsoleteLoops(stored);
    }
    else {
      this.state = initial();
      await this.update(() => {});
    }
  }
  private async invalidateObsoleteLoops(stored: SaveState) {
    const next = structuredClone(this.state);
    // Retire the old announcement metadata in the same atomic cleanup transaction.
    Reflect.deleteProperty(next, 'terrainNoticePending');
    const obsoleteSession = (session: CompetitionSession) =>
      session.courses.some(course => !compatibleLoopGeometry(course)) ||
      session.results.some(({ result }) => !compatibleLoopGeometry(result.config));
    next.records = next.records.filter(record => compatibleLoopGeometry(record.config));
    for (const mode of ['tournament', 'versus'] as const)
      if (next.sessions[mode] && obsoleteSession(next.sessions[mode]!)) delete next.sessions[mode];
    for (const bucket of [next.motonetaSessions, next.tanqueSessions])
      for (const [owner, session] of Object.entries(bucket))
        if (obsoleteSession(session)) delete bucket[owner];
    const changed = JSON.stringify(next) !== JSON.stringify(stored);
    // Metadata and replay invalidation share one transaction. Maps, progression
    // and unrelated records are preserved even if cleanup cannot be committed.
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(['data', 'replays'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudieron actualizar las repeticiones del loop.'));
      tx.onabort = () => reject(tx.error ?? new Error('No se pudieron actualizar las repeticiones del loop.'));
      try {
        if (changed) tx.objectStore('data').put(next, 'state');
        const cursor = tx.objectStore('replays').openCursor();
        cursor.onsuccess = () => {
          try {
            const entry = cursor.result;
            if (!entry) return;
            const replay = entry.value as Recording;
            if (!compatibleLoopGeometry(replay.config) || !compatibleLoopGeometry(replay.result.config)) entry.delete();
            entry.continue();
          } catch (error) {
            tx.abort();
            reject(error);
          }
        };
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
    this.state = next;
  }
  private get<T>(store: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('El almacenamiento no está disponible.'));
        return;
      }
      const r = this.db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  replay(id: string) {
    return this.get<Recording>('replays', id).then((value) => {
      if (!value) return value;
      if (!compatibleLoopGeometry(value.config) || !compatibleLoopGeometry(value.result.config)) return undefined;
      value.config.player = raceProfile(value.config.player);
      value.config.bots = value.config.bots.map(raceProfile);
      value.result.config.player = raceProfile(value.result.config.player);
      value.result.config.bots = value.result.config.bots.map(raceProfile);
      return value;
    });
  }
  update(
    change: (state: SaveState) => void | boolean,
    replay?: { id: string; value: Recording },
  ): Promise<void> {
    const action = async () => {
      const next = structuredClone(this.state);
      if (change(next) === false) return;
      await new Promise<void>((resolve, reject) => {
        if (!this.db) {
          reject(new Error('No se pudo guardar. Reintentá o exportá tus datos.'));
          return;
        }
        const tx = this.db.transaction(['data', 'replays'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar.'));
        tx.onabort = () => reject(tx.error ?? new Error('No se pudo guardar.'));
        try {
          tx.objectStore('data').put(next, 'state');
          if (replay) tx.objectStore('replays').put(replay.value, replay.id);
          const retained = new Set([
            ...next.records.flatMap((r) => [r.replayId, r.lapReplayId]),
            ...Object.values(next.sessions).flatMap((s) => s?.results.map((r) => r.replayId) ?? []),
            ...Object.values(next.motonetaSessions).flatMap((s) => s.results.map((r) => r.replayId)),
            ...Object.values(next.tanqueSessions).flatMap((s) => s.results.map((r) => r.replayId)),
          ]);
          const cursor = tx.objectStore('replays').openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (c) {
              if (!retained.has(String(c.key))) c.delete();
              c.continue();
            }
          };
        } catch (error) {
          tx.abort();
          reject(error);
        }
      });
      this.state = next;
    };
    const pending = this.queue.then(action);
    this.queue = pending.catch(() => {});
    return pending;
  }
  async commit(replay: Recording, session?: CompetitionSession) {
    const replayId = session
      ? `${session.id}:${session.courseIndex}:${session.turnIndex}`
      : crypto.randomUUID();
    await this.update(
      (s) => {
        if (session) {
          const ownerId = session.players[0].id;
          const current = session.presetId ? s[`${session.presetId}Sessions`][ownerId] : s.sessions[session.mode];
          if (
            !current ||
            current.id !== session.id ||
            current.courseIndex !== session.courseIndex ||
            current.turnIndex !== session.turnIndex ||
            current.phase !== 'ready'
          )
            return false;
          let accepted = acceptResult(current, replay.result, replayId);
          if (current.presetId) {
            if (accepted.results.length === accepted.courses.length) {
              accepted = advanceSession(accepted);
              const owner = s.profiles.find((p) => p.id === ownerId);
              const won = standings(accepted).some((row) => row.id === ownerId && row.rank === 1) &&
                (current.presetId !== 'tanque' || owner?.unlockedMotoneta === true);
              const flag = current.presetId === 'tanque' ? 'unlockedTanque' : 'unlockedMotoneta';
              accepted.reward = won && owner ? owner[flag] ? 'already-unlocked' : 'unlocked' : 'not-earned';
              if (won && owner) owner[flag] = true;
            }
            s[`${current.presetId}Sessions`][ownerId] = accepted;
          } else s.sessions[session.mode] = accepted;
        }
        const own = replay.result.finishes.find((f) => f.id === replay.config.player.id);
        if (
          replay.config.mode === 'practice' ||
          own?.ticks == null ||
          !s.profiles.some((p) => p.id === replay.config.player.id)
        )
          return;
        const key = recordKey(replay.config),
          old = s.records.find((r) => r.key === key);
        const lap = Math.min(...own.laps.map((n, i) => n - (own.laps[i - 1] ?? 0)));
        const faster = !old || own.ticks < old.ticks;
        const record: PersonalRecord = {
          key,
          profileId: replay.config.player.id,
          ref: structuredClone(replay.config.ref),
          config: structuredClone(faster ? replay.config : old.config),
          ticks: faster ? own.ticks : old.ticks,
          bestLap: Math.min(old?.bestLap ?? Infinity, lap),
          date: faster ? new Date().toISOString() : old.date,
          replayId: faster ? replayId : old.replayId,
          lapReplayId: !old || lap < old.bestLap ? replayId : old.lapReplayId,
        };
        s.records = [...s.records.filter((r) => r.key !== key), record];
      },
      { id: replayId, value: replay },
    );
  }
  async backup() {
    await this.queue;
    const replays = await new Promise<Record<string, Recording>>((resolve, reject) => {
      if (!this.db) {
        resolve({});
        return;
      }
      const all: Record<string, Recording> = {};
      const r = this.db.transaction('replays').objectStore('replays').openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (c) {
          all[String(c.key)] = c.value;
          c.continue();
        } else resolve(all);
      };
      r.onerror = () => reject(r.error);
    });
    return { ...FILE_HEADER, state: this.state, replays };
  }
}
