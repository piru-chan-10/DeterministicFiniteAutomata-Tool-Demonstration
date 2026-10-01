/* ============================================================
   DFA EDITOR — script.js
   ============================================================
   This file implements the complete logic for the visual DFA
   (Deterministic Finite Automaton) editor.

   Architecture overview
   ---------------------
   1. STATE (Data Model)
      - `states`      : Map  id → { id, label, x, y, initial, accepting }
      - `transitions` : Map  id → { id, from, to, symbols[] }
      - `mode`        : current editor mode string
      - `simulation`  : object holding the live sim state

   2. RENDERING
      - `renderAll()`   re-draws every node and edge on the SVG
      - `renderNode()`  draws one state <g> element
      - `renderEdge()`  draws one transition <g> element
      - Renders are full redraws (simple & correct for this scale)

   3. INTERACTION
      - Canvas click    → add state / start/end transition / deselect
      - Node click      → select / begin transition target
      - Node dblclick   → open state-edit modal
      - Node mousedown  → begin drag (select mode only)
      - Edge click      → select / delete
      - Keyboard        → S / A / T / D for mode shortcuts; Delete key

   4. MODALS
      - Transition symbol modal  (#modal-overlay)
      - State properties modal   (#modal-state-overlay)

   5. SIMULATION
      - `runSimulation()`  full run on the input string
      - `stepSimulation()` advance one symbol at a time

   6. IMPORT / EXPORT
      - Export serialises the data model to JSON and triggers download
      - Import reads a JSON file and rehydrates the data model

   Table of contents (by section marker):
     §1  Data model & global variables
     §2  DOM references
     §3  Utility helpers
     §4  Data-model mutators (addState, addTransition, remove…)
     §5  SVG rendering
     §6  Sidebar UI updaters
     §7  Canvas event handlers
     §8  Mode management
     §9  Drag-to-move logic
     §10 Transition creation flow
     §11 State edit modal
     §12 Transition label modal
     §13 Simulation engine
     §14 Import / Export
     §15 Keyboard shortcuts
     §16 Bootstrap / init
   ============================================================ */


/* ============================================================
   §1  DATA MODEL & GLOBAL VARIABLES
   ============================================================ */

/**
 * Counter used to generate unique IDs for states.
 * Each new state gets id = "s" + stateCounter++
 */
let stateCounter = 0;

/**
 * Counter used to generate unique IDs for transitions.
 */
let transCounter = 0;

/**
 * Map<string, StateObject> — the collection of all DFA states.
 *
 * StateObject shape:
 *   {
 *     id:        string   — unique identifier e.g. "s0"
 *     label:     string   — displayed label e.g. "q0"
 *     x:         number   — SVG cx coordinate
 *     y:         number   — SVG cy coordinate
 *     initial:   boolean  — true if this is the DFA's start state
 *     accepting: boolean  — true if this is a final / accepting state
 *   }
 */
const states = new Map();

/**
 * Map<string, TransitionObject> — all DFA transitions.
 *
 * TransitionObject shape:
 *   {
 *     id:      string    — unique identifier e.g. "t0"
 *     from:    string    — state id of the source state
 *     to:      string    — state id of the target state
 *     symbols: string[]  — array of input symbols that trigger this edge
 *   }
 */
const transitions = new Map();

/**
 * The currently active editor mode. One of:
 *   "select"         — click to select/move states
 *   "add-state"      — click canvas to place new states
 *   "add-transition" — click source then target to draw an arrow
 *   "delete"         — click a node/edge to remove it
 */
let mode = "select";

/**
 * The currently selected state/transition id (in select mode).
 * null when nothing is selected.
 */
let selectedId = null;

/**
 * Radius of state circles in SVG user units (pixels).
 */
const STATE_RADIUS = 28;

/**
 * Holds state during transition creation (add-transition mode).
 * sourceStateId: id of the first-clicked state
 * tempLine:      the <line> element showing the rubber-band
 */
const transCreation = {
  sourceStateId: null,
  active: false
};

/**
 * Drag state — tracks mousedown + mousemove for node dragging.
 */
const drag = {
  active: false,
  stateId: null,
  startMouseX: 0,
  startMouseY: 0,
  startStateX: 0,
  startStateY: 0
};

/**
 * Simulation state object.
 *   inputStr      : full string being tested
 *   currentIndex  : index of next character to consume
 *   currentState  : id of the current DFA state
 *   running       : true while a step-simulation is in progress
 */
const simulation = {
  inputStr: "",
  currentIndex: 0,
  currentState: null,
  running: false
};


/* ============================================================
   §2  DOM REFERENCES
   Cache all frequently-accessed DOM elements at startup.
   ============================================================ */

const svgCanvas    = document.getElementById("dfa-canvas");
const edgesLayer   = document.getElementById("edges-layer");
const nodesLayer   = document.getElementById("nodes-layer");
const tempLine     = document.getElementById("temp-line");

/* Sidebar lists and badges */
const statesList         = document.getElementById("states-list");
const transitionsList    = document.getElementById("transitions-list");
const badgeStates        = document.getElementById("badge-states");
const badgeTransitions   = document.getElementById("badge-transitions");
const alphabetDisplay    = document.getElementById("alphabet-display");

/* Toolbar mode buttons */
const modeButtons = document.querySelectorAll(".btn-tool[data-mode]");

/* Action buttons */
const btnExport  = document.getElementById("btn-export");
const btnImport  = document.getElementById("btn-import");
const importFile = document.getElementById("import-file-input");
const btnClear   = document.getElementById("btn-clear");

/* Status bar */
const statusHint = document.getElementById("status-hint");
const statusMode = document.getElementById("status-mode");

/* Simulation controls */
const simInput    = document.getElementById("sim-input");
const btnSimulate = document.getElementById("btn-simulate");
const btnStep     = document.getElementById("btn-step");
const btnResetSim = document.getElementById("btn-reset-sim");
const simResult   = document.getElementById("sim-result");
const simTrace    = document.getElementById("sim-trace");

