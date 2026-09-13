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

  const settingsModal = document.getElementById("settings-modal");
  const btnSettings = document.getElementById("btn-settings");
  const restartModal = document.getElementById("restart-modal");
  const alertModal = document.getElementById("alert-modal");
  const alertMessage = document.getElementById("alert-message");
  const emotionModal = document.getElementById("emotion-modal");
  const emotionTagsBtn = document.getElementById("emotion-tags");
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
      try {
        await apiFetch("/api/shutdown", { method: "POST" });
      } catch (err) {
        /* the app may close before the response arrives */
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
  let currentOutputFormat = "mp3";
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

  document.querySelectorAll(".dropdown").forEach((dd) => {
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
  });

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
    showView(view);
  };

  const updateBootStatus = (status) => {
    const display = status.service_display || status.service || "TTS";
    const downloading =
      status.download_state === "downloading" &&
      (status.download_progress || 0) < 100;
    if (downloading) {
      setBootStatus(
        `Downloading ${display} ${Math.floor(status.download_progress || 0)}%`
      );
      return;
    }
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
    if (!e.target.closest(".context-menu")) hideVoiceMenu();
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

  bindDropZone(voicePhotoDrop, voicePhotoInput, (file) => {
    pendingIcon = file;
    if (file.type.startsWith("image/")) {
      const preview = voicePhotoDrop.querySelector(".drop-zone__preview");
      preview.src = URL.createObjectURL(file);
      voicePhotoDrop.classList.add("has-preview");
    }
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
  const playerPlayIcon = playerPlay.querySelector(".material-symbols-outlined");
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

  const showPlayer = (url, filename) => {
    const refresh = () => {
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

  playerDownload.addEventListener("click", async (e) => {
    e.preventDefault();
    const filename = playerDownload.download || "output.wav";

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
        const blob = await (await fetch(playerAudio.src)).blob();
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
    a.href = playerAudio.src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  generateBtn.addEventListener("click", async () => {
    const text = (editor.innerText || "").trim();
    if (!text) {
      editor.focus();
      return;
    }
    generateBtn.disabled = true;
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
    } finally {
      generateBtn.disabled = false;
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) closeAllDropdowns();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!restartModal.hidden) {
        closeRestartModal();
        closeSettings();
      }
      if (!alertModal.hidden) closeAlert();
      if (!emotionModal.hidden) closeEmotionModal();
      if (!voiceModal.hidden) closeVoiceModal();
      if (!settingsModal.hidden) closeSettings();
      hideVoiceMenu();
      closeAllDropdowns();
    }
  });

  loadVoices();

  window.__onBootstrapDone = () => {
    loadVoices();
  };
})();