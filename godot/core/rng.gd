class_name Rng
extends RefCounted
## Seeded PRNG (mulberry32). Produces exactly the same sequence as the web
## prototype's src/core/rng.ts, so the same seed gives the same song.

const M := 0xFFFFFFFF
var _a: int

func _init(seed_value: int) -> void:
	_a = seed_value & M

## 32-bit multiply, low word only (JavaScript's Math.imul, kept unsigned).
static func imul(a: int, b: int) -> int:
	a &= M
	b &= M
	return ((a & 0xFFFF) * b + ((((a >> 16) * b) & 0xFFFF) << 16)) & M

## Next value in [0, 1).
func next() -> float:
	_a = (_a + 0x6D2B79F5) & M
	var t := _a
	t = imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + imul(t ^ (t >> 7), t | 61)) & M)) & M
	return float((t ^ (t >> 14)) & M) / 4294967296.0

func pick(xs: Array) -> Variant:
	return xs[int(floor(next() * xs.size()))]