/* Transition modal */
const modalOverlay  = document.getElementById("modal-overlay");
const modalSymbol   = document.getElementById("modal-symbol");
const modalConfirm  = document.getElementById("modal-confirm");
const modalCancel   = document.getElementById("modal-cancel");
const modalDesc     = document.getElementById("modal-desc");

/* State-edit modal */
const modalStateOverlay   = document.getElementById("modal-state-overlay");
const modalStateName      = document.getElementById("modal-state-name");
const modalStateInitial   = document.getElementById("modal-state-initial");
const modalStateAccepting = document.getElementById("modal-state-accepting");
const modalStateConfirm   = document.getElementById("modal-state-confirm");
const modalStateCancel    = document.getElementById("modal-state-cancel");

/* Toast */
const toast = document.getElementById("toast");


/* ============================================================
   §3  UTILITY HELPERS
   ============================================================ */

/**
 * Show a brief toast notification message at the bottom-right.
 * @param {string} message  — text to display
 * @param {number} duration — ms before it disappears (default 2500)
 */
function showToast(message, duration = 2500) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  /* Force reflow so the CSS transition fires from the start */
  toast.offsetHeight; // eslint-disable-line no-unused-expressions
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    /* Hide after the CSS transition completes */
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, duration);
}

/**
 * Create an SVG element with the given tag name and attributes.
 * @param {string} tag      — SVG element tag (e.g. "circle", "text")
 * @param {Object} attrs    — key-value attribute pairs
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * Return the SVG-coordinate position of a mouse event.
 * Accounts for the SVG element's bounding rect offset.
 * @param {MouseEvent} e
 * @returns {{ x: number, y: number }}
 */
