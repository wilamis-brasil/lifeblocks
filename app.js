(() => {
  "use strict";

  const STORAGE_KEY = "lifeblocks:routines:v1";
  const POMODORO_KEY = "lifeblocks:pomodoro:v1";
  let deferredInstallPrompt = null;

  const Days = [
    { key: 0, label: "Dom" },
    { key: 1, label: "Seg" },
    { key: 2, label: "Ter" },
    { key: 3, label: "Qua" },
    { key: 4, label: "Qui" },
    { key: 5, label: "Sex" },
    { key: 6, label: "Sáb" },
  ];

  const KanbanColors = [
    { key: "neutral", label: "Neutro", value: "#c9c9c9" },
    { key: "slate", label: "Slate", value: "#94a3b8" },
    { key: "blue", label: "Azul", value: "#60a5fa" },
    { key: "green", label: "Verde", value: "#34d399" },
    { key: "yellow", label: "Amarelo", value: "#fbbf24" },
    { key: "red", label: "Vermelho", value: "#fb7185" },
    { key: "purple", label: "Roxo", value: "#a78bfa" },
  ];

  const el = {
    app: () => document.getElementById("app"),
    sidebar: () => document.getElementById("sidebar"),
    main: () => document.getElementById("main"),
    topbarTitle: () => document.getElementById("topbarTitle"),
    topbarActions: () => document.getElementById("topbarActions"),
    menuBtn: () => document.getElementById("menuBtn"),
    exportBtn: () => document.getElementById("exportBtn"),
    importBtn: () => document.getElementById("importBtn"),
    importFile: () => document.getElementById("importFile"),
    sidebarOverlay: () => document.getElementById("sidebarOverlay"),
    content: () => document.getElementById("content"),
    overlayRoot: () => document.getElementById("overlayRoot"),
    toastRoot: () => document.getElementById("toastRoot"),
    navItems: () => Array.from(document.querySelectorAll(".navItem[data-route]")),
    navItem: (route) => document.querySelector(`.navItem[data-route="${cssEscape(route)}"]`),
  };

  const state = {
    route: "dashboard",
    tab: "today",
    store: loadStore(),
    pomodoro: loadPomodoro(),
    ui: {
      showDoneToday: false,
      showPomodoroOptions: false,
      openSubtasks: {},
    },
    timers: {
      pomodoro: null,
    },
  };

  bootstrap();

  function bootstrap() {
    normalizeNavigation();
    bindNavigation();
    bindMobileSidebar();
    bindImportExport();
    startPomodoroTicker();
    registerServiceWorker();
    bindInstallPrompt();
    applyPwaChrome();
    render();
  }

  function applyPwaChrome() {
    const apply = () => {
      document.body.classList.toggle("isStandalone", isAppInstalled());
    };
    apply();
    try {
      const mql = window.matchMedia("(display-mode: standalone)");
      if (mql && "addEventListener" in mql) mql.addEventListener("change", apply);
    } catch {}

    const wco = navigator.windowControlsOverlay;
    if (!wco) return;
    document.body.classList.add("hasWco");
    const sync = () => {
      try {
        const rect = wco.getTitlebarAreaRect();
        document.documentElement.style.setProperty("--titlebarInset", `${Math.max(0, Math.floor(rect.height))}px`);
      } catch {}
    };
    sync();
    wco.addEventListener("geometrychange", sync);
  }

  function bindInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      render();
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      render();
      toast("Instalado.", "LifeBlocks foi adicionado ao seu dispositivo.");
    });
  }

  function isAppInstalled() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch {}
    return Boolean(window.navigator && window.navigator.standalone);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!(location.hostname === "localhost" || location.protocol === "https:")) return;
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
  }

  function normalizeNavigation() {
    const dashBtn = el.navItem("dashboard");
    if (dashBtn) {
      dashBtn.textContent = "Minha rotina";
    }

    const pomoBtn = el.navItem("pomodoro");
    if (pomoBtn) pomoBtn.textContent = "Pomodoro";

    const kanbanBtn = el.navItem("kanban");
    if (kanbanBtn) kanbanBtn.textContent = "Kanban";

    if (state.route !== "dashboard" && state.route !== "pomodoro" && state.route !== "kanban") state.route = "dashboard";
    setNavCurrent(state.route);
    setTopbarTitle();
  }

  function bindNavigation() {
    for (const btn of el.navItems()) {
      btn.addEventListener("click", () => {
        const route = btn.getAttribute("data-route");
        if (!route) return;
        state.route = route;
        setNavCurrent(route);
        closeMobileSidebar();
        render();
      });
    }
  }

  function bindMobileSidebar() {
    const btn = el.menuBtn();
    const overlay = el.sidebarOverlay();
    if (!btn || !overlay) return;

    btn.addEventListener("click", () => {
      toggleMobileSidebar();
    });
    overlay.addEventListener("click", () => {
      closeMobileSidebar();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      closeMobileSidebar();
    });
  }

  function bindImportExport() {
    const exportBtn = el.exportBtn();
    const importBtn = el.importBtn();
    const importFile = el.importFile();

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        downloadBackup();
      });
    }

    if (importBtn && importFile) {
      importBtn.addEventListener("click", () => {
        try {
          importFile.click();
        } catch {
          toast("Importar.", "Seu navegador bloqueou o seletor de arquivos.");
        }
      });
      importFile.addEventListener("change", async () => {
        const file = importFile.files && importFile.files[0];
        importFile.value = "";
        if (!file) return;
        await importBackupFile(file);
      });
    }
  }

  function getLifeBlocksStorageKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("lifeblocks:")) keys.push(k);
      }
    } catch {}
    return keys.sort();
  }

  function downloadBackup() {
    const payload = {
      schema: "lifeblocks-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: Object.fromEntries(getLifeBlocksStorageKeys().map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => typeof v === "string")),
    };
    const stamp = payload.exportedAt.replace(/[:.]/g, "-");
    const name = `lifeblocks-backup-${stamp}.json`;
    downloadJson(payload, name);
    toast("Exportado.", "Backup baixado como arquivo .json.");
  }

  async function importBackupFile(file) {
    const maxBytes = 2 * 1024 * 1024;
    if (file && typeof file.size === "number" && file.size > maxBytes) {
      toast("Importar.", "Arquivo grande demais. Use um backup menor que 2 MB.");
      return;
    }

    let json;
    try {
      const text = await file.text();
      json = JSON.parse(text);
    } catch {
      toast("Importar.", "Arquivo inválido (não é JSON).");
      return;
    }

    const data =
      json &&
      typeof json === "object" &&
      json.schema === "lifeblocks-backup" &&
      json.version === 1 &&
      json.data &&
      typeof json.data === "object" &&
      !Array.isArray(json.data)
        ? json.data
        : null;
    if (!data) {
      toast("Importar.", "JSON não parece um backup do LifeBlocks.");
      return;
    }

    const entries = Object.entries(data)
      .filter(([k, v]) => typeof k === "string" && k.startsWith("lifeblocks:") && typeof v === "string")
      .sort(([a], [b]) => a.localeCompare(b));

    if (!entries.length) {
      toast("Importar.", "Backup vazio ou incompatível.");
      return;
    }

    try {
      for (const k of getLifeBlocksStorageKeys()) localStorage.removeItem(k);
      for (const [k, v] of entries) localStorage.setItem(k, v);
    } catch {
      toast("Importar.", "Falha ao gravar no armazenamento do navegador.");
      return;
    }

    state.store = loadStore();
    state.pomodoro = loadPomodoro();
    render();
    toast("Importado.", "Seus dados foram restaurados neste dispositivo.");
  }

  function downloadJson(obj, filename) {
    const text = JSON.stringify(obj, null, 2) + "\n";
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toggleMobileSidebar() {
    if (document.body.classList.contains("sidebarOpen")) closeMobileSidebar();
    else openMobileSidebar();
  }

  function openMobileSidebar() {
    document.body.classList.add("sidebarOpen");
    const btn = el.menuBtn();
    const overlay = el.sidebarOverlay();
    if (btn) btn.setAttribute("aria-expanded", "true");
    if (overlay) overlay.setAttribute("aria-hidden", "false");
  }

  function closeMobileSidebar() {
    document.body.classList.remove("sidebarOpen");
    const btn = el.menuBtn();
    const overlay = el.sidebarOverlay();
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (overlay) overlay.setAttribute("aria-hidden", "true");
  }

  function setNavCurrent(route) {
    for (const btn of el.navItems()) {
      const isCurrent = btn.getAttribute("data-route") === route;
      btn.setAttribute("aria-current", isCurrent ? "page" : "false");
    }
  }

  function render() {
    setTopbarTitle();
    renderTopbarActions();
    renderContent();
  }

  function setTopbarTitle() {
    const title = el.topbarTitle();
    if (!title) return;
    if (state.route === "pomodoro") title.textContent = "Pomodoro";
    else if (state.route === "kanban") title.textContent = "Kanban";
    else title.textContent = "Minha rotina";
  }

  function renderTopbarActions() {
    const root = el.topbarActions();
    if (!root) return;
    root.replaceChildren();

    if (state.route === "dashboard" && state.tab === "manage") {
      const addBtn = h("button", { className: "btn btnPrimary btnSmall", type: "button" }, "Novo hábito");
      addBtn.addEventListener("click", () => openRoutineEditor({ mode: "create" }));
      root.append(addBtn);
    }

    if (deferredInstallPrompt && !isAppInstalled()) {
      const installBtn = h("button", { className: "btn btnGhost btnSmall", type: "button" }, "Instalar");
      installBtn.addEventListener("click", async () => {
        const p = deferredInstallPrompt;
        if (!p) return;
        deferredInstallPrompt = null;
        try {
          await p.prompt();
          const choice = await p.userChoice;
          if (choice && choice.outcome === "accepted") toast("Pronto.", "Você pode abrir como app.");
        } catch {}
        render();
      });
      root.append(installBtn);
    }

    if (isAppInstalled()) {
      const closeBtn = h("button", { className: "iconBtn", type: "button", "aria-label": "Fechar" }, "×");
      closeBtn.addEventListener("click", () => {
        try {
          window.close();
          window.setTimeout(() => toast("Fechar.", "Use o botão X do sistema se não fechar."), 350);
        } catch {
          toast("Fechar.", "Use o botão X do sistema.");
        }
      });
      root.append(closeBtn);
    }

    const credit = h("div", { className: "topbarCredit" }, "por ");
    const link = h("a", { className: "creditLink", href: "https://github.com/wilamis-brasil", target: "_blank", rel: "noopener noreferrer" }, "Wilamis B.");
    credit.append(link);
    root.append(credit);
  }

  function renderContent() {
    const root = el.content();
    if (!root) return;
    root.replaceChildren();

    if (state.route === "pomodoro") {
      root.append(renderPomodoro());
      return;
    }

    if (state.route === "kanban") {
      root.append(renderKanban());
      return;
    }

    root.append(renderTabs());
    root.append(h("div", { className: "divider" }));

    if (state.tab === "today") root.append(renderToday());
    if (state.tab === "manage") root.append(renderManage());
  }

  function renderTabs() {
    const row = h("div", { className: "segRow" });
    const todayBtn = h("button", { className: "segBtn", type: "button" }, "Hoje");
    const manageBtn = h("button", { className: "segBtn", type: "button" }, "Hábitos");

    todayBtn.setAttribute("aria-selected", state.tab === "today" ? "true" : "false");
    manageBtn.setAttribute("aria-selected", state.tab === "manage" ? "true" : "false");

    todayBtn.addEventListener("click", () => {
      state.tab = "today";
      render();
    });
    manageBtn.addEventListener("click", () => {
      state.tab = "manage";
      render();
    });

    row.append(todayBtn, manageBtn);
    return row;
  }

  function renderPomodoro() {
    const wrap = h("div", { className: "pomodoroWrap" });
    const card = h("div", { className: "pomodoroCard" });

    const p = state.pomodoro;
    const status = p.running ? "Em andamento" : "Parado";
    const modeLabel = pomodoroModeLabel(p.mode);
    const remaining = getPomodoroRemainingSec();

    const top = h(
      "div",
      { className: "pomodoroTop" },
      h("div", { className: "pomodoroKicker" }, `${modeLabel} · ${status}`),
      h("div", { className: "pomodoroKicker" }, `Duração: ${Math.round(getSegmentDuration(p) / 60)} min`)
    );

    const time = h("div", { className: "pomodoroTime", "aria-live": "polite" }, formatClock(remaining));
    const hint = h(
      "div",
      { className: "pomodoroHint" },
      p.mode === "focus" ? "Foco: Foque em algo até o timer zerar." : "Pausa: descanse até o timer zerar."
    );

    const controls = h("div", { className: "pomodoroControls" });
    const primaryLabel = p.running ? "Pausar" : remaining === 0 ? "Recomeçar" : "Iniciar";
    const startBtn = h("button", { className: "btn btnPrimary", type: "button" }, primaryLabel);
    startBtn.addEventListener("click", () => {
      if (state.pomodoro.running) pausePomodoro();
      else startPomodoro();
      render();
    });

    const resetBtn = h("button", { className: "btn btnGhost", type: "button" }, "Zerar");
    resetBtn.addEventListener("click", () => {
      resetPomodoro();
      render();
    });

    const optBtn = h("button", { className: "btn btnGhost", type: "button" }, state.ui.showPomodoroOptions ? "Fechar" : "Ajustes");
    optBtn.addEventListener("click", () => {
      state.ui.showPomodoroOptions = !state.ui.showPomodoroOptions;
      render();
    });

    controls.append(startBtn, resetBtn, optBtn);

    card.append(top, time, hint, controls);
    if (state.ui.showPomodoroOptions) card.append(renderPomodoroOptions());
    wrap.append(card);
    return wrap;
  }

  function renderPomodoroOptions() {
    const p = state.pomodoro;
    const box = h("div", { className: "pomoOptions" });

    const modeRow = h("div", { className: "pomoRow" });
    modeRow.append(h("div", { className: "pomoLabel" }, "Atividade"));
    const modeChips = h("div", { className: "chipRow pomodoroPresets" });
    const modes = [
      { key: "focus", label: "Foco" },
      { key: "break", label: "Pausa" },
    ];
    for (const m of modes) {
      const pressed = p.mode === m.key;
      const chip = h("button", { className: "chip", type: "button" }, m.label);
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      chip.addEventListener("click", () => {
        if (state.pomodoro.running) return;
        setPomodoroMode(m.key);
        render();
      });
      modeChips.append(chip);
    }
    modeRow.append(modeChips);

    const focusRow = h("div", { className: "pomoRow" });
    focusRow.append(h("div", { className: "pomoLabel" }, "Tempo de foco"));
    const focusChips = h("div", { className: "chipRow pomodoroPresets" });
    for (const min of [25, 50, 90]) {
      const pressed = !p.running && p.focusSec === min * 60;
      const chip = h("button", { className: "chip chipShort", type: "button" }, `${min}m`);
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      chip.addEventListener("click", () => {
        if (state.pomodoro.running) return;
        setPomodoroFocusDuration(min * 60);
        render();
      });
      focusChips.append(chip);
    }
    focusRow.append(focusChips);

    const breakRow = h("div", { className: "pomoRow" });
    breakRow.append(h("div", { className: "pomoLabel" }, "Tempo de pausa"));
    const breakChips = h("div", { className: "chipRow pomodoroPresets" });
    for (const min of [5, 10, 15]) {
      const pressed = !p.running && p.breakSec === min * 60;
      const chip = h("button", { className: "chip chipShort", type: "button" }, `${min}m`);
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      chip.addEventListener("click", () => {
        if (state.pomodoro.running) return;
        setPomodoroBreakDuration(min * 60);
        render();
      });
      breakChips.append(chip);
    }
    breakRow.append(breakChips);

    box.append(modeRow);
    if (p.mode === "focus") box.append(focusRow);
    else box.append(breakRow);
    return box;
  }

  function renderKanban() {
    const kb = state.store.kanban ?? defaultKanban();
    const wrap = h("div", { className: "kanbanWrap" });
    const intro = h(
      "div",
      { className: "kbIntro" },
      "Ideias → Em andamento → Concluído. Clique em + para criar, arraste para mover. Use Limite para não começar coisas demais."
    );
    const board = h("div", { className: "kanbanBoard" });

    for (const col of kb.columns) {
      board.append(renderKanbanColumn(col, kb));
    }

    wrap.append(intro, board);
    return wrap;
  }

  function renderKanbanColumn(col, kb) {
    const cardIds = col.cardIds ?? [];
    const count = cardIds.length;
    const limit = Number(col.wipLimit ?? 0) || 0;
    const over = limit > 0 && count > limit;
    const atLimit = limit > 0 && count >= limit;

    const oldestDays = computeKanbanOldestDays(col, kb);

    const column = h("div", { className: `kbCol ${over ? "kbColOver" : atLimit ? "kbColAt" : ""}`.trim() });
    const header = h("div", { className: "kbColHeader" });

    const title = h("div", { className: "kbColTitle" }, col.title);
    const meta = h("div", { className: "kbColMeta" });
    const countPill = h("div", { className: "kbMetaPill" }, `${count}${limit > 0 ? `/${limit}` : ""}`);
    meta.append(countPill);

    if (oldestDays !== null && col.id !== "done") {
      meta.append(h("div", { className: "kbMetaText" }, oldestDays === 0 ? "mais antigo: hoje" : `mais antigo: ${oldestDays}d`));
    }

    const wipBtn = h("button", { className: "kbMetaBtn", type: "button" }, limit > 0 ? `Limite ${limit}` : "Sem limite");
    wipBtn.addEventListener("click", () => openKanbanWipEditor(col.id));

    const addBtn = h("button", { className: "kbIconBtn", type: "button", "aria-label": "Adicionar" }, "+");
    addBtn.addEventListener("click", () => openKanbanCardEditor({ mode: "create", columnId: col.id }));

    header.append(title, meta, wipBtn, addBtn);

    const list = h("div", { className: "kbColBody" });
    list.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      const cardId = String(e.dataTransfer?.getData("text/plain") ?? "");
      if (!cardId) return;
      const beforeEl = e.target && e.target.closest ? e.target.closest(".kbCard") : null;
      const beforeId = beforeEl ? String(beforeEl.getAttribute("data-card") ?? "") : null;
      moveKanbanCard(cardId, col.id, beforeId || null);
      render();
    });

    for (const cid of cardIds) {
      const card = kb.cards?.[cid];
      if (!card) continue;
      list.append(renderKanbanCard(card, col.id));
    }

    if (col.id === "done" && count) {
      const clearBtn = h("button", { className: "kbClearBtn", type: "button" }, "Limpar concluídas");
      clearBtn.addEventListener("click", () => {
        clearKanbanDone();
        render();
      });
      column.append(header, list, clearBtn);
    } else {
      column.append(header, list);
    }

    return column;
  }

  function renderKanbanCard(card, colId) {
    const color = KanbanColors.find((c) => c.key === card.color)?.value ?? KanbanColors[0].value;
    const elCard = h("div", { className: "kbCard", draggable: "true" });
    elCard.setAttribute("data-card", card.id);
    elCard.style.borderLeftColor = color;

    elCard.addEventListener("click", () => {
      openKanbanCardEditor({ mode: "edit", cardId: card.id, columnId: colId });
    });

    elCard.addEventListener("dragstart", (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData("text/plain", card.id);
      e.dataTransfer.effectAllowed = "move";
      document.body.classList.add("isDragging");
    });
    elCard.addEventListener("dragend", () => {
      document.body.classList.remove("isDragging");
    });

    const title = h("div", { className: "kbCardTitle" }, card.title);
    const actions = h("div", { className: "kbCardActions" });
    const left = h("button", { className: "kbMoveBtn", type: "button", "aria-label": "Mover para a esquerda" }, "←");
    left.addEventListener("click", (e) => {
      e.stopPropagation();
      moveKanbanCardStep(card.id, -1);
      render();
    });
    const right = h("button", { className: "kbMoveBtn", type: "button", "aria-label": "Mover para a direita" }, "→");
    right.addEventListener("click", (e) => {
      e.stopPropagation();
      moveKanbanCardStep(card.id, 1);
      render();
    });
    actions.append(left, right);

    elCard.append(title, actions);
    return elCard;
  }

  function openKanbanWipEditor(columnId) {
    const kb = state.store.kanban ?? defaultKanban();
    const col = (kb.columns ?? []).find((c) => c.id === columnId);
    if (!col) return;
    const draft = { id: col.id, title: col.title, wipLimit: Number(col.wipLimit ?? 0) || 0 };

    const { modal, closeBtn } = createModalShell(`Limite · ${draft.title}`);

    const body = h("div", { className: "modalBody modalBodySpaced" });
    const field = h("div", { className: "field" });
    field.append(h("div", { className: "label" }, "LIMITE DE TAREFAS (0 = SEM LIMITE)"));
    const input = h("input", { className: "input", value: String(draft.wipLimit), autocomplete: "off" });
    input.setAttribute("inputmode", "numeric");
    input.addEventListener("input", () => {
      const n = Math.floor(Number(input.value));
      draft.wipLimit = Number.isFinite(n) ? Math.max(0, n) : 0;
    });
    field.append(input);
    body.append(field);

    const footer = h("div", { className: "modalFooter" });
    const cancelBtn = h("button", { className: "btn btnGhost", type: "button" }, "Cancelar");
    const saveBtn = h("button", { className: "btn btnPrimary", type: "button" }, "Salvar");
    footer.append(cancelBtn, saveBtn);

    modal.append(body, footer);
    const { close } = mountOverlay(modal, { initialFocus: input });
    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);

    saveBtn.addEventListener("click", () => {
      setKanbanColumnWip(draft.id, draft.wipLimit);
      closeOverlay();
      render();
    });
  }

  function openKanbanCardEditor({ mode, columnId, cardId }) {
    const kb = state.store.kanban ?? defaultKanban();
    const fromCol = (kb.columns ?? []).find((c) => c.id === columnId) ?? (kb.columns ?? [])[0];
    if (!fromCol) return;
    const existing = mode === "edit" ? kb.cards?.[cardId] ?? null : null;

    const draft = existing
      ? deepClone(existing)
      : { id: randomId(), title: "", color: "neutral", createdAt: Date.now(), updatedAt: Date.now() };

    const { modal, closeBtn } = createModalShell(mode === "edit" ? "Editar tarefa" : "Nova tarefa");

    const body = h("div", { className: "modalBody" });
    const titleField = h("div", { className: "field" });
    titleField.append(h("div", { className: "label" }, "O QUE VOCÊ VAI FAZER"));
    const titleInput = h("input", { className: "input", value: draft.title, placeholder: "Ex: Corrigir bug do login", autocomplete: "off" });
    titleInput.addEventListener("input", () => {
      draft.title = normalizeTitle(titleInput.value);
    });
    titleField.append(titleInput);

    const colorField = h("div", { className: "field" });
    colorField.append(h("div", { className: "label" }, "COR"));
    const row = h("div", { className: "kbColorRow" });
    for (const c of KanbanColors) {
      const btn = h("button", { className: "kbColorDot", type: "button", "aria-label": c.label });
      btn.style.background = c.value;
      btn.setAttribute("aria-pressed", draft.color === c.key ? "true" : "false");
      btn.addEventListener("click", () => {
        draft.color = c.key;
        for (const b of Array.from(row.querySelectorAll(".kbColorDot"))) b.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-pressed", "true");
      });
      row.append(btn);
    }
    colorField.append(row);

    body.append(titleField, h("div", { className: "divider" }), colorField);

    const footer = h("div", { className: "modalFooter" });
    const cancelBtn = h("button", { className: "btn btnGhost", type: "button" }, "Cancelar");
    const saveBtn = h("button", { className: "btn btnPrimary", type: "button" }, "Salvar");
    footer.append(cancelBtn);
    if (mode === "edit") {
      const delBtn = h("button", { className: "btn btnGhost", type: "button" }, "Apagar");
      delBtn.addEventListener("click", () => {
        deleteKanbanCard(draft.id);
        closeOverlay();
        render();
      });
      footer.append(delBtn);
    }
    footer.append(saveBtn);

    modal.append(body, footer);
    const { close } = mountOverlay(modal, { initialFocus: titleInput });
    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);

    saveBtn.addEventListener("click", () => {
      const title = normalizeTitle(draft.title);
      if (!title) {
        toast("Digite um nome.", "Ex: “Revisar PR”, “Estudar arrays”, “Resolver bug X”.");
        titleInput.focus();
        return;
      }
      draft.title = title;
      draft.updatedAt = Date.now();
      if (mode === "create") addKanbanCard(fromCol.id, draft);
      else updateKanbanCard(draft);
      closeOverlay();
      render();
    });
  }

  function addKanbanCard(columnId, card) {
    const next = deepClone(state.store);
    const kb = deepClone(next.kanban ?? defaultKanban());
    const col = (kb.columns ?? []).find((c) => c.id === columnId) ?? (kb.columns ?? [])[0];
    if (!col) return;

    const limit = Number(col.wipLimit ?? 0) || 0;
    if (limit > 0 && col.cardIds.length + 1 > limit) {
      toast("Limite atingido.", `Esta coluna aceita no máximo ${limit} tarefas.`);
      return;
    }

    kb.cards[card.id] = card;
    col.cardIds.unshift(card.id);
    kb.updatedAt = Date.now();
    next.kanban = kb;
    state.store = next;
    saveStore(state.store);
  }

  function updateKanbanCard(card) {
    const next = deepClone(state.store);
    const kb = deepClone(next.kanban ?? defaultKanban());
    if (!kb.cards?.[card.id]) return;
    kb.cards[card.id] = card;
    kb.updatedAt = Date.now();
    next.kanban = kb;
    state.store = next;
    saveStore(state.store);
  }

  function deleteKanbanCard(cardId) {
    const next = deepClone(state.store);
    const kb = deepClone(next.kanban ?? defaultKanban());
    if (!kb.cards?.[cardId]) return;
    delete kb.cards[cardId];
    for (const col of kb.columns ?? []) {
      col.cardIds = (col.cardIds ?? []).filter((id) => id !== cardId);
    }
    kb.updatedAt = Date.now();
    next.kanban = kb;
    state.store = next;
    saveStore(state.store);
  }

  function setKanbanColumnWip(columnId, wipLimit) {
    const next = deepClone(state.store);
    const kb = deepClone(next.kanban ?? defaultKanban());
    const col = (kb.columns ?? []).find((c) => c.id === columnId);
    if (!col) return;
    col.wipLimit = Math.max(0, Math.floor(Number(wipLimit) || 0));
    kb.updatedAt = Date.now();
    next.kanban = kb;
    state.store = next;
    saveStore(state.store);
  }

  function moveKanbanCard(cardId, toColumnId, beforeId) {
    const next = deepClone(state.store);
    const kb = deepClone(next.kanban ?? defaultKanban());
    const cols = kb.columns ?? [];
    const fromCol = cols.find((c) => (c.cardIds ?? []).includes(cardId));
    const toCol = cols.find((c) => c.id === toColumnId);
    if (!toCol || !kb.cards?.[cardId]) return;

    if (fromCol && fromCol.id !== toCol.id) {
      const limit = Number(toCol.wipLimit ?? 0) || 0;
      const nextCount = (toCol.cardIds ?? []).length + 1;
      if (limit > 0 && nextCount > limit) {
        toast("Limite atingido.", `Esta coluna aceita no máximo ${limit} tarefas.`);
        return;
      }
    }

    if (fromCol) fromCol.cardIds = (fromCol.cardIds ?? []).filter((id) => id !== cardId);
    if (!toCol.cardIds) toCol.cardIds = [];

    let idx = -1;
    if (beforeId) idx = toCol.cardIds.indexOf(beforeId);
    if (idx < 0) toCol.cardIds.push(cardId);
    else toCol.cardIds.splice(idx, 0, cardId);

    kb.cards[cardId].updatedAt = Date.now();
    kb.updatedAt = Date.now();
    next.kanban = kb;
    state.store = next;
    saveStore(state.store);
  }

  function moveKanbanCardStep(cardId, dir) {
    const kb = state.store.kanban ?? defaultKanban();
    const cols = kb.columns ?? [];
    const fromIndex = cols.findIndex((c) => (c.cardIds ?? []).includes(cardId));
    if (fromIndex < 0) return;
    const toIndex = fromIndex + dir;
    if (toIndex < 0 || toIndex >= cols.length) return;
    moveKanbanCard(cardId, cols[toIndex].id, null);
  }

  function clearKanbanDone() {
    const next = deepClone(state.store);
    const kb = deepClone(next.kanban ?? defaultKanban());
    const done = (kb.columns ?? []).find((c) => c.id === "done");
    if (!done) return;
    for (const id of done.cardIds ?? []) {
      delete kb.cards[id];
    }
    done.cardIds = [];
    kb.updatedAt = Date.now();
    next.kanban = kb;
    state.store = next;
    saveStore(state.store);
  }

  function computeKanbanOldestDays(col, kb) {
    const ids = (col.cardIds ?? []).map((id) => kb.cards?.[id]).filter(Boolean);
    if (!ids.length) return null;
    const oldest = ids.reduce((min, c) => Math.min(min, Number.isFinite(c.updatedAt) ? c.updatedAt : c.createdAt ?? Date.now()), Date.now());
    const days = Math.floor((Date.now() - oldest) / 86400000);
    return Math.max(0, days);
  }

  function renderToday() {
    const container = h("div", { className: "stack" });
    const today = new Date();
    const dateKey = toDateKey(today);
    if (state.ui.showDoneToday && state.ui.showDoneDayKey !== dateKey) state.ui.showDoneToday = false;
    state.ui.showDoneDayKey = dateKey;
    const dayIndex = today.getDay();
    const routines = state.store.routines;

    if (!routines.length) {
      const card = h(
        "div",
        { className: "card" },
        h("div", { className: "text-h2" }, "Sua lista de hábitos está vazia."),
        h("div", { className: "text-muted" }, "Crie um hábito e escolha em quais dias ele aparece.")
      );
      const actions = h("div", { className: "row" });
      const btn = h("button", { className: "btn btnPrimary", type: "button" }, "Criar hábito");
      btn.addEventListener("click", () => {
        state.tab = "manage";
        render();
        openRoutineEditor({ mode: "create" });
      });
      actions.append(btn);
      card.append(h("div", { className: "divider" }), actions);
      container.append(card);
      return container;
    }

    const todayRoutines = routines.filter((r) => (r.days ?? []).includes(dayIndex));
    if (!todayRoutines.length) {
      container.append(
        h(
          "div",
          { className: "card" },
          h("div", { className: "text-h2" }, "Sem hábitos para hoje."),
          h("div", { className: "text-muted" }, "Você pode ajustar os dias na aba “Hábitos”.")
        )
      );
      return container;
    }

    container.append(renderProgressPanel(today, dateKey, todayRoutines));

    const activeList = h("div", { className: "list" });
    const doneList = h("div", { className: "list" });

    let doneCount = 0;
    for (const routine of todayRoutines) {
      const completion = ensureCompletion(dateKey, routine.id);
      const status = computeRoutineStatus(routine, completion);
      if (status === "done") {
        doneCount += 1;
        doneList.append(renderTodayRoutineItem(routine, dateKey));
      } else {
        activeList.append(renderTodayRoutineItem(routine, dateKey));
      }
    }

    container.append(activeList);

    if (doneCount) {
      const row = h("div", { className: "row rowTight" });
      const toggleBtn = h("button", { className: "linkBtn", type: "button" });
      toggleBtn.append(
        h("span", { className: "linkBtnText" }, `Concluídas (${doneCount})`),
        h("span", { className: "linkBtnCaret", "aria-hidden": "true" }, state.ui.showDoneToday ? "▾" : "▸")
      );
      toggleBtn.addEventListener("click", () => {
        state.ui.showDoneToday = !state.ui.showDoneToday;
        render();
      });
      row.append(toggleBtn);
      container.append(row);
      if (state.ui.showDoneToday) container.append(doneList);
    }

    return container;
  }

  function renderTodayRoutineItem(routine, dateKey) {
    const completion = ensureCompletion(dateKey, routine.id);
    const status = computeRoutineStatus(routine, completion);
    const item = h("div", { className: `listItem ${status === "done" ? "isDone" : ""} ${status === "skipped" ? "isSkipped" : ""}`.trim() });

    const checkBtn = h("button", {
      className: "check",
      type: "button",
      "aria-label": status === "done" ? `Marcar como não concluído: ${routine.title}` : `Marcar como concluído: ${routine.title}`,
      "data-checked": status === "done" ? "true" : "false",
    });
    checkBtn.setAttribute("aria-pressed", status === "done" ? "true" : "false");
    checkBtn.addEventListener("click", () => {
      const current = ensureCompletion(dateKey, routine.id);
      const currentStatus = computeRoutineStatus(routine, current);
      const next = currentStatus !== "done";
      setRoutineDone(dateKey, routine, next);
      render();
    });

    const body = h("div", {});
    body.append(h("div", { className: `listTitle ${status === "done" ? "strike" : ""}`.trim() }, routine.title));

    const metaBits = [];
    const dayLabels = formatDaysShort(routine.days ?? []);
    if (dayLabels) metaBits.push(dayLabels);
    const subtasks = routine.subtasks ?? [];
    let doneSubtasks = 0;
    if (subtasks.length) {
      for (const st of subtasks) if (Boolean(completion.subtasks?.[st.id])) doneSubtasks += 1;
      metaBits.push(`Subtarefas ${doneSubtasks}/${subtasks.length}`);
    }
    if (status === "done") metaBits.push("Concluído");
    if (status === "skipped") metaBits.push("Pulado");
    if (metaBits.length) body.append(h("div", { className: "listMeta" }, metaBits.join(" · ")));

    if (subtasks.length) {
      const defaultOpen = status === "pending" && subtasks.length <= 3;
      const isOpenRaw = typeof state.ui.openSubtasks?.[routine.id] === "boolean" ? state.ui.openSubtasks[routine.id] : defaultOpen;
      const isOpen = status === "done" ? false : isOpenRaw;
      const summary = h("button", { className: "subtaskSummary", type: "button" });
      summary.append(
        h("span", { className: "subtaskSummaryText" }, `Subtarefas · ${doneSubtasks}/${subtasks.length}`),
        h("span", { className: "subtaskChevron", "aria-hidden": "true" }, isOpen ? "▾" : "▸")
      );
      summary.addEventListener("click", () => {
        if (!state.ui.openSubtasks) state.ui.openSubtasks = {};
        state.ui.openSubtasks[routine.id] = !isOpen;
        render();
      });
      body.append(summary);

      if (isOpen) {
        const list = h("div", { className: "subtaskList" });
        for (const st of subtasks) {
          const pressed = Boolean(completion.subtasks?.[st.id]);
          const row = h("label", { className: "subtaskItem" });
          const toggle = h("input", { className: "subtaskToggle", type: "checkbox" });
          toggle.checked = pressed;
          toggle.addEventListener("change", () => {
            toggleSubtask(dateKey, routine, st.id);
            render();
          });
          const box = h("span", { className: "subtaskBox", "aria-hidden": "true" });
          const text = h("span", { className: "subtaskText" }, st.title);
          text.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const input = h("input", { className: "subtaskEditInput", value: st.title, autocomplete: "off" });
            row.replaceChildren(toggle, box, input);
            toggle.disabled = true;

            const cancel = () => render();
            const commit = () => {
              const nextTitle = normalizeTitle(input.value);
              if (nextTitle && nextTitle !== st.title) renameRoutineSubtask(routine.id, st.id, nextTitle);
              render();
            };

            input.addEventListener("keydown", (ev) => {
              if (ev.key === "Escape") {
                ev.preventDefault();
                cancel();
              } else if (ev.key === "Enter") {
                ev.preventDefault();
                commit();
              }
            });
            input.addEventListener("blur", commit);

            input.focus();
            try {
              input.select();
            } catch {}
          });
          row.append(toggle, box, text);
          list.append(row);
        }
        body.append(list);
      }
    }

    const actions = h("div", { className: "row" });
    if (status === "pending") {
      const skipBtn = h("button", { className: "btn btnGhost btnSmall", type: "button" }, "Pular hoje");
      skipBtn.addEventListener("click", () => {
        setRoutineSkipped(dateKey, routine, true);
        render();
      });
      actions.append(skipBtn);
    }
    if (status === "skipped") {
      const undoBtn = h("button", { className: "btn btnGhost btnSmall", type: "button" }, "Desfazer");
      undoBtn.addEventListener("click", () => {
        setRoutineSkipped(dateKey, routine, false);
        render();
      });
      actions.append(undoBtn);
    }
    const editBtn = h("button", { className: "btn btnGhost btnSmall", type: "button" }, "Editar");
    editBtn.addEventListener("click", () => openRoutineEditor({ mode: "edit", routineId: routine.id }));
    actions.append(editBtn);

    item.append(checkBtn, body, actions);
    return item;
  }

  function renderProgressPanel(today, todayKey, todayRoutines) {
    const card = h("div", { className: "card progressCard" });

    const todayStats = computeTodayStats(todayKey, todayRoutines);
    const weekStats = computeWeekStats(today);

    const header = h(
      "div",
      { className: "progressHeader" },
      h("div", { className: "cardTitle" }, "Progresso")
    );

    const grid = h(
      "div",
      { className: "metricGrid" },
      renderMetric(`${weekStats.scorePct}%`, "Semana"),
      renderMetric(`${weekStats.dedicatedDays}/${weekStats.daysElapsed}`, "Dias com hábitos"),
      renderMetric(`${todayStats.done}/${todayStats.total}`, "Concluídos hoje")
    );

    const bar = h("div", { className: "progressBar", role: "img", "aria-label": `Progresso da semana ${weekStats.scorePct}%` });
    const fill = h("div", { className: "progressFill" });
    fill.style.width = `${weekStats.scorePct}%`;
    bar.append(fill);

    const meta = h(
      "div",
      { className: "progressMeta" },
      [
        `Concluídos ${weekStats.done}`,
        weekStats.skipped ? `Pulados ${weekStats.skipped}` : null,
        `Planejados ${weekStats.planned}`,
      ]
        .filter(Boolean)
        .join(" · ")
    );

    card.append(header, grid, bar, meta);

    return card;
  }

  function renderMetric(value, label) {
    const box = h("div", { className: "metric" });
    box.append(h("div", { className: "metricValue" }, String(value)), h("div", { className: "metricLabel" }, String(label)));
    return box;
  }

  function renderManage() {
    const container = h("div", { className: "stack" });
    const routines = state.store.routines;

    if (!routines.length) {
      const card = h(
        "div",
        { className: "card" },
        h("div", { className: "text-h2" }, "Sem hábitos por enquanto."),
        h("div", { className: "text-muted" }, "Crie hábitos simples e realistas. Você pode editar depois.")
      );
      const actions = h("div", { className: "row" });
      const btn = h("button", { className: "btn btnPrimary", type: "button" }, "Criar hábito");
      btn.addEventListener("click", () => openRoutineEditor({ mode: "create" }));
      actions.append(btn);
      card.append(h("div", { className: "divider" }), actions);
      container.append(card);
      return container;
    }

    const list = h("div", { className: "list" });
    for (const r of routines) list.append(renderManageRoutineItem(r));
    container.append(list);
    return container;
  }

  function renderManageRoutineItem(routine) {
    const item = h("div", { className: "listItem" });
    const spacer = h("div", { className: "listSpacer", "aria-hidden": "true" });
    const body = h("div", {});
    body.append(h("div", { className: "listTitle" }, routine.title));

    const metaBits = [];
    const dayLabels = formatDaysShort(routine.days ?? []);
    if (dayLabels) metaBits.push(dayLabels);
    if ((routine.subtasks ?? []).length) metaBits.push(`${routine.subtasks.length} subtarefa(s)`);
    body.append(h("div", { className: "listMeta" }, metaBits.join(" · ")));

    const actions = h("div", { className: "row" });
    const editBtn = h("button", { className: "btn btnGhost btnSmall", type: "button" }, "Editar");
    editBtn.addEventListener("click", () => openRoutineEditor({ mode: "edit", routineId: routine.id }));
    const delBtn = h(
      "button",
      { className: "btn btnGhost btnSmall btnIcon", type: "button", "aria-label": "Apagar" },
      trashIcon()
    );
    delBtn.addEventListener("click", () => confirmDeleteRoutine(routine.id));
    actions.append(editBtn, delBtn);

    item.append(spacer, body, actions);
    return item;
  }

  function openRoutineEditor({ mode, routineId }) {
    const existing = mode === "edit" ? state.store.routines.find((r) => r.id === routineId) : null;
    const draft = existing
      ? deepClone(existing)
      : {
          id: randomId(),
          title: "",
          days: [1, 2, 3, 4, 5],
          subtasks: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

    const { modal, closeBtn } = createModalShell(mode === "edit" ? "Editar hábito" : "Novo hábito", "modal modalFixed");

    const body = h("div", { className: "modalBody" });

    const titleField = h("div", { className: "field" });
    titleField.append(h("div", { className: "label" }, "NOME DO HÁBITO"));
    const titleInput = h("input", { className: "input", value: draft.title, placeholder: "Ex: Estudar 30 min", autocomplete: "off" });
    titleInput.addEventListener("input", () => {
      draft.title = normalizeTitle(titleInput.value);
    });
    titleField.append(titleInput);

    const daysField = h("div", { className: "field" });
    daysField.append(h("div", { className: "label" }, "DIAS DA SEMANA"));
    const chipRow = h("div", { className: "chipRow" });
    for (const d of Days) {
      const chip = h("button", { className: "chip", type: "button" }, d.label);
      const pressed = draft.days.includes(d.key);
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      chip.addEventListener("click", () => {
        draft.days = toggleInArray(draft.days, d.key);
        chip.setAttribute("aria-pressed", draft.days.includes(d.key) ? "true" : "false");
      });
      chipRow.append(chip);
    }
    daysField.append(chipRow);

    const subtasksField = h("div", { className: "field" });
    subtasksField.append(h("div", { className: "label" }, "SUBTAREFAS (OPCIONAL)"));
    const subtasksEditor = h("div", { className: "listEditor" });

    const addRow = h("div", { className: "row" });
    const subtaskInput = h("input", { className: "input", placeholder: "Adicionar item", autocomplete: "off" });
    const addBtn = h("button", { className: "btn btnGhost", type: "button" }, "Incluir");
    addBtn.addEventListener("click", () => {
      const title = normalizeTitle(subtaskInput.value);
      if (!title) return;
      draft.subtasks.push({ id: randomId(), title });
      subtaskInput.value = "";
      renderSubtasksEditor();
    });
    subtaskInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      addBtn.click();
    });
    addRow.append(subtaskInput, addBtn);

    subtasksField.append(addRow, subtasksEditor);

    body.append(titleField, h("div", { className: "divider" }), daysField, h("div", { className: "divider" }), subtasksField);

    const footer = h("div", { className: "modalFooter" });
    const cancelBtn = h("button", { className: "btn btnGhost", type: "button" }, "Cancelar");
    const saveBtn = h("button", { className: "btn btnPrimary", type: "button" }, "Salvar");
    footer.append(cancelBtn, saveBtn);

    modal.append(body, footer);
    const { close } = mountOverlay(modal, { initialFocus: titleInput });
    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);

    saveBtn.addEventListener("click", () => {
      const cleaned = cleanRoutineDraft(draft);
      if (!cleaned) {
        toast("Digite um nome.", "Ex: “Estudar”, “Treinar”, “Ler 10 páginas”.");
        titleInput.focus();
        return;
      }
      if (!cleaned.days.length) {
        toast("Selecione os dias.", "Marque em quais dias esse hábito aparece.");
        return;
      }
      upsertRoutine(cleaned);
      closeOverlay();
      render();
    });
    renderSubtasksEditor();

    function renderSubtasksEditor() {
      subtasksEditor.replaceChildren();
      for (const st of draft.subtasks) {
        const row = h("div", { className: "liRow" });
        const input = h("input", { className: "liInput", value: st.title, autocomplete: "off" });
        input.addEventListener("input", () => {
          st.title = normalizeTitle(input.value);
        });
        const rm = h("button", { className: "liRemove", type: "button", "aria-label": "Remover" }, "×");
        rm.addEventListener("click", () => {
          draft.subtasks = draft.subtasks.filter((x) => x.id !== st.id);
          renderSubtasksEditor();
        });
        row.append(input, rm);
        subtasksEditor.append(row);
      }
    }
  }

  function confirmDeleteRoutine(routineId) {
    const routine = state.store.routines.find((r) => r.id === routineId);
    if (!routine) return;

    const { modal, closeBtn } = createModalShell("Apagar hábito");

    const body = h(
      "div",
      { className: "modalBody modalBodySpaced" },
      h("div", { className: "text-h2" }, routine.title),
      h("div", { className: "text-muted" }, "Isso apaga o hábito e os registros de conclusão deste dispositivo.")
    );

    const footer = h("div", { className: "modalFooter" });
    const cancelBtn = h("button", { className: "btn btnGhost", type: "button" }, "Cancelar");
    const deleteBtn = h("button", { className: "btn btnDangerPrimary", type: "button" }, "Apagar");
    footer.append(cancelBtn, deleteBtn);

    modal.append(body, footer);
    const { close } = mountOverlay(modal);
    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);

    deleteBtn.addEventListener("click", () => {
      deleteRoutine(routineId);
      closeOverlay();
      toast("Apagado.", "O hábito foi removido.");
      render();
    });
  }

  function upsertRoutine(routine) {
    const next = deepClone(state.store);
    const idx = next.routines.findIndex((r) => r.id === routine.id);
    if (idx >= 0) next.routines[idx] = routine;
    else next.routines.unshift(routine);
    next.routines.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    state.store = next;
    saveStore(state.store);
  }

  function renameRoutineSubtask(routineId, subtaskId, title) {
    const nextTitle = normalizeTitle(title);
    if (!nextTitle) return;

    const next = deepClone(state.store);
    const idx = next.routines.findIndex((r) => r.id === routineId);
    if (idx < 0) return;

    const routine = next.routines[idx];
    const subtasks = Array.isArray(routine.subtasks) ? routine.subtasks : [];
    const stIdx = subtasks.findIndex((st) => st && st.id === subtaskId);
    if (stIdx < 0) return;
    if (subtasks[stIdx].title === nextTitle) return;

    const nextRoutine = {
      ...routine,
      subtasks: subtasks.map((st, i) => (i === stIdx ? { ...st, title: nextTitle } : st)),
      updatedAt: Date.now(),
    };
    next.routines[idx] = nextRoutine;
    state.store = next;
    saveStore(state.store);
  }

  function deleteRoutine(routineId) {
    const next = deepClone(state.store);
    next.routines = next.routines.filter((r) => r.id !== routineId);
    for (const dateKey of Object.keys(next.completions ?? {})) {
      if (next.completions?.[dateKey]?.[routineId]) delete next.completions[dateKey][routineId];
      if (next.completions?.[dateKey] && Object.keys(next.completions[dateKey]).length === 0) {
        delete next.completions[dateKey];
      }
    }
    state.store = next;
    saveStore(state.store);
  }

  function ensureCompletion(dateKey, routineId) {
    const map = state.store.completions ?? {};
    const day = map[dateKey] ?? {};
    const current = day[routineId];
    if (current) return current;
    const created = { status: "pending", done: false, subtasks: {}, updatedAt: Date.now() };
    const next = deepClone(state.store);
    if (!next.completions) next.completions = {};
    if (!next.completions[dateKey]) next.completions[dateKey] = {};
    next.completions[dateKey][routineId] = created;
    state.store = next;
    saveStore(state.store);
    return created;
  }

  function computeRoutineStatus(routine, completion) {
    if (!completion) return "pending";
    const status = String(completion.status ?? "").toLowerCase();
    if (status === "skipped") return "skipped";
    const subtasks = routine.subtasks ?? [];
    if (subtasks.length) {
      const done = subtasks.every((st) => Boolean(completion.subtasks?.[st.id]));
      return done ? "done" : "pending";
    }
    return Boolean(completion.done) || status === "done" ? "done" : "pending";
  }

  function setRoutineDone(dateKey, routine, done) {
    const next = deepClone(state.store);
    if (!next.completions) next.completions = {};
    if (!next.completions[dateKey]) next.completions[dateKey] = {};
    const prev = next.completions[dateKey][routine.id] ?? { status: "pending", done: false, subtasks: {}, updatedAt: Date.now() };
    const subtasks = routine.subtasks ?? [];
    const newSubtasks = { ...(prev.subtasks ?? {}) };
    for (const st of subtasks) newSubtasks[st.id] = done;
    next.completions[dateKey][routine.id] = { status: done ? "done" : "pending", done, subtasks: newSubtasks, updatedAt: Date.now() };
    state.store = next;
    saveStore(state.store);
  }

  function setRoutineSkipped(dateKey, routine, skipped) {
    const next = deepClone(state.store);
    if (!next.completions) next.completions = {};
    if (!next.completions[dateKey]) next.completions[dateKey] = {};
    const prev = next.completions[dateKey][routine.id] ?? { status: "pending", done: false, subtasks: {}, updatedAt: Date.now() };
    const subtasks = routine.subtasks ?? [];
    const newSubtasks = { ...(prev.subtasks ?? {}) };
    for (const st of subtasks) newSubtasks[st.id] = false;
    next.completions[dateKey][routine.id] = {
      status: skipped ? "skipped" : "pending",
      done: false,
      subtasks: newSubtasks,
      updatedAt: Date.now(),
    };
    state.store = next;
    saveStore(state.store);
  }

  function toggleSubtask(dateKey, routine, subtaskId) {
    const next = deepClone(state.store);
    if (!next.completions) next.completions = {};
    if (!next.completions[dateKey]) next.completions[dateKey] = {};
    const prev = next.completions[dateKey][routine.id] ?? { status: "pending", done: false, subtasks: {}, updatedAt: Date.now() };
    const subtasks = { ...(prev.subtasks ?? {}) };
    subtasks[subtaskId] = !Boolean(subtasks[subtaskId]);
    const allDone = (routine.subtasks ?? []).every((st) => Boolean(subtasks[st.id]));
    next.completions[dateKey][routine.id] = { status: allDone ? "done" : "pending", done: allDone, subtasks, updatedAt: Date.now() };
    state.store = next;
    saveStore(state.store);
  }

  function computeTodayStats(dateKey, todayRoutines) {
    let total = 0;
    let done = 0;
    let skipped = 0;
    for (const r of todayRoutines) {
      total += 1;
      const completion = state.store.completions?.[dateKey]?.[r.id] ?? null;
      const status = computeRoutineStatus(r, completion);
      if (status === "done") done += 1;
      if (status === "skipped") skipped += 1;
    }
    return { total, done, skipped };
  }

  function computeWeekStats(today) {
    const weekStart = startOfWeekMonday(today);
    const daysElapsed = diffDays(weekStart, today) + 1;
    let planned = 0;
    let done = 0;
    let skipped = 0;
    let dedicatedDays = 0;

    for (let i = 0; i < daysElapsed; i += 1) {
      const date = addDays(weekStart, i);
      const dateKey = toDateKey(date);
      const dayIndex = date.getDay();
      const dayRoutines = state.store.routines.filter((r) => (r.days ?? []).includes(dayIndex));

      planned += dayRoutines.length;
      let doneThisDay = 0;
      for (const r of dayRoutines) {
        const completion = state.store.completions?.[dateKey]?.[r.id] ?? null;
        const status = computeRoutineStatus(r, completion);
        if (status === "done") done += 1;
        if (status === "skipped") skipped += 1;
        if (status === "done") doneThisDay += 1;
      }
      if (doneThisDay) dedicatedDays += 1;
    }

    const scorePct = planned ? Math.round((done / planned) * 100) : 0;
    return { planned, done, skipped, dedicatedDays, daysElapsed, scorePct };
  }

  function startOfWeekMonday(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = (day + 6) % 7;
    return addDays(d, -diff);
  }

  function addDays(date, amount) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + amount);
    return d;
  }

  function diffDays(a, b) {
    const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    return Math.floor(ms / 86400000);
  }

  function cleanRoutineDraft(draft) {
    const title = normalizeTitle(draft.title);
    if (!title) return null;
    const days = uniqueNumbers((draft.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)).sort((a, b) => a - b);
    const subtasks = (draft.subtasks ?? [])
      .map((st) => ({ id: st.id || randomId(), title: normalizeTitle(st.title) }))
      .filter((st) => st.title);
    return {
      id: draft.id || randomId(),
      title,
      days,
      subtasks,
      createdAt: draft.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
  }

  function loadStore() {
    const empty = { version: 2, routines: [], completions: {}, kanban: defaultKanban() };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return empty;

      if (parsed.version === 1) {
        return {
          version: 2,
          routines: Array.isArray(parsed.routines) ? parsed.routines : [],
          completions: parsed.completions && typeof parsed.completions === "object" ? parsed.completions : {},
          kanban: defaultKanban(),
        };
      }

      if (parsed.version !== 2) return empty;

      return {
        version: 2,
        routines: Array.isArray(parsed.routines) ? parsed.routines : [],
        completions: parsed.completions && typeof parsed.completions === "object" ? parsed.completions : {},
        kanban: normalizeKanban(parsed.kanban),
      };
    } catch {
      return empty;
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      toast("Sem espaço no navegador.", "Não foi possível salvar.");
    }
  }

  function defaultKanban() {
    return {
      version: 1,
      columns: [
        { id: "backlog", title: "Ideias", wipLimit: 0, cardIds: [] },
        { id: "doing", title: "Em andamento", wipLimit: 3, cardIds: [] },
        { id: "done", title: "Concluído", wipLimit: 0, cardIds: [] },
      ],
      cards: {},
      updatedAt: Date.now(),
    };
  }

  function normalizeKanban(input) {
    const fallback = defaultKanban();
    if (!input || typeof input !== "object") return fallback;
    if (input.version !== 1) return fallback;

    const columns = Array.isArray(input.columns) ? input.columns : fallback.columns;
    const cards = input.cards && typeof input.cards === "object" ? input.cards : {};

    const cleanedCols = [];
    for (const c of columns) {
      if (!c || typeof c !== "object") continue;
      const id = String(c.id || "").trim();
      const title = normalizeTitle(c.title) || "Coluna";
      if (!id) continue;
      const wipLimit = Number.isFinite(c.wipLimit) ? Math.max(0, Math.floor(c.wipLimit)) : 0;
      const cardIds = Array.isArray(c.cardIds) ? c.cardIds.map((x) => String(x)).filter(Boolean) : [];
      cleanedCols.push({ id, title, wipLimit, cardIds });
    }
    if (!cleanedCols.length) return fallback;

    const cleanedCards = {};
    for (const [id, v] of Object.entries(cards)) {
      if (!v || typeof v !== "object") continue;
      const title = normalizeTitle(v.title);
      if (!title) continue;
      cleanedCards[String(id)] = {
        id: String(id),
        title,
        color: String(v.color || "neutral"),
        createdAt: Number.isFinite(v.createdAt) ? v.createdAt : Date.now(),
        updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : Date.now(),
      };
    }

    for (const col of cleanedCols) {
      col.cardIds = col.cardIds.filter((cid) => Boolean(cleanedCards[cid]));
    }

    return {
      version: 1,
      columns: cleanedCols,
      cards: cleanedCards,
      updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
    };
  }

  function loadPomodoro() {
    const fallback = {
      version: 3,
      mode: "focus",
      focusSec: 25 * 60,
      breakSec: 5 * 60,
      remainingSec: 25 * 60,
      running: false,
      endAt: null,
    };
    try {
      const raw = localStorage.getItem(POMODORO_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return fallback;
      if (parsed.version === 1) {
        const durationSec = Number.isFinite(parsed.durationSec) ? Math.max(60, Math.floor(parsed.durationSec)) : fallback.focusSec;
        const running = Boolean(parsed.running);
        const endAt = Number.isFinite(parsed.endAt) ? Math.floor(parsed.endAt) : null;
        const remainingSec = Number.isFinite(parsed.remainingSec) ? Math.max(0, Math.floor(parsed.remainingSec)) : durationSec;
        const rem = running && endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : Math.min(remainingSec, durationSec);
        return {
          ...fallback,
          mode: "focus",
          focusSec: durationSec,
          remainingSec: rem,
          running: running && rem > 0,
          endAt: running && rem > 0 ? endAt : null,
        };
      }

      if (parsed.version === 2) {
        const focusSec = Number.isFinite(parsed.focusSec) ? Math.max(60, Math.floor(parsed.focusSec)) : fallback.focusSec;
        const breakSec = Number.isFinite(parsed.breakSec) ? Math.max(60, Math.floor(parsed.breakSec)) : fallback.breakSec;
        const rawMode = normalizePomodoroMode(parsed.mode);
        const mode = rawMode === "break" ? "break" : "focus";

        const running = Boolean(parsed.running);
        const endAt = Number.isFinite(parsed.endAt) ? Math.floor(parsed.endAt) : null;
        const remainingSecFallback = mode === "break" ? breakSec : focusSec;
        const remainingSec = Number.isFinite(parsed.remainingSec) ? Math.max(0, Math.floor(parsed.remainingSec)) : remainingSecFallback;

        if (running && endAt) {
          const rem = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
          return {
            ...fallback,
            focusSec,
            breakSec,
            mode,
            remainingSec: rem,
            running: rem > 0,
            endAt: rem > 0 ? endAt : null,
          };
        }

        const maxSeg = mode === "break" ? breakSec : focusSec;
        return {
          ...fallback,
          focusSec,
          breakSec,
          mode,
          remainingSec: Math.min(remainingSec, maxSeg),
          running: false,
          endAt: null,
        };
      }

      if (parsed.version !== 3) return fallback;

      const mode = normalizePomodoroMode(parsed.mode);
      const focusSec = Number.isFinite(parsed.focusSec) ? Math.max(60, Math.floor(parsed.focusSec)) : fallback.focusSec;
      const breakSec = Number.isFinite(parsed.breakSec) ? Math.max(60, Math.floor(parsed.breakSec)) : fallback.breakSec;
      const running = Boolean(parsed.running);
      const endAt = Number.isFinite(parsed.endAt) ? Math.floor(parsed.endAt) : null;
      const maxSeg = mode === "break" ? breakSec : focusSec;
      const remainingSec = Number.isFinite(parsed.remainingSec) ? Math.min(maxSeg, Math.max(0, Math.floor(parsed.remainingSec))) : maxSeg;

      if (running && endAt) {
        const rem = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
        return {
          version: 3,
          mode,
          focusSec,
          breakSec,
          remainingSec: rem,
          running: rem > 0,
          endAt: rem > 0 ? endAt : null,
        };
      }

      return { version: 3, mode, focusSec, breakSec, remainingSec, running: false, endAt: null };
    } catch {
      return fallback;
    }
  }

  function savePomodoro(pomodoro) {
    try {
      localStorage.setItem(POMODORO_KEY, JSON.stringify(pomodoro));
    } catch {
      toast("Sem espaço no navegador.", "Não foi possível salvar o timer neste dispositivo.");
    }
  }

  function startPomodoroTicker() {
    if (state.timers.pomodoro) return;
    state.timers.pomodoro = window.setInterval(() => {
      if (!state.pomodoro.running) return;
      const remaining = getPomodoroRemainingSec();
      if (remaining <= 0) {
        handlePomodoroFinish();
      }
      if (state.route === "pomodoro") render();
    }, 250);
  }

  function getPomodoroRemainingSec() {
    const p = state.pomodoro;
    if (p.running && p.endAt) return Math.max(0, Math.ceil((p.endAt - Date.now()) / 1000));
    return Math.max(0, Math.floor(p.remainingSec ?? 0));
  }

  function startPomodoro() {
    const p = state.pomodoro;
    let remaining = getPomodoroRemainingSec();
    if (remaining === 0) remaining = getSegmentDuration(p);
    p.running = true;
    p.endAt = Date.now() + remaining * 1000;
    p.remainingSec = remaining;
    savePomodoro(p);
  }

  function pausePomodoro() {
    const p = state.pomodoro;
    const remaining = getPomodoroRemainingSec();
    p.running = false;
    p.endAt = null;
    p.remainingSec = remaining;
    savePomodoro(p);
  }

  function resetPomodoro() {
    const p = state.pomodoro;
    p.running = false;
    p.endAt = null;
    p.remainingSec = getSegmentDuration(p);
    savePomodoro(p);
  }

  function setPomodoroMode(mode) {
    const p = state.pomodoro;
    p.mode = normalizePomodoroMode(mode);
    p.running = false;
    p.endAt = null;
    p.remainingSec = getSegmentDuration(p);
    savePomodoro(p);
  }

  function setPomodoroFocusDuration(durationSec) {
    const p = state.pomodoro;
    p.focusSec = Math.max(60, Math.floor(durationSec));
    p.running = false;
    p.endAt = null;
    if (p.mode === "focus") p.remainingSec = p.focusSec;
    savePomodoro(p);
  }

  function setPomodoroBreakDuration(durationSec) {
    const p = state.pomodoro;
    p.breakSec = Math.max(60, Math.floor(durationSec));
    p.running = false;
    p.endAt = null;
    if (p.mode === "break") p.remainingSec = p.breakSec;
    savePomodoro(p);
  }

  function handlePomodoroFinish() {
    const p = state.pomodoro;
    p.running = false;
    p.endAt = null;
    p.remainingSec = 0;

    p.mode = p.mode === "focus" ? "break" : "focus";
    p.remainingSec = getSegmentDuration(p);
    savePomodoro(p);
    toast("Tempo acabou.", `Próximo: ${pomodoroModeLabel(p.mode)}.`);
  }

  function getSegmentDuration(p) {
    if (p.mode === "break") return p.breakSec;
    return p.focusSec;
  }

  function normalizePomodoroMode(mode) {
    const m = String(mode ?? "").toLowerCase();
    if (m === "break") return "break";
    return "focus";
  }

  function pomodoroModeLabel(mode) {
    if (mode === "break") return "Pausa";
    return "Foco";
  }

  function formatClock(totalSec) {
    const clamped = Math.max(0, Math.floor(totalSec));
    const mm = String(Math.floor(clamped / 60)).padStart(2, "0");
    const ss = String(clamped % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function closeOverlay() {
    const root = el.overlayRoot();
    if (!root) return;
    root.replaceChildren();
    root.setAttribute("aria-hidden", "true");
  }

  function createModalShell(title, modalClassName = "modal") {
    const modal = h("div", { className: modalClassName, role: "dialog", "aria-modal": "true" });
    const header = h("div", { className: "modalHeader" });
    header.append(h("div", { className: "modalTitle" }, title));
    const closeBtn = h("button", { className: "iconBtn", type: "button", "aria-label": "Fechar" }, "×");
    header.append(closeBtn);
    modal.append(header);
    return { modal, closeBtn };
  }

  function mountOverlay(modal, { initialFocus } = {}) {
    const root = el.overlayRoot();
    const overlay = h("div", { className: "overlay", role: "presentation" });
    overlay.append(modal);

    if (!root) return { overlay, close: () => {} };
    root.replaceChildren(overlay);
    root.setAttribute("aria-hidden", "false");

    const close = () => closeOverlay();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        close();
      },
      { once: true }
    );

    if (initialFocus && typeof initialFocus.focus === "function") initialFocus.focus();
    return { overlay, close };
  }

  function toast(title, message) {
    const root = el.toastRoot();
    if (!root) return;
    const t = h("div", { className: "toast" });
    const top = h("div", { className: "toastTop" });
    top.append(h("div", { className: "toastTitle" }, title));
    const closeBtn = h("button", { className: "iconBtn", type: "button", "aria-label": "Fechar" }, "×");
    top.append(closeBtn);
    const body = h("div", { className: "toastBody" }, message);
    t.append(top, body);
    root.append(t);

    const kill = () => {
      if (!t.isConnected) return;
      t.remove();
    };
    closeBtn.addEventListener("click", kill);
    window.setTimeout(kill, 3200);
  }

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs && typeof attrs === "object") {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null) continue;
        if (k === "className") node.className = String(v);
        else if (k === "style" && v && typeof v === "object") Object.assign(node.style, v);
        else if (k === "value" && "value" in node) node.value = String(v);
        else if (k === "href" || k === "src") {
          const raw = String(v);
          const normalized = raw.replace(/[\u0000-\u001F\u007F\s]+/g, "").toLowerCase();
          if (normalized.startsWith("javascript:")) continue;
          if (k === "href" && normalized.startsWith("data:")) continue;
          if (k === "src" && normalized.startsWith("data:") && !normalized.startsWith("data:image/")) continue;
          node.setAttribute(k, raw);
        } else if (k === "innerHTML" || k === "outerHTML" || k === "srcdoc") {
          continue;
        } else if (k.startsWith("aria-") || k.startsWith("data-") || k === "role" || k === "type" || k === "placeholder" || k === "autocomplete") {
          node.setAttribute(k, String(v));
        } else {
          node[k] = v;
        }
      }
    }
    for (const c of children.flat()) {
      if (c === undefined || c === null) continue;
      node.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function randomId() {
    return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  }

  function normalizeTitle(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  }

  function toggleInArray(arr, value) {
    const next = Array.isArray(arr) ? [...arr] : [];
    const idx = next.indexOf(value);
    if (idx >= 0) next.splice(idx, 1);
    else next.push(value);
    return next;
  }

  function uniqueNumbers(arr) {
    return Array.from(new Set(arr)).filter((n) => typeof n === "number" && Number.isFinite(n));
  }

  function formatDaysShort(days) {
    const labels = (days ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => Days.find((x) => x.key === d)?.label)
      .filter(Boolean);
    return labels.join(", ");
  }

  function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function trashIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.style.display = "block";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M9 3h6m-7 4h8m-9 0 1 14h8l1-14M10 11v7m4-7v7"
    );
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");

    svg.appendChild(path);
    return svg;
  }
})();
