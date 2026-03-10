/**
 * ═══════════════════════════════════════════════════════════════
 *   Banker's Algorithm Simulator — script.js
 *   Modular · Heavily Commented · Vanilla JS
 * ═══════════════════════════════════════════════════════════════
 *
 *  Core Concepts Implemented:
 *  ① Safety Algorithm      — evaluates if system state is safe
 *  ② Resource Request Alg  — validates and simulates allocations
 *  ③ Auto Need Computation — Need[i][j] = Max[i][j] − Alloc[i][j]
 *  ④ Step-by-Step Player   — animated row-by-row visualization
 *  ⑤ Terminal Log          — neon green, line-by-line output
 *  ⑥ Toast Notifications   — error / success / warning feedback
 *  ⑦ Auto-Scroll           — scrolls log into view on safety run
 *
 *  Algorithm Complexity: O(n² × m)
 *    n = number of processes, m = number of resource types
 */

'use strict';

/* ━━━━━━━━━━━━━━━━━  STATE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

let N = 0;  // number of processes
let M = 0;  // number of resource types

// Live matrices (populated from DOM on demand)
let allocMatrix = [];   // N × M
let maxMatrix = [];   // N × M
let needMatrix = [];   // N × M  — derived: Max − Alloc
let availVector = [];   // 1 × M

// ── Step-by-step player state ──────────────────────────────────
const step = {
    active: false,
    work: [],   // copy of availVector at step start
    finish: [],   // boolean[N]
    seq: [],   // ordered list of satisfied processes
    ptr: 0,    // circular pointer to current process
    passes: 0,    // consecutive skips without allocation (deadlock detector)
};

/* ━━━━━━━━━━━━━━━━━  BOOT  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

document.addEventListener('DOMContentLoaded', () => {

    // Set footer year
    const fy = document.getElementById('footer-year');
    if (fy) fy.textContent = new Date().getFullYear();

    // ── Primary Actions ──────────────────────────────────────
    getEl('btn-generate').addEventListener('click', generateMatrices);
    getEl('btn-reset').addEventListener('click', resetAll);
    getEl('btn-random').addEventListener('click', fillRandom);
    getEl('btn-safety').addEventListener('click', runSafetyUI);
    getEl('btn-request').addEventListener('click', runRequestUI);

    // ── Step player controls ─────────────────────────────────
    getEl('btn-step-start').addEventListener('click', stepStart);
    getEl('btn-step-next').addEventListener('click', stepNext);
    getEl('btn-step-close').addEventListener('click', stepStop);

    // ── Exec trace close button ─────────────────────────────────
    getEl('btn-close-trace').addEventListener('click', () => {
        getEl('exec-trace-container').classList.add('hidden');
    });

    // ── Utility ──────────────────────────────────────────────
    getEl('btn-dark-toggle').addEventListener('click', toggleTheme);
    getEl('btn-export-pdf').addEventListener('click', exportPDF);
    getEl('btn-clear-log').addEventListener('click', clearLog);

    // ── Auto-compute Need whenever Alloc or Max cells change ─
    // Uses event delegation on the entire matrices grid for performance.
    getEl('matrices-grid').addEventListener('input', (e) => {
        const el = e.target;
        if (!el.classList.contains('cell-input') || el.classList.contains('readonly')) return;

        const [prefix, iStr, jStr] = el.id.split('-');
        if (prefix === 'alloc' || prefix === 'max') {
            computeNeedCell(parseInt(iStr), parseInt(jStr));
        }
    });
});


/* ━━━━━━━━━━━━━━━━━━  MATRIX GENERATION  ━━━━━━━━━━━━━━━━━━━━━━
 *  KEY FIX: always wipe innerHTML before rebuilding
 *  to prevent duplicate tables on repeated clicks.
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function generateMatrices() {
    const rawN = parseInt(getEl('num-processes').value);
    const rawM = parseInt(getEl('num-resources').value);

    // ── Input Validation ──────────────────────────────────────
    if (!Number.isInteger(rawN) || !Number.isInteger(rawM) || rawN < 1 || rawM < 1) {
        showToast('Please enter valid positive integers for n and m.', 'error');
        return;
    }
    if (rawN > 15 || rawM > 10) {
        showToast('Max: 15 processes and 10 resource types.', 'warning');
        return;
    }

    N = rawN;
    M = rawM;

    // ── DOM Clearing (Critical) ───────────────────────────────
    ['cont-allocation', 'cont-max', 'cont-need', 'cont-available'].forEach(id => {
        getEl(id).innerHTML = '';
    });

    // ── Build Tables ──────────────────────────────────────────
    getEl('cont-allocation').appendChild(buildTable('alloc', N, M, false));
    getEl('cont-max').appendChild(buildTable('max', N, M, false));
    getEl('cont-need').appendChild(buildTable('need', N, M, true));   // readonly
    getEl('cont-available').appendChild(buildAvailTable(M));

    // ── Populate Request Section ──────────────────────────────
    buildRequestSection();

    // ── Show Secondary Sections ───────────────────────────────
    ['section-matrices', 'section-request'].forEach(id => {
        const sec = getEl(id);
        sec.classList.remove('hidden');
        // Re-trigger animation
        sec.classList.remove('fade-in');
        void sec.offsetWidth;
        sec.classList.add('fade-in');
    });

    // Reset glow and stop any active step player
    clearResultGlow();
    stepStop();
    resetDashboard(); // hide & zero-out dashboard on each fresh generation
    getEl('exec-trace-container').classList.add('hidden'); // Hide trace cards
    getEl('section-req-dashboard').classList.add('hidden'); // Hide request dashboard

    termLog('$ bankers_sim --generate', 'sys');
    termLog(`> Matrices initialised — Processes: ${N}, Resources: ${M}`, 'info');
}

/**
 * Builds an N×M HTML table with optional readonly inputs.
 * @param {string}  prefix    - cell id prefix ('alloc', 'max', 'need')
 * @param {number}  rows      - number of processes
 * @param {number}  cols      - number of resources
 * @param {boolean} readonly  - if true, inputs are readonly (Need matrix)
 * @returns {HTMLTableElement}
 */
function buildTable(prefix, rows, cols, readonly) {
    const tbl = document.createElement('table');
    tbl.className = 'data-table';
    tbl.id = `tbl-${prefix}`;

    // ── Header Row ────────────────────────────────────────────
    const tHead = tbl.createTHead();
    const hRow = tHead.insertRow();
    addCell(hRow, 'th', '');
    for (let j = 0; j < cols; j++) addCell(hRow, 'th', `R${j}`);

    // ── Body Rows ─────────────────────────────────────────────
    const tBody = tbl.createTBody();
    for (let i = 0; i < rows; i++) {
        const tr = tBody.insertRow();
        tr.id = `tr-${prefix}-${i}`;

        // Process label cell
        const lbl = tr.insertCell();
        lbl.className = 'proc-label';
        lbl.textContent = `P${i}`;

        // Input cells
        for (let j = 0; j < cols; j++) {
            const td = tr.insertCell();
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.min = '0';
            inp.value = '0';
            inp.id = `${prefix}-${i}-${j}`;
            inp.className = readonly ? 'cell-input readonly' : 'cell-input';
            if (readonly) {
                inp.readOnly = true;
                inp.tabIndex = -1;
            }
            td.appendChild(inp);
        }
    }
    return tbl;
}

/**
 * Builds a single-row Available resources table.
 */
