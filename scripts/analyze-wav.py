"""Loudness and band energy of every baked layer, and of their sum.

Usage:
  godot --headless --path godot -s res://tools/dump_wav.gd -- <dir> [seed] [bass] [lead]
  python3 scripts/analyze-wav.py <dir>

Band columns are each band's share of that layer's energy, in dB (0 = all of it).
"""
import sys, wave, numpy as np
d = sys.argv[1]
bands = [(20,60),(60,120),(120,250),(250,500),(500,1000),(1000,2000),(2000,4000),(4000,8000),(8000,16000)]
print('layer   peak   rms(dB)  ' + ' '.join(f'{a}-{b}'.rjust(9) for a,b in bands))
mix = None
for name in ['drum','hat','bass','lead','pad']:
    w = wave.open(f'{d}/{name}.wav'); sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float)/32768
    mix = x if mix is None else mix + x
    X = np.abs(np.fft.rfft(x))**2; f = np.fft.rfftfreq(len(x), 1/sr); tot = X.sum() + 1e-12
    row = [10*np.log10(X[(f>=a)&(f<b)].sum()/tot + 1e-9) for a,b in bands]
    print(name.ljust(6), f'{np.abs(x).max():5.2f}', f'{20*np.log10(np.sqrt((x**2).mean())+1e-9):8.1f}', ' ' + ' '.join(f'{v:9.1f}' for v in row))
print('mix peak', round(float(np.abs(mix).max()),2), 'rms dB', round(float(20*np.log10(np.sqrt((mix**2).mean()))),1), 'crest dB', round(float(20*np.log10(np.abs(mix).max()/np.sqrt((mix**2).mean()))),1))
