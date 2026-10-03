import { GameAudio } from './audio';
import { defaultAppearance, type Appearance, type SlotId, type VariantId } from './appearance';
import { CinematicCamera } from './cinematic-camera';
import { analyzeRecording, type CinematicTimeline } from './cinematic-timeline';
import { audioCreditsView } from './audio/credits';
import { loadBikeAssets } from './bike-model';
import { advanceSession, sessionConfig } from './core/competition';
import {
  COLORS,
  makeBots,
  recordKey,
  ticksToTime,
  type CompetitionSession,
  type PlayerProfile,
  type RaceConfig,
  type RaceCourse,
  type Recording,
} from './core/game';
import {
  BUILTINS,
  designFromTrack,
  emptyDesign,
  generateMap,
  generatorDefaults,
  mapCourse,
  validateMap,
  type GeneratorOptions,
  type MapDesign,
} from './core/maps';
import { abandonPlayer, createRace, isFinished, raceResult, stepRace } from './core/racing';
import { appendInput, newRecording, Playback, validateRecording } from './core/recording';
import {
  personalRecord,
  preparePersonalGhost,
  quickRaceConfig,
  type PersonalGhostReference,
} from './core/personal-ghost';
import { formatTime } from './core/simulation';
import { TIME_LABELS } from './core/time-of-day';
import {
  defaultSettings,
  STEP_MS,
  type AudioBus,
  type Race,
  type Settings,
  type TimeOfDay,
  type Weather,
} from './core/types';
import { WEATHER_LABELS } from './core/weather';
import { loadCrowdAssets } from './crowd-assets';
import { DEBUG_KEY, GAME_ID, mapFilename } from './identity';
import { Controls } from './input';
import { GameStore } from './persistence';
import { World } from './renderer';
import * as storage from './storage';
import { Dialogs } from './ui/dialogs';
import { patch } from './ui/dom';
import { Editor } from './ui/editor';
import { FocusedField } from './ui/focused-field';
import { garageView } from './ui/garage';
import {
  Navigation,
  setupPresentation,
  type Screen,
  type SetupPresentation,
} from './ui/navigation';
import { raceView, updateHud } from './ui/race-view';
import { personalGhostResults } from './ui/personal-ghost-view';
import {
  finishTable,
  generatorView,
  homeView,
  libraryView,
  recordsView,
  sessionView,
  setupView,
  type LibraryPresentation,
  type Setup,
} from './ui/screens';
import { SceneViewport } from './ui/viewport';
import { button as b, esc, header, icon, settingsView, type SettingsTab } from './ui/widgets';