function buildAvailTable(cols) {
    const tbl = document.createElement('table');
    tbl.className = 'data-table';
    tbl.id = 'tbl-available';

    const tHead = tbl.createTHead();
    const hRow = tHead.insertRow();
    for (let j = 0; j < cols; j++) addCell(hRow, 'th', `R${j}`);

    const tBody = tbl.createTBody();
    const tr = tBody.insertRow();
    tr.id = 'tr-avail-0';
    for (let j = 0; j < cols; j++) {
        const td = tr.insertCell();
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.value = '0';
        inp.id = `avail-0-${j}`;
        inp.className = 'cell-input';
        td.appendChild(inp);
    }
    return tbl;
}

function buildRequestSection() {
    // Process dropdown
    const sel = getEl('req-process');
    sel.innerHTML = '';
    for (let i = 0; i < N; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Process P${i}`;
        sel.appendChild(opt);
    }

    // Request vector inputs
    const vec = getEl('req-vector');
    vec.innerHTML = '';
    for (let j = 0; j < M; j++) {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.value = '0';
        inp.id = `req-${j}`;
        inp.className = 'cell-input';
        inp.placeholder = `R${j}`;
        inp.style.width = '56px';
        vec.appendChild(inp);
    }
}


/* ━━━━━━━━━━━━━━━━━  NEED COMPUTATION  ━━━━━━━━━━━━━━━━━━━━━━━
 *  Recalculates a single cell of the Need matrix when the user
 *  edits an Allocation or Max input:
 *      Need[i][j] = Max[i][j] − Alloc[i][j]
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function computeNeedCell(i, j) {
    const alloc = parseCell(`alloc-${i}-${j}`);
    const max = parseCell(`max-${i}-${j}`);
    const need = getEl(`need-${i}-${j}`);

    if (need) {
        const val = max - alloc;
        need.value = val;
        // Flag visually if Max < Alloc (invalid state)
        need.classList.toggle('invalid', val < 0);
    }
}

function computeAllNeed() {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
            computeNeedCell(i, j);
        }
    }
}


/* ━━━━━━━━━━━━━━━━━  DATA READING & VALIDATION  ━━━━━━━━━━━━━━━
 *  Reads all matrices from DOM into JS arrays.
 *  Returns true on success, false on any validation failure.
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function readState() {
    allocMatrix = [];
    maxMatrix = [];
    needMatrix = [];
    availVector = [];

    for (let i = 0; i < N; i++) {
        const aRow = [], mRow = [], nRow = [];
        for (let j = 0; j < M; j++) {
            const al = parseCell(`alloc-${i}-${j}`);
            const mx = parseCell(`max-${i}-${j}`);

            if (isNaN(al) || al < 0) return err(`Negative/invalid Allocation at P${i} R${j}.`);
            if (isNaN(mx) || mx < 0) return err(`Negative/invalid Max at P${i} R${j}.`);
            if (mx < al) return err(`Max < Allocation at P${i} R${j}. Need cannot be negative!`);

            aRow.push(al);
            mRow.push(mx);
            nRow.push(mx - al);  // Need
        }
        allocMatrix.push(aRow);
        maxMatrix.push(mRow);
        needMatrix.push(nRow);
    }

    for (let j = 0; j < M; j++) {
        const av = parseCell(`avail-0-${j}`);
        if (isNaN(av) || av < 0) return err(`Negative/invalid Available R${j}.`);
        availVector.push(av);
    }

    return true;
}

function err(msg) {
    showToast(msg, 'error');
    termLog(`! ERROR: ${msg}`, 'err');
    return false;
}


/* ━━━━━━━━━━━━━━━━━  SAFETY ALGORITHM  ━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Banker's Safety Algorithm (Textbook Step-by-Step):
 *
 *  1. Init:  Work = Available
 *            Finish[i] = false for all i
 *
 *  2. Find process i such that:
 *       Finish[i] == false  AND  Need[i] <= Work (element-wise)
 *
 *  3. If found:
 *       Work   = Work + Allocation[i]
 *       Finish[i] = true
 *       Add i to safe sequence
 *       Goto step 2
 *
 *  4. If all Finish[i] == true → system is SAFE
 *     Else                     → system is UNSAFE (deadlock risk)
 *
 *  @param {number[]}   avail  - Available resources snapshot
 *  @param {number[][]} alloc  - Allocation matrix snapshot
 *  @param {number[][]} need   - Need matrix snapshot
 *  @returns {{ safe: boolean, seq: number[], traceSteps: object[] }}
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function safetyAlgorithm(avail, alloc, need, collectTrace = false) {
    const work = [...avail];               // mutable workspace
    const finish = new Array(N).fill(false); // tracks process completion
    const seq = [];                       // safe sequence accumulator
    const traceSteps = [];                // detailed steps (only when collectTrace)
    let count = 0;                        // number of completed processes

    // Loop until all processes finish or no progress is made
    outer: while (count < N) {
        let progress = false;

        for (let i = 0; i < N; i++) {
            if (finish[i]) continue;

            // Check: Need[i][j] <= Work[j] for ALL j
            let feasible = true;
            for (let j = 0; j < M; j++) {
                if (need[i][j] > work[j]) { feasible = false; break; }
            }

            if (feasible) {
                // Simulate process i completing and releasing its resources
                const workBefore = [...work];
                for (let j = 0; j < M; j++) work[j] += alloc[i][j];
                finish[i] = true;
                seq.push(i);
                count++;
                progress = true;
                if (collectTrace) {
                    traceSteps.push({
                        type: 'execute',
                        process: i,
                        need: [...need[i]],
                        workBefore,
                        alloc: [...alloc[i]],
                        workAfter: [...work],
                        seq: [...seq],
                        finish: [...finish], // Snapshot finish array
                    });
                }
                // Restart inner scan to recheck previously skipped processes
                continue outer;
            } else if (collectTrace) {
                traceSteps.push({
                    type: 'wait',
                    process: i,
                    need: [...need[i]],
                    work: [...work],
                    finish: [...finish], // Snapshot finish array
                });
            }
        }

        // No process was satisfiable in this full scan → deadlock
        if (!progress) break;
    }

    return { safe: count === N, seq, traceSteps };
}


/* ━━━━━━━━━━━━━━━━━  SAFETY UI TRIGGER  ━━━━━━━━━━━━━━━━━━━━━━ */

function runSafetyUI() {
    stepStop();                        // end any active step visualization
    getEl('exec-trace-container').classList.add('hidden'); // Hide previous trace cards
    getEl('section-req-dashboard').classList.add('hidden'); // Hide request dashboard
    if (!readState()) return;

    termLog('$ bankers_sim --safety-check', 'sys');
    termLog('> Reading system state...', 'info');
    termLog(`> Available : [${availVector.join(', ')}]`, 'info');

    // Run algorithm with trace collection enabled (for PDF export + step cards)
    const { safe, seq, traceSteps } = safetyAlgorithm(availVector, allocMatrix, needMatrix, true);

    if (safe) {
        const seqStr = seq.map(i => `P${i}`).join(' → ');
        termLog(`> ✔ SAFE STATE DETECTED`, 'ok');
        termLog(`> Safe Sequence : ${seqStr}`, 'ok');
        showToast('System is in a SAFE state!', 'success');
        setResultGlow(true);
        injectResultBanner(true, seqStr, getEl('section-matrices'));
    } else {
        termLog(`> ✖ UNSAFE STATE — Deadlock risk exists.`, 'err');
        showToast('UNSAFE state detected! Deadlock risk.', 'error');
        setResultGlow(false);
        injectResultBanner(false, '', getEl('section-matrices'));
    }

    // ── Update Performance Dashboard ─────────────────────────
    updateDashboard(safe, seq);

    // ── Cache result for PDF export ───────────────────────────
    // Compute utilPct and completePct here so PDF helper doesn't
    // need to re-read potentially stale DOM state.
    let totalAllocated = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) totalAllocated += allocMatrix[i][j];
    const totalCap = totalAllocated + availVector.reduce((a, b) => a + b, 0);
    _lastPdfResult = {
        safe,
        seq,
        traceSteps,
        utilPct: totalCap > 0 ? Math.round((totalAllocated / totalCap) * 100) : 0,
        completePct: N > 0 ? Math.round((seq.length / N) * 100) : 0,
    };

    // ── Render Execution Trace Step Cards ─────────────────────────
    renderExecTrace(safe, seq, traceSteps);

    // ── AUTO-SCROLL: scroll to the first Step Card ─────────────────
    setTimeout(() => {
        getEl('section-log').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
}


/* ━━━━━━━━━━━━━━━━━  RESOURCE REQUEST ALGORITHM  ━━━━━━━━━━━━━━
 *
 *  Resource-Request Algorithm:
 *
 *  Given Process Pᵢ requesting Request[i]:
 *
 *  1. If Request[i] > Need[i]    → DENY (exceeds max claim)
 *  2. If Request[i] > Available  → BLOCK (must wait)
 *  3. Pretend to allocate:
 *       Available = Available − Request[i]
 *       Alloc[i]  = Alloc[i]  + Request[i]
 *       Need[i]   = Need[i]   − Request[i]
 *  4. Run Safety Algorithm on simulated state.
 *     If SAFE  → GRANT (apply allocation to UI)
 *     If UNSAFE→ DENY  (rollback)
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function runRequestUI() {
    stepStop();
    getEl('exec-trace-container').classList.add('hidden'); // Hide previous trace cards
    if (!readState()) return;

    const pid = parseInt(getEl('req-process').value);
    const req = [];

    for (let j = 0; j < M; j++) {
        const v = parseCell(`req-${j}`);
        if (isNaN(v) || v < 0) return err(`Negative/invalid request value for R${j}.`);
        req.push(v);
    }

    termLog('$ bankers_sim --request', 'sys');
    termLog(`> Process : P${pid}`, 'info');
    termLog(`> Request : [${req.join(', ')}]`, 'info');

    // ── Show Request Dashboard ────────────────────────────────────
    const dash = getEl('section-req-dashboard');
    dash.classList.remove('hidden');
    const checksEl = getEl('req-validation-checks');
    checksEl.innerHTML = '';
    getEl('req-sim-table-wrap').classList.add('hidden');
    const decisionEl = getEl('req-decision');
    decisionEl.classList.add('hidden');
    decisionEl.innerHTML = '';

    // Helper to add a check row
    const addCheck = (label, passed, detail) => {
        const row = document.createElement('div');
        row.className = `req-check-row ${passed ? 'check-pass' : 'check-fail'}`;
        row.innerHTML = `
            <span class="check-icon">${passed ? '✅' : '❌'}</span>
            <span class="check-label">${label}</span>
            <span class="check-detail">${detail}</span>
        `;
        checksEl.appendChild(row);
        return passed;
    };

    // ── Check 1: Request ≤ Need ────────────────────────────────
    let needViolation = false;
    for (let j = 0; j < M; j++) {
        if (req[j] > needMatrix[pid][j]) { needViolation = true; break; }
    }
    addCheck(
        'Request ≤ Need[P' + pid + ']',
        !needViolation,
        `[${req.join(', ')}] ≤ [${needMatrix[pid].join(', ')}] ?`
    );

    if (needViolation) {
        termLog(`> ✖ Request exceeds maximum claim. DENIED.`, 'err');
        showToast(`P${pid}: Request exceeds its declared Max — denied.`, 'error');
        setResultGlow(false);
        setTimeout(() => getEl('section-req-dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        return;
    }

    // ── Check 2: Request ≤ Available ───────────────────────────
    let availViolation = false;
    for (let j = 0; j < M; j++) {
        if (req[j] > availVector[j]) { availViolation = true; break; }
    }
    addCheck(
        'Request ≤ Available',
        !availViolation,
        `[${req.join(', ')}] ≤ [${availVector.join(', ')}] ?`
    );

    if (availViolation) {
        termLog(`> ⚠ Insufficient Available resources. P${pid} must WAIT.`, 'warn');
        showToast(`P${pid}: Resources unavailable — process must wait.`, 'warning');
        setTimeout(() => getEl('section-req-dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        return;
    }

    // ── Step 3: Simulate allocation ─────────────────────────────
    const simAvail = [...availVector];
    const simAlloc = allocMatrix.map(r => [...r]);
    const simNeed = needMatrix.map(r => [...r]);

    for (let j = 0; j < M; j++) {
        simAvail[j] -= req[j];
        simAlloc[pid][j] += req[j];
        simNeed[pid][j] -= req[j];
    }

    termLog('> Simulating allocation... running safety check...', 'step');

    // ── Show What-If Simulation Snapshot Table ──────────────────
    buildSimSnapshotTable(simAvail, simAlloc, simNeed, pid, req);
    getEl('req-sim-table-wrap').classList.remove('hidden');

    // ── Step 4: Safety Check on simulated state ────────────────
    const { safe, seq } = safetyAlgorithm(simAvail, simAlloc, simNeed);

    const decEl = getEl('req-decision');
    decEl.classList.remove('hidden');

    if (safe) {
        const seqStr = seq.map(i => `P${i}`).join(' → ');
        termLog(`> ✔ Request SAFELY GRANTED to P${pid}`, 'ok');
        termLog(`> New Safe Sequence : ${seqStr}`, 'ok');
        showToast(`Request for P${pid} granted safely!`, 'success');
        setResultGlow(true);

        decEl.innerHTML = `
            <div class="req-decision-banner granted">
                <i class="fas fa-circle-check"></i>
                <div>
                    <strong>✅ Request Safely Granted</strong>
                    <p>New safe sequence: <code>${seqStr}</code></p>
                </div>
            </div>
        `;

        // ── Apply allocation to live DOM ────────────────────────
        for (let j = 0; j < M; j++) {
            getEl(`avail-0-${j}`).value = simAvail[j];
            getEl(`alloc-${pid}-${j}`).value = simAlloc[pid][j];
        }
        computeAllNeed();
    } else {
        termLog(`> ✖ Request DENIED — allocation would cause UNSAFE state.`, 'err');
        showToast(`Request for P${pid} denied — deadlock risk!`, 'error');
        setResultGlow(false);

        decEl.innerHTML = `
            <div class="req-decision-banner denied">
                <i class="fas fa-skull-crossbones"></i>
                <div>
                    <strong>❌ Request Denied: System would enter Deadlock</strong>
                    <p>Simulation rolled back. State unchanged.</p>
                </div>
            </div>
        `;
    }

    // Auto-scroll to request dashboard
    setTimeout(() => getEl('section-req-dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}


/* ━━━━━━━━━━━━━━━━━  STEP-BY-STEP VISUALIZATION  ━━━━━━━━━━━━━━
 *
 *  Provides a manual "next step" player that:
 *  - Highlights the current row being evaluated (yellow)
 *  - Turns the row green when satisfied, red when skipped
 *  - Updates the Work vector and Safe Sequence in the tracker UI
 *  - Prints detailed lines to the terminal log
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function stepStart() {
    if (!readState()) return;

    clearResultGlow();
    clearRowHighlights();
    removeResultBanner();

    // Initialise step state
    step.active = true;
    step.work = [...availVector];
    step.finish = new Array(N).fill(false);
    step.seq = [];
    step.ptr = 0;
    step.passes = 0;

    // Show the player panel
    const player = getEl('step-player');
    player.classList.remove('hidden');
    syncStepUI('Click "Next Process" to begin.');

    termLog('$ bankers_sim --step-mode', 'sys');
    termLog(`> Work vector initialised: [${step.work.join(', ')}]`, 'info');
}

function stepStop() {
    step.active = false;
    const player = getEl('step-player');
    if (player) player.classList.add('hidden');
    clearRowHighlights();
}

/**
 *  Advances the step player by one process evaluation.
 *  Uses the same logic as safetyAlgorithm() but one step at a time.
 */
function stepNext() {
    if (!step.active) return;

    // ── Terminal condition: all processes satisfied ────────────
    if (step.seq.length === N) {
        const seqStr = step.seq.map(i => `P${i}`).join(' → ');
        termLog(`> ✔ Algorithm complete. SAFE SEQUENCE: ${seqStr}`, 'ok');
        showToast('SAFE STATE confirmed step-by-step!', 'success');
        setResultGlow(true);
        syncStepUI('Complete — system is SAFE.');
        clearRowHighlights();
        stepStop();
        return;
    }

    // ── Deadlock detector: too many consecutive skips ─────────
    // If we have gone through N processes without allocating
    // any resources, the remaining processes cannot proceed.
    if (step.passes >= N) {
        termLog('> ✖ No eligible process found. UNSAFE — possible deadlock.', 'err');
        showToast('UNSAFE — deadlock risk detected!', 'error');
        setResultGlow(false);
        syncStepUI('UNSAFE — deadlock detected.', 'danger');
        clearRowHighlights();
        stepStop();
        return;
    }

    // Skip already-finished processes
    while (step.finish[step.ptr]) {
        step.ptr = (step.ptr + 1) % N;
    }

    const i = step.ptr;
    const needVec = needMatrix[i];
    const needStr = `[${needVec.join(', ')}]`;
    const workStr = `[${step.work.join(', ')}]`;

    // Evaluate feasibility: Need[i] <= Work
    let feasible = needVec.every((v, j) => v <= step.work[j]);

    // Highlight row being evaluated (yellow)
    highlightRows(i, 'row-checking');
    termLog(`> Checking P${i}: Need ${needStr} ≤ Work ${workStr} ?`, 'step');

    if (feasible) {
        // Update Work = Work + Alloc[i]
        for (let j = 0; j < M; j++) step.work[j] += allocMatrix[i][j];

        step.finish[i] = true;
        step.seq.push(i);
        step.passes = 0;  // reset deadlock counter on successful allocation

        highlightRows(i, 'row-success');
        const newWork = `[${step.work.join(', ')}]`;
        termLog(`> ✔ P${i} satisfied — Work updated to ${newWork}`, 'ok');
        syncStepUI(`P${i} satisfied. Work = ${newWork}`);
    } else {
        step.passes++;
        highlightRows(i, 'row-fail');
        termLog(`> — P${i} cannot proceed, insufficient resources. Skipping.`, 'warn');
        syncStepUI(`P${i} must wait. Need > Work.`, 'warning');
    }

    // Advance to next process (circular)
    step.ptr = (step.ptr + 1) % N;
}

function syncStepUI(statusMsg, statusClass = '') {
    getEl('step-work').textContent = `[${step.work.join(', ')}]`;

    const seqEl = getEl('step-seq');
    seqEl.textContent = step.seq.length > 0
        ? step.seq.map(i => `P${i}`).join(' → ')
        : '—';

    const statEl = getEl('step-status');
    statEl.textContent = statusMsg;
    statEl.className = 'stat-value';
    if (statusClass === 'warning') statEl.classList.add('warning-text');
    if (statusClass === 'danger') statEl.classList.add('danger-text');
}


/* ━━━━━━━━━━━━━━━━━  EXECUTION TRACE STEP CARDS  ━━━━━━━━━━━━━━
 *
 *  renderExecTrace(safe, seq, traceSteps)
 *  Generates a vertically-stacked series of "Step Cards" inside
 *  #exec-step-cards that visually trace the Safety Algorithm.
 *
 *  Card types:
 *  1. Initialization Card — Work = Available, Finish = [false…]
 *  2. Execute Card (green header) — Need ≤ Work, update Work
 *  3. Wait Card (amber header) — Need > Work, process must wait
 *  4. Final Outcome Card — Safe banner with sequence or Unsafe
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function renderExecTrace(safe, seq, traceSteps) {
    const container = getEl('exec-trace-container');
    const cardsEl = getEl('exec-step-cards');
    cardsEl.innerHTML = '';

    // ── Card 1: Initialization ────────────────────────────────
    const initCard = document.createElement('div');
    initCard.className = 'step-card step-card-init';
    initCard.innerHTML = `
        <div class="step-card-header">
            <span class="step-num">Step 1</span>
            <span class="step-tag tag-init">⚙ Initialization</span>
        </div>
        <div class="step-card-body">
            <div class="step-param-row">
                <span class="step-param-lbl">n (processes)</span>
                <span class="step-param-val">${N}</span>
            </div>
            <div class="step-param-row">
                <span class="step-param-lbl">m (resource types)</span>
                <span class="step-param-val">${M}</span>
            </div>
            <div class="step-param-row">
                <span class="step-param-lbl">Work = Available</span>
                <span class="step-param-val vec-blue">[${availVector.join(', ')}]</span>
            </div>
            <div class="step-finish-wrap">
                <span class="step-param-lbl" style="display:block;margin-bottom:8px;">Finish Table</span>
                ${buildFinishTable(new Array(N).fill(false))}
            </div>
        </div>
    `;
    cardsEl.appendChild(initCard);

    // ── Cards 2…n+1: Process Analysis ────────────────────────
    if (traceSteps && traceSteps.length > 0) {
        traceSteps.forEach((s, idx) => {
            const card = document.createElement('div');
            const isSafe = s.type === 'execute';
            card.className = `step-card ${isSafe ? 'step-card-exec' : 'step-card-wait'}`;
            card.style.animationDelay = `${(idx + 1) * 0.07}s`;

            if (isSafe) {
                card.innerHTML = `
                    <div class="step-card-header">
                        <span class="step-num">Step ${idx + 2}</span>
                        <span class="step-tag tag-exec">✔ P${s.process} — Execute</span>
                    </div>
                    <div class="step-card-body">
                        <div class="step-compare">
                            <span class="vec-label">Need[P${s.process}]</span>
                            <span class="vec-val vec-pink">[${s.need.join(', ')}]</span>
                            <span class="vec-op">≤</span>
                            <span class="vec-label">Work</span>
                            <span class="vec-val vec-blue">[${s.workBefore.join(', ')}]</span>
                            <span class="vec-check check-yes">✓ Feasible</span>
                        </div>
                        <div class="step-work-update">
                            <span class="work-update-lbl">Work Update</span>
                            <span class="work-expr">
                                [${s.workBefore.join(', ')}]
                                <span class="work-plus">+</span>
                                Alloc[P${s.process}]([${s.alloc.join(', ')}])
                                <span class="work-arrow">→</span>
                                <span class="vec-green">[${s.workAfter.join(', ')}]</span>
                            </span>
                        </div>
                        <div class="step-finish-wrap">
                            <span class="step-param-lbl" style="display:block;margin-bottom:8px;">Finish [P${s.process}] → <strong class="clr-green">true</strong></span>
                            ${buildFinishTable(s.finish)}
                        </div>
                        <div class="step-seq-sofar">
                            <span class="step-param-lbl">Sequence so far</span>
                            <span class="seq-chain">${s.seq.map(p => `<span class="seq-node">P${p}</span>`).join('<span class="seq-arrow">→</span>')}</span>
                        </div>
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <div class="step-card-header">
                        <span class="step-num">Step ${idx + 2}</span>
                        <span class="step-tag tag-wait">⚠ P${s.process} — Must Wait</span>
                    </div>
                    <div class="step-card-body">
                        <div class="step-compare">
                            <span class="vec-label">Need[P${s.process}]</span>
                            <span class="vec-val vec-pink">[${s.need.join(', ')}]</span>
                            <span class="vec-op op-gt">&gt;</span>
                            <span class="vec-label">Work</span>
                            <span class="vec-val vec-blue">[${s.work.join(', ')}]</span>
                            <span class="vec-check check-no">✗ Insufficient</span>
                        </div>
                        <p class="wait-note">⚠️ P${s.process} must wait — insufficient resources available.</p>
                    </div>
                `;
            }
            cardsEl.appendChild(card);
        });
    }

    // ── Final Outcome Card ────────────────────────────────────
    const finalCard = document.createElement('div');
    finalCard.className = `step-card ${safe ? 'step-card-safe-final' : 'step-card-unsafe-final'}`;
    finalCard.style.animationDelay = `${(traceSteps.length + 1) * 0.07}s`;

    if (safe) {
        const seqStr = seq.map(p => `<span class="seq-node seq-node-lg">P${p}</span>`).join('<span class="seq-arrow">→</span>');
        finalCard.innerHTML = `
            <div class="step-card-header">
                <span class="step-num">Final</span>
                <span class="step-tag tag-safe">✅ System is in a SAFE STATE</span>
            </div>
            <div class="step-card-body">
                <div class="safe-state-banner">
                    <div class="safe-icon-wrap"><i class="fas fa-circle-check"></i></div>
                    <div>
                        <div class="safe-title">Safe State Confirmed</div>
                        <div class="safe-subtitle">All ${N} processes can complete. No deadlock possible.</div>
                    </div>
                </div>
                <div class="final-seq-wrap">
                    <span class="step-param-lbl">Safe Sequence</span>
                    <div class="seq-chain seq-chain-final">${seqStr}</div>
                </div>
            </div>
        `;
    } else {
        finalCard.innerHTML = `
            <div class="step-card-header">
                <span class="step-num">Final</span>
                <span class="step-tag tag-unsafe">❌ System is in an UNSAFE STATE</span>
            </div>
            <div class="step-card-body">
                <div class="unsafe-state-banner">
                    <div class="unsafe-icon-wrap"><i class="fas fa-skull-crossbones"></i></div>
                    <div>
                        <div class="unsafe-title">Deadlock Risk Detected</div>
                        <div class="unsafe-subtitle">Only ${seq.length} of ${N} processes could be ordered safely.</div>
                    </div>
                </div>
            </div>
        `;
    }
    cardsEl.appendChild(finalCard);

    // Show the trace container
    container.classList.remove('hidden');
}

/**
 * Builds a small Finish status table (P0…Pn-1 → true/false).
 * @param {boolean[]} finishArr  - current finish state
 * @returns {string}  HTML string
 */
function buildFinishTable(finishArr) {
    const headers = finishArr.map((_, i) => `<th>P${i}</th>`).join('');
    const cells = finishArr.map(v =>
        `<td class="${v ? 'finish-true' : 'finish-false'}">${v ? 'true' : 'false'}</td>`
    ).join('');
    return `
        <table class="finish-table">
            <thead><tr>${headers}</tr></thead>
            <tbody><tr>${cells}</tr></tbody>
        </table>
    `;
}

/**
 * Builds the What-If Simulation Snapshot table showing modified
 * rows/cells highlighted in cyan.
 * @param {number[]}   simAvail  - Available after request
 * @param {number[][]} simAlloc  - Allocation after request
 * @param {number[][]} simNeed   - Need after request
 * @param {number}     pid       - process index that made request
 * @param {number[]}   req       - request vector
 */
function buildSimSnapshotTable(simAvail, simAlloc, simNeed, pid, req) {
    const wrap = getEl('req-sim-table');
    wrap.innerHTML = '';

    // Build a combined table: columns = P | R0..Rm-1 (Alloc) | R0..Rm-1 (Need) | R0..Rm-1 (Avail)
    const tbl = document.createElement('table');
    tbl.className = 'data-table sim-table';

    // Header row
    const thead = tbl.createTHead();
    const hRow = thead.insertRow();
    const addTh = (txt, colspan = 1, cls = '') => {
        const th = document.createElement('th');
        th.textContent = txt;
        if (colspan > 1) th.colSpan = colspan;
        if (cls) th.className = cls;
        hRow.appendChild(th);
    };
    addTh('');
    addTh('Allocation', M, 'sim-col-group');
    addTh('Need', M, 'sim-col-group');
    addTh('Available', M, 'sim-col-group sim-col-avail-hdr');

    // Sub-header
    const hRow2 = thead.insertRow();
    const addTh2 = (txt, cls = '') => {
        const th = document.createElement('th');
        th.textContent = txt;
        if (cls) th.className = cls;
        hRow2.appendChild(th);
    };
    addTh2('');
    for (let j = 0; j < M; j++) addTh2(`R${j}`);
    for (let j = 0; j < M; j++) addTh2(`R${j}`);
    for (let j = 0; j < M; j++) addTh2(`R${j}`, 'sim-avail-sub');

    // Data rows
    const tbody = tbl.createTBody();
    for (let i = 0; i < N; i++) {
        const tr = tbody.insertRow();

        // Process label
        const lbl = tr.insertCell();
        lbl.className = 'proc-label';
        lbl.textContent = `P${i}`;

        // Allocation cells
        for (let j = 0; j < M; j++) {
            const td = tr.insertCell();
            td.textContent = simAlloc[i][j];
            // Highlight the modified cell (pid row, where req[j]>0)
            if (i === pid && req[j] > 0) {
                td.className = 'sim-modified-cell';
                td.title = `+${req[j]} (request applied)`;
            }
        }

        // Need cells
        for (let j = 0; j < M; j++) {
            const td = tr.insertCell();
            td.textContent = simNeed[i][j];
            if (i === pid && req[j] > 0) {
                td.className = 'sim-modified-cell';
                td.title = `-${req[j]} (request applied)`;
            }
        }

        // Available (only meaningful on first row; show on all for alignment)
        for (let j = 0; j < M; j++) {
            const td = tr.insertCell();
            if (i === 0) {
                td.textContent = simAvail[j];
                if (req[j] > 0) {
                    td.className = 'sim-modified-cell sim-avail-cell';
                    td.title = `-${req[j]} (request applied)`;
                } else {
                    td.className = 'sim-avail-cell';
                }
            } else {
                td.textContent = '—';
                td.className = 'sim-avail-cell sim-avail-empty';
            }
        }
    }

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
}


/* ━━━━━━━━━━━━━━━━━  RANDOM DATA FILLER  ━━━━━━━━━━━━━━━━━━━━━━
 *  Generates valid random matrices:
 *    Max[i][j]   = random in [1, 9]
 *    Alloc[i][j] = random in [0, Max[i][j]]   ensures Alloc ≤ Max
 *    Avail[j]    = random in [1, 8]
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function fillRandom() {
    if (N === 0 || M === 0) {
        showToast('Generate matrices first!', 'warning');
        return;
    }

    for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
            const maxVal = rand(1, 9);
            const allocVal = rand(0, maxVal);
            getEl(`max-${i}-${j}`).value = maxVal;
            getEl(`alloc-${i}-${j}`).value = allocVal;
            computeNeedCell(i, j);
        }
    }

    for (let j = 0; j < M; j++) {
        getEl(`avail-0-${j}`).value = rand(1, 8);
    }

    clearResultGlow();
    removeResultBanner();
    stepStop();

    showToast('Matrices filled with valid random data!', 'info');
    termLog('> Random data populated. Ready for analysis.', 'info');
}


/* ━━━━━━━━━━━━━━━━━  RESET  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function resetAll() {
    N = 0;
    M = 0;
    allocMatrix = []; maxMatrix = []; needMatrix = []; availVector = [];

    getEl('num-processes').value = '5';
    getEl('num-resources').value = '3';

    ['cont-allocation', 'cont-max', 'cont-need', 'cont-available'].forEach(id => {
        getEl(id).innerHTML = '';
    });

    getEl('section-matrices').classList.add('hidden');
    getEl('section-request').classList.add('hidden');
    getEl('exec-trace-container').classList.add('hidden');
    getEl('section-req-dashboard').classList.add('hidden');

    clearResultGlow();
    removeResultBanner();
    resetDashboard();
    stepStop();
    clearLog();

    termLog('$ bankers_sim --reset', 'sys');
    termLog('> Simulator cleared. Configure parameters to begin.', 'info');
}


/* ━━━━━━━━━━━━━━━━━  THEME TOGGLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function toggleTheme() {
    const html = document.documentElement;
    html.classList.toggle('light');
    const icon = getEl('btn-dark-toggle').querySelector('i');
    if (html.classList.contains('light')) {
        icon.className = 'fas fa-sun';
    } else {
        icon.className = 'fas fa-moon';
    }
}


/* ━━━━━━━━━━━━━━━━━  TERMINAL LOG  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Appends a styled line to the terminal body.
 *  type: 'sys' | 'info' | 'step' | 'ok' | 'warn' | 'err'
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

function termLog(text, type = 'info') {
    const body = getEl('log-body');
    const line = document.createElement('span');
    line.className = `log-line log-${type}`;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    line.textContent = type === 'sys' ? text : `[${ts}]  ${text}`;
    body.appendChild(line);
    // Auto-scroll terminal body to bottom
    body.scrollTop = body.scrollHeight;
}

function clearLog() {
    const body = getEl('log-body');
    body.innerHTML = '';
    termLog('$ bankers_sim --log-cleared', 'sys');
}


/* ━━━━━━━━━━━━━━━━━  TOAST NOTIFICATIONS  ━━━━━━━━━━━━━━━━━━━━━
 *  Auto-dismisses after 5 s with a slide-out animation.
 *  Each toast has its own timer — stacks correctly.
 *  A shrinking timer bar gives a visual countdown.
 *  Click any toast to dismiss immediately.
 *  type: 'success' | 'error' | 'warning' | 'info'
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

const TOAST_ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
};

// Auto-dismiss duration: 5000 ms = 5 seconds
const TOAST_DURATION = 5000;

function showToast(message, type = 'info') {
    const container = getEl('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = document.createElement('i');
    icon.className = `fas ${TOAST_ICONS[type] || 'fa-circle-info'} toast-icon`;

    const msg = document.createElement('span');
    msg.textContent = message;
    msg.style.flex = '1';

    // Shrinking timer bar — CSS @keyframes toastTimer drives width 100%→0%
    const timer = document.createElement('div');
    timer.className = 'toast-timer';

    toast.append(icon, msg, timer);
    container.appendChild(toast);

    // Auto-dismiss: play slide-out animation after TOAST_DURATION ms,
    // then remove from DOM after the animation completes (~480 ms).
    const dismissTimer = setTimeout(() => {
        toast.classList.add('slide-out');
        setTimeout(() => toast.remove(), 480);
    }, TOAST_DURATION);

    // Click-to-dismiss — clears the auto-dismiss timer
    toast.addEventListener('click', () => {
        clearTimeout(dismissTimer);
        toast.classList.add('slide-out');
        setTimeout(() => toast.remove(), 480);
    }, { once: true });
}


/* ━━━━━━━━━━━━━━━━━  GLOW FEEDBACK  ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function setResultGlow(isSafe) {
    const target = getEl('section-matrices');
    target.classList.remove('glow-safe', 'glow-unsafe');
    target.classList.add(isSafe ? 'glow-safe' : 'glow-unsafe');
}

function clearResultGlow() {
    const target = getEl('section-matrices');
    if (target) target.classList.remove('glow-safe', 'glow-unsafe');
}


/* ━━━━━━━━━━━━━━━━━  RESULT BANNER  ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function injectResultBanner(isSafe, seqStr, parent) {
    removeResultBanner();

    const banner = document.createElement('div');
    banner.id = 'result-banner';
    banner.className = `result-banner ${isSafe ? 'safe' : 'unsafe'}`;

    const icon = document.createElement('i');
    icon.className = isSafe
        ? 'fas fa-circle-check ri'
        : 'fas fa-skull-crossbones ri';

    const text = document.createElement('span');
    text.innerHTML = isSafe
        ? `<strong>SAFE STATE</strong> — Sequence: <code>${seqStr}</code>`
        : '<strong>UNSAFE STATE</strong> — Deadlock may occur with current resource levels.';

    banner.append(icon, text);
    parent.appendChild(banner);
}

function removeResultBanner() {
    const old = document.getElementById('result-banner');
    if (old) old.remove();
}


/* ━━━━━━━━━━━━━━━━━  ROW HIGHLIGHTS  ━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Applies a single highlight class to all three matrix rows for process i.
 */
function highlightRows(i, cls) {
    clearRowHighlights();
    ['alloc', 'max', 'need'].forEach(prefix => {
        const row = document.getElementById(`tr-${prefix}-${i}`);
        if (row) row.classList.add(cls);
    });
}

function clearRowHighlights() {
    document.querySelectorAll('tr.row-checking, tr.row-success, tr.row-fail').forEach(tr => {
        tr.classList.remove('row-checking', 'row-success', 'row-fail');
    });
}



/* ━━━━━━━━━━━━━━━━━  PDF EXPORT  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Strategy: instead of capturing the dark glassmorphism DOM
 *  (which renders as a blank white page), we build a completely
 *  separate, print-safe HTML report inside #pdf-capture, styled
 *  exclusively with .pdf-render classes that force white/black.
 *
 *  Steps:
 *  1. Build the report markup from current JS state arrays.
 *  2. Inject it into #pdf-capture and make it visible.
 *  3. Run html2pdf on that element.
 *  4. Hide and clear it when done.
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

// Last known safety result — stored by runSafetyUI so PDF can reference it.
let _lastPdfResult = null;  // { safe, seq, utilPct, completePct }

function exportPDF() {
    if (N === 0) {
        showToast('Generate matrices before exporting!', 'warning');
        return;
    }

    showToast('Building PDF report…', 'info');
    termLog('> Initiating PDF export (high-contrast mode)...', 'info');

    // ── 1. Build the report HTML ─────────────────────────────
    const res = _lastPdfResult;
    const ts = new Date().toLocaleString('en-IN', { hour12: true });

    let html = `
    <div class="pdf-render" style="background:#fff;padding:28px 32px;font-family:Inter,Arial,sans-serif;">

      <!-- TITLE BLOCK -->
      <div class="pdf-title-block">
        <div class="pdf-title">&#x1F4CA; Banker's Algorithm — Simulation Report</div>
        <div class="pdf-subtitle">Operating Systems Lab &nbsp;·&nbsp; Deadlock Avoidance &nbsp;·&nbsp; Generated ${ts}</div>
      </div>

      <!-- SYSTEM INFO -->
      <div class="pdf-section-title">&#x2699; System Parameters</div>
      <p style="font-size:12px;margin:4px 0 14px;">
        Processes (n) = <strong>${N}</strong> &nbsp;|&nbsp;
        Resource Types (m) = <strong>${M}</strong> &nbsp;|&nbsp;
        Resource Labels = ${Array.from({ length: M }, (_, j) => `R${j}`).join(', ')}
      </p>

      <!-- MATRICES (4 tables) -->
      <div class="pdf-section-title">&#x1F4CB; Resource Matrices</div>
      <div class="pdf-matrices">
        ${buildPdfMatrix('Allocation Matrix', allocMatrix, false)}
        ${buildPdfMatrix('Max Demand Matrix', maxMatrix, false)}
        ${buildPdfMatrix('Need Matrix&nbsp;<small>(Max − Allocation)</small>', needMatrix, true)}
        ${buildPdfAvail()}
      </div>

      <!-- EXECUTION TRACE (only if safety check was run) -->
      ${res ? buildPdfTrace(res) : '<p style="font-size:11px;color:#6b7280;margin-top:8px;">Run the Safety Check to generate an execution trace.</p>'}

      <!-- DASHBOARD SUMMARY (only if safety check was run) -->
      ${res ? buildPdfDashboard(res) : ''}

    </div>`;

    // ── 2. Inject into capture zone and reveal ───────────────
    const zone = getEl('pdf-capture');
    zone.innerHTML = html;
    zone.style.display = 'block';
    zone.style.position = 'absolute';
    zone.style.top = '-99999px';   // off-screen but renderable
    zone.style.left = '0';
    zone.style.width = '1100px';   // fixed width so html2canvas has a stable viewport
    zone.style.background = '#ffffff';

    // ── 3. Render with html2pdf ─────────────────────────────
    html2pdf()
        .set({
            margin: [0.35, 0.35, 0.35, 0.35],
            filename: `Bankers_Report_${Date.now()}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                background: '#ffffff',
                logging: false,
                // Force white canvas background
                onclone: (doc) => {
                    doc.body.style.background = '#ffffff';
                },
            },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' },
        })
        .from(zone.firstElementChild)   // render just the .pdf-render div
        .save()
        .then(() => {
            showToast('PDF saved successfully!', 'success');
            termLog('> PDF report exported to disk.', 'ok');
        })
        .catch(err => {
            showToast('PDF export failed — see console.', 'error');
            console.error('[PDF export]', err);
        })
        .finally(() => {
            // ── 4. Hide and clear the zone ───────────────────
            zone.style.display = 'none';
            zone.innerHTML = '';
        });
}

