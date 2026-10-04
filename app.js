(function () {
  const code = document.getElementById("code");
  const gutter = document.getElementById("gutter");
  const highlight = document.getElementById("highlight");
  const log = document.getElementById("log");
  const status = document.getElementById("status");
  const runBtn = document.getElementById("run");
  const stopBtn = document.getElementById("stop");
  const canvas = document.getElementById("scope");
  const scope = canvas.getContext("2d");

  let audioCtx = null;
  let master = null;
  let analyser = null;
  let wave = null;
  let active = [];
  let timers = [];
  let raf = 0;
  let runId = 0;
  let playing = false;
  let errorLine = 0;

  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightSource(source) {
    const re =
      /#[^\n]*|:[A-Za-z][A-Za-z0-9_#]*|\b(?:play_pattern_timed|use_synth|use_bpm|sleep|play|times|do|end)\b|\b\d+(?:\.\d+)?\b/g;
    let html = "";
    let last = 0;
    for (const match of source.matchAll(re)) {
      html += escapeHtml(source.slice(last, match.index));
      const raw = match[0];
      const cls = raw.startsWith("#") ? "cmt" : raw.startsWith(":") ? "sym" : /^\d/.test(raw) ? "num" : "kw";
      html += '<span class="' + cls + '">' + escapeHtml(raw) + "</span>";
      last = match.index + raw.length;
    }
    html += escapeHtml(source.slice(last));
    return html || " ";
  }

  function renderEditor() {
    const lines = code.value.split("\n");
    gutter.replaceChildren();
    lines.forEach(function (_, index) {
      const span = document.createElement("span");
      span.textContent = String(index + 1);
      if (errorLine === index + 1) span.className = "bad";
      gutter.append(span);
    });
    highlight.innerHTML = highlightSource(code.value);
    code.setAttribute("aria-invalid", errorLine ? "true" : "false");
  }

  function syncScroll() {
    highlight.scrollTop = code.scrollTop;
    highlight.scrollLeft = code.scrollLeft;
    gutter.scrollTop = code.scrollTop;
  }

  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function paintFlat() {
    fitCanvas();
    const w = canvas.width;
    const h = canvas.height;
    scope.clearRect(0, 0, w, h);
    scope.fillStyle = "#0d1016";
    scope.fillRect(0, 0, w, h);
    scope.beginPath();
    scope.strokeStyle = "#3a4252";
    scope.lineWidth = Math.max(1, (window.devicePixelRatio || 1));
    scope.moveTo(0, h / 2);
    scope.lineTo(w, h / 2);
    scope.stroke();
  }

  function paintWave() {
    fitCanvas();
    const w = canvas.width;
    const h = canvas.height;
    scope.fillStyle = "#0d1016";
    scope.fillRect(0, 0, w, h);
    if (!analyser || !wave) {
      paintFlat();
      return;
    }
    analyser.getByteTimeDomainData(wave);
    scope.beginPath();
    scope.strokeStyle = "#ff5c8a";
    scope.lineWidth = Math.max(1.5, (window.devicePixelRatio || 1) * 1.4);
    for (let x = 0; x < w; x += 1) {
      const i = Math.floor((x / w) * wave.length);
      const v = wave[i] / 128 - 1;
      const y = h / 2 + v * h * 0.42;
      if (x === 0) scope.moveTo(x, y);
      else scope.lineTo(x, y);
    }
    scope.stroke();
  }

  function drawIdle() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    paintFlat();
  }

  function startDraw() {
    if (raf) cancelAnimationFrame(raf);
    const frame = function () {
      paintWave();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    playing = on;
    document.body.classList.toggle("is-playing", on);
    stopBtn.disabled = !on;
  }

  function clearLog() {
    log.replaceChildren();
  }

  function addLog(className, parts) {
    const li = document.createElement("li");
    if (className) li.className = className;
    parts.forEach(function (part) {
      const span = document.createElement("span");
      span.className = part.cls;
      span.textContent = part.text;
      li.append(span);
    });
    log.append(li);
    log.scrollTop = log.scrollHeight;
    return li;
  }

  function showReady() {
    clearLog();
    addLog("quiet", [{ cls: "msg", text: "Run the buffer. Each note lands here as it plays." }]);
    status.textContent = "Ready";
  }

  function showError(result) {
    errorLine = result.line || 1;
    renderEditor();
    clearLog();
    addLog("error", [{ cls: "msg", text: "Line " + errorLine + " — " + result.message }]);
    status.textContent = "Fix line " + errorLine;
    setPlaying(false);
  }

  function halt() {
    runId += 1;
    timers.forEach(function (id) {
      window.clearTimeout(id);
    });
    timers = [];
    active.forEach(function (node) {
      try {
        node.stop();
      } catch (err) {
        /* already finished */
      }
    });
    active = [];
    setPlaying(false);
    drawIdle();
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    master = audioCtx.createGain();
    master.gain.value = 0.32;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    wave = new Uint8Array(analyser.fftSize);
    master.connect(analyser);
    analyser.connect(audioCtx.destination);
    return audioCtx;
  }

  function voice(when, freq, type, amp, release) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const attack = 0.012;
    const stopAt = when + attack + release;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(amp, 0.0001), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(stopAt + 0.02);
    return osc;
  }

  function schedule(event, when) {
    const count = event.notes.length;
    const amp = event.amp / Math.sqrt(count);
    const nodes = [];
    event.notes.forEach(function (note) {
      const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
      if (event.wave === "hollow") {
        nodes.push(voice(when, freq, "sine", amp * 0.75, event.release));
        nodes.push(voice(when, freq * 1.007, "sine", amp * 0.45, event.release));
      } else {
        nodes.push(voice(when, freq, event.wave, amp, event.release));
      }
    });
    return nodes;
  }

  function pushCue(event) {
    const current = log.querySelector(".now");
    if (current) current.classList.remove("now");
    const names = event.notes.map(function (note) {
      return note.name;
    });
    addLog("now", [
      { cls: "when", text: event.time.toFixed(2) },
      { cls: "notes", text: names.join("  ") },
      { cls: "synth", text: ":" + event.synth },
    ]);
    status.textContent = "Playing " + names.join(" ");
  }

  function begin(result, id) {
    const t0 = audioCtx.currentTime + 0.06;
    result.events.forEach(function (event) {
      schedule(event, t0 + event.time).forEach(function (node) {
        active.push(node);
      });
      const timer = window.setTimeout(function () {
        if (id !== runId) return;
        pushCue(event);
      }, Math.max(0, event.time * 1000));
      timers.push(timer);
    });
    timers.push(
      window.setTimeout(function () {
        if (id !== runId) return;
        setPlaying(false);
        status.textContent = "Done";
        drawIdle();
      }, result.endTime * 1000 + 80)
    );
    startDraw();
  }

  function run() {
    const result = window.CueEngine.compileSource(code.value);
    halt();
    if (!result.ok) {
      showError(result);
      return;
    }
    errorLine = 0;
    renderEditor();
    clearLog();
    status.textContent = "Playing";
    setPlaying(true);
    const ctx = ensureAudio();
    const id = runId;
    ctx.resume().then(function () {
      if (id !== runId) return;
      begin(result, id);
    }).catch(function () {
      if (id !== runId) return;
      halt();
      showError({ line: 1, message: "Audio could not start. Click Run again." });
    });
  }

  code.addEventListener("input", function () {
    if (errorLine) errorLine = 0;
    renderEditor();
    syncScroll();
  });
  code.addEventListener("scroll", syncScroll);
  code.addEventListener("keydown", function (event) {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = code.selectionStart;
      const end = code.selectionEnd;
      code.setRangeText("  ", start, end, "end");
      renderEditor();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && playing) {
      event.preventDefault();
      halt();
      status.textContent = "Stopped";
    }
  });
  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", function () {
    halt();
    status.textContent = "Stopped";
  });
  window.addEventListener("resize", function () {
    if (playing) paintWave();
    else paintFlat();
  });

  renderEditor();
  showReady();
  paintFlat();
})();
