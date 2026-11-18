class_name Mix
extends RefCounted
## The mixing desk. Every voice goes through its own chain before the layers are summed:
## equalisation to give it a slot of its own, a level, a share of one common room, and for the
## bass a duck under every kick. Without this the layers are just raw synths played at once.
##
## Everything runs around the loop, so nothing clicks where the loop joins.

## Per-voice settings. This is data: an instrument set will carry its own.
##   eq:    [kind, hz, q, gain_db]  kind is "hp", "lp" or "peak"
##   peak:  level by loudest sample (for hits)      rms_db: level by average loudness (for held sounds)
##   room:  how much of the shared reverb             duck: how far the kick pushes it down (0..1)
const DESK := {
	"kick": {"eq": [["hp", 30.0, 0.7, 0.0], ["peak", 62.0, 1.0, 2.0], ["peak", 320.0, 1.2, -4.0], ["lp", 6000.0, 0.7, 0.0]], "peak": 0.82},
	"snare": {"eq": [["hp", 170.0, 0.7, 0.0], ["peak", 220.0, 1.0, 1.5], ["peak", 3000.0, 0.9, 2.0], ["lp", 10000.0, 0.7, 0.0]], "peak": 0.42, "room": 0.16},
	"hat": {"eq": [["hp", 6000.0, 0.7, 0.0], ["lp", 15000.0, 0.7, 0.0]], "peak": 0.16, "room": 0.05},
	# The bass is the bed everything sits on: no rumble below the kick, a dip where the kick's
	# body is, the muddy low-mids pulled out, a little presence so small speakers can find it,
	# no fizz on top, and it gives way each time the kick lands.
	"bass": {"eq": [["hp", 36.0, 0.7, 0.0], ["peak", 58.0, 1.0, -3.0], ["peak", 105.0, 1.0, 1.5], ["peak", 280.0, 1.0, -4.5], ["peak", 800.0, 0.9, 2.5], ["lp", 1500.0, 0.7, 0.0], ["lp", 2400.0, 0.7, 0.0]], "rms_db": -19.0, "duck": 0.45},
	# The lead and the pad are written in the same register. The lead is played an octave up so the
	# pad can hold the middle, and each is thinned where the other is strongest.
	"lead": {"octave": 12, "eq": [["hp", 420.0, 0.7, 0.0], ["peak", 520.0, 1.0, -2.5], ["peak", 3200.0, 0.8, 1.5], ["lp", 8500.0, 0.7, 0.0]], "rms_db": -24.0, "room": 0.2},
	"pad": {"eq": [["hp", 240.0, 0.7, 0.0], ["peak", 900.0, 0.8, -3.0], ["peak", 2600.0, 0.7, 1.5], ["lp", 5000.0, 0.7, 0.0]], "rms_db": -28.0, "room": 0.32},
}

## One second-order filter, run twice around the loop so its state has settled where the loop joins.
static func biquad(buf: PackedFloat32Array, kind: String, hz: float, q: float, gain_db: float, sr: float) -> void:
	var w := TAU * clampf(hz, 10.0, sr * 0.45) / sr
	var cw := cos(w)
	var alpha := sin(w) / (2.0 * q)
	var b0 := 1.0
	var b1 := 0.0
	var b2 := 0.0
	var a0 := 1.0
	var a1 := -2.0 * cw
	var a2 := 1.0
	match kind:
		"hp":
			b0 = (1.0 + cw) / 2.0
			b1 = -(1.0 + cw)
			b2 = b0
			a0 = 1.0 + alpha
			a2 = 1.0 - alpha
		"lp":
			b0 = (1.0 - cw) / 2.0
			b1 = 1.0 - cw
			b2 = b0
			a0 = 1.0 + alpha
			a2 = 1.0 - alpha
		_:
			var amp := pow(10.0, gain_db / 40.0)
			b0 = 1.0 + alpha * amp
			b1 = -2.0 * cw
			b2 = 1.0 - alpha * amp
			a0 = 1.0 + alpha / amp
			a2 = 1.0 - alpha / amp
	b0 /= a0
	b1 /= a0
	b2 /= a0
	a1 /= a0
	a2 /= a0
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	var n := buf.size()
	for lap in 2:
		for i in n:
			var x := buf[i]
			var y := b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
			x2 = x1
			x1 = x
			y2 = y1
			y1 = y
			if lap == 1:
				buf[i] = y

