class_name Voice
extends RefCounted
## Voices whose sound is data. A patch is { "synth": kind, "p": { param: value } }, so a song
## file can carry its own instruments and the studio can change them with sliders.
##
## Synth.gd keeps the first, hard-coded voices; the game's experiment screen still uses those.

const SR := 44100
const FILTER_TOP := 6800.0      # the filter is only stable below about a sixth of the sample rate

## What each kind of voice can be told. [key, low, high, default, scale]
## scale: "lin", "log" (frequencies and times) or "int".
const PARAMS := {
	"tone": [
		["oct", -24.0, 24.0, 0.0, "int"],            # semitones the whole voice is shifted by
		["sub", 0.0, 1.0, 0.0, "lin"],               # a sine one octave under the oscillators; it skips the filter
		["sine", 0.0, 1.0, 0.0, "lin"],
		["saw", 0.0, 1.0, 0.0, "lin"],
		["pulse", 0.0, 1.0, 0.0, "lin"],
		["pw", 0.05, 0.5, 0.5, "lin"],               # pulse width
		["tri", 0.0, 1.0, 0.0, "lin"],
		["detune", 0.0, 40.0, 0.0, "lin"],           # cents between the two copies of saw and triangle
		["fm", 0.0, 8.0, 0.0, "lin"],                # how hard the sine is bent by the modulator
		["fm_ratio", 0.5, 8.0, 2.0, "lin"],
		["fm_decay", 0.5, 40.0, 8.0, "log"],         # how fast the bend dies away (1/s)
		["fm_hold", 0.0, 1.0, 0.1, "lin"],           # the share of the bend that stays
		["cutoff", 40.0, 6800.0, 6800.0, "log"],     # filter, Hz; at the top the filter is off
		["env", 0.0, 6000.0, 0.0, "lin"],            # Hz the filter opens by at the start of a note
		["env_decay", 0.5, 40.0, 8.0, "log"],        # how fast it closes again (1/s)
		["reso", 0.0, 0.97, 0.3, "lin"],
		["track", 0.0, 8.0, 0.0, "lin"],             # cutoff follows the pitch: Hz per Hz of the note
		["drive", 0.0, 1.0, 0.0, "lin"],
		["attack", 0.001, 1.0, 0.006, "log"],
		["decay", 0.02, 3.0, 0.3, "log"],
		["sustain", 0.0, 1.0, 1.0, "lin"],
		["release", 0.01, 2.0, 0.08, "log"],
		["gate", 0.05, 1.0, 1.0, "lin"],             # the share of the written length that is held
		["accent", 0.0, 1.0, 0.5, "lin"],            # how much an accented note opens the filter and gains
		["glide", 0.005, 0.3, 0.05, "log"],          # seconds a sliding note takes to arrive
		["vib", 0.0, 30.0, 0.0, "lin"],              # cents
		["vib_rate", 1.0, 9.0, 5.2, "lin"],
		["echo", 0.0, 0.8, 0.0, "lin"],              # level of the echo
		["echo_steps", 1.0, 8.0, 3.0, "int"],
		["echo_fb", 0.0, 0.7, 0.34, "lin"],
	],
	"kick": [
		["f_start", 60.0, 400.0, 150.0, "log"],
		["f_end", 30.0, 90.0, 45.0, "log"],
		["sweep", 0.01, 0.3, 0.12, "log"],
		["decay", 4.0, 40.0, 15.0, "log"],
		["click", 0.0, 1.0, 0.0, "lin"],
		["drive", 0.0, 1.0, 0.0, "lin"],
	],
	"snare": [
		["tone", 120.0, 320.0, 180.0, "log"],
		["tone_level", 0.0, 1.0, 0.5, "lin"],
		["tone_decay", 10.0, 80.0, 40.0, "log"],
		["noise_level", 0.0, 1.5, 1.12, "lin"],
		["noise_decay", 8.0, 60.0, 26.0, "log"],
		["bright", 0.1, 0.95, 0.45, "lin"],
		["thin", 0.02, 0.5, 0.12, "lin"],
	],
	"hat": [
		["decay", 20.0, 200.0, 80.0, "log"],
		["bright", 0.0, 1.0, 1.0, "lin"],
	],
	"tick": [],
}

static func defaults(kind: String) -> Dictionary:
	var out := {}
	for row in PARAMS.get(kind, []):
		out[row[0]] = row[3]
	return out

