import { defaultTunables, Tunables } from '../core/tunables';

const KEY = 'rm.tunables';

/** Saved values from an earlier session, applied over the defaults. */
export function loadTunables(tun: Tunables): { hadAudioOffset: boolean } {
  let saved: Partial<Tunables> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* storage unavailable: defaults */ }
  for (const k of Object.keys(tun) as (keyof Tunables)[]) {
    if (typeof saved[k] === 'number' && Number.isFinite(saved[k])) tun[k] = saved[k]!;
  }
  return { hadAudioOffset: typeof saved.audioOffsetMs === 'number' };
}

export function saveTunables(tun: Tunables): void {
  try { localStorage.setItem(KEY, JSON.stringify(tun)); } catch { /* ignore */ }
}

/** A plain list of every tunable number, editable while playing. */
export function mountPanel(tun: Tunables, onChange: (key: keyof Tunables, value: number) => void): { toggle(): void; refresh(): void } {
  const box = document.createElement('div');
  box.id = 'panel';
  box.hidden = true;
  const inputs = new Map<keyof Tunables, HTMLInputElement>();
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const k of Object.keys(tun) as (keyof Tunables)[]) {
    const label = document.createElement('label');
    label.textContent = k;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = String(tun[k]);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) { input.value = String(tun[k]); return; }
      tun[k] = v;
      saveTunables(tun);
      onChange(k, v);
    });
    inputs.set(k, input);
    grid.append(label, input);
  }
  const refresh = (): void => inputs.forEach((el, k) => { el.value = String(tun[k]); });
  const row = document.createElement('div');
  row.className = 'row';
  const reset = document.createElement('button');
  reset.textContent = '기본값으로';
  reset.addEventListener('click', () => {
    const d = defaultTunables();
    for (const k of Object.keys(d) as (keyof Tunables)[]) { tun[k] = d[k]; onChange(k, d[k]); }
    saveTunables(tun);
    refresh();
  });
  const copy = document.createElement('button');
  copy.textContent = 'JSON 복사';
  copy.addEventListener('click', () => { void navigator.clipboard?.writeText(JSON.stringify(tun, null, 2)); });
  row.append(reset, copy);
  box.append(grid, row);
  document.body.append(box);
  return { toggle: () => { box.hidden = !box.hidden; if (!box.hidden) refresh(); }, refresh };
}