static func rms_db(buf: PackedFloat32Array) -> float:
	var e := 0.0
	for v in buf:
		e += v * v
	return 10.0 * log(maxf(e / maxi(1, buf.size()), 1e-12)) / log(10.0)

static func peak(buf: PackedFloat32Array) -> float:
	var top := 0.0
	for v in buf:
		top = maxf(top, absf(v))
	return top

static func scale(buf: PackedFloat32Array, k: float) -> void:
	for i in buf.size():
		buf[i] *= k

## Push the buffer down each time the kick lands, and let it come back up: the kick gets the low end to itself for a moment.
static func duck(buf: PackedFloat32Array, hits: Array, depth: float, sr: float) -> void:
	var n := buf.size()
	var attack := int(0.004 * sr)
	var release := 0.16 * sr
	var span := int(release * 5.0)
	var gain := PackedFloat32Array()
	gain.resize(n)
	gain.fill(1.0)
	for h in hits:
		for i in span:
			var g := 1.0 - depth * (float(i) / attack if i < attack else exp(-float(i - attack) / release))
			var j := (int(h) + i) % n
			gain[j] = minf(gain[j], g)
	for i in n:
		buf[i] *= gain[i]

## The shared room: a small plate-like reverb. Returns only the reverberated sound.
## Every voice that takes some of it is placed in the same space, which is most of what
## makes separate synths sound like one piece of music.
static func room(buf: PackedFloat32Array, sr: float) -> PackedFloat32Array:
	var n := buf.size()
	var wet := PackedFloat32Array()
	wet.resize(n)
	var k := sr / 44100.0
	for d in [1116, 1188, 1277, 1356]:
		var size := int(d * k)
		var line := PackedFloat32Array()
		line.resize(size)
		var pos := 0
		var damp := 0.0
		for lap in 2:
			for i in n:
				var out := line[pos]
				damp = out * 0.72 + damp * 0.28       # the room swallows highs as the sound decays
				line[pos] = buf[i] + damp * 0.8
				pos = (pos + 1) % size
				if lap == 1:
					wet[i] += out
	for d in [556, 441]:
		var size := int(d * k)
		var line := PackedFloat32Array()
		line.resize(size)
		var pos := 0
		for lap in 2:
			for i in n:
				var x := wet[i]
				var delayed := line[pos]
				line[pos] = x + delayed * 0.5
				pos = (pos + 1) % size
				if lap == 1:
					wet[i] = delayed - x * 0.5
	scale(wet, 0.18)
	biquad(wet, "hp", 350.0, 0.7, 0.0, sr)        # keep the low end dry and tight
	biquad(wet, "lp", 6500.0, 0.7, 0.0, sr)
	return wet

## Semitones a voice is shifted by before it is played (the desk decides its register).
static func octave_of(voice: String) -> float:
	return float(DESK[voice].get("octave", 0)) if DESK.has(voice) else 0.0

## Run one voice through its chain. `kick_hits` are sample positions of the kick, for ducking.
static func process(buf: PackedFloat32Array, voice: String, sr: float, kick_hits: Array) -> void:
	if not DESK.has(voice):
		return
	var d: Dictionary = DESK[voice]
	for e in d["eq"]:
		biquad(buf, e[0], e[1], e[2], e[3], sr)
	if d.has("rms_db"):
		scale(buf, pow(10.0, (float(d["rms_db"]) - rms_db(buf)) / 20.0))
	elif d.has("peak"):
		var top := peak(buf)
		if top > 0.0001:
			scale(buf, float(d["peak"]) / top)
	if d.has("duck") and not kick_hits.is_empty():
		duck(buf, kick_hits, float(d["duck"]), sr)
	if d.has("room"):
		var wet := room(buf, sr)
		var send: float = d["room"]
		for i in buf.size():
			buf[i] += wet[i] * send / 0.18 * 0.5