function svgPoint(e) {
  const rect = svgCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

/**
 * Compute the angle (radians) from point A to point B.
 */
function angle(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

/**
 * Compute the Euclidean distance between two points.
 */
function dist(ax, ay, bx, by) {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

/**
 * Generate a unique state id.
 */
function nextStateId() { return `s${stateCounter++}`; }

/**
 * Generate a unique transition id.
 */
function nextTransId()  { return `t${transCounter++}`; }

/**
 * Collect all unique symbols used across all transitions.
 * @returns {string[]} sorted array of symbols
 */
function computeAlphabet() {
  const symbols = new Set();
  for (const t of transitions.values()) {
    t.symbols.forEach(s => symbols.add(s));
  }
  return [...symbols].sort();
}

/**
 * Find an existing transition between two states (regardless of direction).
 * Used to detect duplicate edges and allow editing them.
 * @param {string} fromId
 * @param {string} toId
 * @returns {TransitionObject|undefined}
 */
function findTransition(fromId, toId) {
  for (const t of transitions.values()) {
    if (t.from === fromId && t.to === toId) return t;
  }
  return undefined;
}

/**
 * Find the opposite transition (toId → fromId) for self-loop offset detection.
 */
function hasReverseTransition(fromId, toId) {
  for (const t of transitions.values()) {
    if (t.from === toId && t.to === fromId) return true;
  }
  return false;
}


/* ============================================================
   §4  DATA-MODEL MUTATORS
   Functions that modify the `states` and `transitions` Maps
   and then trigger a re-render.
   ============================================================ */

/**
 * Create a new state at the given SVG coordinates.
 * The label is auto-generated as q0, q1, q2, …
 * The first state added is automatically set as initial.
 * @param {number} x — SVG x coordinate
 * @param {number} y — SVG y coordinate
 * @returns {StateObject} the newly created state
 */
function addState(x, y) {
  const id    = nextStateId();
  const label = `q${states.size}`;         /* q0, q1, q2 … */
  const isFirst = states.size === 0;        /* first state becomes initial */

  const state = { id, label, x, y, initial: isFirst, accepting: false };
  states.set(id, state);

  renderAll();
  updateSidebar();
  showToast(`State "${label}" added`);
  return state;
}

/**
 * Remove a state and all transitions that reference it.
 * @param {string} id — state id to delete
 */
function removeState(id) {
  const state = states.get(id);
  if (!state) return;

  /* Delete all transitions connected to this state */
  for (const [tid, t] of transitions) {
    if (t.from === id || t.to === id) {
      transitions.delete(tid);
    }
  }

  /* If this was the initial state, promote the first remaining state */
  if (state.initial && states.size > 1) {
    const remaining = [...states.values()].filter(s => s.id !== id);
    if (remaining.length > 0) remaining[0].initial = true;
  }

  states.delete(id);
  if (selectedId === id) selectedId = null;

  renderAll();
  updateSidebar();
  showToast(`State "${state.label}" deleted`);
}

/**
 * Add a transition (or update an existing one by appending symbols).
 * DFA semantics: we allow multiple symbols on one edge but enforce
 * that from each state, each symbol leads to exactly one target.
 *
 * @param {string}   fromId  — source state id
 * @param {string}   toId    — target state id
 * @param {string[]} symbols — list of input symbols
 */
function addTransition(fromId, toId, symbols) {
  /* Check for existing edge between the same pair */
  const existing = findTransition(fromId, toId);

  if (existing) {
    /* Merge symbols, avoiding duplicates */
    const merged = [...new Set([...existing.symbols, ...symbols])];
    existing.symbols = merged;
    showToast(`Transition updated: ${merged.join(",")}`);
  } else {
    const id = nextTransId();
    transitions.set(id, { id, from: fromId, to: toId, symbols: [...symbols] });
    showToast(`Transition added: ${symbols.join(",")}`);
  }

  renderAll();
  updateSidebar();
}

/**
 * Remove a transition by its id.
 * @param {string} id — transition id
 */
function removeTransition(id) {
  const t = transitions.get(id);
  if (!t) return;
  const fromLabel = states.get(t.from)?.label ?? t.from;
  const toLabel   = states.get(t.to)?.label   ?? t.to;
  transitions.delete(id);
  renderAll();
  updateSidebar();
  showToast(`Transition ${fromLabel}→${toLabel} deleted`);
}

/**
 * Clear the entire diagram (states + transitions).
 */
function clearAll() {
  states.clear();
  transitions.clear();
  stateCounter = 0;
  transCounter = 0;
  selectedId   = null;
  resetSimulation();
  renderAll();
  updateSidebar();
  showToast("Canvas cleared");
}


/* ============================================================
   §5  SVG RENDERING
   Full re-render approach: clear the two SVG layers and redraw
   every state and transition from scratch.
   ============================================================ */

/**
 * Re-render everything on the SVG canvas.
 * Called after any model mutation.
 */
function renderAll() {
  /* Clear existing SVG children from both layers */
  edgesLayer.innerHTML = "";
  nodesLayer.innerHTML = "";

  /* Draw transitions first (they go behind nodes) */
  for (const t of transitions.values()) {
    renderEdge(t);
  }

  /* Draw states on top */
  for (const s of states.values()) {
    renderNode(s);
  }
}

/**
 * Render a single state as an SVG <g class="node"> element.
 * Structure:
 *   <g class="node [selected] [accepting] [sim-active]" data-id="…">
 *     [<line> initial arrow]
 *     <circle class="state-circle" />
 *     <circle class="accept-ring" />   ← only for accepting states
 *     <text class="state-label" />
 *   </g>
 *
 * @param {StateObject} state
 */
function renderNode(state) {
  const g = svgEl("g", { "data-id": state.id, "data-type": "state" });
  g.classList.add("node");
  if (state.accepting)          g.classList.add("accepting");
  if (state.id === selectedId)  g.classList.add("selected");
  /* sim-active class is added by simulateStep(), not here */

  /* ── Initial state arrow ────────────────────────── */
  if (state.initial) {
    /* Draw a short horizontal arrow pointing into the state from the left */
    const arrowLen  = 30;
    const arrowX1   = state.x - STATE_RADIUS - arrowLen;
    const arrowX2   = state.x - STATE_RADIUS - 2;  /* stop just before circle edge */
    const arrowY    = state.y;

    const initLine = svgEl("line", {
      x1: arrowX1, y1: arrowY,
      x2: arrowX2, y2: arrowY,
      "class": "initial-arrow",
      "marker-end": "url(#arrowhead)"
    });
    g.appendChild(initLine);

    /* Small "start" label above the arrow */
    const startLabel = svgEl("text", {
      x: arrowX1 + arrowLen / 2,
      y: arrowY - 8,
      "class": "edge-label",
      "style": "font-size:10px;fill:#fbbf24;"
    });
    startLabel.textContent = "start";
    g.appendChild(startLabel);
  }

  /* ── Main circle ────────────────────────────────── */
  const circle = svgEl("circle", {
    cx: state.x,
    cy: state.y,
    r:  STATE_RADIUS,
    "class": "state-circle"
  });
  g.appendChild(circle);

  /* ── Accept ring (inner double circle) ──────────── */
  const acceptRing = svgEl("circle", {
    cx: state.x,
    cy: state.y,
    r:  STATE_RADIUS - 6,
    "class": "accept-ring"
  });
  g.appendChild(acceptRing);

  /* ── State label ────────────────────────────────── */
  const label = svgEl("text", {
    x: state.x,
    y: state.y,
    "class": "state-label"
  });
  label.textContent = state.label;
  g.appendChild(label);

  /* ── Event listeners on the node group ─────────── */
  g.addEventListener("click",      (e) => onNodeClick(e, state.id));
  g.addEventListener("dblclick",   (e) => onNodeDblClick(e, state.id));
  g.addEventListener("mousedown",  (e) => onNodeMouseDown(e, state.id));
  g.addEventListener("mouseover",  ()  => onNodeHover(state.id, true));
  g.addEventListener("mouseout",   ()  => onNodeHover(state.id, false));

  nodesLayer.appendChild(g);
}

/**
 * Render a single transition as an SVG <g class="edge"> element.
 * Structure:
 *   <g class="edge" data-id="…">
 *     <path class="edge-path" />   ← the arrow curve/line
 *     <text class="edge-label" />  ← symbol label
 *   </g>
 *
 * Handles three geometric cases:
 *   a) Self-loop  (from === to)          → arc above the state
 *   b) Bidirectional (A→B and B→A exist) → curved arc
 *   c) One-way                           → straight line
 *
 * @param {TransitionObject} t
 */
function renderEdge(t) {
  const fromState = states.get(t.from);
  const toState   = states.get(t.to);
  if (!fromState || !toState) return;   /* safety: skip orphaned transitions */

  const g = svgEl("g", { "data-id": t.id, "data-type": "transition" });
  g.classList.add("edge");

  let pathEl, labelEl;
  const symbolText = t.symbols.join(", ");

  if (t.from === t.to) {
    /* ── Case (a): Self-loop ───────────────────────── */
    const { path, labelX, labelY } = makeSelfLoop(fromState);
    pathEl = svgEl("path", { d: path, "class": "edge-path" });
    labelEl = svgEl("text", {
      x: labelX, y: labelY,
      "class": "edge-label"
    });

  } else if (hasReverseTransition(t.from, t.to)) {
    /* ── Case (b): Bidirectional — use a curved arc ─── */
    const { path, labelX, labelY } = makeCurvedEdge(fromState, toState);
    pathEl = svgEl("path", { d: path, "class": "edge-path" });
    labelEl = svgEl("text", {
      x: labelX, y: labelY,
      "class": "edge-label"
    });

  } else {
    /* ── Case (c): Straight line ───────────────────── */
    const { path, labelX, labelY } = makeStraightEdge(fromState, toState);
    pathEl = svgEl("path", { d: path, "class": "edge-path" });
    labelEl = svgEl("text", {
      x: labelX, y: labelY,
      "class": "edge-label"
    });
  }

  labelEl.textContent = symbolText;

  /* Click on edge → select or delete */
  g.addEventListener("click", (e) => onEdgeClick(e, t.id));

  g.appendChild(pathEl);
  g.appendChild(labelEl);
  edgesLayer.appendChild(g);
}

/**
 * Build the SVG path string for a self-loop on a state.
 * Returns { path, labelX, labelY }.
 * The loop is drawn as a circular arc above the state circle.
 */
function makeSelfLoop(state) {
  const r  = STATE_RADIUS;
  const lx = state.x;
  const ly = state.y - r;       /* top of the state circle */

  /* Control points for the cubic bezier forming the loop */
  const cp1x = lx - 40, cp1y = ly - 60;
  const cp2x = lx + 40, cp2y = ly - 60;

  /* Start and end points sit on the top of the circle, slightly offset */
  const sx = lx - 10, sy = ly;
  const ex = lx + 10, ey = ly;

  const path = `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${ey}`;
  return { path, labelX: lx, labelY: ly - 68 };
}

/**
 * Build the SVG path string for a curved (bidirectional) edge.
 * The arc bows away from the straight line between the two states.
 * Returns { path, labelX, labelY }.
 */
function makeCurvedEdge(fromState, toState) {
  const r  = STATE_RADIUS;
  const a  = angle(fromState.x, fromState.y, toState.x, toState.y);

  /* Start point: edge of source circle */
  const sx = fromState.x + Math.cos(a) * r;
  const sy = fromState.y + Math.sin(a) * r;

  /* End point: edge of target circle (with a small offset for arrow) */
  const ex = toState.x - Math.cos(a) * (r + 2);
  const ey = toState.y - Math.sin(a) * (r + 2);

  /* Mid-point between start and end */
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;

  /* Perpendicular offset for the control point (bow the curve) */
  const perpAngle = a + Math.PI / 2;
  const bow = 40;
  const cpx = mx + Math.cos(perpAngle) * bow;
  const cpy = my + Math.sin(perpAngle) * bow;

  const path = `M ${sx} ${sy} Q ${cpx} ${cpy}, ${ex} ${ey}`;

  /* Label sits at the midpoint of the quadratic bezier */
  const labelX = 0.25 * sx + 0.5 * cpx + 0.25 * ex;
  const labelY = 0.25 * sy + 0.5 * cpy + 0.25 * ey - 8;

  return { path, labelX, labelY };
}

/**
 * Build the SVG path string for a straight directed edge.
 * Returns { path, labelX, labelY }.
 */
function makeStraightEdge(fromState, toState) {
  const r = STATE_RADIUS;
  const a = angle(fromState.x, fromState.y, toState.x, toState.y);

  /* Start at the edge of the source circle */
  const sx = fromState.x + Math.cos(a) * r;
  const sy = fromState.y + Math.sin(a) * r;

  /* End just before reaching the target circle (arrow tip lands on edge) */
  const ex = toState.x - Math.cos(a) * (r + 2);
  const ey = toState.y - Math.sin(a) * (r + 2);

  const path = `M ${sx} ${sy} L ${ex} ${ey}`;

  /* Label is centred along the line, slightly above it */
  const perpAngle = a - Math.PI / 2;
  const labelX = (sx + ex) / 2 + Math.cos(perpAngle) * 14;
  const labelY = (sy + ey) / 2 + Math.sin(perpAngle) * 14;

  return { path, labelX, labelY };
}


/* ============================================================
   §6  SIDEBAR UI UPDATERS
   Keep the sidebar lists and badges in sync with the data model.
   ============================================================ */

/**
 * Refresh the complete sidebar: states list, transitions list,
 * badge counters, and alphabet display.
 */
function updateSidebar() {
  updateStatesList();
  updateTransitionsList();
  updateAlphabet();
}

/**
 * Re-render the sidebar states list from the `states` Map.
 */
function updateStatesList() {
  statesList.innerHTML = "";
  badgeStates.textContent = states.size;

  for (const state of states.values()) {
    const li = document.createElement("li");
    li.className = "state-item";
    li.dataset.id = state.id;

    /* State name */
    const nameSpan = document.createElement("span");
    nameSpan.textContent = state.label;
    li.appendChild(nameSpan);

    /* Tag pills */
    const tags = document.createElement("span");
    tags.style.cssText = "display:flex;gap:4px;";
    if (state.initial)   tags.appendChild(makeTag("start",  "tag-initial"));
    if (state.accepting) tags.appendChild(makeTag("accept", "tag-accepting"));
    li.appendChild(tags);

    /* Clicking a state item in the sidebar highlights it on canvas */
    li.addEventListener("click", () => {
      selectedId = state.id;
      renderAll();
    });

    statesList.appendChild(li);
  }
}

/**
 * Re-render the sidebar transitions list from the `transitions` Map.
 */
function updateTransitionsList() {
  transitionsList.innerHTML = "";
  badgeTransitions.textContent = transitions.size;

  for (const t of transitions.values()) {
    const fromLabel = states.get(t.from)?.label ?? "?";
    const toLabel   = states.get(t.to)?.label   ?? "?";

    const li = document.createElement("li");
    li.className = "trans-item";
    li.dataset.id = t.id;
    li.textContent = `${fromLabel} → ${t.symbols.join(",")} → ${toLabel}`;

    transitionsList.appendChild(li);
  }
}

/**
 * Refresh the Alphabet Σ display.
 */
function updateAlphabet() {
  const alpha = computeAlphabet();
  alphabetDisplay.textContent = alpha.length ? `{ ${alpha.join(", ")} }` : "∅";
}

/**
 * Create a small <span> tag pill for state badges.
 * @param {string} text       — pill text
 * @param {string} cssClass   — tag CSS class
 * @returns {HTMLSpanElement}
 */
function makeTag(text, cssClass) {
  const span = document.createElement("span");
  span.className = `tag ${cssClass}`;
  span.textContent = text;
  return span;
}


/* ============================================================
   §7  CANVAS EVENT HANDLERS
   Handlers attached to the SVG canvas and its children.
   ============================================================ */

/**
 * Handle clicks on the blank SVG canvas (not on a node or edge).
 * Behaviour depends on the active mode:
 *   add-state:       create a new state at click position
 *   select:          deselect the currently selected element
 *   add-transition:  cancel any in-progress transition creation
 */
svgCanvas.addEventListener("click", (e) => {
  /* Only react if the click target is the SVG itself or a layer group,
     not a state/edge child element */
  const target = e.target;
  const isCanvas = target === svgCanvas
                || target === edgesLayer
                || target === nodesLayer;

  if (!isCanvas) return;

  if (mode === "add-state") {
    const { x, y } = svgPoint(e);
    addState(x, y);

  } else if (mode === "select") {
    /* Deselect */
    selectedId = null;
    renderAll();

  } else if (mode === "add-transition") {
    /* User clicked on empty canvas — cancel transition creation */
    cancelTransitionCreation();
  }
});

/**
 * Handle clicks on a state node group.
 * Behaviour depends on mode:
 *   select:          select the state (highlight it)
 *   add-transition:  if no source yet → set as source;
 *                    if source already set → open symbol modal
 *   delete:          remove the state
 *
 * @param {MouseEvent} e
 * @param {string}     stateId
 */
function onNodeClick(e, stateId) {
  e.stopPropagation();    /* prevent the canvas click handler from firing */

  if (mode === "select") {
    selectedId = stateId;
    renderAll();

  } else if (mode === "add-transition") {
    if (!transCreation.active) {
      /* First click — set source state */
      transCreation.sourceStateId = stateId;
      transCreation.active = true;

      /* Show the rubber-band temporary line from source to cursor */
      const src = states.get(stateId);
      showTempLine(src.x, src.y, src.x, src.y);

      showToast("Now click the target state");

    } else {
      /* Second click — complete transition creation */
      const targetStateId = stateId;
      openTransitionModal(transCreation.sourceStateId, targetStateId);
      cancelTransitionCreation();
    }

  } else if (mode === "delete") {
    removeState(stateId);
  }
}

/**
 * Handle double-click on a state — opens the state-edit modal.
 * @param {MouseEvent} e
 * @param {string}     stateId
 */
function onNodeDblClick(e, stateId) {
  e.stopPropagation();
  /* Only open in select mode; avoid conflicts with other modes */
  if (mode === "select" || mode === "add-state") {
    openStateModal(stateId);
  }
}

/**
 * Handle mousedown on a node — begins dragging in select mode.
 * @param {MouseEvent} e
 * @param {string}     stateId
 */
function onNodeMouseDown(e, stateId) {
  if (mode !== "select") return;
  e.stopPropagation();

  const state = states.get(stateId);
  drag.active     = true;
  drag.stateId    = stateId;
  drag.startMouseX = e.clientX;
  drag.startMouseY = e.clientY;
  drag.startStateX = state.x;
  drag.startStateY = state.y;
}

/**
 * Handle hover over a state — visual feedback hint.
 * @param {string}  stateId
 * @param {boolean} entering — true if hover entered
 */
function onNodeHover(stateId, entering) {
  if (mode === "add-transition" && transCreation.active) {
    /* Highlight potential target */
    const node = nodesLayer.querySelector(`[data-id="${stateId}"]`);
    if (node) node.classList.toggle("selected", entering);
  }
}

/**
 * Handle clicks on a transition edge.
 * @param {MouseEvent} e
 * @param {string}     transId
 */
function onEdgeClick(e, transId) {
  e.stopPropagation();

  if (mode === "delete") {
    removeTransition(transId);
  } else if (mode === "select") {
    selectedId = transId;
    /* No visual change for edge selection currently */
  }
}


/* ============================================================
   §8  MODE MANAGEMENT
   Switch the active editor mode and update toolbar/status bar UI.
   ============================================================ */

/**
 * Set a new editor mode and update all related UI.
 * @param {string} newMode — one of "select", "add-state",
 *                            "add-transition", "delete"
 */
function setMode(newMode) {
  mode = newMode;

  /* Cancel any in-progress transition creation when switching modes */
  if (newMode !== "add-transition") {
    cancelTransitionCreation();
  }

  /* Clear selection */
  selectedId = null;

  /* Update toolbar button active states */
  modeButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === newMode);
  });

  /* Update SVG canvas cursor class */
  svgCanvas.className = `mode-${newMode}`;

  /* Update status bar */
  const hints = {
    "select":         "Click to select a state, drag to move it",
    "add-state":      "Click anywhere on the canvas to place a new state",
    "add-transition": "Click a source state, then the destination state",
    "delete":         "Click any state or transition to delete it"
  };
  const labels = {
    "select":         "MODE: Select",
    "add-state":      "MODE: Add State",
    "add-transition": "MODE: Add Transition",
    "delete":         "MODE: Delete"
  };
  statusHint.textContent = hints[newMode] || "";
  statusMode.textContent = labels[newMode] || newMode;

  renderAll();
}

