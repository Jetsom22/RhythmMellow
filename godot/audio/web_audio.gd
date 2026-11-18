class_name WebAudio
extends RefCounted
## Web only: hands the baked loops straight to the browser's audio thread.
##
## Godot's own web audio cannot hold a beat. Its low-latency path restarts a loop only after
## it has ended (measured: every lap 16 to 37 ms late). Its mixed path runs on the same thread
## as the game, so on a slow device the sound breaks up and slips. The browser's audio thread
## does neither: it loops to the exact sample and is not held up by the game.
## Native builds do not use this; there the engine's mixer is on its own thread.

const LIB := """
window.__rmA = window.__rmA || (function () {
  const ctx = window.__rmCtx;
  const loops = {}, shots = {}, gains = {}, sources = {};
  let t0 = null;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  function buffer(b64, rate) {
    const bin = atob(b64), n = bin.length >> 1;
    const b = ctx.createBuffer(1, n, rate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v >= 32768) v -= 65536;
      d[i] = v / 32768;
    }
    return b;
  }
  const delay = () => (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  return {
    addLoop(id, b64, rate) {
      loops[id] = buffer(b64, rate);
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(master);
      gains[id] = g;
    },
    addShot(id, b64, rate) { shots[id] = buffer(b64, rate); },
    // Every loop is scheduled for the same instant on the audio clock, and loops natively.
    start() {
      if (ctx.state !== 'running') ctx.resume();
      t0 = ctx.currentTime + 0.12;
      for (const id in loops) {
        const s = ctx.createBufferSource();
        s.buffer = loops[id];
        s.loop = true;
        s.connect(gains[id]);
        s.start(t0);
        sources[id] = s;
      }
    },
    // Swap one layer's sound while it plays: the new loop comes in at the same point of the bar.
    replaceLoop(id, b64, rate) {
      const b = buffer(b64, rate);
      loops[id] = b;
      if (t0 === null) return;
      const when = ctx.currentTime + 0.06;
      const offset = (((when - t0) % b.duration) + b.duration) % b.duration;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.connect(gains[id]);
      s.start(when, offset);
      if (sources[id]) sources[id].stop(when);
      sources[id] = s;
    },
    // Song time the listener is hearing now.
    time() { return t0 === null ? -1000 : ctx.currentTime - t0 - delay(); },
    delay,
    gain(id, v) { if (gains[id]) gains[id].gain.setTargetAtTime(v, ctx.currentTime, 0.04); },
    shot(id) {
      if (!shots[id]) return;
      const s = ctx.createBufferSource();
      s.buffer = shots[id];
      s.connect(master);
      s.start();
    },
  };
})();
"""

static func available() -> bool:
	return OS.has_feature("web") and bool(JavaScriptBridge.eval("!!(window.__rmCtx && window.__rmCtx.createBufferSource)", true))

func install() -> void:
	JavaScriptBridge.eval(LIB, true)

static func _b64(pcm: PackedFloat32Array) -> String:
	return Marshalls.raw_to_base64(Synth.to_pcm16(pcm))

func add_loop(id: String, pcm: PackedFloat32Array) -> void:
	JavaScriptBridge.eval("window.__rmA.addLoop('%s','%s',%d);" % [id, _b64(pcm), Synth.SR], true)

func replace_loop(id: String, pcm: PackedFloat32Array) -> void:
	JavaScriptBridge.eval("window.__rmA.replaceLoop('%s','%s',%d);" % [id, _b64(pcm), Synth.SR], true)

func add_shot(id: String, pcm: PackedFloat32Array) -> void:
	JavaScriptBridge.eval("window.__rmA.addShot('%s','%s',%d);" % [id, _b64(pcm), Synth.SR], true)

func start() -> void:
	JavaScriptBridge.eval("window.__rmA.start();", true)

func time() -> float:
	return float(JavaScriptBridge.eval("window.__rmA.time()", true))

func delay_ms() -> float:
	return float(JavaScriptBridge.eval("window.__rmA.delay()", true)) * 1000.0

func set_gain(id: String, v: float) -> void:
	JavaScriptBridge.eval("window.__rmA.gain('%s',%f);" % [id, v], true)

func shot(id: String) -> void:
	JavaScriptBridge.eval("window.__rmA.shot('%s');" % id, true)