## A patch's parameters with every missing one filled in.
static func filled(patch: Dictionary) -> Dictionary:
	var out := defaults(str(patch.get("synth", "tone")))
	var given: Dictionary = patch.get("p", {})
	for k in given:
		out[k] = float(given[k])
	return out

## Render every note of one voice into `buf`. Tails wrap around the loop.
## A note is { step, len, midi, vel } and may carry `acc` (accent) and `slide` (glide in from the note before).
static func render(buf: PackedFloat32Array, patch: Dictionary, notes: Array, sps: float) -> void:
	var kind := str(patch.get("synth", "tone"))
	var p := filled(patch)
	var noise := RandomNumberGenerator.new()
	noise.seed = 1234
	var before := -1000.0
	for n in notes:
		var at := int(round(float(n["step"]) * sps * SR))
		var vel := float(n["vel"])
		match kind:
			"kick": _kick(buf, at, vel, p)
			"snare": _snare(buf, at, vel, p, noise)
			"hat": _hat(buf, at, vel, p, noise)
			"tick": Synth._tone(buf, at, 2000.0, 0.02, vel * 0.5)
			_:
				var midi := float(n["midi"])
				var from := before if bool(n.get("slide", false)) and before > -500.0 else midi
				_tone(buf, at, midi, from, float(n["len"]) * sps, vel, bool(n.get("acc", false)), p)
				before = midi
	if kind == "tone" and float(p["echo"]) > 0.0:
		Synth._echo(buf, int(round(float(p["echo_steps"]) * sps * SR)), maxf(0.05, float(p["echo_fb"])), float(p["echo"]))

static func _tone(buf: PackedFloat32Array, at: int, midi: float, from: float, dur: float, vel: float, acc: bool, p: Dictionary) -> void:
	var total := buf.size()
	var oct: float = p["oct"]
	var f := Synth.mtof(midi + oct)
	var f_from := Synth.mtof(from + oct)
	var sub: float = p["sub"]
	var sine: float = p["sine"]
	var saw: float = p["saw"]
	var pulse: float = p["pulse"]
	var pw: float = p["pw"]
	var tri: float = p["tri"]
	var spread := pow(2.0, float(p["detune"]) / 1200.0)
	var two := float(p["detune"]) > 0.0 and (saw > 0.0 or tri > 0.0)
	var fm: float = p["fm"]
	var fm_ratio: float = p["fm_ratio"]
	var fm_decay: float = p["fm_decay"]
	var fm_hold: float = p["fm_hold"]
	var push := 1.0 + (float(p["accent"]) if acc else 0.0)
	var cutoff: float = p["cutoff"]
	var env: float = float(p["env"]) * push
	var env_decay: float = p["env_decay"]
	var damp := 1.5 - 1.45 * float(p["reso"])
	var track: float = p["track"]
	var filtered := cutoff < FILTER_TOP - 1.0 or env > 0.0
	var drive := 1.0 + 3.0 * float(p["drive"])
	var driven := float(p["drive"]) > 0.0
	var attack: float = p["attack"]
	var decay: float = p["decay"]
	var sustain: float = p["sustain"]
	var release: float = p["release"]
	var hold := maxf(attack, dur * float(p["gate"]))
	var at_hold := sustain + (1.0 - sustain) * exp(-(hold - attack) / decay)
	var glide: float = p["glide"]
	var gliding := absf(f_from - f) > 0.01
	var vib := float(p["vib"]) * 0.0005777       # cents to a frequency ratio, near enough
	var vib_rate: float = p["vib_rate"]
	var gain := vel * push * 0.5
	var n := mini(int((hold + release) * SR) + 1, total * 2)
	var ph := 0.0
	var ph2 := 0.25
	var phs := 0.0
	var phm := 0.0
	var phv := 0.0
	var low := 0.0
	var band := 0.0
	for i in n:
		var t := float(i) / SR
		var fr := f
		if gliding:
			fr = f + (f_from - f) * exp(-t / glide)
		if vib > 0.0:
			phv = fposmod(phv + vib_rate / SR, 1.0)
			fr *= 1.0 + sin(TAU * phv) * vib * clampf((t - 0.14) / 0.2, 0.0, 1.0)
		var dt := fr / SR
		ph = fposmod(ph + dt, 1.0)
		var x := 0.0
		if saw > 0.0:
			x += saw * Synth._saw(ph, dt)
		if tri > 0.0:
			x += tri * (absf(4.0 * ph - 2.0) - 1.0)
		if two:
			var dt2 := dt * spread
			ph2 = fposmod(ph2 + dt2, 1.0)
			x *= 0.5
			if saw > 0.0:
				x += 0.5 * saw * Synth._saw(ph2, dt2)
			if tri > 0.0:
				x += 0.5 * tri * (absf(4.0 * ph2 - 2.0) - 1.0)
		if pulse > 0.0:
			x += pulse * Synth._pulse(ph, dt, pw)
		if sine > 0.0:
			var bend := 0.0
			if fm > 0.0:
				phm = fposmod(phm + dt * fm_ratio, 1.0)
				bend = sin(TAU * phm) * fm * (fm_hold + (1.0 - fm_hold) * exp(-t * fm_decay))
			x += sine * sin(TAU * ph + bend)
		if filtered:
			var cut := minf(cutoff + env * exp(-t * env_decay) + track * fr, FILTER_TOP)
			var fc := 2.0 * sin(PI * cut / SR)
			low += fc * band
			band += fc * (x - low - damp * band)
			x = low
		if sub > 0.0:
			phs = fposmod(phs + dt * 0.5, 1.0)
			x += sub * sin(TAU * phs)
		if driven:
			x = tanh(x * drive)
		var amp := 0.0
		if t < attack:
			amp = t / attack
		elif t < hold:
			amp = sustain + (1.0 - sustain) * exp(-(t - attack) / decay)
		else:
			amp = at_hold * maxf(0.0, 1.0 - (t - hold) / release)
		buf[(at + i) % total] += x * amp * gain