/* Wire up toolbar mode buttons */
modeButtons.forEach(btn => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});


/* ============================================================
   §9  DRAG-TO-MOVE LOGIC
   mousemove on the SVG canvas moves the dragged state.
   mouseup ends the drag.
   ============================================================ */

/**
 * Handle mouse move on SVG canvas.
 * - If a drag is active, move the dragged state.
 * - If transition creation is active, update the rubber-band line.
 */
svgCanvas.addEventListener("mousemove", (e) => {
  /* ── Dragging a state ──────────────────────────── */
  if (drag.active && drag.stateId) {
    const dx = e.clientX - drag.startMouseX;
    const dy = e.clientY - drag.startMouseY;

    const state = states.get(drag.stateId);
    state.x = drag.startStateX + dx;
    state.y = drag.startStateY + dy;

    /* Re-render to reflect new position */
    renderAll();
  }

  /* ── Rubber-band line for transition creation ─── */
  if (mode === "add-transition" && transCreation.active) {
    const src = states.get(transCreation.sourceStateId);
    const { x, y } = svgPoint(e);
    showTempLine(src.x, src.y, x, y);
  }
});

/**
 * End drag on mouse up.
 */
svgCanvas.addEventListener("mouseup", () => {
  drag.active  = false;
  drag.stateId = null;
});