export async function startApp() {
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  const settings = storage.settings(),
    controls = new Controls(settings),
    audio = new GameAudio(settings),
    store = new GameStore();
  $('#app').innerHTML =
    `<div id="backdrop-host" data-scene-host><canvas id="world" aria-label="Circuito de motocross en tres dimensiones"></canvas></div><div class="scene-shade"></div><div id="ui"></div><div id="attract-fade"></div><div id="toast" role="status" aria-live="polite"></div><dialog id="modal"></dialog><input id="import-file" type="file" accept=".json,application/json" hidden><div id="model-status" role="status">Cargando pilotos y estadio…</div><div id="size-gate" hidden>${icon('expand')}<h2>Espacio de pantalla insuficiente</h2><p id="size-message"></p>${b('fullscreen', 'Pantalla completa', '', 'class="primary"')}</div>`;
  const ui = $('#ui'),
    modal = $<HTMLDialogElement>('#modal');
  let screen: Screen = 'home';
  let world: World | null = null,
    models = 'loading',
    modelBusy = false,
    paused = false,
    activity: 'running' | 'finishing' | 'results' = 'results';
  let race: Race | null = null,
    recording: Recording | null = null,
    playback: Playback | null = null,
    lastRecording: Recording | null = null;
  let replayPresentation: 'none' | 'manual' | 'attract' = 'none';
  let timeline: CinematicTimeline | null = null;
  let timelinePending: Promise<CinematicTimeline> | null = null;
  let replayGeneration = 0;
  let cinematicHelpTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCinematicDiagnostic = 0;
  let attractIds: string[] = [];
  let attractIndex = 0;
  let attractStarting = false;
  let attractSuspended = false;
  let attractTicket = 0;
  let idleSince: number | null = null;
  let ghosts: Playback[] = [],
    ghostNames: PlayerProfile[] = [],
    session: CompetitionSession | null = null;
  let quickGhostEnabled = false;
  let quickStartGeneration = 0;
  let quickSetupSignature = '';
  let quickAttempt: { reference: PersonalGhostReference | null } | null = null;
  let returnScreen = 'quick',
    setup: Setup = {
      mode: 'quick',
      selected: BUILTINS[0].ref.id,
      courses: [
        {
          ...structuredClone(BUILTINS[0]),
          timeOfDay: settings.timeOfDay,
          weather: settings.weather,
        },
      ],
      bots: 0,
      difficulty: 'normal',
      players: [],
      filter: 'all',
    };
  let generator: GeneratorOptions = { ...generatorDefaults },
    generated: MapDesign | null = null,
    importKind: 'design' | 'replay' = 'design';
  let accumulator = 0,
    lastFrame = performance.now(),
    lastHud = 0,
    toastTimer = 0,
    saveBusy = false,
    startBusy = false,
    previewKey = '',
    storageReady = false;
  let activeTimeOfDay: TimeOfDay = settings.timeOfDay,
    activeWeather: Weather = settings.weather;
  const canvas = $<HTMLCanvasElement>('#world');
  const viewport = new SceneViewport(canvas, () => world);
  const dialogs = new Dialogs(modal);
  const navigation = new Navigation();
  const setupViews: Record<Setup['mode'], SetupPresentation> = {
    quick: setupPresentation(),
    tournament: setupPresentation(),
    versus: setupPresentation(),
  };
  const setupCache: Partial<Record<Setup['mode'], Setup>> = {};
  let settingsTab: SettingsTab = 'audio';
  let selectedProfile = store.state.activeProfile;
  let garage: { profileId: string; draft: Appearance; selected: SlotId } | null = null;
  let recordSelection = '';
  let generatorOrigin: Screen = 'quick';
  const libraryState: LibraryPresentation = {
    search: '',
    filter: 'all',
    selected: BUILTINS[0].ref.id,
  };
  let pendingReplacement: (() => void) | null = null;
  let publishing = false;
  let resultFeedbackPlayed = false;
  let previousBest = Infinity;
  const celebratedSessions = new Set<string>();
  const focusedField = new FocusedField();
  const toast = (message: string, alert = false) => {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    if (modal.open) {
      let feedback = modal.querySelector<HTMLElement>('#dialog-feedback');
      if (!feedback) {
        feedback = document.createElement('p');
        feedback.id = 'dialog-feedback';
        feedback.className = 'dialog-feedback';
        modal.querySelector('.dialog-heading')!.append(feedback);
      }
      feedback.textContent = message;
      feedback.setAttribute('role', alert ? 'alert' : 'status');
    }
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      $('#toast').classList.remove('visible');
      modal.querySelector('#dialog-feedback')?.remove();
    }, 6000);
  };
  const error = (e: unknown) => {
    toast(e instanceof Error ? e.message : String(e), true);
    void audio.interfaceSound('error');
  };
  const safely = (p: Promise<unknown>) => void p.catch(error);
  try {
    await store.open();
    storageReady = true;
  } catch (e) {
    error(e);
  }
  const profile = () =>
    store.state.profiles.find((p) => p.id === store.state.activeProfile) ?? store.state.profiles[0];
  const quickConfig = () => quickRaceConfig(setup.courses[0], profile(), setup.bots, setup.difficulty);
  const editor = new Editor(
    store.state.draft,
    (d) =>
      store.update((s) => {
        s.draft = structuredClone(d);
      }),
    () => render(),
    (message) => error(new Error(message)),
    (kind) => {
      void audio.interfaceSound(kind);
    },
  );
  editor.markPublished(store.state.maps.find((m) => m.id === editor.design.id));
  const catalog = () => [...BUILTINS, ...store.state.maps.map(mapCourse)];
  const closeModal = () => {
    audio.stopPreview();
    controls.onKey = null;
    dialogs.close();
  };
  const showModal = (html: string) => {
    controls.clear();
    controls.onKey = null;
    dialogs.show(html);
  };
  function environment(time: TimeOfDay, weather: Weather, animate = false) {
    activeTimeOfDay = time;
    activeWeather = weather;
    document.body.dataset.timeOfDay = time;
    document.body.dataset.weather = weather;
    world?.setTimeOfDay(time, animate);
    world?.setWeather(weather, animate);
  }
  function preview(c: RaceCourse, editorMode = false) {
    if (!world) return;
    const key = c.ref.id + ':' + c.ref.revision;
    if (previewKey !== key) {
      world.setTrack(c.track);
      previewKey = key;
    }
    world.mode = editorMode ? 'editor' : 'menu';
    environment(c.timeOfDay, c.weather);
  }
  function render() {
    document.body.dataset.screen = screen;
    if (screen === 'race') return;
    controls.enabled = false;
    controls.gamepadActive = false;
    const heading = header(screen, store.state.profiles, store.state.activeProfile);
    let content = '';
    let course = BUILTINS[0];
    if (screen === 'garage' && garage) {
      const owner = store.state.profiles.find((p) => p.id === garage!.profileId);
      content = garageView(owner?.name ?? 'Jugador', garage.draft, garage.selected);
    } else if (screen === 'home') content = homeView(store.state);
    else if (screen === 'editor') {
      content = editor.html();
      course = mapCourse(editor.design);
    } else if (screen === 'records') content = recordsView(store.state, recordSelection);
    else if (screen === 'library') {
      content = libraryView(catalog(), libraryState);
      course = catalog().find((c) => c.ref.id === libraryState.selected) ?? BUILTINS[0];
    } else if (screen === 'generator') {
      content = generatorView(generator, generated);
      course = generated ? mapCourse(generated) : (setup.courses[0] ?? BUILTINS[0]);
    } else if (screen === 'session' && session) {
      content = sessionView(session);
      course = session.courses[Math.min(session.courseIndex, session.courses.length - 1)];
    } else {
      const config = setup.mode === 'quick' ? quickConfig() : null;
      const signature = config ? JSON.stringify([config, quickGhostEnabled]) : '';
      if (signature !== quickSetupSignature) {
        quickSetupSignature = signature;
        quickStartGeneration++;
      }
      const record = config ? personalRecord(store.state.records, config) : undefined;
      content = setupView(
        setup,
        catalog(),
        store.state.profiles,
        models === 'ready' && !startBusy,
        setupViews[setup.mode],
        config ? { record, enabled: quickGhostEnabled, available: !!record && storageReady, busy: startBusy } : undefined,
      );
      course = setup.courses[setupViews[setup.mode].course] ?? setup.courses[0] ?? BUILTINS[0];
    }
    patch(ui, heading + content);
    const host = ui.querySelector<HTMLElement>('[data-scene-host]') ?? $('#backdrop-host');
    viewport.attach(host, screen === 'editor' ? 'editor' : 'menu');
    preview(course, screen === 'editor');
    if (screen === 'garage' && garage) {
      world?.setGarage(garage.draft);
      const stage = ui.querySelector<HTMLElement>('#garage-stage');
      let lastX: number | null = null;
      stage?.addEventListener('pointerdown', (event) => {
        if ((event.target as Element).closest('button')) return;
        lastX = event.clientX;
        stage.setPointerCapture(event.pointerId);
      });
      stage?.addEventListener('pointermove', (event) => {
        if (lastX === null || !world) return;
        world.garageYaw += (event.clientX - lastX) * 0.009;
        lastX = event.clientX;
      });
      stage?.addEventListener('pointerup', () => { lastX = null; });
      stage?.addEventListener('pointercancel', () => { lastX = null; });
      stage?.addEventListener('wheel', (event) => {
        if (!world) return;
        event.preventDefault();
        world.garageZoom = Math.max(2.3, Math.min(6, world.garageZoom + event.deltaY * 0.004));
      }, { passive: false });
    }
    if (screen === 'editor') {
      editor.bind(ui);
      if (world) world.preview = editor.cursor / editor.design.length;
    }
    let warning = document.getElementById('storage-warning');
    if (!storageReady && !warning) {
      warning = document.createElement('div');
      warning.id = 'storage-warning';
      warning.className = 'storage-error';
      warning.innerHTML =
        'El guardado no está disponible. ' +
        b('retry-storage', 'Reintentar') +
        b('backup', 'Exportar datos');
      $('#app').append(warning);
    } else if (storageReady) warning?.remove();
  }
  function navigate(next: Screen, remember = true) {
    quickStartGeneration++;
    quickAttempt = null;
    if (cinematicHelpTimer) clearTimeout(cinematicHelpTimer);
    attractTicket++;
    attractStarting = false;
    attractIds = [];
    if (screen === 'editor' && next !== 'editor') {
      editor.cameraZoom = world?.zoomTarget ?? 1;
      editor.unbind(ui);
    }
    if (screen === 'garage' && next !== 'garage') {
      world?.setGarage(null);
      garage = null;
    }
    if (remember) navigation.enter(next);
    setupCache[setup.mode] = setup;
    closeModal();
    controls.clear();
    session = null;
    race = null;
    ghosts = [];
    playback = null;
    replayPresentation = 'none';
    timeline = null;
    timelinePending = null;
    replayGeneration++;
    attractSuspended = false;
    document.body.dataset.cinematic = 'false';
    document.body.dataset.attract = 'false';
    if (world) {
      world.cinematic = null;
      world.ghostStart = Infinity;
      if (next === 'editor') world.zoomTarget = editor.cameraZoom;
      else world.resetZoom();
    }
    if (['quick', 'tournament', 'versus'].includes(next)) {
      const mode = next as Setup['mode'];
      if (setup.mode !== mode)
        setup = setupCache[mode] ?? {
          mode,
          selected: BUILTINS[0].ref.id,
          courses: mode === 'quick' ? [structuredClone(BUILTINS[0])] : [],
          bots: mode === 'tournament' ? 3 : 0,
          difficulty: 'normal',
          players: store.state.profiles.slice(0, 2).map((p) => p.id),
          filter: 'all',
        };
      if (mode === 'quick' && setup.courses.length && !setupCache[mode]) {
        setup.courses[0].timeOfDay = settings.timeOfDay;
        setup.courses[0].weather = settings.weather;
      }
    }
    screen = next;
    idleSince = next === 'home' && audio.unlocked ? performance.now() : null;
    render();
    checkSize();
    navigation.restoreFocus(ui);
    window.scrollTo(0, 0);
  }
  function refreshSession(mode: 'tournament' | 'versus') {
    session = store.state.sessions[mode] ?? null;
    navigation.enter('session');
    screen = 'session';
    closeModal();
    render();
    if (session?.phase === 'complete' && !celebratedSessions.has(session.id)) {
      celebratedSessions.add(session.id);
      audio.playCue('podium', 0.2);
    }
    window.scrollTo(0, 0);
  }
  async function prepareWorld() {
    if (world || modelBusy) return;
    modelBusy = true;
    models = 'loading';
    $('#model-status').hidden = false;
    $('#model-status').textContent = 'Cargando pilotos y estadio…';
    try {
      const [assets, crowd] = await Promise.all([loadBikeAssets(), loadCrowdAssets()]);
      world = new World(canvas, settings, assets, crowd);
      models = 'ready';
      $('#model-status').hidden = true;
      previewKey = '';
      render();
    } catch (e) {
      models = 'error';
      $('#model-status').innerHTML =
        `No se pudo cargar la vista 3D. Comprobá WebGL 2 y los archivos del juego. ${b('retry-models', 'Reintentar')}`;
      console.warn(e);
    } finally {
      modelBusy = false;
    }
  }
  function viewRace(): Race | null {
    return race
      ? { ...race, riders: [...race.riders, ...ghosts.map((g) => g.race.riders[0])] }
      : null;
  }
  function run(
    config: RaceConfig | null,
    watch: Recording | null = null,
    ghostRecordings: Recording[] = [],
    presentation: 'manual' | 'attract' = 'manual',
    preparedTimeline: CinematicTimeline | null = null,
    attempt: { reference: PersonalGhostReference | null } | null = null,
  ) {
    if (!world || models !== 'ready') {
      toast('Esperá a que la vista 3D esté lista.');
      return;
    }
    // A new race or replay supersedes any pending personal-ghost load.
    quickStartGeneration++;
    if (screen !== 'race') navigation.rememberView();
    closeModal();
    paused = false;
    activity = 'running';
    controls.clear();
    controls.enabled = !watch;
    controls.gamepadActive = true;
    accumulator = 0;
    playback = watch ? new Playback(watch) : null;
    replayGeneration++;
    replayPresentation = watch ? presentation : 'none';
    timeline = preparedTimeline;
    timelinePending = watch && !preparedTimeline ? analyzeRecording(watch) : null;
    void timelinePending?.catch(() => {});
    world.cinematic = preparedTimeline ? new CinematicCamera(preparedTimeline) : null;
    document.body.dataset.cinematic = String(!!world.cinematic);
    document.body.dataset.attract = String(presentation === 'attract' && !!watch);
    race = playback?.race ?? createRace(config!);
    quickAttempt = attempt;
    recording = watch ? null : newRecording(config!);
    lastRecording = watch;
    ghosts = ghostRecordings.map((r) => new Playback(r));
    ghostNames = ghostRecordings.map((r) => r.config.player);
    const appearanceConfig = watch ? watch.config : config!;
    world.appearances = [appearanceConfig.player, ...appearanceConfig.bots, ...ghostRecordings.map((r) => r.config.player)]
      .map((p) => structuredClone(p.appearance));
    world.ghostStart = race.riders.length;
    world.ensureBikes(race.riders.length + ghosts.length);
    world.setTrack(race.track);
    world.beginRace(race);
    world.mode = 'race';
    if (screen === 'editor') editor.cameraZoom = world.zoomTarget;
    world.resetZoom();
    previewKey = '';
    const c = watch ? watch.config : config!;
    environment(c.timeOfDay, c.weather);
    if (screen === 'editor') editor.unbind(ui);
    screen = 'race';
    document.body.dataset.screen = 'race';
    patch(ui, presentation === 'attract' && watch
      ? '<div class="attract-hint">Escape para volver al menú</div>'
      : raceView(race, ghostNames, !!watch, quickAttempt?.reference) + (watch ? `<div class="cinematic-controls">${b('toggle-cinematic', icon('camera'), '', 'class="cinematic-toggle" aria-label="Activar cámara cinematográfica" aria-pressed="false" data-tooltip="Activar cámara cinematográfica · C"')}</div>` : ''));
    viewport.attach($('#backdrop-host'), 'race');
    document.querySelector('.race-identity>div')?.insertAdjacentHTML(
      'beforeend',
      `<small class="race-time-of-day">${TIME_LABELS[activeTimeOfDay]} · ${WEATHER_LABELS[activeWeather]}</small>`,
    );
    controls.bindTouch(ui);
    window.scrollTo(0, 0);
    resultFeedbackPlayed = false;
    previousBest = config
      ? (store.state.records.find((v) => v.key === recordKey(config))?.ticks ?? Infinity)
      : Infinity;
    audio.beginRace();
    audio.setSlowMotion(false);
    audio.setScene(presentation === 'attract' && watch ? 'cinematic' : 'countdown', activeWeather);
    void audio.unlock();
  }
  function updateCinematicButton(showHelp = false) {
    const button = ui.querySelector<HTMLButtonElement>('[data-action="toggle-cinematic"]');
    if (!button) return;
    const active = !!world?.cinematic;
    const label = active ? 'Volver a cámara normal' : 'Activar cámara cinematográfica';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(active));
    button.dataset.tooltip = `${label} · C`;
    if (showHelp && matchMedia('(pointer: coarse)').matches) {
      button.classList.add('show-help');
      if (cinematicHelpTimer) clearTimeout(cinematicHelpTimer);
      cinematicHelpTimer = setTimeout(() => button.classList.remove('show-help'), 1800);
    }
  }
  function toggleCinematic(showHelp = false) {
    if (screen !== 'race' || !playback || replayPresentation !== 'manual' || !world) return;
    if (world.cinematic) {
      world.cinematic = null;
      document.body.dataset.cinematic = 'false';
      audio.setSlowMotion(false);
      audio.setScene(race?.phase === 'countdown' ? 'countdown' : 'race', activeWeather);
    } else {
      const generation = replayGeneration;
      const director = new CinematicCamera(timeline ?? { events: [], moments: [], poses: [], lapEnds: [], slowMotion: [], lastFrame: 0 });
      world.cinematic = director;
      document.body.dataset.cinematic = 'true';
      audio.setScene(paused ? 'pause' : 'cinematic', activeWeather);
      $('#toast').classList.remove('visible');
      $('#toast').textContent = '';
      if (!timeline) {
        void (timelinePending ?? analyzeRecording(playback.recording)).then((prepared) => {
          if (generation !== replayGeneration || screen !== 'race' || world?.cinematic !== director) return;
          timeline = prepared;
          director.timeline = prepared;
        }).catch((error) => {
          if (generation !== replayGeneration || world?.cinematic !== director) return;
          world.cinematic = null;
          document.body.dataset.cinematic = 'false';
          audio.setScene(race?.phase === 'countdown' ? 'countdown' : 'race', activeWeather);
          updateCinematicButton();
          toast(error instanceof Error ? error.message : 'No se pudo preparar la repetición.', true);
        });
      }
    }
    updateCinematicButton(showHelp);
  }
  function exitAttract() {
    if (replayPresentation !== 'attract' && !attractStarting) return;
    attractTicket++;
    attractStarting = false;
    attractIds = [];
    attractSuspended = false;
    $('#app').classList.remove('attract-fading');
    audio.setSlowMotion(false);
    navigate('home', false);
  }
  async function playAttractNext() {
    const ticket = attractTicket;
    for (let attempts = 0; attempts < attractIds.length; attempts++) {
      const id = attractIds[attractIndex++ % attractIds.length];
      try {
        const next = await store.replay(id);
        if (!next) continue;
        const prepared = await analyzeRecording(next);
        if (ticket !== attractTicket || (screen !== 'home' && replayPresentation !== 'attract')) return;
        run(null, next, [], 'attract', prepared);
        $('#app').classList.remove('attract-fading');
        attractStarting = false;
        return;
      } catch {
        // A missing or incompatible local replay must not interrupt the playlist.
      }
    }
    if (ticket === attractTicket) exitAttract();
  }
  function startAttract() {
    if (attractStarting || screen !== 'home') return;
    attractIds = store.state.records
      .filter((record) => record.profileId === store.state.activeProfile)
      .sort((a, b) => a.ticks - b.ticks)
      .map((record) => record.replayId);
    idleSince = performance.now();
    if (!attractIds.length) return;
    attractStarting = true;
    attractIndex = 0;
    attractTicket++;
    safely(playAttractNext());
  }
  function markHomeActivity() {
    if (screen !== 'home') return;
    idleSince = audio.unlocked ? performance.now() : null;
    if (attractStarting) {
      attractTicket++;
      attractStarting = false;
      attractIds = [];
    }
  }
  document.addEventListener('pointermove', markHomeActivity, { passive: true });
  document.addEventListener('pointerdown', () => {
    markHomeActivity();
    if (!audio.unlocked) void audio.unlock();
  }, { passive: true });
  document.addEventListener('wheel', markHomeActivity, { passive: true });
  document.addEventListener('keydown', () => {
    markHomeActivity();
    if (!audio.unlocked) void audio.unlock();
  });
  function pause() {
    if (screen !== 'race' || activity !== 'running') return;
    paused = true;
    controls.clear();
    audio.setScene('pause', activeWeather);
    audio.update(race, false);
    showModal(
      `<h2>Pausa</h2><div class="stack">${b('resume', 'Continuar', '', 'class="primary"')}${!session ? b('retry', 'Reiniciar') : ''}${b('settings', 'Ajustes')}${b('leave-race', session ? 'Abandonar carrera' : 'Salir')}</div>`,
    );
  }
  function resume() {
    if (!$('#size-gate').hidden) return;
    closeModal();
    paused = false;
    controls.clear();
    accumulator = 0;
    audio.setScene(world?.cinematic ? 'cinematic' : race?.phase === 'countdown' ? 'countdown' : 'race', activeWeather);
  }
  async function finishInWorker(r: Race): Promise<Race> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./core/finish.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e) => {
        worker.terminate();
        e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.race);
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage(r);
    });
  }
  function showResult(saved = true) {
    if (!race) return;
    const r = race,
      own = r?.finishes.find((f) => f.id === r.config.player.id);
    const table = r?.config.bots.length
      ? finishTable(r.finishes, [r.config.player, ...r.config.bots])
      : '';
    const time = own?.ticks == null ? 'No terminó' : formatTime(ticksToTime(own.ticks));
    const comparison = quickAttempt?.reference ? personalGhostResults(r, quickAttempt.reference) : '';
    const best =
      recording && store.state.records.find((v) => v.key === recordKey(recording!.config));
    if (saved && !playback && !resultFeedbackPlayed && recording && own?.ticks != null) {
      resultFeedbackPlayed = true;
      if (
        recording.config.mode !== 'practice' &&
        own.ticks < previousBest &&
        best?.ticks === own.ticks
      )
        audio.playCue('record', 0.2, 0.7);
      else if (r && r.config.bots.length && r.rank === 1) audio.playCue('victory', 0.2, 0.7);
    }
    showModal(
      `<h2>${playback ? 'Repetición finalizada' : 'Resultado'}</h2><div class="result-time">${time}</div><p class="dialog-description">${TIME_LABELS[activeTimeOfDay]} · ${WEATHER_LABELS[activeWeather]}</p>${best && own?.ticks === best.ticks ? '<p>Mejor marca personal</p>' : ''}${table}${comparison || `<div class="lap-times">${race.laps.map((t, i) => `<span>Vuelta ${i + 1}<b>${formatTime(t - (race!.laps[i - 1] ?? 0))}</b></span>`).join('')}</div>`}${!saved ? `<p role="alert">No se pudo guardar el resultado. Reintentá o exportá la repetición.</p>${b('retry-save', 'Reintentar guardado', '', 'class="primary"')}` : ''}<div class="actions">${!session ? b('retry', 'Volver a correr', '', saved ? '' : 'disabled') : ''}${b('watch', 'Ver repetición', '', saved ? '' : 'disabled')}${b('export-replay', 'Exportar repetición')}${b('leave-race', session ? 'Ver clasificación' : returnScreen === 'editor' ? 'Editor' : 'Volver', '', !saved ? 'disabled' : 'class="primary"')}</div>`,
    );
  }
  async function finish() {
    if (!race || saveBusy) return;
    saveBusy = true;
    activity = 'finishing';
    audio.setScene('results', activeWeather);
    controls.enabled = false;
    audio.update(race, false);
    try {
      if (playback) {
        if (playback.recording.termination === 'abandoned') audio.playCue('dnf', 0.2);
        activity = 'results';
        lastRecording = playback.recording;
        race.finishes = structuredClone(playback.recording.result.finishes);
        race.phase = 'finished';
        if (replayPresentation === 'attract') {
          $('#app').classList.add('attract-fading');
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (replayPresentation === 'attract') await playAttractNext();
          return;
        }
        showResult();
        return;
      }
      showModal('<h2>Resultados</h2><p>Calculando llegadas…</p>');
      let r = race;
      if (r.phase !== 'finished') {
        r = await finishInWorker(r);
        race = r;
      }
      recording!.result = raceResult(r);
      lastRecording = recording;
      try {
        await store.commit(recording!, session ?? undefined);
        if (session) session = store.state.sessions[session.mode]!;
        activity = 'results';
        showResult();
      } catch (e) {
        activity = 'results';
        error(e);
        showResult(false);
        modal
          .querySelector('.dialog-actions')
          ?.insertAdjacentHTML('beforeend', b('leave-unsaved', 'Salir sin guardar'));
      }
    } catch (e) {
      error(e);
      showModal(
        `<h2>No se pudo calcular el resultado</h2><div class="actions">${b('retry-finish', 'Reintentar')}${b('export-replay', 'Exportar repetición')}</div>`,
      );
    } finally {
      saveBusy = false;
    }
  }
  async function startQuickRace(config: RaceConfig, includeGhost: boolean, origin: Screen, generation: number) {
    const current = () => generation === quickStartGeneration && screen === origin;
    let reference: PersonalGhostReference | null = null;
    const recordings: Recording[] = [];
    if (includeGhost) {
      const record = personalRecord(store.state.records, config);
      if (!record) throw new Error('No hay un récord para esta configuración.');
      let source: Recording | undefined;
      try {
        source = await store.replay(record.replayId);
      } catch (error) {
        if (!current()) return;
        throw error;
      }
      if (!current()) return;
      if (!source) throw new Error('No se encontró la repetición de tu récord. Podés desmarcar el fantasma y comenzar.');
      const prepared = preparePersonalGhost(record, config, source);
      recordings.push(prepared.replay);
      reference = prepared.reference;
    }
    if (!current()) return;
    returnScreen = 'quick';
    session = null;
    run(config, null, recordings, 'manual', null, { reference });
  }

  async function retryQuickRace() {
    if (startBusy || !recording || !quickAttempt) return;
    startBusy = true;
    const button = modal.querySelector<HTMLButtonElement>('[data-action="retry"]');
    if (button) button.disabled = true;
    try {
      await startQuickRace(structuredClone(recording.config), !!quickAttempt.reference, 'race', quickStartGeneration);
    } finally {
      startBusy = false;
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function startSetup(replace = false) {
    if (startBusy) return;
    startBusy = true;
    try {
      if (models !== 'ready') throw new Error('Esperá a que la vista 3D esté lista.');
      if (setup.mode === 'quick') {
        const config = quickConfig();
        const includeGhost = quickGhostEnabled && storageReady && !!personalRecord(store.state.records, config);
        render();
        await startQuickRace(config, includeGhost, 'quick', quickStartGeneration);
        return;
      }
      if (setup.courses.length < (setup.mode === 'tournament' ? 3 : 1))
        throw new Error(
          setup.mode === 'tournament'
            ? 'Seleccioná al menos tres mapas diferentes.'
            : 'Seleccioná al menos un mapa.',
        );
      if (setup.mode === 'versus' && (setup.players.length < 2 || setup.players.length > 6))
        throw new Error('Versus requiere entre 2 y 6 jugadores.');
      const old = store.state.sessions[setup.mode];
      if (old && old.phase !== 'complete' && !replace) {
        showModal(
          `<h2>Competición pendiente</h2><p>Crear otra reemplaza el progreso guardado de este modo.</p><div class="actions">${b('resume-session', 'Continuar pendiente', setup.mode)}${b('replace-session', 'Reemplazar')}${b('close-modal', 'Cancelar')}</div>`,
        );
        return;
      }
      const s: CompetitionSession = {
        id: crypto.randomUUID(),
        mode: setup.mode,
        players: structuredClone(
          setup.mode === 'tournament'
            ? [profile()]
            : setup.players.map((id) => store.state.profiles.find((p) => p.id === id)!),
        ),
        bots: setup.mode === 'tournament' ? makeBots(setup.bots) : [],
        difficulty: setup.difficulty,
        courses: structuredClone(setup.courses),
        courseIndex: 0,
        turnIndex: 0,
        results: [],
        phase: 'ready',
        seed: 1984,
      };
      await store.update((state) => {
        state.sessions[s.mode] = s;
      });
      refreshSession(s.mode);
    } finally {
      startBusy = false;
      if (screen === 'quick') render();
    }
  }
  async function beginTurn() {
    if (startBusy || !session || session.phase !== 'ready') return;
    startBusy = true;
    try {
      const recordings: Recording[] = [];
      if (session.mode === 'versus')
        for (const result of session.results.filter((r) => r.course === session!.courseIndex)) {
          const replay = await store.replay(result.replayId);
          if (replay) recordings.push(replay);
        }
      returnScreen = 'session';
      const config = sessionConfig(session);
      const current = store.state.profiles.find((p) => p.id === config.player.id);
      if (current) config.player.appearance = structuredClone(current.appearance);
      run(config, null, recordings);
    } finally {
      startBusy = false;
    }
  }
  function profilesView() {
    const p = store.state.profiles.find((p) => p.id === selectedProfile) ?? profile();
    selectedProfile = p.id;
    showModal(
      '<h2>Perfiles locales</h2><div class="profile-layout"><div class="profile-list">' +
        store.state.profiles
          .map((v) =>
            b(
              'profile-select',
              '<i class="color-dot" style="background:' +
                v.color +
                '"></i><span>' +
                esc(v.name) +
                '</span>',
              v.id,
              'aria-pressed="' + (v.id === p.id) + '"',
            ),
          )
          .join('') +
        '</div><div class="profile-row"><label>Nombre<input data-profile-name="' +
        esc(p.id) +
        '" maxlength="40" value="' +
        esc(p.name) +
        '"></label><label>Color<input type="color" data-profile-color="' +
        esc(p.id) +
        '" value="' +
        p.color +
        '"></label><div class="actions">' +
        b(
          'activate-profile',
          p.id === store.state.activeProfile ? 'Perfil activo' : 'Usar perfil',
          p.id,
          p.id === store.state.activeProfile ? 'disabled' : 'class="primary"',
        ) +
        b(
          'delete-profile',
          'Eliminar',
          p.id,
          store.state.profiles.length === 1 ? 'disabled' : 'class="danger"',
        ) +
        b('garage-open', 'Personalizar moto y piloto', p.id, 'class="primary"') +
        '</div></div></div><div class="actions">' +
        b('add-profile', 'Añadir perfil') +
        b('close-modal', 'Listo', '', 'class="primary"') +
        '</div><p class="muted">Los perfiles y sus marcas se guardan en este navegador.</p>',
    );
  }
  async function leaveGarage(save: boolean) {
    if (!garage) return;
    if (save) {
      const { profileId, draft } = garage;
      await store.update((state) => {
        const owner = state.profiles.find((p) => p.id === profileId);
        if (owner) owner.appearance = structuredClone(draft);
      });
    }
    garage = null;
    navigate(navigation.back(), false);
    profilesView();
  }
  function library() {
    if (screen !== 'library') navigate('library');
    else {
      closeModal();
      render();
    }
  }
  function guardReplacement(replace: () => void) {
    if (!editor.dirty) {
      replace();
      return;
    }
    pendingReplacement = replace;
    showModal(
      '<h2>Cambios sin publicar</h2><p>Tu borrador tiene cambios. Guardalos antes de abrir otra pista o descartalos para continuar.</p><div class="actions">' +
        b('save-replace', 'Guardar y continuar', '', 'class="primary"') +
        b('discard-replace', 'Descartar cambios') +
        b('cancel-replace', 'Cancelar') +
        '</div>',
    );
  }
  function replaceDesign(d: MapDesign) {
    guardReplacement(() => {
      closeModal();
      editor.markPublished(store.state.maps.find((m) => m.id === d.id));
      editor.replace(d);
      editor.markPublished(store.state.maps.find((m) => m.id === d.id));
      navigate('editor');
    });
  }
  async function saveDesign(copy = false) {
    if (publishing) return false;
    const d = validateMap(editor.design);
    const snapshot = JSON.stringify(d);
    if (copy) d.id = crypto.randomUUID();
    publishing = true;
    try {
      await store.update((s) => {
        s.maps = [...s.maps.filter((m) => m.id !== d.id), d];
        if (JSON.stringify(validateMap(editor.design)) === snapshot) s.draft = d;
      });
      const unchanged = JSON.stringify(validateMap(editor.design)) === snapshot;
      if (unchanged) editor.design = d;
      if (!copy || unchanged) editor.markPublished(d);
      editor.saveState = unchanged ? 'saved' : editor.saveState;
      render();
      toast(
        unchanged
          ? 'Mapa guardado. Disponible en todos los modos.'
          : 'Versión guardada. Tus cambios más recientes siguen en el borrador.',
      );
      void audio.interfaceSound('saved');
      return unchanged;
    } catch (error) {
      editor.saveState = 'error';
      editor.updateStatus();
      throw error;
    } finally {
      publishing = false;
    }
  }
  function generatedPreview() {
    generated = generateMap(generator);
    render();
  }
  async function leaveRace() {
    if (activity === 'finishing') return;
    quickStartGeneration++;
    if (session && activity === 'running' && !playback) {
      showModal(
        `<h2>Abandonar carrera</h2><p>Este turno contará como no terminado y sumará cero puntos.</p>${b('confirm-abandon', 'Abandonar')}${b('resume', 'Continuar corriendo', '', 'class="primary"')}`,
      );
      paused = true;
      return;
    }
    closeModal();
    ghosts = [];
    controls.clear();
    controls.enabled = false;
    if (session) {
      refreshSession(session.mode);
      race = null;
    } else navigate((returnScreen === 'session' ? 'home' : returnScreen) as Screen, false);
  }
  document.addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!el || el.disabled) return;
    // Safari does not focus buttons on pointer clicks; retain the actual dialog/navigation opener.
    el.focus({ preventScroll: true });
    const action = el.dataset.action!,
      value = el.dataset.value ?? '';
    void audio.unlock();
    safely(
      (async () => {
        if (action === 'new-design') {
          replaceDesign(emptyDesign());
          return;
        }
        if (screen === 'editor' && editor.action(action, value)) return;
        switch (action) {
          case 'back':
            navigate(navigation.back(), false);
            break;
          case 'editor-file':
            showModal(
              `<h2>Archivo</h2><div class="stack">${b('new-design', 'Nuevo')}${b('library', 'Abrir')}${b('save-copy', 'Guardar copia')}${b('import-design', 'Importar')}${b('export-design', 'Exportar')}${b('home', 'Ir al inicio')}</div><div class="actions">${b('close-modal', 'Cerrar')}</div>`,
            );
            break;
          case 'save-replace': {
            if (!(await saveDesign())) break;
            const replace = pendingReplacement;
            pendingReplacement = null;
            replace?.();
            break;
          }
          case 'discard-replace': {
            const replace = pendingReplacement;
            pendingReplacement = null;
            replace?.();
            break;
          }
          case 'cancel-replace':
            pendingReplacement = null;
            closeModal();
            break;
          case 'settings-tab':
            settingsTab = value as SettingsTab;
            showModal(settingsView(settings, settingsTab));
            break;
          case 'profile-select':
            selectedProfile = value;
            profilesView();
            break;
          case 'activate-profile':
            quickStartGeneration++;
            await store.update((s) => {
              s.activeProfile = value;
            });
            profilesView();
            render();
            break;
          case 'record-select':
            recordSelection = value;
            render();
            break;
          case 'library-select':
            libraryState.selected = value;
            render();
            break;
          case 'setup-tab':
            setupViews[setup.mode].tab = value as 'maps' | 'options';
            render();
            break;
          case 'setup-step':
          case 'setup-next':
          case 'setup-previous': {
            const steps = ['players', 'courses', 'review'] as const;
            const view = setupViews[setup.mode];
            const next =
              action === 'setup-step'
                ? steps.indexOf(value as (typeof steps)[number])
                : steps.indexOf(view.step) + (action === 'setup-next' ? 1 : -1);
            if (next > steps.indexOf(view.step)) {
              if (setup.mode === 'versus' && (setup.players.length < 2 || setup.players.length > 6))
                throw new Error('Versus requiere entre 2 y 6 jugadores.');
              if (next === 2 && setup.courses.length < (setup.mode === 'tournament' ? 3 : 1))
                throw new Error(
                  setup.mode === 'tournament'
                    ? 'Seleccioná al menos tres mapas diferentes.'
                    : 'Seleccioná al menos un mapa.',
                );
            }
            view.step = steps[Math.max(0, Math.min(2, next))];
            render();
            break;
          }
          case 'course-select':
            setupViews[setup.mode].course = Number(value);
            render();
            break;
          case 'camera-in':
          case 'camera-out':
            world?.zoomBy(action === 'camera-in' ? -120 : 120);
            break;
          case 'camera-center':
            editor.setCursor(
              editor.design.items.find((p) => p.id === editor.chosenItem)?.x ?? editor.cursor,
            );
            break;
          case 'camera-reset':
            world?.resetZoom();
            break;
          case 'home':
            navigate('home');
            break;
          case 'navigate':
            navigate(value as Screen);
            break;
          case 'retry-models':
            await prepareWorld();
            break;
          case 'retry-storage':
            await store.open();
            storageReady = true;
            render();
            break;
          case 'start':
            await startSetup();
            break;
          case 'replace-session':
            await startSetup(true);
            break;
          case 'resume-session':
            refreshSession(value as 'tournament' | 'versus');
            break;
          case 'begin-turn':
            await beginTurn();
            break;
          case 'advance':
            if (session) {
              const mode = session.mode;
              await store.update((s) => {
                s.sessions[mode] = advanceSession(s.sessions[mode]!);
              });
              refreshSession(mode);
            }
            break;
          case 'track': {
            const c = catalog().find((c) => c.ref.id === value);
            if (!c) return;
            setup.selected = value;
            if (setup.mode === 'quick')
              setup.courses = [
                { ...structuredClone(c), timeOfDay: settings.timeOfDay, weather: settings.weather },
              ];
            else if (setup.courses.some((v) => v.ref.id === value))
              setup.courses = setup.courses.filter((v) => v.ref.id !== value);
            else setup.courses.push(structuredClone(c));
            if (setup.mode !== 'quick')
              setupViews[setup.mode].course = Math.max(
                0,
                setup.courses.findIndex((course) => course.ref.id === value),
              );
            render();
            break;
          }
          case 'random': {
            const options = catalog().filter(
              (c) => setup.filter === 'all' || !!c.track.custom === (setup.filter === 'custom'),
            );
            if (!options.length) throw new Error('No hay mapas en este grupo.');
            const c = structuredClone(options[Math.floor(Math.random() * options.length)]);
            setup.selected = c.ref.id;
            if (setup.mode === 'quick') setup.courses = [c];
            else if (!setup.courses.some((v) => v.ref.id === c.ref.id)) setup.courses.push(c);
            render();
            break;
          }
          case 'course-up':
          case 'course-down': {
            const i = Number(value),
              to = i + (action === 'course-up' ? -1 : 1);
            if (to >= 0 && to < setup.courses.length) {
              [setup.courses[i], setup.courses[to]] = [setup.courses[to], setup.courses[i]];
              const view = setupViews[setup.mode];
              view.course = view.course === i ? to : view.course === to ? i : view.course;
            }
            render();
            break;
          }
          case 'course-remove': {
            const selected = setup.courses[setupViews[setup.mode].course];
            setup.courses.splice(Number(value), 1);
            setupViews[setup.mode].course = Math.max(0, setup.courses.indexOf(selected));
            render();
            break;
          }
          case 'apply-all':
            if (setup.courses.length) {
              const first = setup.courses[setupViews[setup.mode].course] ?? setup.courses[0];
              setup.courses = setup.courses.map((c) => ({
                ...c,
                track: { ...c.track, laps: first.track.laps },
                timeOfDay: first.timeOfDay,
                weather: first.weather,
              }));
              render();
            }
            break;
          case 'time-of-day':
          case 'weather': {
            const field = action === 'weather' ? 'weather' : 'timeOfDay';
            if (screen === 'editor')
              editor.edit((d) => {
                (d[field] as string) = value;
              });
            else if (setup.courses[0]) {
              (setup.courses[0][field] as string) = value;
              (settings[field] as string) = value;
              storage.writeSettings(settings);
              render();
            }
            break;
          }
          case 'generator':
            generatorOrigin = screen;
            navigate('generator');
            break;
          case 'generate':
            generatedPreview();
            break;
          case 'regenerate':
            generator.seed = String(crypto.getRandomValues(new Uint32Array(1))[0]);
            generatedPreview();
            break;
          case 'use-generated':
            if (generated) {
              const c = mapCourse(generated);
              if (setup.mode === 'quick') setup.courses = [c];
              else if (!setup.courses.some((v) => v.ref.id === c.ref.id)) setup.courses.push(c);
              setup.selected = c.ref.id;
              navigate(generatorOrigin);
            }
            break;
          case 'edit-generated':
            if (generated) {
              replaceDesign(generated);
            }
            break;
          case 'save-generated':
            if (generated) {
              const d = generated;
              await store.update((s) => {
                s.maps = [...s.maps.filter((m) => m.id !== d.id), d];
              });
              toast('Mapa guardado.');
              void audio.interfaceSound('saved');
            }
            break;
          case 'copy-map': {
            const c =
              catalog().find((c) => c.ref.id === value) ??
              setup.courses.find((c) => c.ref.id === value);
            if (c) {
              const d = designFromTrack(c.track);
              d.name = (d.name + ' · copia').slice(0, 40);
              d.timeOfDay = c.timeOfDay;
              d.weather = c.weather;
              replaceDesign(d);
            }
            break;
          }
          case 'save-design':
            await saveDesign();
            break;
          case 'save-copy':
            await saveDesign(true);
            closeModal();
            break;
          case 'library':
            library();
            break;
          case 'load-design': {
            const d = store.state.maps.find((d) => d.id === value);
            if (d) {
              replaceDesign(d);
            }
            break;
          }
          case 'delete-design':
            showModal(
              `<h2>Eliminar mapa</h2><p>Las marcas y competiciones iniciadas conservarán su trazado.</p>${b('confirm-delete-design', 'Eliminar', value)}${b('library', 'Cancelar')}`,
            );
            break;
          case 'confirm-delete-design':
            await store.update((s) => {
              s.maps = s.maps.filter((d) => d.id !== value);
            });
            if (editor.design.id === value) editor.markPublished(undefined);
            setup.courses = setup.courses.filter((c) => c.ref.id !== value);
            if (setup.mode === 'quick' && !setup.courses.length)
              setup.courses = [structuredClone(BUILTINS[0])];
            if (setup.selected === value)
              setup.selected = setup.courses[0]?.ref.id ?? BUILTINS[0].ref.id;
            library();
            break;
          case 'export-design':
            storage.download(mapFilename(editor.design.name), validateMap(editor.design));
            break;
          case 'import-design':
          case 'import-replay':
            importKind = action === 'import-design' ? 'design' : 'replay';
            $<HTMLInputElement>('#import-file').click();
            break;
          case 'play-design-solo':
          case 'play-design-bots':
            returnScreen = 'editor';
            session = null;
            run({
              ...mapCourse(validateMap(editor.design)),
              mode: 'practice',
              player: profile(),
              bots: makeBots(action === 'play-design-bots' ? 3 : 0),
              difficulty: 'normal',
              seed: 1984,
            });
            break;
          case 'profiles':
            profilesView();
            break;
          case 'garage-open': {
            const owner = store.state.profiles.find((p) => p.id === value);
            if (!owner) break;
            selectedProfile = owner.id;
            garage = { profileId: owner.id, draft: structuredClone(owner.appearance), selected: 'fairing' };
            navigate('garage');
            break;
          }
          case 'garage-slot':
            if (garage) { garage.selected = value as SlotId; render(); }
            break;
          case 'garage-variant':
            if (garage) { garage.draft.parts[garage.selected] = value as VariantId; render(); }
            break;
          case 'garage-left':
          case 'garage-right':
            if (world) world.garageYaw += action === 'garage-left' ? -0.35 : 0.35;
            break;
          case 'garage-zoom-in':
          case 'garage-zoom-out':
            if (world) world.garageZoom = Math.max(2.3, Math.min(6, world.garageZoom + (action === 'garage-zoom-in' ? -0.35 : 0.35)));
            break;
          case 'garage-reset-slot':
            if (garage) {
              const owner = store.state.profiles.find((p) => p.id === garage!.profileId)!;
              garage.draft.parts[garage.selected] = 'core';
              garage.draft.paints[garage.selected] = defaultAppearance(owner.color).paints[garage.selected];
              render();
            }
            break;
          case 'garage-reset-all':
            if (garage) {
              const owner = store.state.profiles.find((p) => p.id === garage!.profileId)!;
              garage.draft = defaultAppearance(owner.color);
              render();
            }
            break;
          case 'garage-save':
            await leaveGarage(true);
            break;
          case 'garage-cancel':
            await leaveGarage(false);
            break;
          case 'add-profile':
            await store.update((s) => {
              s.profiles.push({
                id: crypto.randomUUID(),
                name: `Jugador ${s.profiles.length + 1}`,
                color: COLORS[s.profiles.length % COLORS.length],
                appearance: defaultAppearance(COLORS[s.profiles.length % COLORS.length]),
              });
            });
            selectedProfile = store.state.profiles.at(-1)!.id;
            profilesView();
            break;
          case 'delete-profile':
            showModal(
              `<h2>Eliminar perfil</h2><p>Se eliminarán sus marcas personales. Las competiciones iniciadas conservarán el participante.</p>${b('confirm-delete-profile', 'Eliminar', value)}${b('profiles', 'Cancelar')}`,
            );
            break;
          case 'confirm-delete-profile':
            await store.update((s) => {
              if (s.profiles.length <= 1) return;
              s.profiles = s.profiles.filter((p) => p.id !== value);
              s.records = s.records.filter((r) => r.profileId !== value);
              if (s.activeProfile === value) s.activeProfile = s.profiles[0].id;
            });
            setup.players = setup.players.filter((id) => id !== value);
            profilesView();
            break;
          case 'record-watch':
          case 'record-race': {
            const r = await store.replay(value);
            if (!r) throw new Error('No se encontró la repetición.');
            returnScreen = 'records';
            session = null;
            run(
              action === 'record-race'
                ? { ...structuredClone(r.config), mode: 'quick', player: profile() }
                : null,
              action === 'record-watch' ? r : null,
              action === 'record-race' ? [r] : [],
            );
            break;
          }
          case 'backup':
            storage.download(`${GAME_ID}-datos.json`, await store.backup());
            break;
          case 'settings':
            if (screen === 'race' && activity === 'running') paused = true;
            showModal(settingsView(settings, settingsTab));
            break;
          case 'audio-preview':
            await audio.preview('mix');
            return;
          case 'audio-stop':
            audio.stopPreview();
            return;
          case 'audio-credits':
            showModal(audioCreditsView());
            break;
          case 'reset-settings':
            Object.assign(settings, structuredClone(defaultSettings));
            document.body.dataset.reducedMotion = String(settings.reducedMotion);
            storage.writeSettings(settings);
            world?.applySettings();
            audio.volume();
            showModal(settingsView(settings, settingsTab));
            break;
          case 'rebind':
            el.textContent = 'Presioná una tecla…';
            controls.onKey = (code) => {
              if (code !== 'Escape') {
                settings.bindings[value] = code;
                storage.writeSettings(settings);
              }
              controls.onKey = null;
              showModal(settingsView(settings, settingsTab));
            };
            break;
          case 'fullscreen':
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else if (document.documentElement.requestFullscreen)
                await document.documentElement.requestFullscreen();
              else
                toast(
                  'La pantalla completa no está disponible. Podés seguir jugando en esta ventana.',
                );
            } catch {
              toast('No se pudo activar pantalla completa. El juego sigue disponible.');
            }
            break;
          case 'help':
            if (screen === 'race' && activity === 'running') paused = true;
            showModal(
              `<h2>Controles</h2><p>Acelerá con ${esc(settings.bindings.A.replace('Key', ''))} y usá ${esc(settings.bindings.B.replace('Key', ''))} para el turbo. El turbo calienta el motor; las franjas claras lo enfrían.</p><p>Arriba y abajo cambian de carril. Izquierda levanta la rueda y derecha baja el morro. Los saltos se producen al pasar por las rampas. Aterrizá alineado con el terreno.</p><p>Después de una caída, pulsá acelerar repetidamente. La rueda del mouse ajusta el zoom. Escape pausa la carrera.</p><p>En Torneo y Versus hay un intento por carrera. Los fantasmas no producen colisiones.</p>${b('close-modal', 'Cerrar')}`,
            );
            break;
          case 'close-modal':
            closeModal();
            if (screen === 'race' && activity === 'running') resume();
            else render();
            break;
          case 'pause':
            pause();
            break;
          case 'toggle-cinematic':
            toggleCinematic(true);
            break;
          case 'resume':
            resume();
            break;
          case 'leave-race':
            await leaveRace();
            break;
          case 'confirm-abandon':
            if (race) {
              abandonPlayer(race);
              if (recording) recording.termination = 'abandoned';
              paused = false;
              audio.playCue('dnf', 0.2);
              await finish();
            }
            break;
          case 'retry':
            if (session) return;
            if (quickAttempt) {
              await retryQuickRace();
            } else if (playback) {
              const r = playback.recording;
              run({ ...structuredClone(r.config), player: profile(), mode: 'quick' });
            } else if (recording)
              run(
                recording.config,
                null,
                ghosts.map((g) => g.recording),
              );
            break;
          case 'watch':
            if (lastRecording) {
              const previous = session;
              run(null, lastRecording);
              session = previous;
            }
            break;
          case 'export-replay':
            if (lastRecording ?? recording)
              storage.download(`${GAME_ID}-repeticion.json`, lastRecording ?? recording);
            break;
          case 'retry-save':
            if (recording) {
              await store.commit(recording, session ?? undefined);
              if (session) session = store.state.sessions[session.mode]!;
              showResult();
            }
            break;
          case 'leave-unsaved':
            navigate('home');
            break;
          case 'retry-finish':
            await finish();
            break;
        }
        if (
          ![
            'save-design',
            'save-copy',
            'save-generated',
            'retry-save',
            'import-design',
            'import-replay',
          ].includes(action)
        )
          void audio.interfaceSound(
            action === 'close-modal'
              ? 'close'
              : ['back', 'home'].includes(action)
                ? 'back'
                : ['settings', 'help', 'profiles', 'audio-credits'].includes(action)
                  ? 'open'
                  : ['start', 'begin-turn', 'resume', 'retry'].includes(action)
                    ? 'confirm'
                    : 'select',
          );
      })(),
    );
  });
  document.addEventListener('input', (event) => {
    const el = event.target as HTMLInputElement;
    if (focusedField.owns(el)) return;
    if (el.dataset.garageColor && garage) {
      garage.draft.paints[garage.selected][el.dataset.garageColor as 'primary' | 'accent'] = el.value;
      world?.setGarage(garage.draft);
      return;
    }
    if (el.id === 'map-search') {
      setupViews[setup.mode].search = el.value;
      render();
    }
    if (el.id === 'library-search') {
      libraryState.search = el.value;
      render();
    }
    if (el.id === 'volume') {
      settings.volume = Number(el.value) / 100;
      audio.volume();
      storage.writeSettings(settings);
    }
    if (el.dataset.audioBus && el.dataset.audioBus in settings.audioLevels) {
      settings.audioLevels[el.dataset.audioBus as AudioBus] = Math.min(
        1,
        Math.max(0, Number(el.value) / 100),
      );
      audio.volume();
      storage.writeSettings(settings);
    }
    if (el.id === 'preview-range' && world)
      editor.setCursor((Number(el.value) / 100) * editor.design.length);
  });
  document.addEventListener('change', (event) => {
    const el = event.target as HTMLInputElement;
    safely(
      (async () => {
        if (el.id === 'import-file') return;
        if (focusedField.owns(el)) return;
        if (screen === 'editor' && editor.change(el)) return;
        if (el.dataset.generator) {
          const k = el.dataset.generator as keyof GeneratorOptions;
          (generator as unknown as Record<string, unknown>)[k] = ['ramps', 'mud', 'cool'].includes(
            k,
          )
            ? Number(el.value)
            : el.value;
          if (k === 'difficulty') {
            Object.assign(
              generator,
              generator.difficulty === 'easy'
                ? { ramps: 35, mud: 10, cool: 40 }
                : generator.difficulty === 'normal'
                  ? { ramps: 55, mud: 20, cool: 25 }
                  : { ramps: 75, mud: 35, cool: 15 },
            );
            render();
          }
          return;
        }
        if (el.dataset.profileName || el.dataset.profileColor) {
          const id = el.dataset.profileName ?? el.dataset.profileColor;
          await store.update((s) => {
            const p = s.profiles.find((p) => p.id === id)!;
            if (el.dataset.profileName) p.name = el.value.trim() || 'Jugador';
            else p.color = el.value;
          });
          profilesView();
          render();
          return;
        }
        if (el.id === 'active-profile') {
          quickStartGeneration++;
          await store.update((s) => {
            s.activeProfile = el.value;
          });
          render();
          return;
        }
        if (el.dataset.player) {
          const id = el.dataset.player;
          setup.players = el.checked
            ? [...new Set([...setup.players, id])]
            : setup.players.filter((p) => p !== id);
          if (setup.players.length > 6) {
            setup.players = setup.players.filter((p) => p !== id);
            toast('Máximo seis jugadores.');
          }
          render();
          return;
        }
        if (el.dataset.course !== undefined) {
          const c = setup.courses[Number(el.dataset.course)];
          if (el.dataset.field === 'laps') c.track.laps = Number(el.value);
          else if (el.dataset.field === 'timeOfDay') c.timeOfDay = el.value as TimeOfDay;
          else c.weather = el.value as Weather;
          return;
        }
        if (el.id === 'bots') setup.bots = Number(el.value);
        if (el.id === 'difficulty') setup.difficulty = el.value as Setup['difficulty'];
        if (el.id === 'laps') setup.courses[0].track.laps = Number(el.value);
        if (el.id === 'quick-ghost') quickGhostEnabled = el.checked;
        if (['bots', 'difficulty', 'laps', 'quick-ghost'].includes(el.id)) render();
        if (el.id === 'map-filter') {
          setup.filter = el.value as Setup['filter'];
          render();
        }
        if (el.id === 'library-filter') {
          libraryState.filter = el.value as LibraryPresentation['filter'];
          render();
        }
        if (el.id === 'quality') settings.quality = el.value as 'high' | 'low';
        if (el.id === 'surface-detail')
          settings.surfaceDetail = el.value as Settings['surfaceDetail'];
        if (el.dataset.vfx && ['race', 'tracks', 'ambient'].includes(el.dataset.vfx)) {
          settings.vfx[el.dataset.vfx as 'race' | 'tracks' | 'ambient'] = el.checked;
        }
        if (el.id === 'vfx-intensity')
          settings.vfx.intensity = el.value as Settings['vfx']['intensity'];
        if (['bloom', 'cameraShake', 'reducedMotion', 'attractReplays'].includes(el.id))
          (settings as unknown as Record<string, unknown>)[el.id] = el.checked;
        if (
          [
            'quality',
            'surface-detail',
            'bloom',
            'vfx-race',
            'vfx-tracks',
            'vfx-ambient',
            'vfx-intensity',
            'cameraShake',
            'reducedMotion',
            'attractReplays',
          ].includes(el.id)
        ) {
          document.body.dataset.reducedMotion = String(settings.reducedMotion);
          world?.applySettings();
          if (!storage.writeSettings(settings)) toast('No se pudieron guardar los ajustes.');
        }
      })(),
    );
  });
  $<HTMLInputElement>('#import-file').addEventListener('change', (event) =>
    safely(
      (async () => {
        const input = event.target as HTMLInputElement,
          file = input.files?.[0];
        if (!file) return;
        try {
          if (file.size > 20_000_000) throw new Error('El archivo supera 20 MB.');
          const value = JSON.parse(await file.text());
          if (importKind === 'design') {
            const d = validateMap(value);
            replaceDesign(d);
            toast('Mapa importado. Guardalo para usarlo en los otros modos.');
            void audio.interfaceSound('imported');
          } else {
            const r = validateRecording(value);
            returnScreen = 'records';
            session = null;
            lastRecording = r;
            run(null, r);
          }
        } finally {
          input.value = '';
        }
      })(),
    ),
  );
  controls.onPause = () => {
    if (replayPresentation === 'attract') {
      exitAttract();
      return;
    }
    if (screen === 'editor' && editor.cancelGesture) {
      editor.cancelGesture();
      return;
    }
    if (focusedField.active) {
      focusedField.cancel();
      return;
    }
    if (modal.open) {
      if (activity === 'finishing' || (screen === 'race' && activity === 'results')) return;
      const wasPause = modal.querySelector('h2')?.textContent === 'Pausa';
      closeModal();
      if (paused && screen === 'race') {
        if (wasPause) resume();
        else pause();
      }
    } else if (screen === 'race') pause();
    else if (screen === 'editor' && editor.armed) {
      editor.armed = false;
      render();
    } else if (screen !== 'home') navigate(navigation.back(), false);
  };
  controls.onStart = () => {
    if (replayPresentation === 'attract') return;
    if (screen === 'race' && activity === 'running') {
      if (paused) resume();
      else pause();
    } else if (screen === 'quick' && !modal.open) safely(startSetup());
  };
  modal.addEventListener('cancel', (event) => {
    event.preventDefault();
    controls.onPause();
  });
  function updateAttractFocus() {
    if (replayPresentation !== 'attract') return;
    const suspend = document.hidden || !document.hasFocus();
    if (attractSuspended === suspend) return;
    attractSuspended = suspend;
    accumulator = 0;
    audio.setScene(suspend ? 'pause' : 'cinematic', activeWeather);
  }
  window.addEventListener('blur', () => {
    idleSince = null;
    if (replayPresentation === 'attract') updateAttractFocus();
    else if (screen === 'race' && activity === 'running' && !paused) pause();
  });
  window.addEventListener('focus', () => {
    idleSince = audio.unlocked ? performance.now() : null;
    updateAttractFocus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) idleSince = null;
    if (replayPresentation === 'attract') updateAttractFocus();
    else if (document.hidden && screen === 'race' && activity === 'running' && !paused) pause();
    audio.setHidden(document.hidden);
    if (!document.hidden && screen === 'home') idleSince = audio.unlocked ? performance.now() : null;
  });
  window.addEventListener('pagehide', () => audio.setHidden(true));
  window.addEventListener('pageshow', () => audio.setHidden(document.hidden));
  if (import.meta.hot) import.meta.hot.dispose(() => audio.dispose());
  window.addEventListener(
    'wheel',
    (event) => {
      if (
        !world ||
        modal.open ||
        paused ||
        !['race', 'editor'].includes(screen) ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        !event.deltaY
      )
        return;
      if (
        (event.target as Element)?.closest(
          'button,input,select,textarea,a,.editor-timeline,.editor-sidebar',
        )
      )
        return;
      if (screen === 'editor' && !(event.target as Element).closest('#editor-viewport')) return;
      event.preventDefault();
      world.zoomBy(
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? world.height : 1),
      );
    },
    { passive: false },
  );
  document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyC' && !event.repeat && replayPresentation === 'manual' && screen === 'race' && activity === 'running' && !modal.open && !(event.target as Element)?.closest('input,textarea,select,[contenteditable="true"]')) {
      event.preventDefault();
      toggleCinematic();
      return;
    }
    const tab = (event.target as Element)?.closest<HTMLElement>('[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = Array.from(
        tab.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      );
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (tabs.indexOf(tab as HTMLButtonElement) +
                (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) %
              tabs.length;
      event.preventDefault();
      tabs[index].click();
      tabs[index].focus();
      return;
    }
    if (
      screen !== 'editor' ||
      modal.open ||
      focusedField.active ||
      (event.target as Element)?.closest('input,textarea,select,[contenteditable="true"]')
    )
      return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.code === 'KeyS') {
      event.preventDefault();
      safely(saveDesign());
    } else if (modifier && event.code === 'KeyZ') {
      event.preventDefault();
      editor.action(event.shiftKey ? 'redo' : 'undo', '');
    } else if (modifier && event.code === 'KeyY') {
      event.preventDefault();
      editor.action('redo', '');
    } else if (event.code === 'Delete' && editor.chosenItem) {
      event.preventDefault();
      editor.action('remove-piece', '');
    }
  });
  let gateWasBlocked = false,
    gateDialogOpen = false;
  function checkSize() {
    const editing =
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.matches(
        'input[type="text"],input[type="number"],input:not([type]),input[type="search"]',
      );
    if (focusedField.active || (editing && matchMedia('(pointer:coarse)').matches)) return;
    const portrait = matchMedia('(pointer:coarse)').matches && innerHeight > innerWidth;
    const safe = getComputedStyle(ui);
    const availableWidth =
      innerWidth - parseFloat(safe.paddingLeft) - parseFloat(safe.paddingRight);
    const availableHeight =
      innerHeight - parseFloat(safe.paddingTop) - parseFloat(safe.paddingBottom);
    const blocked = screen !== 'home' && screen !== 'garage' &&
      (portrait || availableWidth < 640 || availableHeight < 360);
    $('#size-gate').hidden = !blocked;
    ui.inert = blocked;
    if (blocked) {
      $('#size-message').textContent = portrait
        ? 'Girá el dispositivo para jugar en horizontal.'
        : 'Ampliá la ventana. Necesitás al menos 640 × 360 de espacio disponible.';
      if (screen === 'race' && activity === 'running' && !paused) pause();
      if (!gateWasBlocked) {
        gateDialogOpen = modal.open;
        modal.close();
      }
    } else if (gateWasBlocked && gateDialogOpen) {
      modal.showModal();
      gateDialogOpen = false;
    }
    gateWasBlocked = blocked;
    viewport.resize();
  }
  window.addEventListener('resize', checkSize);
  document.addEventListener('fullscreenchange', checkSize);
  window.visualViewport?.addEventListener('resize', checkSize);
  matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change', () =>
    world?.applySettings(),
  );
  document.body.dataset.reducedMotion = String(settings.reducedMotion);
  checkSize();
  function loop(now: number) {
    const delta = Math.min(now - lastFrame, 150);
    lastFrame = now;
    audio.setScene(
      screen === 'race'
        ? activity !== 'running'
          ? 'results'
          : paused || attractSuspended
            ? 'pause'
            : world?.cinematic
              ? 'cinematic'
              : race?.phase === 'countdown'
              ? 'countdown'
              : 'race'
        : screen === 'editor'
          ? 'editor'
          : screen === 'session' && session?.phase !== 'ready'
            ? 'results'
            : 'menu',
      activeWeather,
    );
    if (screen === 'home') {
      const gamepadUsed = navigator.getGamepads?.().some((pad) => pad?.connected &&
        (pad.buttons.some((button) => button.pressed) || pad.axes.some((axis) => Math.abs(axis) > 0.35)));
      if (gamepadUsed) markHomeActivity();
      if (!idleSince && audio.unlocked) idleSince = now;
      if (idleSince && now - idleSince >= 60_000 && settings.attractReplays && !attractStarting &&
        !modal.open && !document.hidden && document.hasFocus() &&
        !matchMedia('(pointer: coarse) and (hover: none)').matches &&
        $('#size-gate').hidden && storageReady && models === 'ready') startAttract();
    }
    if (screen === 'race' && race && activity === 'running' && !paused && !attractSuspended) {
      const slowMotion = !!world?.cinematic && !!timeline?.slowMotion.some((window) => race!.frame >= window.start && race!.frame < window.end);
      audio.setSlowMotion(slowMotion);
      accumulator += delta * (slowMotion ? 0.5 : 1);
      let steps = 0;
      while (accumulator >= STEP_MS && steps++ < 10) {
        const input = controls.sample();
        if (paused) break;
        world?.capture(viewRace()!);
        if (playback) {
          playback.step();
          race = playback.race;
        } else {
          appendInput(recording!, input);
          stepRace(race, input);
        }
        ghosts.forEach((g) => g.step());
        world?.onSimulationStep(race);
        audio.update(race, true);
        accumulator -= STEP_MS;
        if (playback ? playback.done : isFinished(race, 0)) {
          safely(finish());
          break;
        }
      }
    } else {
      accumulator = 0;
      audio.update(race, false);
      controls.sample();
    }
    if (screen === 'race' && race && now - lastHud > 40) {
      updateHud(race, settings, quickAttempt?.reference);
      lastHud = now;
    }
    if (world) world.beatDelay = audio.beatDelay();
    world?.render(
      now / 1000,
      screen === 'race' ? viewRace() : null,
      paused || attractSuspended,
      accumulator / STEP_MS,
      activity === 'results',
    );
    if (import.meta.env.DEV && now - lastCinematicDiagnostic >= 500) {
      $('#app').dataset.cinematicTrace = JSON.stringify(world?.cinematic?.diagnostics() ?? null);
      lastCinematicDiagnostic = now;
    }
    requestAnimationFrame(loop);
  }
  render();
  void prepareWorld();
  requestAnimationFrame(loop);
  if (import.meta.env.DEV)
    Object.defineProperty(window, DEBUG_KEY, {
      get: () => ({
        screen,
        activity,
        timeOfDay: activeTimeOfDay,
        weather: activeWeather,
        paused,
        race: race ? structuredClone(race) : null,
        design: structuredClone(editor.design),
        session: session ? structuredClone(session) : null,
        setup: structuredClone(setup),
        profiles: structuredClone(store.state.profiles),
        records: structuredClone(store.state.records),
        personalGhost: quickAttempt?.reference ? structuredClone(quickAttempt.reference) : null,
        ghosts: ghosts.map((g) => ({
          frame: g.race.frame,
          done: g.done,
          rider: structuredClone(g.race.riders[0]),
        })),
        models,
        quality: world?.bikes[0]?.quality,
        camera: world ? { zoom: world.camera.zoom, target: world.zoomTarget } : null,
        cinematic: world?.cinematic?.diagnostics() ?? null,
        renderer: world?.renderer.info.render,
        memory: world?.renderer.info.memory,
        audio: audio.diagnostics(),
        environment: world?.environment.diagnostics(),
        precipitation: world?.weatherEffects.diagnostics(),
        vfx: world?.vfx.diagnostics(),
        stadium: world?.stadium.diagnostics(),
      }),
    });
}