/* ── PDF Content Builders ────────────────────────────────────── */

/**
 * Builds one matrix table for the PDF.
 * @param {string}    label   - display heading
 * @param {number[][]} data   - N×M matrix
 * @param {boolean}   isNeed  - if true, apply need-cell class to data cells
 */
function buildPdfMatrix(label, data, isNeed) {
    const headers = Array.from({ length: M }, (_, j) => `<th>R${j}</th>`).join('');
    const rows = data.map((row, i) => {
        const cells = row.map(v => `<td class="${isNeed ? 'need-cell' : ''}">${v}</td>`).join('');
        return `<tr><td class="proc-label">P${i}</td>${cells}</tr>`;
    }).join('');

    return `
    <div class="pdf-matrix-block">
      <div class="pdf-matrix-label">${label}</div>
      <table>
        <thead><tr><th></th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Builds the Available resources table (single row).
 */
function buildPdfAvail() {
    const headers = Array.from({ length: M }, (_, j) => `<th>R${j}</th>`).join('');
    const cells = availVector.map(v => `<td>${v}</td>`).join('');

    return `
    <div class="pdf-matrix-block">
      <div class="pdf-matrix-label">Available Resources</div>
      <table>
        <thead><tr><th></th>${headers}</tr></thead>
        <tbody><tr class="pdf-avail-row"><td class="proc-label">Avail</td>${cells}</tr></tbody>
      </table>
    </div>`;
}

/**
 * Builds the execution trace section:
 *  - Init panel (shows Work = Available)
 *  - One row per process (exec or wait)
 *  - Result banner (SAFE / UNSAFE)
 */
function buildPdfTrace(res) {
    const { safe, seq, traceSteps } = res;

    let panels = `
    <div class="pdf-trace-panel pdf-trace-init">
      <span class="pdf-trace-hdr">&#x25BA; Initialization</span>
      Work = Available = [${availVector.join(', ')}] &nbsp;|&nbsp; Finish = [${Array(N).fill('false').join(', ')}]
    </div>`;

    if (traceSteps && traceSteps.length) {
        traceSteps.forEach((s, idx) => {
            if (s.type === 'execute') {
                panels += `
                <div class="pdf-trace-panel pdf-trace-exec">
                  <span class="pdf-trace-hdr">&#x2714; Step ${idx + 1} — P${s.process} executes</span>
                  Need[P${s.process}] = [${s.need.join(', ')}] &le; Work = [${s.workBefore.join(', ')}] &nbsp; &rarr; &nbsp;
                  Work = [${s.workAfter.join(', ')}] &nbsp;|&nbsp; Sequence so far: ${s.seq.map(p => `P${p}`).join(' → ')}
                </div>`;
            } else if (s.type === 'wait') {
                panels += `
                  <div class="pdf-trace-panel pdf-trace-wait">
                  <span class="pdf-trace-hdr">&#x23F3; Step ${idx + 1} — P${s.process} must wait</span>
                  Need[P${s.process}] = [${s.need.join(', ')}] &gt; Work = [${s.work.join(', ')}] — insufficient resources.
                </div>`;
            }
        });
    }

    const resultHtml = safe
        ? `<div class="pdf-result-safe">
             <div class="pdf-result-label">&#x2705; System is in a SAFE STATE</div>
             <div class="pdf-seq-line">Safe Sequence: ${seq.map(p => `P${p}`).join(' → ')}</div>
             <p style="font-size:11px;margin-top:6px;color:#166534;">All ${N} processes can complete. No deadlock possible.</p>
           </div>`
        : `<div class="pdf-result-unsafe">
             <div class="pdf-result-label">&#x274C; System is in an UNSAFE STATE</div>
             <p style="font-size:11px;margin-top:6px;color:#7f1d1d;">Deadlock risk — only ${seq.length} of ${N} processes could be ordered safely.</p>
           </div>`;

    return `
    <div class="pdf-section-title">&#x1F50D; Safety Algorithm — Execution Trace</div>
    ${panels}
    ${resultHtml}`;
}

/**
 * Builds the three-cell dashboard summary table.
 */
function buildPdfDashboard(res) {
    const { safe, seq, utilPct, completePct } = res;

    return `
    <div class="pdf-section-title">&#x1F4CA; Performance Dashboard Summary</div>
    <div class="pdf-dashboard">
      <div class="pdf-metric-cell">
        <span class="pdf-metric-value">${utilPct ?? '—'}%</span>
        <span class="pdf-metric-key">Resource Utilisation</span>
      </div>
      <div class="pdf-metric-cell">
        <span class="pdf-metric-value">${safe ? 'Stable' : 'Critical'}</span>
        <span class="pdf-metric-key">System Reliability</span>
      </div>
      <div class="pdf-metric-cell">
        <span class="pdf-metric-value">${completePct ?? '—'}%</span>
        <span class="pdf-metric-key">Process Completion (${seq.length}/${N})</span>
      </div>
    </div>`;
}




/* ━━━━━━━━━━━━━━━━━  UTILITIES  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Shorthand for getElementById */
const getEl = id => document.getElementById(id);

/** Parse an integer from an input field by id */
const parseCell = id => parseInt(getEl(id)?.value ?? '', 10);

/** Random integer in [min, max] inclusive */
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Add a th or td cell to a row */
function addCell(row, tag, text) {
    const cell = document.createElement(tag);
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
}


/* ━━━━━━━━━━━━━━━━━  PERFORMANCE DASHBOARD  ━━━━━━━━━━━━━━━━━
 *
 *  updateDashboard(safe, seq)
 *  Called immediately after the Safety Algorithm result is known.
 *  Computes three metrics and animates them into the dashboard cards:
 *
 *  1. Resource Utilisation %
 *       = total allocated across all processes & resources
 *         ÷ (allocated + available) × 100
 *
 *  2. System Reliability Status
 *       ‘Stable’  with pulsing green dot  when safe
 *       ‘Critical’ with pulsing red dot   when unsafe
 *
 *  3. Process Completion Rate
 *       = |safe_sequence| ÷ N × 100
 *       Animated progress bar from 0 → rate%
 *
 *  resetDashboard() — hides the section and zeros everything.
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━*/

/**
 * Injects an SVG linearGradient into a <defs> block so the ring-fill
 * can reference `url(#ring-gradient)`. Called once per page load.
 */
function ensureRingGradient() {
    const svg = document.querySelector('.ring-svg');
    if (!svg || svg.querySelector('#ring-gradient')) return; // already injected

    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'ring-gradient');
    grad.setAttribute('x1', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%');
    grad.setAttribute('y2', '0%');

    // Purple → Blue gradient to match brand palette
    const stop1 = document.createElementNS(ns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#7c3aed');

    const stop2 = document.createElementNS(ns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#2563eb');

    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.prepend(defs);
}

/**
 * Updates all three dashboard metric cards.
 * @param {boolean}  safe  - result from safetyAlgorithm()
 * @param {number[]} seq   - safe sequence array (may be empty if unsafe)
 */
function updateDashboard(safe, seq) {
    // ── Ensure SVG gradient is in the DOM ────────────────────
    ensureRingGradient();

    // ── Reveal the dashboard section with animation ───────────
    const section = getEl('section-dashboard');
    section.classList.remove('hidden');
    section.classList.remove('fade-in');
    void section.offsetWidth;          // force reflow to re-trigger animation
    section.classList.add('fade-in');

    // ─────────────────────────────────────────────────────────
    // METRIC 1: Resource Utilisation
    //   totalAllocated = sum of all allocMatrix[i][j]
    //   totalCapacity  = totalAllocated + sum of availVector[j]
    // ─────────────────────────────────────────────────────────
    let totalAllocated = 0;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
            totalAllocated += allocMatrix[i][j];
        }
    }
    const totalAvailable = availVector.reduce((a, b) => a + b, 0);
    const totalCapacity = totalAllocated + totalAvailable;

    // Guard divide-by-zero when all resources are 0
    const utilPct = totalCapacity > 0
        ? Math.round((totalAllocated / totalCapacity) * 100)
        : 0;

    // Circumference of r=50 circle: 2πr ≈ 314
    const circumference = 314;
    const filled = Math.round((utilPct / 100) * circumference);

    // Animate the SVG ring by setting stroke-dasharray
    const ringFill = getEl('ring-fill');
    // Start from 0 and let CSS transition drive to target (0.8s ease)
    ringFill.setAttribute('stroke-dasharray', `0 ${circumference}`);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            ringFill.setAttribute('stroke-dasharray', `${filled} ${circumference - filled}`);
        });
    });

    getEl('ring-pct').textContent = `${utilPct}%`;
    getEl('util-sub').textContent =
        `${totalAllocated} / ${totalCapacity} total resource units allocated.`;

    // Flash card to draw attention when updated
    flashCard('dash-utilisation');

    // ─────────────────────────────────────────────────────────
    // METRIC 2: System Reliability Status
    // ─────────────────────────────────────────────────────────
    const badge = getEl('reliability-badge');
    const dot = getEl('reliability-dot');
    const badgeTxt = getEl('reliability-text');
    const relSub = getEl('reliability-sub');

    badge.classList.remove('stable', 'critical');
    badge.classList.add(safe ? 'stable' : 'critical');
    badgeTxt.textContent = safe ? 'Stable' : 'Critical';
    relSub.textContent = safe
        ? 'No deadlock risk. All processes can complete.'
        : 'Deadlock risk! Some processes cannot finish.';

    flashCard('dash-reliability');

    // ─────────────────────────────────────────────────────────
    // METRIC 3: Process Completion Rate
    // ─────────────────────────────────────────────────────────
    const completed = seq.length;
    const completePct = N > 0 ? Math.round((completed / N) * 100) : 0;

    getEl('completion-count').textContent = completed;
    getEl('completion-total').textContent = N;
    getEl('completion-pct').textContent = `${completePct}%`;

    // Colour the count number green if all finished, red otherwise
    const countEl = getEl('completion-count');
    countEl.style.color = completed === N ? 'var(--clr-green)' : 'var(--clr-red)';

    // Animate the progress bar — start at 0, then set target width
    const bar = getEl('completion-bar');
    bar.style.width = '0%';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            bar.style.width = `${completePct}%`;
            // Update gradient to green when all done, magenta when partial
            bar.style.background = completed === N
                ? 'linear-gradient(90deg, #059669, #10b981)'
                : 'linear-gradient(90deg, #db2777, #f43f5e)';
        });
    });

    flashCard('dash-completion');

    termLog(`> Dashboard updated: Utilisation ${utilPct}%, Reliability ${safe ? 'Stable' : 'Critical'}, Completion ${completePct}%`, 'step');
}