/* Also end drag if mouse leaves the SVG entirely */
svgCanvas.addEventListener("mouseleave", () => {
  drag.active  = false;
  drag.stateId = null;
});


/* ============================================================
   §10  TRANSITION CREATION FLOW
   Manages the two-click flow of creating a new transition:
     Click source state → rubber-band line appears
     Click target state → symbol modal opens
   ============================================================ */

/**
 * Show the temporary dashed rubber-band line from source to cursor.
 * @param {number} x1 — source x
 * @param {number} y1 — source y
 * @param {number} x2 — cursor x
 * @param {number} y2 — cursor y
 */
function showTempLine(x1, y1, x2, y2) {
  tempLine.setAttribute("x1", x1);
  tempLine.setAttribute("y1", y1);
  tempLine.setAttribute("x2", x2);
  tempLine.setAttribute("y2", y2);
  tempLine.classList.remove("hidden");
}

/**
 * Hide and reset the temporary rubber-band line.
 */
function hideTempLine() {
  tempLine.classList.add("hidden");
}

/**
 * Cancel an in-progress transition creation (reset source state).
 */
function cancelTransitionCreation() {
  transCreation.active = false;
  transCreation.sourceStateId = null;
  hideTempLine();
}


/* ============================================================
   §11  STATE EDIT MODAL
   Opens a modal to rename a state and toggle initial/accepting.
   ============================================================ */

