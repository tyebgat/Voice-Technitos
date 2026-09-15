(() => {
  "use strict";

  const themeToggle = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");

  window.setTheme = (name) => {
    document.documentElement.dataset.theme = name;
    const light = name === "light";
    themeIcon.textContent = light ? "light_mode" : "dark_mode";
    themeToggle.setAttribute(
      "aria-label",
      light ? "Switch to dark theme" : "Switch to light theme"
    );
  };

  themeToggle.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    setTheme(next);
  });

  setTheme(document.documentElement.dataset.theme || "dark");

  const btnTerminal = document.getElementById("btn-terminal");
  btnTerminal.addEventListener("click", async () => {
    const viaBridge =
      window.pywebview &&
      window.pywebview.api &&
      typeof window.pywebview.api.open_terminal_window === "function";
    if (viaBridge) {
      try {
        await window.pywebview.api.open_terminal_window();
        return;
      } catch (err) {
        console.error("Failed to open the terminal window:", err);
      }
    }
    window.open("/terminal", "_blank", "noopener");
  });

  const settingsModal = document.getElementById("settings-modal");
  const btnSettings = document.getElementById("btn-settings");
  const restartModal = document.getElementById("restart-modal");
  const alertModal = document.getElementById("alert-modal");
  const alertMessage = document.getElementById("alert-message");
  const emotionModal = document.getElementById("emotion-modal");
  const emotionTagsBtn = document.getElementById("emotion-tags");
  const creditsModal = document.getElementById("credits-modal");
  const btnCredits = document.getElementById("btn-credits");
  const overviewAvatar = document.getElementById("overview-avatar");
  const overviewVoiceName = document.getElementById("overview-voice-name");
  const ttsServiceDropdown = document.getElementById("tts-service");
  const skipSetupInput = document.getElementById("skip-setup");

  const closeSettings = () => {
    if (settingsModal.hidden) return;
    settingsModal.classList.add("closing");
    setTimeout(() => {
      settingsModal.classList.remove("open", "closing");
      settingsModal.hidden = true;
    }, 120);
  };

  const closeRestartModal = () => {
    if (restartModal.hidden) return;
    restartModal.classList.add("closing");
    setTimeout(() => {
      restartModal.classList.remove("open", "closing");
      restartModal.hidden = true;
    }, 120);
  };

  const openRestartModal = () => {
    restartModal.hidden = false;
    restartModal.classList.remove("closing");
    restartModal.classList.add("open");
  };

  const showAlert = (message) => {
    alertMessage.textContent = message || "Something went wrong.";
    alertModal.hidden = false;
    alertModal.classList.remove("closing");
    alertModal.classList.add("open");
  };

  const closeAlert = () => {
    if (alertModal.hidden) return;
    alertModal.classList.add("closing");
    setTimeout(() => {
      alertModal.classList.remove("open", "closing");
      alertModal.hidden = true;
    }, 120);
  };

  document.getElementById("alert-ok").addEventListener("click", closeAlert);
  alertModal
    .querySelector(".modal__backdrop")
    .addEventListener("click", closeAlert);

  const openEmotionModal = () => {
    emotionModal.hidden = false;
    emotionModal.classList.remove("closing");
    emotionModal.classList.add("open");
  };

  const closeEmotionModal = () => {
    if (emotionModal.hidden) return;
    emotionModal.classList.add("closing");
    setTimeout(() => {
      emotionModal.classList.remove("open", "closing");
      emotionModal.hidden = true;
    }, 120);
  };

  emotionTagsBtn.addEventListener("click", openEmotionModal);
  document
    .getElementById("emotion-close")
    .addEventListener("click", closeEmotionModal);
  emotionModal
    .querySelector(".modal__backdrop")
    .addEventListener("click", closeEmotionModal);

  const openCreditsModal = () => {
    creditsModal.hidden = false;
    creditsModal.classList.remove("closing");
    creditsModal.classList.add("open");
  };

  const closeCreditsModal = () => {
    if (creditsModal.hidden) return;
    creditsModal.classList.add("closing");
    setTimeout(() => {
      creditsModal.classList.remove("open", "closing");
      creditsModal.hidden = true;
    }, 120);
  };

  const openExternal = (url) => {
    if (!url) return;
    if (
      window.pywebview &&
      window.pywebview.api &&
      typeof window.pywebview.api.open_external === "function"
    ) {
      try {
        window.pywebview.api.open_external(url);
      } catch (err) {
        console.error("Failed to open external link:", err);
      }
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  btnCredits.addEventListener("click", openCreditsModal);
  document
    .getElementById("credits-close")
    .addEventListener("click", closeCreditsModal);
  creditsModal
    .querySelector(".modal__backdrop")
    .addEventListener("click", closeCreditsModal);
  creditsModal
    .querySelectorAll(".credit__banner, .credit__chip")
    .forEach((el) =>
      el.addEventListener("click", () => openExternal(el.dataset.url))
    );

  const apiFetch = async (url, opts) => {
    const res = await fetch(url, opts);
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : null;
    if (!res.ok) throw new Error((body && body.detail) || `HTTP ${res.status}`);
    return body;
  };

  const saveSettings = async (payload) => {
    await apiFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  let savedTtsService = null;
  let pendingTtsService = null;

  const refreshSettingsModal = async () => {
    try {
      const data = await apiFetch("/api/settings");
      const s = data.settings || {};
      savedTtsService = s.tts_service;
      pendingTtsService = s.tts_service;
      if (ttsServiceDropdown._setValue) ttsServiceDropdown._setValue(s.tts_service);
      skipSetupInput.checked = !!s.skip_setup;
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  btnSettings.addEventListener("click", () => {
    settingsModal.hidden = false;
    settingsModal.classList.remove("closing");
    settingsModal.classList.add("open");
    refreshSettingsModal();
  });

  settingsModal
    .querySelector(".modal__backdrop")
    .addEventListener("click", closeSettings);

  ttsServiceDropdown.addEventListener("change", (e) => {
    pendingTtsService = e.detail.value;
  });

  document
    .getElementById("settings-apply")
    .addEventListener("click", async () => {
      const skip = skipSetupInput.checked;
      if (pendingTtsService && pendingTtsService !== savedTtsService) {
        openRestartModal();
        return;
      }
      try {
        await saveSettings({ skip_setup: skip });
        closeSettings();
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    });

  document
    .getElementById("restart-confirm")
    .addEventListener("click", async () => {
      const skip = skipSetupInput.checked;
      try {
        await saveSettings({ tts_service: pendingTtsService, skip_setup: skip });
      } catch (err) {
        console.error("Failed to save settings before closing:", err);
      }
      const viaBridge =
        window.pywebview &&
        window.pywebview.api &&
        typeof window.pywebview.api.close_application === "function";
      if (viaBridge) {
        try {
          await window.pywebview.api.close_application();
        } catch (err) {
          console.error("Failed to close the application:", err);
        }
      } else {
        try {
          await apiFetch("/api/shutdown", { method: "POST" });
        } catch (err) {
          /* the app may close before the response arrives */
        }
      }
    });

  document
    .getElementById("restart-cancel")
    .addEventListener("click", () => {
      closeRestartModal();
      closeSettings();
    });

  restartModal
    .querySelector(".modal__backdrop")
    .addEventListener("click", () => {
      closeRestartModal();
      closeSettings();
    });

  const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  let currentTab = "overview";

  const fadeOut = (panel) =>
    new Promise((resolve) => {
      panel.classList.add("leaving");
      setTimeout(() => {
        panel.classList.remove("leaving");
        resolve();
      }, 150);
    });

  async function switchTab(name) {
    if (name === currentTab) return;
    const oldPanel = document.getElementById(`tab-${currentTab}`);
    const newPanel = document.getElementById(`tab-${name}`);
    if (!newPanel) return;
    await fadeOut(oldPanel);
    oldPanel.classList.remove("active");
    newPanel.classList.add("active");
    currentTab = name;
    tabButtons.forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === name)
    );
    if (name === "voices") loadVoices();
    if (name === "settings") {
      logSettings("tab-open");
      renderSettingsTab().catch((err) => console.error("Failed to render settings tab:", err));
    }
    if (name === "history") {
      logEvent("tab_opened");
      stopHistoryPolling();
      loadHistory();
      historyPollTimer = setInterval(loadHistory, 3000);
    } else {
      stopHistoryPolling();
    }
  }

  tabButtons.forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  const splitter = document.getElementById("splitter");
  const sidePanel = document.getElementById("panel-side");
  const workspace = document.getElementById("workspace");
  let dragging = false;

  splitter.addEventListener("pointerdown", (e) => {
    dragging = true;
    splitter.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
  });

  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    sidePanel.style.width = `${Math.min(85, Math.max(15, 100 - pct))}%`;
  });

  const stopDrag = () => {
    dragging = false;
    document.body.style.cursor = "";
  };

  splitter.addEventListener("pointerup", stopDrag);
  splitter.addEventListener("pointercancel", stopDrag);

  const editor = document.getElementById("input-text");
  const charCount = document.getElementById("char-count");

  const TAG_PATTERN = /(\[[^\[\]]*\])/g;
  const TAG_SET = new Set([
    "laughter",
    "sigh",
    "confirmation-en",
    "question-en",
    "question-ah",
    "question-oh",
    "question-ei",
    "question-yi",
    "surprise-ah",
    "surprise-oh",
    "surprise-wa",
    "surprise-yo",
    "dissatisfaction-hnn",
  ]);

  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const updateCharCount = () => {
    const len = (editor.innerText || "").length;
    charCount.textContent = `${len} ${len === 1 ? "character" : "characters"}`;
  };

  const buildHtml = (text) => {
    const escaped = escapeHtml(text);
    let html = "";
    let last = 0;
    for (const m of escaped.matchAll(TAG_PATTERN)) {
      html += escaped.slice(last, m.index);
      const token = m[0];
      const inner = token.slice(1, -1).toLowerCase();
      html += TAG_SET.has(inner)
        ? `<span class="tag">${token}</span>`
        : token;
      last = m.index + token.length;
    }
    html += escaped.slice(last);
    return html.replace(/\n/g, "<br>");
  };

  const captureOffsets = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const mapping = [];
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );
    let pos = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType !== Node.TEXT_NODE && node.nodeName !== "BR") continue;
      const len = node.nodeType === Node.TEXT_NODE ? node.length : 1;
      mapping.push({ node, start: pos, len });
      pos += len;
    }
    const locate = (container, offset) => {
      const entry = mapping.find((m) => m.node === container);
      if (!entry) return pos;
      return entry.start + Math.min(Math.max(0, offset), entry.len);
    };
    return {
      start: locate(range.startContainer, range.startOffset),
      end: locate(range.endContainer, range.endOffset),
    };
  };

  const restoreOffsets = (offsets) => {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    let start = null;
    let end = null;
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );
    let pos = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType !== Node.TEXT_NODE && node.nodeName !== "BR") continue;
      const len = node.nodeType === Node.TEXT_NODE ? node.length : 1;
      if (start === null && offsets.start <= pos + len) {
        start = [node, Math.min(len, Math.max(0, offsets.start - pos))];
      }
      if (end === null && offsets.end <= pos + len) {
        end = [node, Math.min(len, Math.max(0, offsets.end - pos))];
      }
      if (start && end) break;
      pos += len;
    }
    if (start) range.setStart(start[0], start[1]);
    else range.setStart(editor, 0);
    if (end) range.setEnd(end[0], end[1]);
    else range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const render = () => {
    const offsets =
      document.activeElement === editor ? captureOffsets() : null;
    editor.innerHTML = buildHtml(editor.innerText);
    if (offsets) restoreOffsets(offsets);
  };

  const update = () => {
    updateCharCount();
    render();
  };

  let composing = false;

  editor.addEventListener("compositionstart", () => {
    composing = true;
  });

  editor.addEventListener("compositionend", () => {
    composing = false;
    update();
  });

  editor.addEventListener("input", (e) => {
    if (composing || e.isComposing) return;
    update();
  });

  editor.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement("br");
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    update();
  });

  const insertPlainText = (text) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    update();
  };

  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    insertPlainText(e.clipboardData.getData("text/plain"));
  });

  editor.addEventListener("drop", (e) => {
    e.preventDefault();
    const text = e.dataTransfer.getData("text/plain");
    if (text) insertPlainText(text);
  });

  update();

  const bindSlider = (sliderId, valueId) => {
    const slider = document.getElementById(sliderId);
    const value = document.getElementById(valueId);
    const update = () => {
      value.textContent = Number(slider.value).toFixed(1);
      const pct =
        ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty("--fill", `${pct}%`);
    };
    slider.addEventListener("input", update);
    update();
  };

  bindSlider("slider-speed", "speed-value");
  bindSlider("slider-gain", "gain-value");

  const sliderSpeed = document.getElementById("slider-speed");
  const sliderGain = document.getElementById("slider-gain");
  const outputFormat = document.getElementById("output-format");
  const sampleRate = document.getElementById("sample-rate");

  let currentSpeed = Number(sliderSpeed.value);
  let currentOutputFormat = "wav";
  let currentSampleRate = 48000;

  sliderSpeed.addEventListener("change", () => {
    currentSpeed = Number(sliderSpeed.value);
    saveSettings({ speed: currentSpeed }).catch((err) =>
      console.error("Failed to save speed:", err)
    );
  });

  sliderGain.addEventListener("change", () => {
    saveSettings({ gain: Number(sliderGain.value) }).catch((err) =>
      console.error("Failed to save gain:", err)
    );
  });

  outputFormat.addEventListener("change", (e) => {
    currentOutputFormat = e.detail.value;
    saveSettings({ audio_format: currentOutputFormat }).catch((err) =>
      console.error("Failed to save output format:", err)
    );
  });

  sampleRate.addEventListener("change", (e) => {
    currentSampleRate = Number(e.detail.value);
    saveSettings({ sample_rate: currentSampleRate }).catch((err) =>
      console.error("Failed to save sample rate:", err)
    );
  });

  const closeDropdown = (dd) => {
    dd.classList.remove("open");
    dd.querySelector(".dropdown__trigger").setAttribute("aria-expanded", "false");
  };

  const closeAllDropdowns = () => {
    document.querySelectorAll(".dropdown").forEach(closeDropdown);
  };

  const initDropdown = (dd) => {
    const trigger = dd.querySelector(".dropdown__trigger");
    const value = dd.querySelector(".dropdown__value");
    const items = Array.from(dd.querySelectorAll(".dropdown__item"));

    const setSelected = (item) => {
      items.forEach((i) => {
        const selected = i === item;
        i.setAttribute("aria-selected", String(selected));
        if (selected) value.textContent = i.textContent;
      });
      dd.dispatchEvent(
        new CustomEvent("change", { detail: { value: item.dataset.value } })
      );
    };

    dd._setValue = (val) => {
      const item = items.find((i) => i.dataset.value === String(val));
      if (item) setSelected(item);
    };

    dd._setSilent = (val) => {
      const item = items.find((i) => i.dataset.value === String(val));
      if (!item) return;
      items.forEach((i) => {
        const selected = i === item;
        i.setAttribute("aria-selected", String(selected));
        if (selected) value.textContent = i.textContent;
      });
    };

    trigger.addEventListener("click", () => {
      const open = dd.classList.toggle("open");
      trigger.setAttribute("aria-expanded", String(open));
    });

    items.forEach((item) =>
      item.addEventListener("click", () => {
        setSelected(item);
        closeDropdown(dd);
      })
    );
  };

  document.querySelectorAll(".dropdown").forEach(initDropdown);

  // ---------- Settings tab (generation parameters) ----------

  const settingsTab = document.getElementById("settings-tab");
  const speedValue = document.getElementById("speed-value");

  const SETTING_SCHEMAS = {
    omnivoice: {
      num_step: {
        control: "slider",
        min: 1,
        max: 64,
        step: 1,
        desc: "Number of iterative unmasking steps. Higher values improve quality but slow down generation. Use 16 for faster inference.",
      },
      denoise: {
        control: "toggle",
        desc: "Prepend a denoise token to the prompt to reduce background noise in the generated audio.",
      },
      guidance_scale: {
        control: "slider",
        min: 0,
        max: 8,
        step: 0.1,
        desc: "Classifier-free guidance scale.",
      },
      t_shift: {
        control: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        desc: "Time-step shift for the noise schedule. Smaller values emphasise earlier steps in decoding.",
      },
      position_temperature: {
        control: "slider",
        min: 0,
        max: 15,
        step: 0.1,
        desc: "Temperature for mask-position selection. 0 = greedy (deterministic). Higher values increase randomness.",
      },
      class_temperature: {
        control: "slider",
        min: 0,
        max: 3,
        step: 0.1,
        desc: "Temperature for token sampling at each step. 0 = greedy (deterministic). Higher values increase randomness.",
      },
      layer_penalty_factor: {
        control: "slider",
        min: 0,
        max: 10,
        step: 0.1,
        desc: "Penalty applied to deeper codebook layers, encouraging earlier (lower) layers to unmask first.",
      },
      duration: {
        control: "number",
        step: 0.1,
        desc: "Fixed output duration in seconds. Overrides speed when set. Leave empty to estimate the duration from the text.",
      },
      speed: {
        control: "slider",
        min: 0.5,
        max: 4,
        step: 0.1,
        desc: "Speed factor. Values above 1.0 shorten the audio (faster); below 1.0 lengthen it (slower). Ignored when duration is set.",
      },
      preprocess_prompt: {
        control: "toggle",
        desc: "Apply preprocessing to the voice-clone prompt audio: remove long silences in the reference audio and add punctuation at the end of the reference text.",
      },
      postprocess_output: {
        control: "toggle",
        desc: "Apply post-processing to the generated audio, removing long silences.",
      },
      pad_duration: {
        control: "slider",
        min: 0,
        max: 1,
        step: 0.05,
        desc: "Silence padding duration per side, in seconds. Set to 0 to disable.",
      },
      fade_duration: {
        control: "slider",
        min: 0,
        max: 1,
        step: 0.05,
        desc: "Fade-in/out curve duration, in seconds. Set to 0 to disable.",
      },
      audio_chunk_duration: {
        control: "slider",
        min: 1,
        max: 60,
        step: 0.5,
        desc: "Target chunk duration (seconds) used when splitting long text into segments.",
      },
      audio_chunk_threshold: {
        control: "slider",
        min: 1,
        max: 120,
        step: 1,
        desc: "Estimated audio duration (seconds) above which long-form chunking is activated.",
      },
    },
    "pocket-tts": {
      language: {
        control: "dropdown",
        label: "Language",
        options: [
          "english_2026-01",
          "english_2026-04",
          "english",
          "french_24l",
          "german_24l",
          "portuguese_24l",
          "italian_24l",
          "spanish_24l",
        ],
        desc: "Built-in language config to load. The '24l' variants are larger, non-distilled models offered as a preview. Takes effect when the model is (re)initialized.",
      },
      temp: {
        control: "number",
        step: 0.05,
        desc: "Sampling temperature for generation. Leave empty (None) to use the model's recommended default (0.3 for the English model, 0.7 otherwise).",
      },
      sampler_decode_steps: {
        control: "slider",
        min: 1,
        max: 8,
        step: 1,
        desc: "Number of generation steps (default: 1).",
      },
      noise_clamp: {
        control: "number",
        step: 0.05,
        desc: "Maximum value for noise sampling. Leave empty for no clamping.",
      },
      eos_threshold: {
        control: "number",
        step: 0.1,
        desc: "Threshold for end-of-sequence detection. Signals the model to stop early once detected.",
      },
      quantize: {
        control: "toggle",
        desc: "Enable int8 quantization when loading the model. Takes effect when the model is (re)initialized.",
      },
      truncate_voice: {
        control: "toggle",
        desc: "Trim the cloning reference to a short phrase when building the voice.",
      },
      frames_after_eos: {
        control: "number",
        step: 1,
        desc: "Extra frames to generate after the end-of-sequence token is detected. Leave empty for the model default.",
      },
    },
  };

  const formatSettingName = (key, meta) => {
    if (meta && meta.label) return meta.label;
    return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  };

  const cleanCategoryHeader = (raw) => {
    if (typeof raw !== "string") return "";
    return raw.replace(/-+/g, " ").trim();
  };

  const settingsTip = (desc) => {
    if (!desc) return null;
    const tip = document.createElement("span");
    tip.className = "settings-tip";
    tip.tabIndex = 0;
    tip.dataset.tip = desc;
    tip.textContent = "?";
    tip.setAttribute("role", "tooltip");
    return tip;
  };

  const settingsInputId = (service, key) =>
    `setting-${service}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const saveSectionConfig = async (service, updates) => {
    await apiFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { [service]: updates } }),
    });
  };

  const logSettings = (event, detail = "") => {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area: "settings", event, detail: String(detail) }),
    }).catch(() => {});
  };

  const fetchSettings = () => apiFetch("/api/settings");

  const formatStepValue = (n, step) => {
    const decimals = String(step).includes(".")
      ? String(step).split(".")[1].length
      : 0;
    return Number(n).toFixed(decimals);
  };

  function buildSliderRow(service, key, value, meta) {
    const wrap = document.createElement("div");
    wrap.className = "slider-control";

    const head = document.createElement("div");
    head.className = "slider-control__head";

    const label = document.createElement("span");
    label.className = "slider-control__label";
    label.textContent = formatSettingName(key, meta);
    const tip = settingsTip(meta.desc);
    if (tip) label.appendChild(tip);
    head.appendChild(label);

    const val = document.createElement("span");
    val.className = "slider-control__value";
    head.appendChild(val);
    wrap.appendChild(head);

    const input = document.createElement("input");
    input.className = "slider";
    input.type = "range";
    input.min = meta.min;
    input.max = meta.max;
    input.step = meta.step;
    input.value = Number(value);

    const sync = () => {
      val.textContent = formatStepValue(input.value, meta.step);
      const pct =
        ((input.value - meta.min) / (meta.max - meta.min)) * 100;
      input.style.setProperty("--fill", `${pct}%`);
    };

    input.addEventListener("input", sync);
    wrap.appendChild(input);
    sync();

    input.addEventListener("change", () => {
      const parsed = parseFloat(input.value);
      saveSectionConfig(service, { [key]: parsed })
        .then(() => {
          logSettings("setting-change", `${service}.${key}=${parsed}`);
          if (key === "speed") {
            sliderSpeed.value = parsed;
            speedValue.textContent = parsed.toFixed(1);
            const pct =
              ((parsed - sliderSpeed.min) / (sliderSpeed.max - sliderSpeed.min)) *
              100;
            sliderSpeed.style.setProperty("--fill", `${pct}%`);
          }
        })
        .catch((err) => console.error("Failed to save setting:", err));
    });

    return wrap;
  }

  function buildToggleRow(service, key, value, meta) {
    const label = document.createElement("label");
    label.className = "checkbox checkbox--row";

    const text = document.createElement("span");
    text.className = "settings-toggle-row__label";
    text.textContent = formatSettingName(key, meta);
    const tip = settingsTip(meta.desc);
    if (tip) text.appendChild(tip);
    label.appendChild(text);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;

    const box = document.createElement("span");
    box.className = "checkbox__box";
    const check = document.createElement("span");
    check.className = "material-symbols-rounded checkbox__check";
    check.textContent = "check";
    box.appendChild(check);

    label.appendChild(input);
    label.appendChild(box);

    input.addEventListener("change", () => {
      saveSectionConfig(service, { [key]: input.checked })
        .then(() => logSettings("setting-change", `${service}.${key}=${input.checked}`))
        .catch((err) => console.error("Failed to save setting:", err));
    });

    return label;
  }

  function buildInputRow(service, key, value, meta, opts) {
    const wrap = document.createElement("div");
    wrap.className = "settings-input-row";

    const label = document.createElement("label");
    label.className = "form-label";
    label.htmlFor = settingsInputId(service, key);
    label.textContent = formatSettingName(key, meta);
    const tip = settingsTip(meta.desc);
    if (tip) label.appendChild(tip);
    wrap.appendChild(label);

    const input = document.createElement("input");
    input.id = label.htmlFor;
    input.className = "form-input";
    input.type = opts.type;
    input.step = meta.step || "any";
    input.value = value == null ? "" : String(value);
    input.autocomplete = "off";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    wrap.appendChild(input);

    input.addEventListener("change", () => {
      let parsed;
      if (opts.type === "number") {
        if (input.value.trim() === "") parsed = null;
        else {
          parsed = Number(input.value);
          if (Number.isNaN(parsed)) return;
        }
      } else {
        parsed = input.value.trim();
      }
      saveSectionConfig(service, { [key]: parsed })
        .then(() => {
          logSettings("setting-change", `${service}.${key}=${parsed}`);
          if (parsed == null) input.value = "";
        })
        .catch((err) => console.error("Failed to save setting:", err));
    });

    return wrap;
  }

  function buildDropdownRow(service, key, value, meta) {
    const wrap = document.createElement("div");
    wrap.className = "settings-input-row";

    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = formatSettingName(key, meta);
    const tip = settingsTip(meta.desc);
    if (tip) label.appendChild(tip);
    wrap.appendChild(label);

    const dd = document.createElement("div");
    dd.className = "dropdown";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dropdown__trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const valueSpan = document.createElement("span");
    valueSpan.className = "dropdown__value";
    trigger.appendChild(valueSpan);

    const chevron = document.createElement("span");
    chevron.className = "material-symbols-rounded dropdown__chevron";
    chevron.textContent = "expand_more";
    trigger.appendChild(chevron);
    dd.appendChild(trigger);

    const menu = document.createElement("ul");
    menu.className = "dropdown__menu";
    menu.setAttribute("role", "listbox");
    (meta.options || []).forEach((opt) => {
      const item = document.createElement("li");
      item.className = "dropdown__item";
      item.setAttribute("role", "option");
      item.dataset.value = opt;
      item.textContent = opt;
      menu.appendChild(item);
    });
    dd.appendChild(menu);

    wrap.appendChild(dd);
    initDropdown(dd);
    dd._setSilent(value);

    dd.addEventListener("change", (e) => {
      saveSectionConfig(service, { [key]: e.detail.value })
        .then(() => logSettings("setting-change", `${service}.${key}=${e.detail.value}`))
        .catch((err) => console.error("Failed to save setting:", err));
    });

    return wrap;
  }

  function buildSettingRow(service, key, value) {
    const meta = (SETTING_SCHEMAS[service] || {})[key];
    if (!meta) return null;
    switch (meta.control) {
      case "slider":
        return buildSliderRow(service, key, value, meta);
      case "toggle":
        return buildToggleRow(service, key, value, meta);
      case "dropdown":
        return buildDropdownRow(service, key, value, meta);
      case "number":
        return buildInputRow(service, key, value, meta, {
          type: "number",
          placeholder: "Auto (estimated)",
        });
      case "text":
        return buildInputRow(service, key, value, meta, { type: "text" });
      default:
        return null;
    }
  }

  function buildRestoreButton(service) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-restore";

    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = "refresh";
    const text = document.createElement("span");
    text.textContent = "Restore to defaults";

    btn.append(icon, text);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        logSettings("restore-defaults", service);
        await apiFetch("/api/settings/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: service }),
        });
        await renderSettingsTab();
      } catch (err) {
        console.error("Failed to restore settings:", err);
        showAlert(err.message || "Failed to restore settings to defaults.");
      } finally {
        btn.disabled = false;
      }
    });

    return btn;
  }

  async function renderSettingsTab() {
    const data = await fetchSettings();
    settingsTab.replaceChildren();
    const fragment = document.createDocumentFragment();

    const services = chosenService
      ? [chosenService]
      : Object.keys(SETTING_SCHEMAS);

    for (const service of services) {
      const raw = (data.sections || {})[service] || {};
      const schema = SETTING_SCHEMAS[service] || {};

      const block = document.createElement("div");
      block.className = "settings-service";
      let category = null;
      let rows = null;

      for (const [key, value] of Object.entries(raw)) {
        if (key.startsWith("_")) {
          if (category) block.appendChild(category);
          category = document.createElement("div");
          category.className = "settings-category";
          const heading = document.createElement("h3");
          heading.className = "section-label";
          heading.textContent = cleanCategoryHeader(value);
          category.appendChild(heading);
          rows = document.createElement("div");
          category.appendChild(rows);
        } else if (schema[key] && category) {
          const row = buildSettingRow(service, key, value);
          if (row) rows.appendChild(row);
        }
      }
      if (category) block.appendChild(category);
      block.appendChild(buildRestoreButton(service));
      fragment.appendChild(block);
    }

    settingsTab.appendChild(fragment);
  }

  // ---------- Bootstrap / loading screen ----------

  const bootstrap = document.getElementById("bootstrap");
  const setupView = document.getElementById("bootstrap-setup");
  const initView = document.getElementById("bootstrap-init");
  const setupDropdown = document.getElementById("setup-service");
  const setupNext = document.getElementById("setup-next");
  const bootStatus = document.getElementById("bootstrap-status");
  const bootLoader = document.getElementById("bootstrap-loader");
  const bootContinue = document.getElementById("bootstrap-continue");
  const bootRetry = document.getElementById("bootstrap-retry");
  const bootError = document.getElementById("bootstrap-error");
  const bootH1 = document.getElementById("bootstrap-h1");
  const bootTip = document.getElementById("bootstrap-tip");
  const bootDownload = document.getElementById("bootstrap-download");
  const bootDownloadBar = document.getElementById("bootstrap-download-bar");
  const bootDownloadText = document.getElementById("bootstrap-download-text");
  const loaders = Array.from(bootLoader.querySelectorAll(".loader"));

  const FADE_MS = 450;

  const TIPS = {
    omnivoice: [
      "Tip: OmniVoice clones a voice from a short reference clip, with no retraining.",
      "Fun fact: tags like [laughter] or [sigh] in your text get acted out during speech.",
      "Fun fact: OmniVoice comes from k2-fsa, the same community behind next-gen Kaldi.",
      "Tip: clean, well-recorded reference audio gives the best-sounding clones.",
    ],
    "pocket-tts": [
      "Fun fact: Pocket-tts from kyutai is built to run on-device — tiny and fast.",
      "Fun fact: it synthesizes speech end-to-end, with no separate alignment stage.",
      "Tip: Pocket-tts can also speak many languages without needing a reference voice.",
      "Fun fact: being so light, it starts generating audio almost immediately.",
    ],
    _fallback: [
      "Tip: keep reference audio short and clean for the best voice cloning.",
      "Fun fact: your voices and settings stay stored locally, right on this machine.",
    ],
  };

  const displayName = (service) => {
    if (!service) return "TTS";
    return service === "pocket-tts" ? "Pocket TTS" : "OmniVoice";
  };

  let chosenService = null;
  let loaderTimer = null;
  let loaderIndex = 0;
  let pollTimer = null;
  let tipTimer = null;
  let tipSeq = 0;
  let tipIdx = 0;

  const showView = (view) => {
    [setupView, initView].forEach((v) =>
      v.classList.toggle("active", v === view)
    );
  };

  const setLoaderActive = (idx) => {
    loaders.forEach((l, i) => l.classList.toggle("active", i === idx));
  };

  const startLoaderCycle = () => {
    loaderIndex = 0;
    setLoaderActive(0);
    loaderTimer = setInterval(() => {
      loaderIndex = (loaderIndex + 1) % loaders.length;
      setLoaderActive(loaderIndex);
    }, 10000);
  };

  const stopLoaderCycle = () => {
    if (loaderTimer) clearInterval(loaderTimer);
    loaderTimer = null;
    setLoaderActive(-1);
  };

  const stopTipCycle = () => {
    tipSeq += 1;
    if (tipTimer) clearInterval(tipTimer);
    tipTimer = null;
  };

  const startTipCycle = () => {
    stopTipCycle();
    const list = TIPS[chosenService] || TIPS._fallback;
    tipIdx = 0;
    const show = () => {
      const seq = ++tipSeq;
      bootTip.style.opacity = "0";
      setTimeout(() => {
        if (seq !== tipSeq) return;
        bootTip.textContent = list[tipIdx % list.length];
        bootTip.style.opacity = "1";
      }, FADE_MS);
    };
    show();
    tipTimer = setInterval(() => {
      tipIdx += 1;
      show();
    }, 5000);
  };

  const setBootStatus = (text) => {
    bootStatus.textContent = text;
  };

  const showBootError = (msg) => {
    bootError.textContent = msg || "Unknown error.";
    bootError.hidden = false;
  };

  const hideBootError = () => {
    bootError.hidden = true;
    bootError.textContent = "";
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const displayBootView = (view) => {
    hideBootError();
    bootRetry.hidden = true;
    bootContinue.hidden = true;
    bootLoader.classList.remove("collapsed");
    bootH1.textContent = "setting up your service...";
    stopTipCycle();
    bootTip.style.opacity = "0";
    bootTip.textContent = "";
    setBootStatus("");
    updateDownloadBar(false);
    showView(view);
  };

  const updateDownloadBar = (visible, pct) => {
    if (!bootDownload) return;
    bootDownload.hidden = !visible;
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    if (bootDownloadBar) bootDownloadBar.style.width = `${clamped}%`;
    if (bootDownloadText)
      bootDownloadText.textContent = `Downloading ${Math.floor(clamped)}%`;
  };

  const updateBootStatus = (status) => {
    const display = status.service_display || status.service || "TTS";
    const rawPct = Number(status.download_progress) || 0;
    const downloading =
      status.download_state === "downloading" && rawPct < 100;
    if (downloading) {
      updateDownloadBar(true, rawPct);
      setBootStatus(`Downloading ${display} model files…`);
      return;
    }
    updateDownloadBar(false);
    if (status.model_state === "ready") {
      stopPolling();
      stopLoaderCycle();
      stopTipCycle();
      bootH1.textContent = "Completed without issues";
      setBootStatus("Ready");
      bootLoader.classList.add("collapsed");
      bootLoader.querySelectorAll(".loader").forEach((l) => l.remove());
      bootContinue.hidden = false;
      return;
    }
    if (status.model_state === "error") {
      stopLoaderCycle();
      stopTipCycle();
      setBootStatus(`Failed to initialize ${display}`);
      showBootError(status.model_error);
      bootRetry.hidden = false;
      return;
    }
    setBootStatus(`Initializing ${display}`);
  };

  const pollOnce = async () => {
    try {
      const status = await apiFetch("/api/status");
      updateBootStatus(status);
    } catch (err) {
      console.error("Status poll failed:", err);
    }
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = setInterval(pollOnce, 1000);
    pollOnce();
  };

  const startInit = (service) => {
    displayBootView(initView);
    setBootStatus(
      service ? `Initializing ${displayName(service)}` : "setting up your service..."
    );
    startLoaderCycle();
    startTipCycle();
    apiFetch("/api/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(service ? { service } : {}),
    })
      .catch((err) => console.error("Failed to start initialization:", err))
      .finally(startPolling);
  };

  setupDropdown.addEventListener("change", (e) => {
    chosenService = e.detail.value;
  });

  setupNext.addEventListener("click", () => {
    const svc = chosenService;
    startInit(svc);
    saveSettings({ tts_service: svc }).catch((err) =>
      console.error("Failed to save service:", err)
    );
  });

  bootContinue.addEventListener("click", () => {
    bootstrap.hidden = true;
    if (window.__onBootstrapDone) window.__onBootstrapDone();
  });

  bootRetry.addEventListener("click", () => {
    startInit(chosenService || null);
  });

  (async () => {
    try {
      const data = await apiFetch("/api/settings");
      const s = data.settings || {};
      savedTtsService = s.tts_service;
      chosenService = s.tts_service || "omnivoice";
      emotionTagsBtn.hidden = chosenService !== "omnivoice";
      if (setupDropdown._setValue) setupDropdown._setValue(chosenService);

      if (s.skip_setup) {
        startInit(null);
      } else {
        displayBootView(setupView);
      }
    } catch (err) {
      console.error("Bootstrap settings failed:", err);
      displayBootView(setupView);
    }
  })();

  // ---------- Voices tab ----------

  const voiceList = document.getElementById("voice-list");
  const voiceEmpty = document.getElementById("voice-empty");
  const voiceSearch = document.getElementById("voice-search");
  const voiceCreateBtn = document.getElementById("voice-create");
  const voiceModal = document.getElementById("voice-modal");
  const voiceModalTitle = document.getElementById("voice-modal-title");
  const voiceNameInput = document.getElementById("voice-name");
  const voiceDescInput = document.getElementById("voice-description");
  const voiceTranscriptionInput = document.getElementById("voice-transcription");
  const voicePhotoDrop = document.getElementById("voice-photo-drop");
  const voicePhotoInput = document.getElementById("voice-photo-input");
  const voicePhotoError = document.getElementById("voice-photo-error");
  const voiceRefDrop = document.getElementById("voice-ref-drop");
  const voiceRefInput = document.getElementById("voice-ref-input");
  const voiceCancelBtn = document.getElementById("voice-cancel");
  const voiceSaveBtn = document.getElementById("voice-save");
  const voiceContextMenu = document.getElementById("voice-context-menu");

  let voices = [];
  let selectedVoice = "";
  let editingVoice = null;
  let pendingIcon = null;
  let pendingRef = null;

  async function loadVoices() {
    try {
      const res = await fetch("/api/voices");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      voices = Array.isArray(data.voices) ? data.voices : [];
    } catch (err) {
      console.error("Failed to load voices:", err);
      voices = [];
    }
    renderVoices();
    initOverview();
  }

  function refreshOverviewVoice() {
    const v = voices.find((x) => x.name === selectedVoice);
    overviewVoiceName.textContent = v ? v.name : "No voice selected";
    overviewAvatar.src = v && v.icon_url ? v.icon_url : "/gui/assets/avatar.svg";
  }

  const initOverview = async () => {
    try {
      const data = await apiFetch("/api/settings");
      selectedVoice = data.settings.default_voice || "";
    } catch (err) {
      // Keep the current selection if settings are unavailable.
    }
    refreshOverviewVoice();
    renderVoices();
  };

  function renderVoices() {
    const query = voiceSearch.value.trim().toLowerCase();
    const filtered = voices.filter((v) => v.name.toLowerCase().includes(query));

    voiceEmpty.hidden = filtered.length > 0;
    voiceEmpty.textContent =
      voices.length === 0 ? "no voices" : "No voices match your search";

    const fragment = document.createDocumentFragment();
    filtered.forEach((v) => fragment.appendChild(buildVoiceItem(v)));
    voiceList.replaceChildren(fragment);
  }

  function buildVoiceItem(v) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "voice-list__item";
    item.dataset.name = v.name;
    if (v.name === selectedVoice) item.classList.add("selected");

    const avatar = document.createElement("span");
    avatar.className = "voice-list__avatar";
    const img = document.createElement("img");
    img.alt = "";
    img.src = v.icon_url || "/gui/assets/avatar.svg";
    img.addEventListener("error", () => {
      if (img.src !== new URL("/gui/assets/avatar.svg", location.href).href) {
        img.src = "/gui/assets/avatar.svg";
      }
    });
    avatar.appendChild(img);

    const name = document.createElement("span");
    name.className = "voice-list__name";
    name.textContent = v.name;

    item.append(avatar, name);

    item.addEventListener("click", () => {
      selectedVoice = v.name;
      renderVoices();
      refreshOverviewVoice();
      saveSettings({ default_voice: v.name }).catch((err) =>
        console.error("Failed to save default voice:", err)
      );
      switchTab("overview");
    });

    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedVoice = v.name;
      renderVoices();
      showVoiceMenu(e.clientX, e.clientY);
    });

    return item;
  }

  voiceSearch.addEventListener("input", renderVoices);

  function showVoiceMenu(x, y) {
    voiceContextMenu.hidden = false;
    voiceContextMenu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
    voiceContextMenu.style.top = `${Math.min(y, window.innerHeight - 96)}px`;
  }

  function hideVoiceMenu() {
    voiceContextMenu.hidden = true;
  }

  voiceContextMenu.querySelectorAll(".context-menu__item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      if (action === "edit") openEditVoiceModal(selectedVoice);
      else if (action === "delete") deleteVoice(selectedVoice);
      hideVoiceMenu();
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".context-menu")) {
      hideVoiceMenu();
      hideHistoryMenu();
    }
  });

  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(".context-menu")) {
      hideVoiceMenu();
      hideHistoryMenu();
    }
  });

  function resetDropZone(zone, label) {
    zone.classList.remove("has-preview", "dragover");
    const preview = zone.querySelector(".drop-zone__preview");
    if (preview) preview.removeAttribute("src");
    zone.querySelector(".drop-zone__text").textContent = label;
  }

  function resetVoiceForm() {
    voiceNameInput.value = "";
    voiceDescInput.value = "";
    voiceTranscriptionInput.value = "";
    voicePhotoError.hidden = true;
    resetDropZone(voicePhotoDrop, "Drag n Drop an image.");
    resetDropZone(voiceRefDrop, "Drag n Drop a reference file");
    pendingIcon = null;
    pendingRef = null;
  }

  const openVoiceModal = () => {
    editingVoice = null;
    resetVoiceForm();
    voiceModalTitle.textContent = "Create new voice";
    voiceSaveBtn.textContent = "Create";
    voiceModal.hidden = false;
    voiceModal.classList.remove("closing");
    voiceModal.classList.add("open");
    voiceNameInput.focus();
  };

  const openEditVoiceModal = (name) => {
    const v = voices.find((x) => x.name === name);
    if (!v) return;
    editingVoice = v.name;
    resetVoiceForm();
    voiceNameInput.value = v.name;
    voiceDescInput.value = v.description || "";
    voiceTranscriptionInput.value = v.transcription || "";
    if (v.icon_url) {
      const preview = voicePhotoDrop.querySelector(".drop-zone__preview");
      preview.src = v.icon_url;
      voicePhotoDrop.classList.add("has-preview");
      voicePhotoDrop.querySelector(".drop-zone__text").textContent =
        v.icon_url.split("/").pop();
    }
    voiceRefDrop.querySelector(".drop-zone__text").textContent = v.reference_wav
      ? "Current reference: reference.wav"
      : "Drag n Drop a reference file";
    voiceModalTitle.textContent = "Edit voice";
    voiceSaveBtn.textContent = "Save";
    voiceModal.hidden = false;
    voiceModal.classList.remove("closing");
    voiceModal.classList.add("open");
    voiceNameInput.focus();
  };

  const deleteVoice = async (name) => {
    try {
      const res = await fetch(`/api/voices/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.detail) || `HTTP ${res.status}`);
      }
      if (selectedVoice === name) selectedVoice = "";
      await loadVoices();
    } catch (err) {
      console.error("Failed to delete voice:", err);
      showAlert(err.message || "Failed to delete voice.");
    }
  };

  const closeVoiceModal = () => {
    if (voiceModal.hidden) return;
    voiceModal.classList.add("closing");
    setTimeout(() => {
      voiceModal.classList.remove("open", "closing");
      voiceModal.hidden = true;
    }, 120);
    resetVoiceForm();
  };

  function bindDropZone(zone, input, onFile) {
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) onFile(file);
    });
    ["dragenter", "dragover"].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.remove("dragover");
      })
    );
    zone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) onFile(file);
    });
  }

  const ICON_ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif"];
  const ICON_ACCEPTED_MIMES = ["image/png", "image/jpeg", "image/gif"];

  const isAcceptedIcon = (file) => {
    const name = (file.name || "").toLowerCase();
    return (
      ICON_ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext)) &&
      ICON_ACCEPTED_MIMES.includes(file.type)
    );
  };

  bindDropZone(voicePhotoDrop, voicePhotoInput, (file) => {
    if (!isAcceptedIcon(file)) {
      voicePhotoError.hidden = false;
      pendingIcon = null;
      return;
    }
    voicePhotoError.hidden = true;
    pendingIcon = file;
    const preview = voicePhotoDrop.querySelector(".drop-zone__preview");
    preview.src = URL.createObjectURL(file);
    voicePhotoDrop.classList.add("has-preview");
    voicePhotoDrop.querySelector(".drop-zone__text").textContent = file.name;
  });

  bindDropZone(voiceRefDrop, voiceRefInput, (file) => {
    pendingRef = file;
    voiceRefDrop.querySelector(".drop-zone__text").textContent = file.name;
  });

  voiceCreateBtn.addEventListener("click", openVoiceModal);

  voiceModal
    .querySelector(".modal__backdrop")
    .addEventListener("click", closeVoiceModal);

  voiceCancelBtn.addEventListener("click", closeVoiceModal);

  voiceSaveBtn.addEventListener("click", async () => {
    const name = voiceNameInput.value.trim();
    if (!name) {
      voiceNameInput.focus();
      return;
    }
    if (!editingVoice && !pendingRef) {
      voiceRefDrop.focus();
      return;
    }

    const form = new FormData();
    form.append("name", name);
    form.append("description", voiceDescInput.value.trim());
    form.append("transcription", voiceTranscriptionInput.value.trim());
    if (pendingRef) form.append("reference", pendingRef, pendingRef.name);
    if (pendingIcon) form.append("icon", pendingIcon, pendingIcon.name);

    voiceSaveBtn.disabled = true;
    try {
      const res = await fetch(
        editingVoice
          ? `/api/voices/${encodeURIComponent(editingVoice)}`
          : "/api/voices",
        { method: editingVoice ? "PATCH" : "POST", body: form }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showAlert((data && data.detail) || "Failed to save voice.");
        return;
      }
      selectedVoice = data.voice;
      closeVoiceModal();
      await loadVoices();
    } catch (err) {
      console.error("Failed to save voice:", err);
      showAlert("Failed to save voice.");
    } finally {
      voiceSaveBtn.disabled = false;
    }
  });

  // ---------- Generation & player widget ----------

  const generateBtn = document.getElementById("generate-btn");
  const playerWidget = document.getElementById("player-widget");
  const playerPlay = document.getElementById("player-play");
  const playerDownload = document.getElementById("player-download");
  const playerWave = document.getElementById("player-wave");
  const playerAudio = document.getElementById("player-audio");
  const playerPlayIcon = playerPlay.querySelector(".material-symbols-rounded");
  const WIDGET_FADE_MS = 250;

  const setPlayIcon = (playing) => {
    playerPlayIcon.textContent = playing ? "pause" : "play_arrow";
    playerPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
    playerPlay.classList.toggle("playing", playing);
  };

  const drawWaveform = async (url) => {
    try {
      playerWave.classList.add("loading");
      const res = await fetch(url);
      const buffer = await res.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuf = await ctx.decodeAudioData(buffer);
      const data = audioBuf.getChannelData(0);
      const dpr = window.devicePixelRatio || 1;
      const cssW = playerWave.clientWidth || 300;
      const cssH = playerWave.clientHeight || 40;
      playerWave.width = Math.max(1, Math.round(cssW * dpr));
      playerWave.height = Math.max(1, Math.round(cssH * dpr));
      const g = playerWave.getContext("2d");
      const color =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--text")
          .trim() || "#E4E4E7";
      const barCount = Math.max(48, Math.floor(playerWave.width / 4));
      const step = Math.max(1, Math.floor(data.length / barCount));
      const midY = playerWave.height / 2;
      g.clearRect(0, 0, playerWave.width, playerWave.height);
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, dpr * 2);
      g.beginPath();
      for (let i = 0; i < barCount; i++) {
        let peak = 0;
        const start = i * step;
        const end = Math.min(start + step, data.length);
        for (let j = start; j < end; j++) {
          const v = Math.abs(data[j] || 0);
          if (v > peak) peak = v;
        }
        const amp = Math.max(g.lineWidth, peak * (playerWave.height * 0.92) * 0.5);
        const x = (i + 0.5) * (playerWave.width / barCount);
        g.moveTo(x, midY - amp);
        g.lineTo(x, midY + amp);
      }
      g.stroke();
      ctx.close();
    } catch (err) {
      console.error("Failed to draw waveform:", err);
    } finally {
      playerWave.classList.remove("loading");
    }
  };

  const showPlayerLoading = () => {
    playerAudio.pause();
    playerAudio.removeAttribute("src");
    playerWidget.classList.add("loading");
    if (playerWidget.hidden) {
      playerWidget.hidden = false;
      requestAnimationFrame(() => playerWidget.classList.add("visible"));
    } else {
      playerWidget.classList.add("visible");
    }
  };

  const hidePlayer = () => {
    playerAudio.pause();
    playerAudio.removeAttribute("src");
    playerWidget.classList.remove("visible", "loading");
    setTimeout(() => {
      playerWidget.hidden = true;
    }, WIDGET_FADE_MS);
  };

  const showPlayer = (url, filename) => {
    const refresh = () => {
      playerWidget.classList.remove("loading");
      playerAudio.src = url;
      playerAudio.load();
      playerDownload.href = url;
      playerDownload.download = filename;
      setPlayIcon(false);
      drawWaveform(url);
      playerWidget.hidden = false;
      requestAnimationFrame(() => playerWidget.classList.add("visible"));
    };
    if (!playerWidget.hidden && playerWidget.classList.contains("visible")) {
      playerWidget.classList.remove("visible");
      setTimeout(refresh, WIDGET_FADE_MS);
    } else {
      refresh();
    }
  };

  playerPlay.addEventListener("click", () => {
    if (playerAudio.paused) {
      playerAudio.play().catch(() => {});
      setPlayIcon(true);
    } else {
      playerAudio.pause();
      setPlayIcon(false);
    }
  });

  playerAudio.addEventListener("ended", () => setPlayIcon(false));

  const downloadAudio = async (url, filename) => {
    const saveViaPicker = async () => {
      if (!window.showSaveFilePicker) return false;
      try {
        const ext = filename.includes(".")
          ? filename.split(".").pop().toLowerCase()
          : "wav";
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "Audio file", accept: { "audio/*": [`.${ext}`] } }],
        });
        const blob = await (await fetch(url)).blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (err) {
        if (err && err.name === "AbortError") return true;
        return false;
      }
    };

    if (await saveViaPicker()) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  playerDownload.addEventListener("click", (e) => {
    e.preventDefault();
    const filename = playerDownload.download || "output.wav";
    downloadAudio(playerAudio.src, filename);
  });

  generateBtn.addEventListener("click", async () => {
    const text = (editor.innerText || "").trim();
    if (!text) {
      editor.focus();
      return;
    }
    generateBtn.disabled = true;
    showPlayerLoading();
    try {
      const data = await apiFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: editor.innerText,
          voice: selectedVoice || undefined,
          gain: Number(sliderGain.value),
          sample_rate: currentSampleRate,
          audio_format: currentOutputFormat,
          params: { speed: currentSpeed },
        }),
      });
      const filename = data.audio_url.split("/").pop();
      showPlayer(data.audio_url, filename);
    } catch (err) {
      console.error("Generation failed:", err);
      showAlert(err.message || "Generation failed.");
      hidePlayer();
    } finally {
      generateBtn.disabled = false;
    }
  });

  // ---------- History tab ----------

  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");
  const historySearch = document.getElementById("history-search");
  const historyDeleteAll = document.getElementById("history-delete-all");
  const historyContextMenu = document.getElementById("history-context-menu");
  const confirmModal = document.getElementById("confirm-modal");
  const confirmTitle = document.getElementById("confirm-modal-title");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmOk = document.getElementById("confirm-ok");
  const confirmCancel = document.getElementById("confirm-cancel");

  let historyItems = [];
  let historyPlaying = null;
  let pendingConfirm = null;
  let currentHistoryFile = null;
  let historyPollTimer = null;
  let lastHistoryFingerprint = null;

  const logEvent = (event, detail = "") => {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area: "history", event, detail: String(detail) }),
    }).catch(() => {});
  };

  function stopHistoryPolling() {
    if (historyPollTimer) clearInterval(historyPollTimer);
    historyPollTimer = null;
  }

  function setHistoryPlayState(btn, icon, playing) {
    icon.textContent = playing ? "pause" : "play_arrow";
    btn.setAttribute("aria-label", playing ? "Pause" : "Play");
    btn.classList.toggle("playing", playing);
  }

  function stopHistoryPlayback() {
    if (historyPlaying && historyPlaying.audio) {
      historyPlaying.audio.pause();
      setHistoryPlayState(historyPlaying.btn, historyPlaying.icon, false);
      historyPlaying = null;
    }
  }

  const formatHistoryRate = (hz) => {
    if (hz == null) return "";
    return `${Number((hz / 1000).toFixed(1))} kHz`;
  };

  async function loadHistory() {
    try {
      const data = await apiFetch("/api/history");
      const items = Array.isArray(data.items) ? data.items : [];
      const fingerprint = JSON.stringify(items);
      if (fingerprint === lastHistoryFingerprint) return;
      historyItems = items;
      lastHistoryFingerprint = fingerprint;
      logEvent("history_loaded", `${items.length} item(s)`);
      renderHistory();
    } catch (err) {
      console.error("Failed to load history:", err);
      historyItems = [];
    }
  }

  function renderHistory() {
    const query = historySearch.value.trim().toLowerCase();
    const filtered = historyItems.filter((item) => {
      const hay = [item.filename, item.voice_name, item.time, item.sample_rate, item.format]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });

    historyEmpty.hidden = filtered.length > 0;
    historyEmpty.textContent =
      historyItems.length === 0
        ? "No history yet"
        : "No history matches your search";

    const fragment = document.createDocumentFragment();
    filtered.forEach((item) => fragment.appendChild(buildHistoryItem(item)));
    historyList.replaceChildren(fragment);
  }

  function buildHistoryItem(item) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.dataset.filename = item.filename;

    const top = document.createElement("div");
    top.className = "history-item__top";

    const avatar = document.createElement("span");
    avatar.className = "history-item__avatar";
    const img = document.createElement("img");
    img.alt = "";
    img.src = item.icon_url || "/gui/assets/avatar.svg";
    img.addEventListener("error", () => {
      if (img.src !== new URL("/gui/assets/avatar.svg", location.href).href) {
        img.src = "/gui/assets/avatar.svg";
      }
    });
    avatar.appendChild(img);

    const name = document.createElement("span");
    name.className = "history-item__name";
    name.textContent = item.voice_name || item.filename;

    top.append(avatar, name);

    const meta = document.createElement("div");
    meta.className = "history-item__meta";
    meta.textContent = [
      formatHistoryRate(item.sample_rate),
      item.format ? item.format.toUpperCase() : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const bottom = document.createElement("div");
    bottom.className = "history-item__bottom";

    const time = document.createElement("span");
    time.className = "history-item__time";
    time.textContent = item.time ? item.time.replace("_", " ") : "";

    const actions = document.createElement("div");
    actions.className = "history-item__actions";

    const play = document.createElement("button");
    play.type = "button";
    play.className = "history-item__play";
    const playIcon = document.createElement("span");
    playIcon.className = "material-symbols-rounded";
    playIcon.textContent = "play_arrow";
    play.appendChild(playIcon);
    play.setAttribute("aria-label", "Play");

    const download = document.createElement("button");
    download.type = "button";
    download.className = "history-item__download";
    const dlIcon = document.createElement("span");
    dlIcon.className = "material-symbols-rounded";
    dlIcon.textContent = "download";
    download.appendChild(dlIcon);
    download.setAttribute("aria-label", "Download");

    play.addEventListener("click", () =>
      playHistoryAudio(item, li, play, playIcon)
    );
    download.addEventListener("click", (e) => {
      e.stopPropagation();
      logEvent("download", item.filename);
      downloadAudio(item.url, item.filename);
    });

    actions.append(play, download);
    bottom.append(time, actions);
    li.append(top, meta, bottom);

    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentHistoryFile = item.filename;
      logEvent("context_menu", item.filename);
      showHistoryMenu(e.clientX, e.clientY);
    });

    return li;
  }

  function playHistoryAudio(item, li, btn, icon) {
    li._audio = li._audio || new Audio(item.url);
    const audio = li._audio;
    audio.onended = () => {
      if (historyPlaying && historyPlaying.audio === audio) historyPlaying = null;
      setHistoryPlayState(btn, icon, false);
    };
    audio.onerror = () => setHistoryPlayState(btn, icon, false);

    if (historyPlaying && historyPlaying.audio && historyPlaying.audio !== audio) {
      historyPlaying.audio.pause();
      setHistoryPlayState(historyPlaying.btn, historyPlaying.icon, false);
      historyPlaying = null;
    }

    if (audio.paused) {
      audio
        .play()
        .then(() => {
          logEvent("play", item.filename);
          setHistoryPlayState(btn, icon, true);
          historyPlaying = { btn, icon, audio };
        })
        .catch((err) => {
          console.error("Failed to play history audio:", err);
          setHistoryPlayState(btn, icon, false);
        });
    } else {
      audio.pause();
      logEvent("pause", item.filename);
      setHistoryPlayState(btn, icon, false);
      if (historyPlaying && historyPlaying.audio === audio) historyPlaying = null;
    }
  }

  function showHistoryMenu(x, y) {
    historyContextMenu.hidden = false;
    historyContextMenu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
    historyContextMenu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  }

  function hideHistoryMenu() {
    historyContextMenu.hidden = true;
  }

  historyContextMenu.querySelectorAll(".context-menu__item").forEach((item) => {
    item.addEventListener("click", () => {
      if (item.dataset.action === "delete" && currentHistoryFile) {
        openConfirm({
          title: "Delete file",
          message: `This will delete output file ${currentHistoryFile}`,
          confirmLabel: "Delete",
          onConfirm: () => deleteHistoryFile(currentHistoryFile),
        });
      }
      hideHistoryMenu();
    });
  });

  const openConfirm = ({
    title = "Confirm",
    message = "",
    confirmLabel = "Confirm",
    onConfirm = null,
  }) => {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmOk.textContent = confirmLabel;
    pendingConfirm = typeof onConfirm === "function" ? onConfirm : null;
    confirmModal.hidden = false;
    confirmModal.classList.remove("closing");
    confirmModal.classList.add("open");
  };

  const closeConfirm = () => {
    if (confirmModal.hidden) return;
    confirmModal.classList.add("closing");
    setTimeout(() => {
      confirmModal.classList.remove("open", "closing");
      confirmModal.hidden = true;
      pendingConfirm = null;
    }, 120);
  };

  confirmOk.addEventListener("click", () => {
    const cb = pendingConfirm;
    closeConfirm();
    if (cb) cb();
  });

  confirmCancel.addEventListener("click", closeConfirm);
  confirmModal.querySelector(".modal__backdrop").addEventListener("click", closeConfirm);

  historyDeleteAll.addEventListener("click", () => {
    openConfirm({
      title: "Delete history",
      message: "This will delete all of the output files. Do you really want to delete them?",
      confirmLabel: "Delete",
      onConfirm: deleteAllHistory,
    });
  });

  async function deleteAllHistory() {
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.detail) || `HTTP ${res.status}`);
      }
      stopHistoryPlayback();
      logEvent("all_deleted", `${data.deleted ?? 0} file(s)`);
      await loadHistory();
    } catch (err) {
      console.error("Failed to delete history:", err);
      showAlert(err.message || "Failed to delete history.");
    }
  }

  async function deleteHistoryFile(filename) {
    const li = historyList.querySelector(
      `[data-filename="${CSS.escape(filename)}"]`
    );
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.detail) || `HTTP ${res.status}`);
      }
      stopHistoryPlayback();
      logEvent("file_deleted", filename);
      if (li) await animateHistoryItemRemoval(li);
      await loadHistory();
    } catch (err) {
      console.error("Failed to delete history file:", err);
      showAlert(err.message || "Failed to delete history file.");
    }
  }

  function animateHistoryItemRemoval(li) {
    return new Promise((resolve) => {
      const transition =
        "height 0.25s ease, padding-top 0.25s ease, padding-bottom 0.25s ease, " +
        "border-top-width 0.25s ease, border-bottom-width 0.25s ease, " +
        "margin-bottom 0.25s ease, transform 0.25s ease, opacity 0.2s ease";

      li.style.transition = transition;
      li.style.overflow = "hidden";
      li.style.height = `${li.offsetHeight}px`;
      void li.offsetHeight;

      li.style.height = "0px";
      li.style.paddingTop = "0px";
      li.style.paddingBottom = "0px";
      li.style.borderTopWidth = "0px";
      li.style.borderBottomWidth = "0px";
      li.style.marginBottom = "0px";
      li.style.opacity = "0";
      li.style.transform = "translateY(12px)";

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        li.remove();
        resolve();
      };
      li.addEventListener(
        "transitionend",
        (e) => {
          if (e.propertyName === "height" && e.target === li) finish();
        },
        { once: true }
      );
      setTimeout(finish, 450);
    });
  }

  historySearch.addEventListener("input", () => {
    logEvent("search", historySearch.value.trim() || "(clear)");
    renderHistory();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) closeAllDropdowns();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!confirmModal.hidden) closeConfirm();
      if (!restartModal.hidden) {
        closeRestartModal();
        closeSettings();
      }
      if (!alertModal.hidden) closeAlert();
      if (!emotionModal.hidden) closeEmotionModal();
      if (!creditsModal.hidden) closeCreditsModal();
      if (!voiceModal.hidden) closeVoiceModal();
      if (!settingsModal.hidden) closeSettings();
      hideVoiceMenu();
      hideHistoryMenu();
      closeAllDropdowns();
    }
  });

  loadVoices();

  window.__onBootstrapDone = () => {
    loadVoices();
  };
})();