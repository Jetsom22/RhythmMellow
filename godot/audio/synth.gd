class_name Synth
extends RefCounted
## Renders a layer's loop to a buffer ahead of time.
##
## Why not synthesize live: on the web, Godot's low-latency "sample" playback cannot
## play procedurally generated audio, and live generation in GDScript is slow. A song
## is fully determined by its seed, so its loops can be baked once when a stage loads
## and then played as ordinary looping samples: low latency everywhere.

const SR := 44100

## Timbres to choose between by ear. The first of each is the default.
const BASS_PRESETS: Array[String] = ["sub pluck", "round", "acid", "fm thump"]
const LEAD_PRESETS: Array[String] = ["fm bell", "soft pulse", "glass", "reed"]

static func mtof(m: float) -> float:
	return 440.0 * pow(2.0, (m - 69.0) / 12.0)

## Render notes into one loop. Tails that run past the end wrap to the start, so the loop is seamless.
## `timbre` picks the bass and lead presets: { "bass": index, "lead": index }.
## `kick_steps` are the loop steps where the kick lands (the bass ducks under them).
## With `mixed` off the voices are returned raw, as the synths made them.
static func render(notes: Array, loop_steps: int, bpm: float, gain: float = 1.0, timbre: Dictionary = {}, kick_steps: Array = [], mixed: bool = true) -> PackedFloat32Array:
	var sps := 60.0 / bpm / 4.0
	var total := int(round(loop_steps * sps * SR))
	var noise := RandomNumberGenerator.new()
	noise.seed = 1234
	var bass_kind := int(timbre.get("bass", 0))
	var lead_kind := int(timbre.get("lead", 0))
	# One buffer per voice, so each can go through its own mixing chain.
	var voices := {}
	for n in notes:
		var voice: String = n["voice"]
		if not voices.has(voice):
			var fresh := PackedFloat32Array()
			fresh.resize(total)
			voices[voice] = fresh
		var buf: PackedFloat32Array = voices[voice]
		var at := int(round(float(n["step"]) * sps * SR))
		var dur: float = float(n["len"]) * sps
		var vel: float = float(n["vel"]) * gain
		match voice:
			"kick": _kick(buf, at, vel)
			"snare": _snare(buf, at, vel, noise)
			"hat": _hat(buf, at, vel, noise)
			"bass": _bass(buf, at, float(n["midi"]), dur, vel, bass_kind)
			"lead": _lead(buf, at, float(n["midi"]) + (Mix.octave_of("lead") if mixed else 0.0), dur, vel, lead_kind)
			"pad": _pad(buf, at, float(n["midi"]), dur, vel)
			"tick": _tone(buf, at, 2000.0, 0.02, vel * 0.5)
		voices[voice] = buf
	var hits: Array = []
	for st in kick_steps:
		hits.append(int(round(float(st) * sps * SR)))
	var out := PackedFloat32Array()
	out.resize(total)
	for voice in voices:
		var buf: PackedFloat32Array = voices[voice]
		if voice == "lead":
			_echo(buf, int(round(3.0 * sps * SR)), 0.34, 0.28)     # a dotted-eighth echo, baked into the loop
		if mixed:
			Mix.process(buf, voice, SR, hits)
		for i in total:
			out[i] += buf[i]
	return out

## The loop steps where a song's kick lands.
static func kick_steps_of(song: Song) -> Array:
	var out: Array = []
	for n in song.layers["drum"]:
		if n["voice"] == "kick":
			out.append(n["step"])
	return out

## Band-limiting correction for a naive saw or pulse edge (PolyBLEP). Without it the edges alias into a harsh buzz.
static func _blep(t: float, dt: float) -> float:
	if t < dt:
		var x := t / dt
		return x + x - x * x - 1.0
	if t > 1.0 - dt:
		var y := (t - 1.0) / dt
		return y * y + y + y + 1.0
	return 0.0

static func _saw(phase: float, dt: float) -> float:
	return 2.0 * phase - 1.0 - _blep(phase, dt)

static func _pulse(phase: float, dt: float, width: float) -> float:
	var v := 1.0 if phase < width else -1.0
	return v + _blep(phase, dt) - _blep(fposmod(phase + 1.0 - width, 1.0), dt)

## Note envelope: quick attack, held, short release. Never clicks.
static func _env(t: float, dur: float, attack: float, release: float) -> float:
	if t < attack:
		return t / attack
	if t < dur:
		return 1.0
	return maxf(0.0, 1.0 - (t - dur) / release)

## Feedback echo around the loop, so the tail of the last note carries into the first bar.
static func _echo(buf: PackedFloat32Array, delay: int, feedback: float, mix: float) -> void:
	var total := buf.size()
	if delay <= 0 or delay >= total:
		return
	var wet := PackedFloat32Array()
	wet.resize(total)
	for lap in 3:
		for i in total:
			var j := posmod(i - delay, total)
			wet[i] = (buf[j] + wet[j]) * feedback
	for i in total:
		buf[i] += wet[i] * mix / feedback

## Scale so the loudest moment sits at `peak`. Keeps presets comparable in loudness.
static func _level(buf: PackedFloat32Array, peak: float) -> void:
	var top := 0.0
	for v in buf:
		top = maxf(top, absf(v))
	if top < 0.0001:
		return
	var k := peak / top
	for i in buf.size():
		buf[i] *= k

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