/**
 * Internal reference to the state being edited in the modal.
 * Set by openStateModal(); used by the confirm handler.
 * @type {string|null}
 */
let editingStateId = null;

/**
 * Open the state-edit modal pre-populated with the state's current values.
 * @param {string} stateId — id of the state to edit
 */
function openStateModal(stateId) {
  const state = states.get(stateId);
  if (!state) return;

  editingStateId = stateId;

  /* Pre-fill fields */
  modalStateName.value           = state.label;
  modalStateInitial.checked      = state.initial;
  modalStateAccepting.checked    = state.accepting;

  /* Show the modal */
  modalStateOverlay.classList.remove("hidden");
  modalStateName.focus();
  modalStateName.select();
}

/**
 * Confirm the state-edit modal: apply changes to the data model.
 */
modalStateConfirm.addEventListener("click", () => {
  if (!editingStateId) return;

  const state    = states.get(editingStateId);
  const newLabel = modalStateName.value.trim();
  const newInit  = modalStateInitial.checked;
  const newAccep = modalStateAccepting.checked;

  if (!newLabel) {
    showToast("State name cannot be empty");
    return;
  }

  /* If this state is being made initial, unset all others */
  if (newInit && !state.initial) {
    for (const s of states.values()) {
      s.initial = false;
    }
  }

  state.label     = newLabel;
  state.initial   = newInit;
  state.accepting = newAccep;

  modalStateOverlay.classList.add("hidden");
  editingStateId = null;

  renderAll();
  updateSidebar();
  showToast(`State updated: ${newLabel}`);
});

/* Cancel state modal */
modalStateCancel.addEventListener("click", () => {
  modalStateOverlay.classList.add("hidden");
  editingStateId = null;
});

/* Close modal on backdrop click */
modalStateOverlay.addEventListener("click", (e) => {
  if (e.target === modalStateOverlay) {
    modalStateOverlay.classList.add("hidden");
    editingStateId = null;
  }
});


/* ============================================================
   §12  TRANSITION LABEL MODAL
   Opens a modal asking the user for the symbol(s) of a new
   (or updated) transition between two states.
   ============================================================ */

/**
 * Pending transition data stored when the modal opens.
 * Resolved when the user confirms.
 */
let pendingTransition = { fromId: null, toId: null };

/**
 * Open the transition-symbol modal.
 * @param {string} fromId — source state id
 * @param {string} toId   — target state id
 */
function openTransitionModal(fromId, toId) {
  const fromLabel = states.get(fromId)?.label ?? fromId;
  const toLabel   = states.get(toId)?.label   ?? toId;

  pendingTransition = { fromId, toId };
  modalDesc.textContent = `${fromLabel}  →  ${toLabel}`;
  modalSymbol.value = "";

  /* Pre-fill if a transition already exists (for editing) */
  const existing = findTransition(fromId, toId);
  if (existing) {
    modalSymbol.value = existing.symbols.join(",");
  }

  modalOverlay.classList.remove("hidden");
  modalSymbol.focus();
}

/**
 * Confirm: parse the symbol input and call addTransition.
 */
modalConfirm.addEventListener("click", () => {
  const raw     = modalSymbol.value.trim();
  if (!raw) {
    showToast("Please enter at least one symbol");
    return;
  }

  /* Split on comma, trim whitespace, remove empty entries */
  const symbols = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (!symbols.length) {
    showToast("No valid symbols entered");
    return;
  }

  addTransition(pendingTransition.fromId, pendingTransition.toId, symbols);

  modalOverlay.classList.add("hidden");
  pendingTransition = { fromId: null, toId: null };
});

/* Pressing Enter in the symbol field also confirms */
modalSymbol.addEventListener("keydown", (e) => {
  if (e.key === "Enter") modalConfirm.click();
});

