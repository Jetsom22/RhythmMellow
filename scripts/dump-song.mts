// Prints the web prototype's generated song as JSON, for comparing with the Godot port.
import { generateSong } from '../src/core/music/song.ts';
console.log('SONG ' + JSON.stringify(generateSong(Number(process.argv[2] ?? 7), 2)));