## Bass. Bass notes sit at 55 to 80 Hz, below what small speakers can play,
## so every preset also carries energy an octave or two up.
static func _bass(buf: PackedFloat32Array, at: int, midi: float, dur: float, vel: float, kind: int) -> void:
	var total := buf.size()
	var f := mtof(midi)
	var dt := f / SR
	var n := int((dur + 0.09) * SR)
	var p := 0.0        # fundamental
	var p2 := 0.0       # octave up
	var low := 0.0
	var band := 0.0
	var mod := 0.0
	for i in n:
		var t := float(i) / SR
		p = fposmod(p + dt, 1.0)
		p2 = fposmod(p2 + dt * 2.0, 1.0)
		var x := 0.0
		match kind:
			1:      # round: sine and a soft triangle an octave up, no edge at all
				x = sin(TAU * p) * 0.8 + (absf(4.0 * p2 - 2.0) - 1.0) * 0.28 * exp(-t * 3.0) + sin(TAU * p2) * 0.18
			2:      # acid: a saw through a resonant filter that snaps shut
				var cut := 180.0 + 2200.0 * exp(-t * 11.0)
				var fc := 2.0 * sin(PI * minf(cut, SR / 7.0) / SR)
				low += fc * band
				band += fc * (_saw(p2, dt * 2.0) - low - 0.22 * band)
				x = low * 0.75 + sin(TAU * p) * 0.55
			3:      # fm thump: a sine bent by a fast-decaying modulator, like a plucked low string
				mod = sin(TAU * p2) * (2.6 * exp(-t * 16.0) + 0.25)
				x = sin(TAU * p + mod) * 0.85 + sin(TAU * p2 + mod * 0.5) * 0.2 * exp(-t * 5.0)
			_:      # sub pluck: a sine sub under a saw whose filter closes after the attack
				var cut0 := 140.0 + 1500.0 * exp(-t * 8.0)
				var fc0 := 2.0 * sin(PI * cut0 / SR)
				low += fc0 * band
				band += fc0 * (_saw(p2, dt * 2.0) - low - 0.9 * band)
				x = sin(TAU * p) * 0.7 + low * 0.6
		x = tanh(x * 1.3)       # a little warmth; also keeps peaks in check
		buf[(at + i) % total] += x * _env(t, dur - 0.02, 0.006, 0.08) * vel

static func _lead(buf: PackedFloat32Array, at: int, midi: float, dur: float, vel: float, kind: int) -> void:
	var total := buf.size()
	var f := mtof(midi)
	var dt := f / SR
	var n := int((dur + 0.3) * SR)
	var p := 0.0
	var pm := 0.0
	var pv := 0.0
	var low := 0.0
	var band := 0.0
	for i in n:
		var t := float(i) / SR
		# Vibrato only once the note has settled.
		pv = fposmod(pv + 5.2 / SR, 1.0)
		var bend := 1.0 + sin(TAU * pv) * 0.0035 * clampf((t - 0.14) / 0.2, 0.0, 1.0)
		p = fposmod(p + dt * bend, 1.0)
		var x := 0.0
		var amp := 1.0
		match kind:
			1:      # soft pulse: a narrow pulse, filtered, opening a little at the start
				var cut := 900.0 + 1700.0 * exp(-t * 6.0)
				var fc := 2.0 * sin(PI * cut / SR)
				low += fc * band
				band += fc * (_pulse(p, dt, 0.32) - low - 0.7 * band)
				x = low
				amp = _env(t, dur, 0.012, 0.16) * (0.6 + 0.4 * exp(-t * 4.0))
			2:      # glass: almost a sine, with a soft fifth above that fades
				x = sin(TAU * p) * 0.8 + sin(TAU * p * 3.0) * 0.14 * exp(-t * 6.0) + sin(TAU * p * 2.0) * 0.1
				amp = _env(t, dur, 0.008, 0.28) * (0.55 + 0.45 * exp(-t * 3.0))
			3:      # reed: a triangle bent by a slow modulator, breathier and longer
				pm = fposmod(pm + dt * 3.0, 1.0)
				x = sin(TAU * p + sin(TAU * pm) * 0.7 * (0.4 + 0.6 * exp(-t * 3.0))) * 0.6 + (absf(4.0 * p - 2.0) - 1.0) * 0.3
				amp = _env(t, dur, 0.03, 0.2)
			_:      # fm bell: a sine struck by a modulator two octaves up that dies away fast
				pm = fposmod(pm + dt * 2.0, 1.0)
				x = sin(TAU * p + sin(TAU * pm) * (2.0 * exp(-t * 8.0) + 0.22))
				amp = _env(t, dur, 0.004, 0.3) * (0.4 + 0.6 * exp(-t * 3.2))
		buf[(at + i) % total] += x * amp * 0.5 * vel

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

## 16-bit little-endian samples.
static func to_pcm16(buf: PackedFloat32Array) -> PackedByteArray:
	var bytes := PackedByteArray()
	bytes.resize(buf.size() * 2)
	for i in buf.size():
		bytes.encode_s16(i * 2, int(clampf(buf[i], -1.0, 1.0) * 32767.0))
	return bytes

static func to_stream(buf: PackedFloat32Array, looping: bool) -> AudioStreamWAV:
	var bytes := to_pcm16(buf)
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
