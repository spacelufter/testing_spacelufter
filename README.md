# testing_spacelufter

## Tone Pi

Tone Pi is a one-screen live-coding instrument. You write a short tune in a small [Sonic Pi](https://sonic-pi.net/)-style language and press **Run** to hear it. The sounds are simple browser waveforms — beep, pulse, saw, tri, and hollow — so this is a sketchpad, not Sonic Pi itself.

### Run

Nothing to install. Python 3 is enough. From this directory:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Open [http://localhost:8080](http://localhost:8080).

Press **Run**, or Ctrl+Enter (Cmd+Enter on a Mac). Edit a note and run again. **Stop**, or Escape, cuts the sound.

### Language

| Line | What it does |
| --- | --- |
| `use_bpm 100` | Sets the tempo. `sleep 1` waits one beat. |
| `use_synth :pulse` | Switches waveform: `:beep`, `:pulse`, `:saw`, `:tri`, or `:hollow`. |
| `play :E4` | Plays a note. `play 64` is the same pitch. `play :C` means C4. |
| `play [:C4, :E4, :G4]` | Plays a chord. |
| `play :E4, release: 0.4, amp: 0.6` | `release` is in beats. `amp` is from 0 to 1. |
| `sleep 0.5` | Waits half a beat. |
| `2.times do` … `end` | Repeats the indented block. |
| `play_pattern_timed [:C4, :E4], [0.5, 0.25]` | Plays each note, then sleeps that long. One time value repeats. |
| `# comment` | Ignored. |

A few Sonic Pi synth names (`:prophet`, `:blade`, `:fm`, `:piano`) map to the nearest simple waveform. `sample`, `live_loop`, and `with_fx` are left out on purpose.