/* Cancel transition modal */
modalCancel.addEventListener("click", () => {
  modalOverlay.classList.add("hidden");
  pendingTransition = { fromId: null, toId: null };
});

/* Close on backdrop click */
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.classList.add("hidden");
    pendingTransition = { fromId: null, toId: null };
  }
});


/* ============================================================
   §13  SIMULATION ENGINE
   Implements DFA string simulation.

   Full run:  feed every character and report accept/reject.
   Step run:  feed one character at a time, highlighting the
              active state and transition on the canvas.
   ============================================================ */

/**
 * Reset all simulation visual state (remove active highlights, clear trace).
 */
function resetSimulation() {
  simulation.inputStr    = "";
  simulation.currentIndex = 0;
  simulation.currentState = null;
  simulation.running     = false;

  /* Remove sim-active class from all SVG nodes and edges */
  document.querySelectorAll(".node.sim-active, .edge.sim-active").forEach(el => {
    el.classList.remove("sim-active");
  });

  /* Clear UI */
  simResult.className = "sim-result hidden";
  simResult.textContent = "";
  simTrace.innerHTML = "";
}

/**
 * Find the initial state. Returns null if none is set.
 * @returns {StateObject|null}
 */
function getInitialState() {
  for (const s of states.values()) {
    if (s.initial) return s;
  }
  return null;
}

/**
 * Given a current state and a symbol, find the next state.
 * Returns the target StateObject or null if no transition exists.
 * @param {string} currentStateId
 * @param {string} symbol
 * @returns {StateObject|null}
 */
function getNextState(currentStateId, symbol) {
  for (const t of transitions.values()) {
    if (t.from === currentStateId && t.symbols.includes(symbol)) {
      return states.get(t.to) ?? null;
    }
  }
  return null;   /* no transition found → implicit rejection */
}

/**
 * Find the transition used between two states for a symbol (for highlighting).
 */
function getTransitionEdge(fromId, toId, symbol) {
  for (const t of transitions.values()) {
    if (t.from === fromId && t.to === toId && t.symbols.includes(symbol)) {
      return t;
    }
  }
  return null;
}

/**
 * Highlight a state node on the SVG canvas.
 * @param {string} stateId
 */
function highlightState(stateId) {
  /* Remove highlight from all nodes first */
  document.querySelectorAll(".node.sim-active").forEach(n =>
    n.classList.remove("sim-active")
  );
  /* Apply to the target node */
  const node = nodesLayer.querySelector(`[data-id="${stateId}"]`);
  if (node) node.classList.add("sim-active");
}

/**
 * Highlight a transition edge on the SVG canvas.
 * @param {string} transId
 */
function highlightEdge(transId) {
  document.querySelectorAll(".edge.sim-active").forEach(e =>
    e.classList.remove("sim-active")
  );
  const edge = edgesLayer.querySelector(`[data-id="${transId}"]`);
  if (edge) edge.classList.add("sim-active");
}

/**
 * Append a line to the step trace log in the sidebar.
 * @param {string} text
 */
function appendTrace(text) {
  /* Remove .latest from previous entry */
  const prev = simTrace.querySelector("p.latest");
  if (prev) prev.classList.remove("latest");

  const p = document.createElement("p");
  p.textContent = text;
  p.classList.add("latest");
  simTrace.appendChild(p);

  /* Auto-scroll to bottom */
  simTrace.scrollTop = simTrace.scrollHeight;
}

/**
 * Run the full DFA simulation on the input string.
 * Shows the final accepted / rejected result immediately.
 */
function runSimulation() {
  const input = simInput.value;
  resetSimulation();

  if (!states.size) { showToast("Add some states first"); return; }

  const initState = getInitialState();
  if (!initState) { showToast("No initial state defined"); return; }

  let current = initState;
  appendTrace(`Start: ${current.label}  |  Input: "${input}"`);
  highlightState(current.id);

  /* Walk through each character of the input */
  for (let i = 0; i < input.length; i++) {
    const symbol = input[i];
    const next   = getNextState(current.id, symbol);

    if (!next) {
      /* Dead / reject state — no transition found */
      appendTrace(`Read '${symbol}' from ${current.label} → dead state`);
      showResult(false);
      return;
    }

    const edge = getTransitionEdge(current.id, next.id, symbol);
    appendTrace(`Read '${symbol}': ${current.label} → ${next.label}`);
    if (edge) highlightEdge(edge.id);
    current = next;
  }

  highlightState(current.id);
  showResult(current.accepting);
}

/**
 * Initialise step-by-step simulation.
 * Starts the simulation cursor at the initial state.
 */
function startStepSimulation() {
  const input = simInput.value;
  resetSimulation();

  if (!states.size) { showToast("Add some states first"); return; }
  const initState = getInitialState();
  if (!initState)   { showToast("No initial state defined"); return; }

  simulation.inputStr     = input;
  simulation.currentIndex = 0;
  simulation.currentState = initState.id;
  simulation.running      = true;

  appendTrace(`Start: ${initState.label}  |  Input: "${input}"`);
  highlightState(initState.id);
}

/**
 * Advance the step-simulation by one character.
 * If no more input remains, show the final result.
 */
function stepSimulation() {
  if (!simulation.running) {
    /* Start if not yet started */
    startStepSimulation();
    return;
  }

  if (simulation.currentIndex >= simulation.inputStr.length) {
    /* No more input — check acceptance */
    const cur = states.get(simulation.currentState);
    appendTrace(`End of input. State: ${cur?.label ?? "?"}`);
    showResult(cur?.accepting ?? false);
    simulation.running = false;
    return;
  }

  const symbol  = simulation.inputStr[simulation.currentIndex];
  const nextSt  = getNextState(simulation.currentState, symbol);
  const curLabel = states.get(simulation.currentState)?.label ?? "?";

  if (!nextSt) {
    appendTrace(`Read '${symbol}' from ${curLabel} → dead state`);
    showResult(false);
    simulation.running = false;
    return;
  }

  const edge = getTransitionEdge(simulation.currentState, nextSt.id, symbol);
  appendTrace(`Read '${symbol}': ${curLabel} → ${nextSt.label}`);
  if (edge) highlightEdge(edge.id);

  simulation.currentState = nextSt.id;
  simulation.currentIndex++;
  highlightState(nextSt.id);
}

