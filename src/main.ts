import { AudioEngine } from './audio/engine';
import { computeMix, MixState } from './core/music/mix';
import { generateSong, LayerId } from './core/music/song';
import { defaultTunables } from './core/tunables';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7);
const tun = defaultTunables();
const song = generateSong(seed, tun.loopBars);
const engine = new AudioEngine(song, tun);

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = innerWidth;
canvas.height = innerHeight;

(window as any).__rm = { engine, tun, song };

const startBtn = document.getElementById('start') as HTMLButtonElement;
startBtn.addEventListener('click', async () => {
  await engine.start();
  document.getElementById('overlay')!.remove();
  if (params.get('jam')) jam();
});

/** Dev page: toggle layers by ear. */
function jam(): void {
  const st: MixState = { owned: [], equipped: null, previewLayer: null, leadOn: false, harmony: 0, harmonyMax: 3, muffled: false, intensity: 0 };
  const box = document.createElement('div');
  box.id = 'jam';
  box.style.cssText = 'position:fixed;left:16px;top:16px;display:grid;gap:6px';
  const apply = (): void => engine.setMix(computeMix(st));
  const check = (label: string, on: (v: boolean) => void): void => {
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.addEventListener('change', () => { on(c.checked); apply(); });
    l.append(c, ' ' + label);
    box.append(l);
  };
  for (const layer of ['drum', 'hat', 'bass'] as LayerId[]) {
    check(layer, v => { st.owned = v ? [...st.owned, layer] : st.owned.filter(x => x !== layer); });
  }
  check('lead', v => { st.leadOn = v; });
  check('pad', v => { st.harmony = v ? 3 : 0; });
  check('muffled', v => { st.muffled = v; });
  check('bright', v => { st.intensity = v ? 1 : 0; });
  const bpm = document.createElement('input');
  bpm.type = 'number';
  bpm.value = String(tun.bpm);
  bpm.addEventListener('change', () => engine.setBpm(Number(bpm.value)));
  box.append(bpm);
  document.body.append(box);
  apply();
}
