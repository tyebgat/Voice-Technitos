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
  const wordCount = document.getElementById("word-count");

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

  const updateWordCount = () => {
    const trimmed = editor.innerText.trim();
    const count = trimmed ? trimmed.split(/\s+/).length : 0;
    wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
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
    updateWordCount();
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

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) closeAllDropdowns();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllDropdowns();
  });
})();