/**
 * Display the accepted / rejected result banner.
 * @param {boolean} accepted
 */
function showResult(accepted) {
  simResult.classList.remove("hidden", "accepted", "rejected");
  if (accepted) {
    simResult.classList.add("accepted");
    simResult.textContent = "✓  Accepted";
  } else {
    simResult.classList.add("rejected");
    simResult.textContent = "✗  Rejected";
  }
}

/* Wire up simulation buttons */
btnSimulate.addEventListener("click", runSimulation);
btnStep.addEventListener("click",     stepSimulation);
btnResetSim.addEventListener("click", resetSimulation);

/* Also allow pressing Enter in the input field to run simulation */
simInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSimulation();
});


/* ============================================================
   §14  IMPORT / EXPORT
   Serialise / deserialise the DFA data model to/from JSON.
   ============================================================ */

/**
 * Export the current DFA as a JSON file download.
 * The JSON contains: states (array), transitions (array),
 * stateCounter, transCounter.
 */
btnExport.addEventListener("click", () => {
  const data = {
    stateCounter,
    transCounter,
    states:      [...states.values()],
    transitions: [...transitions.values()]
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);

  /* Create a temporary <a> to trigger the download */
  const a = document.createElement("a");
  a.href     = url;
  a.download = "dfa-export.json";
  a.click();
  URL.revokeObjectURL(url);

  showToast("DFA exported as JSON");
});

/* Import button opens the hidden file input */
btnImport.addEventListener("click", () => importFile.click());

/**
 * Handle the file selected for import.
 * Reads the JSON and rebuilds the data model.
 */
importFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);

      /* Clear current state */
      states.clear();
      transitions.clear();

      /* Restore counters */
      stateCounter = data.stateCounter ?? 0;
      transCounter = data.transCounter ?? 0;

      /* Restore states */
      for (const s of (data.states ?? [])) {
        states.set(s.id, s);
      }

      /* Restore transitions */
      for (const t of (data.transitions ?? [])) {
        transitions.set(t.id, t);
      }

      renderAll();
      updateSidebar();
      showToast("DFA imported successfully");
    } catch (err) {
      showToast("Import failed: invalid JSON");
      console.error("Import error:", err);
    }

    /* Reset the file input so the same file can be re-imported */
    importFile.value = "";
  };

  reader.readAsText(file);
});

/* Clear all button */
btnClear.addEventListener("click", () => {
  if (states.size === 0) return;
  /* Simple confirmation to avoid accidental clear */
  if (confirm("Clear the entire canvas? This cannot be undone.")) {
    clearAll();
  }
});


/* ============================================================
   §15  KEYBOARD SHORTCUTS
   Global key bindings for quick mode switching.
   ============================================================ */

/**
 * Keyboard shortcut map.
 * Key → mode or action string
 */
const keyboardShortcuts = {
  "s": "select",
  "a": "add-state",
  "t": "add-transition",
  "d": "delete"
};

document.addEventListener("keydown", (e) => {
  /* Don't intercept shortcuts when the user is typing in an input */
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  const key = e.key.toLowerCase();

  /* Mode switch shortcuts */
  if (keyboardShortcuts[key]) {
    setMode(keyboardShortcuts[key]);
    return;
  }

  /* Delete key removes the selected element */
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
    if (states.has(selectedId)) {
      removeState(selectedId);
    } else if (transitions.has(selectedId)) {
      removeTransition(selectedId);
    }
    selectedId = null;
    return;
  }

  /* Escape cancels transition creation or closes modals */
  if (e.key === "Escape") {
    cancelTransitionCreation();
    modalOverlay.classList.add("hidden");
    modalStateOverlay.classList.add("hidden");
    pendingTransition = { fromId: null, toId: null };
    editingStateId    = null;
  }
});


/* ============================================================
   §16  BOOTSTRAP / INIT
   Called once on page load to set up the initial application state.
   ============================================================ */

/**
 * Initialise the editor with a default example DFA:
 *   q0 (initial) --a--> q1 (accepting)
 *   q1            --b--> q0
 * This gives users an immediate visual to interact with.
 */
function initDefaultDFA() {
  /* Create two states at nice centred positions */
  const canvasW = svgCanvas.clientWidth  || 800;
  const canvasH = svgCanvas.clientHeight || 500;

  /* State q0 — initial */
  const s0 = {
    id: nextStateId(), label: "q0",
    x: canvasW * 0.3, y: canvasH * 0.5,
    initial: true, accepting: false
  };

  /* State q1 — accepting */
  const s1 = {
    id: nextStateId(), label: "q1",
    x: canvasW * 0.65, y: canvasH * 0.5,
    initial: false, accepting: true
  };

  states.set(s0.id, s0);
  states.set(s1.id, s1);

  /* Transition q0 --a--> q1 */
  const t0 = { id: nextTransId(), from: s0.id, to: s1.id, symbols: ["a"] };
  /* Transition q1 --b--> q0 */
  const t1 = { id: nextTransId(), from: s1.id, to: s0.id, symbols: ["b"] };

  transitions.set(t0.id, t0);
  transitions.set(t1.id, t1);

  renderAll();
  updateSidebar();
}

/* Set the initial mode and render the default DFA */
setMode("select");
initDefaultDFA();

/* Welcome toast */
showToast("DFA Editor ready! S=Select  A=Add State  T=Transition  D=Delete", 4000);