static func _kick(buf: PackedFloat32Array, at: int, vel: float, p: Dictionary) -> void:
	var total := buf.size()
	var f_start: float = p["f_start"]
	var f_end: float = p["f_end"]
	var sweep: float = p["sweep"]
	var decay: float = p["decay"]
	var click: float = p["click"]
	var drive := 1.0 + 3.0 * float(p["drive"])
	var driven := float(p["drive"]) > 0.0
	var n := int(minf(0.7, 7.0 / decay) * SR)
	var phase := 0.0
	for i in n:
		var t := float(i) / SR
		var f := f_start * pow(f_end / f_start, minf(t / sweep, 1.0))
		phase += TAU * f / SR
		var x := sin(phase) * minf(t / 0.002, 1.0) * exp(-t * decay)
		if click > 0.0:
			x += click * sin(TAU * 1900.0 * t) * exp(-t * 500.0) * 0.5
		if driven:
			x = tanh(x * drive)
		buf[(at + i) % total] += x * vel

static func _snare(buf: PackedFloat32Array, at: int, vel: float, p: Dictionary, noise: RandomNumberGenerator) -> void:
	var total := buf.size()
	var tone: float = p["tone"]
	var tone_level: float = p["tone_level"]
	var tone_decay: float = p["tone_decay"]
	var noise_level: float = p["noise_level"]
	var noise_decay: float = p["noise_decay"]
	var bright: float = p["bright"]
	var thin: float = p["thin"]
	var n := int(minf(0.5, 7.0 / minf(noise_decay, tone_decay)) * SR)
	var lp := 0.0
	var hp := 0.0
	var phase := 0.0
	for i in n:
		var t := float(i) / SR
		var x := noise.randf_range(-1.0, 1.0)
		lp += bright * (x - lp)
		hp += thin * (lp - hp)
		phase += TAU * tone / SR
		var tri := 2.0 * absf(2.0 * fposmod(phase / TAU, 1.0) - 1.0) - 1.0
		buf[(at + i) % total] += ((lp - hp) * noise_level * exp(-t * noise_decay) + tri * tone_level * exp(-t * tone_decay)) * vel

static func _hat(buf: PackedFloat32Array, at: int, vel: float, p: Dictionary, noise: RandomNumberGenerator) -> void:
	var total := buf.size()
	var decay: float = p["decay"]
	var bright: float = p["bright"]
	var n := int(minf(0.4, 7.0 / decay) * SR)
	var prev := 0.0
	for i in n:
		var t := float(i) / SR
		var x := noise.randf_range(-1.0, 1.0)
		var hi := x - prev * bright
		prev = x
		buf[(at + i) % total] += hi * exp(-t * decay) * 0.22 * vel