/** Briefly flashes a dashboard card with a purple glow to signal an update. */
function flashCard(cardId) {
    const card = getEl(cardId);
    if (!card) return;
    card.classList.remove('flash');
    void card.offsetWidth;   // reflow to re-trigger animation
    card.classList.add('flash');
}

/** Hides the dashboard section and resets all metrics to their zero state. */
function resetDashboard() {
    const section = getEl('section-dashboard');
    if (section) section.classList.add('hidden');

    // Zero the ring
    const ringFill = getEl('ring-fill');
    if (ringFill) ringFill.setAttribute('stroke-dasharray', '0 314');
    const ringPct = getEl('ring-pct');
    if (ringPct) ringPct.textContent = '0%';
    const utilSub = getEl('util-sub');
    if (utilSub) utilSub.textContent = 'Run Safety Check to compute.';

    // Reset reliability badge
    const badge = getEl('reliability-badge');
    if (badge) badge.classList.remove('stable', 'critical');
    const badgeTxt = getEl('reliability-text');
    if (badgeTxt) badgeTxt.textContent = 'Unknown';
    const relSub = getEl('reliability-sub');
    if (relSub) relSub.textContent = 'Awaiting safety evaluation.';

    // Zero completion bar
    const bar = getEl('completion-bar');
    if (bar) bar.style.width = '0%';
    const cnt = getEl('completion-count');
    if (cnt) { cnt.textContent = '0'; cnt.style.color = ''; }
    const tot = getEl('completion-total');
    if (tot) tot.textContent = '0';
    const pct = getEl('completion-pct');
    if (pct) pct.textContent = '0%';
}
