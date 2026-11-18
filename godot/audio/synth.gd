class_name Synth
extends RefCounted
## Renders a layer's loop to a buffer ahead of time.
##
## Why not synthesize live: on the web, Godot's low-latency "sample" playback cannot
## play procedurally generated audio, and live generation in GDScript is slow. A song
## is fully determined by its seed, so its loops can be baked once when a stage loads
## and then played as ordinary looping samples: low latency everywhere.

const SR := 32000

static func mtof(m: float) -> float:
	return 440.0 * pow(2.0, (m - 69.0) / 12.0)

## Render notes into one loop. Tails that run past the end wrap to the start, so the loop is seamless.
static func render(notes: Array, loop_steps: int, bpm: float, gain: float = 1.0) -> PackedFloat32Array:
	var sps := 60.0 / bpm / 4.0
	var total := int(round(loop_steps * sps * SR))
	var buf := PackedFloat32Array()
	buf.resize(total)
	var noise := RandomNumberGenerator.new()
	noise.seed = 1234
	for n in notes:
		var at := int(round(float(n["step"]) * sps * SR))
		var dur: float = float(n["len"]) * sps
		var vel: float = float(n["vel"]) * gain
		match n["voice"]:
			"kick": _kick(buf, at, vel)
			"snare": _snare(buf, at, vel, noise)
			"hat": _hat(buf, at, vel, noise)
			"bass": _bass(buf, at, float(n["midi"]), dur, vel)
			"lead": _lead(buf, at, float(n["midi"]), dur, vel)
			"pad": _pad(buf, at, float(n["midi"]), dur, vel)
			"tick": _tone(buf, at, 2000.0, 0.02, vel * 0.5)
	return buf

static func _kick(buf: PackedFloat32Array, at: int, vel: float) -> void:
	var total := buf.size()
	var n := int(0.32 * SR)
	var phase := 0.0
	for i in n:
		var t := float(i) / SR
		var f := 150.0 * pow(45.0 / 150.0, minf(t / 0.12, 1.0))
		phase += TAU * f / SR
		var env := minf(t / 0.002, 1.0) * exp(-t * 15.0)
		buf[(at + i) % total] += sin(phase) * env * vel

static func _snare(buf: PackedFloat32Array, at: int, vel: float, noise: RandomNumberGenerator) -> void:
	var total := buf.size()
	var n := int(0.2 * SR)
	var lp := 0.0
	var hp := 0.0
	var phase := 0.0
	for i in n:
		var t := float(i) / SR
		var x := noise.randf_range(-1.0, 1.0)
		lp += 0.45 * (x - lp)           # band-limit the noise
		hp += 0.12 * (lp - hp)
		phase += TAU * 180.0 / SR
		var tri := 2.0 * absf(2.0 * fposmod(phase / TAU, 1.0) - 1.0) - 1.0
		buf[(at + i) % total] += ((lp - hp) * 1.6 * exp(-t * 26.0) * 0.7 + tri * exp(-t * 40.0) * 0.5) * vel

static func _hat(buf: PackedFloat32Array, at: int, vel: float, noise: RandomNumberGenerator) -> void:
	var total := buf.size()
	var n := int(0.09 * SR)
	var prev := 0.0
	for i in n:
		var t := float(i) / SR
		var x := noise.randf_range(-1.0, 1.0)
		var hi := x - prev              # crude high-pass
		prev = x
		buf[(at + i) % total] += hi * exp(-t * 80.0) * 0.22 * vel

static func _bass(buf: PackedFloat32Array, at: int, midi: float, dur: float, vel: float) -> void:
	var total := buf.size()
	var n := int((dur + 0.06) * SR)
	var inc := mtof(midi) / SR
	var phase := 0.0
	var lp := 0.0
	for i in n:
		var t := float(i) / SR
		phase = fposmod(phase + inc, 1.0)
		var cutoff := 500.0 * pow(160.0 / 500.0, minf(t / maxf(dur, 0.1), 1.0))
		lp += minf(1.0, TAU * cutoff / SR) * ((2.0 * phase - 1.0) - lp)
		var env := minf(t / 0.01, 1.0) * (1.0 if t < dur - 0.04 else maxf(0.0, 1.0 - (t - (dur - 0.04)) / 0.07))
		buf[(at + i) % total] += lp * env * 0.9 * vel

static func _lead(buf: PackedFloat32Array, at: int, midi: float, dur: float, vel: float) -> void:
	var total := buf.size()
	var n := int((dur + 0.14) * SR)
	var f := mtof(midi)
	var inc_a := f * pow(2.0, -7.0 / 1200.0) / SR
	var inc_b := f * pow(2.0, 7.0 / 1200.0) / SR
	var pa := 0.0
	var pb := 0.0
	var lp := 0.0
	var k := minf(1.0, TAU * 1800.0 / SR)
	for i in n:
		var t := float(i) / SR
		pa = fposmod(pa + inc_a, 1.0)
		pb = fposmod(pb + inc_b, 1.0)
		lp += k * (((1.0 if pa < 0.5 else -1.0) + (1.0 if pb < 0.5 else -1.0)) * 0.5 - lp)
		var env := minf(t / 0.012, 1.0) * (lerpf(1.0, 0.55, minf(t / dur, 1.0)) if t < dur else 0.55 * maxf(0.0, 1.0 - (t - dur) / 0.12))
		buf[(at + i) % total] += lp * env * 0.3 * vel

static func _pad(buf: PackedFloat32Array, at: int, midi: float, dur: float, vel: float) -> void:
	var total := buf.size()
	var n := int((dur + 0.25) * SR)
	var f := mtof(midi)
	var inc_a := f * pow(2.0, -5.0 / 1200.0) / SR
	var inc_b := f * pow(2.0, 5.0 / 1200.0) / SR
	var pa := 0.0
	var pb := 0.25
	var attack := minf(0.35, dur / 2.0)
	for i in n:
		var t := float(i) / SR
		pa = fposmod(pa + inc_a, 1.0)
		pb = fposmod(pb + inc_b, 1.0)
		var tri := (absf(2.0 * pa - 1.0) + absf(2.0 * pb - 1.0)) - 1.0
		var env := minf(t / attack, 1.0) * (1.0 if t < dur - 0.05 else maxf(0.0, 1.0 - (t - (dur - 0.05)) / 0.3))
		buf[(at + i) % total] += tri * env * 0.2 * vel

static func _tone(buf: PackedFloat32Array, at: int, freq: float, dur: float, vel: float) -> void:
	var total := buf.size()
	var n := int((dur + 0.03) * SR)
	for i in n:
		var t := float(i) / SR
		buf[(at + i) % total] += sin(TAU * freq * t) * minf(t / 0.003, 1.0) * exp(-t / dur * 3.0) * vel

## A short one-shot, for sounds triggered by the player.
static func ping(freqs: Array, dur: float, vel: float) -> PackedFloat32Array:
	var buf := PackedFloat32Array()
	buf.resize(int((dur + 0.05) * SR))
	for f in freqs:
		_tone(buf, 0, float(f), dur, vel)
	return buf

static func to_stream(buf: PackedFloat32Array, looping: bool) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(buf.size() * 2)
	for i in buf.size():
		bytes.encode_s16(i * 2, int(clampf(buf[i], -1.0, 1.0) * 32767.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = SR
	s.stereo = false
	s.data = bytes
	if looping:
		s.loop_mode = AudioStreamWAV.LOOP_FORWARD
		s.loop_begin = 0
		s.loop_end = buf.size()
	return s
