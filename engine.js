(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CueEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const NAMES = ["C", "Cs", "D", "Eb", "E", "F", "Fs", "G", "Ab", "A", "Bb", "B"];
  const SYNTHS = {
    beep: "sine",
    sine: "sine",
    pretty_bell: "sine",
    pulse: "square",
    square: "square",
    saw: "sawtooth",
    sawtooth: "sawtooth",
    prophet: "sawtooth",
    blade: "sawtooth",
    tri: "triangle",
    triangle: "triangle",
    piano: "triangle",
    hollow: "hollow",
    fm: "hollow",
  };
  const HINTS = {
    live_loop: "live_loop is not in Tone Pi. Repeat with 2.times do and end.",
    sample: "Samples are not in Tone Pi. Use play :E4.",
    with_fx: "Effects are not in Tone Pi.",
    sync: "sync is not in Tone Pi.",
    in_thread: "in_thread is not in Tone Pi. Stack notes with play [:C4, :E4, :G4].",
    play_pattern: "Use play_pattern_timed [:C4, :E4], [0.5].",
  };
  const MAX_EVENTS = 400;
  const MAX_SECONDS = 45;

  function fail(line, message) {
    const error = new Error(message);
    error.line = line;
    throw error;
  }

  function midiName(midi) {
    const n = Math.round(midi);
    const pitch = ((n % 12) + 12) % 12;
    const octave = Math.floor(n / 12) - 1;
    return NAMES[pitch] + octave;
  }

  function formatNoteName(raw, accidental, octave) {
    const letter = raw.toUpperCase();
    let acc = accidental || "";
    if (acc === "#" || acc === "S") acc = "s";
    if (acc === "B") acc = "b";
    return letter + acc + String(octave);
  }

  function noteFromSymbol(raw) {
    const match = /^([A-Ga-g])([sSb#])?([0-8])?$/.exec(raw);
    if (!match) return null;
    const letter = match[1].toUpperCase();
    let accidental = 0;
    if (match[2] === "s" || match[2] === "S" || match[2] === "#") accidental = 1;
    if (match[2] === "b" || match[2] === "B") accidental = -1;
    const octave = match[3] ? Number(match[3]) : 4;
    const midi = (octave + 1) * 12 + SEMI[letter] + accidental;
    if (midi < 0 || midi > 127) return null;
    return { midi, name: formatNoteName(letter, match[2], octave) };
  }

  function tokenize(line, lineNo) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === "#") break;
      if (/\s/.test(c)) {
        i += 1;
        continue;
      }
      if (c === ",") {
        tokens.push({ type: "comma" });
        i += 1;
        continue;
      }
      if (c === "[") {
        tokens.push({ type: "lbracket" });
        i += 1;
        continue;
      }
      if (c === "]") {
        tokens.push({ type: "rbracket" });
        i += 1;
        continue;
      }
      if (c === ".") {
        tokens.push({ type: "dot" });
        i += 1;
        continue;
      }
      if (c === ":") {
        const body = /^[A-Za-z][A-Za-z0-9_#]*/.exec(line.slice(i + 1));
        if (!body) fail(lineNo, "Expected a name after the colon.");
        tokens.push({ type: "symbol", value: body[0] });
        i += 1 + body[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const body = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
        i += body[0].length;
        if (line[i] === ":") {
          tokens.push({ type: "label", value: body[0] });
          i += 1;
        } else {
          tokens.push({ type: "ident", value: body[0] });
        }
        continue;
      }
      if (/[0-9]/.test(c)) {
        const body = /^\d+(?:\.\d+)?/.exec(line.slice(i));
        tokens.push({ type: "number", value: body[0] });
        i += body[0].length;
        continue;
      }
      fail(lineNo, "Unexpected '" + c + "'.");
    }
    return tokens;
  }

  function expectNote(token, lineNo) {
    if (!token) fail(lineNo, "Expected a note, such as :E4 or 64.");
    if (token.type === "number") {
      const midi = Number(token.value);
      if (!Number.isFinite(midi) || midi < 0 || midi > 127) {
        fail(lineNo, "MIDI notes must be numbers from 0 to 127.");
      }
      const name = Number.isInteger(midi) ? midiName(midi) : token.value;
      return { midi, name };
    }
    if (token.type === "symbol") {
      const note = noteFromSymbol(token.value);
      if (!note) fail(lineNo, "':" + token.value + "' is not a note. Try :C4, :Eb4, or :Fs3.");
      return note;
    }
    fail(lineNo, "Expected a note, such as :E4 or 64.");
  }

  function parseArray(tokens, start, lineNo, kind) {
    if (tokens[start] && tokens[start].type !== "lbracket") {
      fail(lineNo, "Expected a list in brackets.");
    }
    if (!tokens[start]) fail(lineNo, "Expected a list in brackets.");
    let i = start + 1;
    const values = [];
    while (i < tokens.length && tokens[i].type !== "rbracket") {
      if (tokens[i].type === "comma") fail(lineNo, "Remove the extra comma in the list.");
      if (kind === "note") values.push(expectNote(tokens[i], lineNo));
      else {
        if (tokens[i].type !== "number") fail(lineNo, "Sleep times must be numbers.");
        const beats = Number(tokens[i].value);
        if (!(beats > 0) || beats > 16) {
          fail(lineNo, "Each sleep time must be greater than 0 and at most 16 beats.");
        }
        values.push(beats);
      }
      i += 1;
      if (tokens[i] && tokens[i].type === "comma") i += 1;
    }
    if (!tokens[i] || tokens[i].type !== "rbracket") fail(lineNo, "Close the list with ].");
    if (values.length === 0) {
      fail(lineNo, kind === "note" ? "Add at least one note." : "Add at least one sleep time.");
    }
    return { values, next: i + 1 };
  }

  function parseOpts(tokens, start, lineNo) {
    let i = start;
    let release = null;
    let amp = null;
    while (i < tokens.length) {
      if (tokens[i].type === "comma") {
        i += 1;
        if (i >= tokens.length) break;
      }
      if (tokens[i].type !== "label") fail(lineNo, "Expected release: or amp: after the note.");
      const label = tokens[i].value;
      const num = tokens[i + 1];
      if (!num || num.type !== "number") fail(lineNo, "Expected a number after " + label + ":.");
      const value = Number(num.value);
      if (label === "release") {
        if (!(value > 0) || value > 8) {
          fail(lineNo, "release must be greater than 0 and at most 8 beats.");
        }
        release = value;
      } else if (label === "amp") {
        if (!(value >= 0) || value > 1) fail(lineNo, "amp must be from 0 to 1.");
        amp = value;
      } else {
        fail(lineNo, "Unknown option " + label + ". Use release: or amp:.");
      }
      i += 2;
    }
    return { release, amp };
  }

  function parseStatement(tokens, lineNo) {
    if (tokens[0].type === "number") {
      const timesCall =
        tokens[1] &&
        tokens[1].type === "dot" &&
        tokens[2] &&
        tokens[2].type === "ident" &&
        tokens[2].value === "times";
      if (!timesCall) {
        fail(lineNo, "A line cannot start with a number. Try play 60 or 2.times do.");
      }
      if (!tokens[3] || tokens[3].type !== "ident" || tokens[3].value !== "do") {
        fail(lineNo, "Add do after times, as in 2.times do.");
      }
      if (tokens.length > 4) fail(lineNo, "Unexpected text after do.");
      const times = Number(tokens[0].value);
      if (!Number.isInteger(times) || times < 1 || times > 32) {
        fail(lineNo, "Loop count must be a whole number from 1 to 32.");
      }
      return { op: "times", times };
    }

    if (tokens[0].type !== "ident") fail(lineNo, "Start the line with play, sleep, use_synth, or use_bpm.");
    const name = tokens[0].value;

    if (name === "end") {
      if (tokens.length > 1) fail(lineNo, "Unexpected text after end.");
      return { op: "end" };
    }
    if (name === "use_bpm") {
      if (!tokens[1] || tokens[1].type !== "number") fail(lineNo, "use_bpm needs a number, such as use_bpm 120.");
      if (tokens.length > 2) fail(lineNo, "Unexpected text after the BPM.");
      const bpm = Number(tokens[1].value);
      if (!(bpm >= 40) || bpm > 240) fail(lineNo, "BPM must be a number from 40 to 240.");
      return { op: "bpm", bpm };
    }
    if (name === "use_synth") {
      if (!tokens[1] || tokens[1].type !== "symbol") {
        fail(lineNo, "Name a synth, such as use_synth :pulse.");
      }
      if (tokens.length > 2) fail(lineNo, "Unexpected text after the synth name.");
      const synth = tokens[1].value;
      if (!SYNTHS[synth]) {
        fail(lineNo, ":" + synth + " is not a synth here. Try :beep, :pulse, :saw, :tri, or :hollow.");
      }
      return { op: "synth", name: synth, wave: SYNTHS[synth] };
    }
    if (name === "sleep") {
      if (!tokens[1] || tokens[1].type !== "number") fail(lineNo, "sleep needs a number of beats, such as sleep 0.5.");
      if (tokens.length > 2) fail(lineNo, "Unexpected text after sleep.");
      const beats = Number(tokens[1].value);
      if (!(beats > 0) || beats > 16) {
        fail(lineNo, "sleep must be greater than 0 and at most 16 beats.");
      }
      return { op: "sleep", beats };
    }
    if (name === "play") {
      let notes;
      let next;
      if (tokens[1] && tokens[1].type === "lbracket") {
        const list = parseArray(tokens, 1, lineNo, "note");
        notes = list.values;
        next = list.next;
      } else {
        notes = [expectNote(tokens[1], lineNo)];
        next = 2;
      }
      const opts = parseOpts(tokens, next, lineNo);
      return { op: "play", notes, release: opts.release, amp: opts.amp };
    }
    if (name === "play_pattern_timed") {
      const notes = parseArray(tokens, 1, lineNo, "note");
      let next = notes.next;
      if (tokens[next] && tokens[next].type === "comma") next += 1;
      const times = parseArray(tokens, next, lineNo, "time");
      const opts = parseOpts(tokens, times.next, lineNo);
      return {
        op: "pattern",
        notes: notes.values,
        times: times.values,
        release: opts.release,
        amp: opts.amp,
      };
    }
    if (HINTS[name]) fail(lineNo, HINTS[name]);
    fail(lineNo, "Unknown command '" + name + "'. Try play, sleep, use_synth, use_bpm, or 2.times do.");
  }

  function foldBlocks(stmts) {
    const root = [];
    let block = null;
    stmts.forEach(function (stmt) {
      if (stmt.op === "times") {
        if (block) fail(stmt.line, "Nested loops are not supported. Close the first loop with end.");
        block = { op: "times", times: stmt.times, line: stmt.line, body: [] };
        return;
      }
      if (stmt.op === "end") {
        if (!block) fail(stmt.line, "end does not close a loop. Add 2.times do above it.");
        if (block.body.length === 0) {
          fail(block.line, "The loop is empty. Add a play and a sleep before end.");
        }
        root.push(block);
        block = null;
        return;
      }
      if (block) block.body.push(stmt);
      else root.push(stmt);
    });
    if (block) fail(block.line, "The loop is missing end.");
    return root;
  }

  function pushNote(events, state, line, notes, releaseBeats, amp) {
    const beats = releaseBeats == null ? 1 : releaseBeats;
    const release = Math.min(4, Math.max(0.03, beats * (60 / state.bpm)));
    events.push({
      time: state.time,
      line: line,
      synth: state.synth,
      wave: state.wave,
      amp: amp == null ? 0.75 : amp,
      release: release,
      notes: notes,
    });
    if (events.length > MAX_EVENTS) {
      fail(line, "This sketch has too many notes. Shorten the loop.");
    }
  }

  function advance(state, beats, line) {
    state.time += beats * (60 / state.bpm);
    if (state.time > MAX_SECONDS) {
      fail(line, "This sketch is longer than 45 seconds. Shorten a loop or a sleep.");
    }
  }

  function walk(commands, state, events) {
    commands.forEach(function (cmd) {
      if (cmd.op === "times") {
        for (let n = 0; n < cmd.times; n += 1) walk(cmd.body, state, events);
        return;
      }
      if (cmd.op === "bpm") {
        state.bpm = cmd.bpm;
        return;
      }
      if (cmd.op === "synth") {
        state.synth = cmd.name;
        state.wave = cmd.wave;
        return;
      }
      if (cmd.op === "sleep") {
        advance(state, cmd.beats, cmd.line);
        return;
      }
      if (cmd.op === "play") {
        pushNote(events, state, cmd.line, cmd.notes, cmd.release, cmd.amp);
        return;
      }
      if (cmd.op === "pattern") {
        cmd.notes.forEach(function (note, index) {
          const beats = cmd.times[index % cmd.times.length];
          const releaseBeats = cmd.release == null ? Math.min(beats, 1) : cmd.release;
          pushNote(events, state, cmd.line, [note], releaseBeats, cmd.amp);
          advance(state, beats, cmd.line);
        });
      }
    });
  }

  function compileSource(source) {
    try {
      if (typeof source !== "string" || source.trim() === "") {
        return { ok: false, line: 1, message: "Write a play line first." };
      }
      const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      const stmts = [];
      lines.forEach(function (text, index) {
        const tokens = tokenize(text, index + 1);
        if (tokens.length === 0) return;
        stmts.push(Object.assign({ line: index + 1 }, parseStatement(tokens, index + 1)));
      });
      const program = foldBlocks(stmts);
      const state = { bpm: 60, synth: "beep", wave: "sine", time: 0 };
      const events = [];
      walk(program, state, events);
      if (events.length === 0) {
        return { ok: false, line: 1, message: "Add a play line so there is something to hear." };
      }
      let endTime = state.time;
      events.forEach(function (event) {
        endTime = Math.max(endTime, event.time + event.release);
      });
      return { ok: true, events: events, duration: state.time, endTime: endTime };
    } catch (error) {
      if (error && error.line) return { ok: false, line: error.line, message: error.message };
      throw error;
    }
  }

  return { compileSource: compileSource, midiName: midiName };
});
