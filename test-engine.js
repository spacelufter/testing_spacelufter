const fs = require("fs");
const { compileSource } = require("./engine");

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error("FAIL:", message);
  }
}

function compileOk(source) {
  const result = compileSource(source);
  assert(result.ok, result.message || "expected ok");
  return result;
}

const c4 = compileOk("play :C4");
assert(c4.events.length === 1, "one note");
assert(c4.events[0].notes[0].midi === 60, "C4 is midi 60");
assert(c4.events[0].synth === "beep", "default synth is beep");

const sharp = compileOk("play :C#4\nplay :Cs4\nplay :Eb4\nplay :Bb4\nplay :Fs3");
assert(sharp.events[0].notes[0].midi === 61, "C#4");
assert(sharp.events[1].notes[0].midi === 61, "Cs4");
assert(sharp.events[2].notes[0].midi === 63, "Eb4");
assert(sharp.events[3].notes[0].midi === 70, "Bb4");
assert(sharp.events[4].notes[0].midi === 54, "Fs3");

const tempo = compileOk("use_bpm 120\nplay 60\nsleep 1\nplay 64");
assert(Math.abs(tempo.events[1].time - 0.5) < 0.0001, "120 bpm sleep 1 is half a second");
assert(tempo.events[1].notes[0].name === "E4", "midi 64 is E4");

const loop = compileOk("2.times do\nplay :C4\nsleep 1\nuse_bpm 120\nend");
assert(loop.events.length === 2, "loop plays twice");
assert(Math.abs(loop.events[1].time - 1) < 0.0001, "second pass starts at 1s");
assert(Math.abs(loop.duration - 1.5) < 0.0001, "bpm change applies to the next sleep");

const chord = compileOk("play [:C4, :E4, :G4], release: 0.5, amp: 0.4");
assert(chord.events[0].notes.length === 3, "chord is one event");
assert(chord.events[0].amp === 0.4, "amp option");

const pattern = compileOk("play_pattern_timed [:C4, :E4, :G4], [0.5]");
assert(pattern.events.length === 3, "pattern length");
assert(Math.abs(pattern.events[2].time - 1) < 0.0001, "times cycle");
assert(Math.abs(pattern.duration - 1.5) < 0.0001, "pattern includes the last sleep");

const comment = compileOk("# hello\n\nplay :E4, release: 0.25");
assert(comment.events[0].notes[0].name === "E4", "comment ignored");

assert(!compileSource("end").ok, "unmatched end");
assert(!compileSource("2.times do\nplay :C4").ok, "missing end");
assert(compileSource("2.times do\n2.times do\nplay :C4\nend\nend").line === 2, "nested loop line");
assert(compileSource("sample :bd").message.includes("Samples"), "sample hint");
assert(compileSource("play :hello").message.includes("not a note"), "bad note");
assert(!compileSource("use_bpm 10").ok, "bpm range");
assert(!compileSource("play :C4, amp: 2").ok, "amp range");

const html = fs.readFileSync("index.html", "utf8");
const example = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1];
const tune = compileOk(example);
assert(tune.events.length === 12, "example schedules 12 events, got " + tune.events.length);
assert(tune.events[0].notes[0].name === "C4" && tune.events[0].synth === "pulse", "example starts on pulse C4");
assert(tune.events[3].notes.map((note) => note.name).join(" ") === "C5 G4 E4", "example chord");
assert(tune.events[8].synth === "hollow", "example switches to hollow");
for (let i = 1; i < tune.events.length; i += 1) {
  assert(tune.events[i].time >= tune.events[i - 1].time, "times move forward");
}

if (failed) {
  console.error(failed + " assertion(s) failed");
  process.exit(1);
}
console.log("engine tests passed");
