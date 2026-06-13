// components/KeyTest.jsx
//
// Two modes:
//   Visual    — keyboard diagram with live highlights using the verified matrix map
//   Raw Matrix — full [row,col] grid from the VIA firmware for diagnosing mapping issues

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { HALVES } from '../keyboardLayout';
import { buildKeyLedColors, buildTapDanceBadges } from '../keyDerived';
import KeyboardGrid from './KeyboardGrid';
import './KeyTest.css';
import './TapDanceEditor.css'; // unlock overlay styles

const MO_BASE = 0x5220; // MO(n) = 0x5220 | n
const MO_MASK = 0xFFF0;
const LT_BASE = 0x4000; // LT(n,key) = 0x4000 | (n<<8) | key
const LT_HMASK = 0xF000;
const ROWS = 10; // QMK matrix: rows 0-4 = left half, rows 5-9 = right half
const COLS = 6;

// Map hardware (matrixRow, matrixCol) → {viaRow, viaCol} for all keys.
// Built once at module load from the confirmed HALVES layout.
const HW_TO_VIA = new Map(
  [...HALVES.left, ...HALVES.right].map(k => [
    `${k.matrixRow},${k.matrixCol}`,
    { viaRow: k.viaRow, viaCol: k.viaCol },
  ])
);

// Returns the highest layer activated by held MO() or LT() keys.
// Translates hardware matrix positions to VIA-buffer positions before
// looking up keycodes in layer0 (which is indexed by VIA row/col).
function computeActiveLayer(matrixState, layer0) {
  let highest = 0;
  for (let row = 0; row < matrixState.length; row++) {
    for (let col = 0; col < (matrixState[row]?.length ?? 0); col++) {
      if (!matrixState[row][col]) continue;
      const via = HW_TO_VIA.get(`${row},${col}`);
      if (!via) continue;
      const code = layer0?.[via.viaRow]?.[via.viaCol];
      if (code === undefined) continue;
      if ((code & MO_MASK) === MO_BASE) {              // MO(n)
        const n = code & 0x000f;
        if (n > highest) highest = n;
      } else if ((code & LT_HMASK) === LT_BASE) {      // LT(n, key)
        const n = (code >> 8) & 0x0f;
        if (n > highest) highest = n;
      }
    }
  }
  return highest;
}

// ─── Polling hook ────────────────────────────────────────────────────────────

function useMatrixPolling(active) {
  const [matrixState, setMatrixState] = useState(null);
  const [pollError, setPollError] = useState(null);
  // Live firmware layer via the custom GET_ACTIVE_LAYER raw-HID command.
  // null = unknown/unsupported (old firmware) → callers fall back to MO/LT
  // inference. Support is sticky once seen so one failed poll doesn't flick
  // the UI back to inference.
  const [firmwareLayer, setFirmwareLayer] = useState(null);

  // ── Matrix poll ──────────────────────────────────────────────────────────
  // Fast 50ms loop for live keypress highlighting. Kept fully independent of
  // the layer query below so its responsiveness never depends on a second HID
  // round-trip. Own in-flight guard so a slow read can't stack up calls.
  useEffect(() => {
    if (!active) return;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const state = await invoke('get_matrix_state');
        setMatrixState(state);
        setPollError(null);
      } catch (err) {
        setPollError(String(err));
      } finally {
        inFlight = false;
      }
    };
    const id = setInterval(poll, 50);
    poll();
    return () => clearInterval(id);
  }, [active]);

  // ── Layer query ──────────────────────────────────────────────────────────
  // Independent ~200ms loop with its own in-flight guard, so the extra HID
  // round-trip never blocks the matrix poll. Tracks TO/TG/DF/tap-dance layer
  // moves (no key held). Restarts on device change so a previous device's
  // detected support can't pin a stale layer. Gives up after a few empty
  // replies on firmware that lacks the command, to avoid burning a round-trip
  // forever — the caller then falls back to MO/LT inference.
  useEffect(() => {
    if (!active) return;
    setFirmwareLayer(null);
    let inFlight = false;
    let supported = false;
    let misses = 0;
    let id = null;
    const stop = () => { if (id !== null) { clearInterval(id); id = null; } };
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const layer = await invoke('get_active_layer');
        if (layer !== null && layer !== undefined) {
          supported = true;
          setFirmwareLayer(layer);
        } else if (!supported && ++misses >= 3) {
          setFirmwareLayer(null); // old firmware — stop querying, stay on inference
          stop();
        }
      } catch { /* transient layer-poll failure — keep last known value, keep polling */ }
      finally { inFlight = false; }
    };
    id = setInterval(poll, 200);
    poll();
    return () => stop();
  }, [active]);

  return { matrixState, pollError, firmwareLayer };
}

// ─── Raw Matrix view ─────────────────────────────────────────────────────────

function RawMatrixView({ matrixState }) {
  const [discovered, setDiscovered] = useState([]);
  const prevRef = useRef(null);

  // Detect rising edges (not-pressed → pressed) and append to discovery log.
  useEffect(() => {
    if (!matrixState) return;
    const prev = prevRef.current;
    if (prev) {
      const fresh = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (matrixState[r]?.[c] && !prev[r]?.[c]) {
            const key = `R${r}C${c}`;
            fresh.push({ row: r, col: c, key });
          }
        }
      }
      if (fresh.length) {
        setDiscovered((prev) => {
          const seen = new Set(prev.map((k) => k.key));
          return [...prev, ...fresh.filter((k) => !seen.has(k.key))];
        });
      }
    }
    prevRef.current = matrixState;
  }, [matrixState]);

  const copyLog = useCallback(() => {
    const text = discovered.map((k, i) => `${i + 1}. R${k.row}C${k.col}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  }, [discovered]);

  return (
    <div className="raw-matrix-view">
      <p className="raw-hint">
        Press each physical key. Note which cell lights up — that's the true <code>[row, col]</code> for that key.
      </p>

      {/* 10×6 live grid */}
      <div className="raw-grid">
        <div className="raw-col-labels">
          <div className="raw-corner" />
          {Array.from({ length: COLS }, (_, c) => (
            <div key={c} className="raw-axis-label">C{c}</div>
          ))}
        </div>
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="raw-row">
            <div className="raw-axis-label">R{r}</div>
            {Array.from({ length: COLS }, (_, c) => {
              const pressed = matrixState?.[r]?.[c] ?? false;
              const seen = discovered.some((k) => k.row === r && k.col === c);
              return (
                <div
                  key={c}
                  className={`raw-cell${pressed ? ' pressed' : ''}${seen && !pressed ? ' seen' : ''}`}
                  title={`Row ${r}, Col ${c}`}
                >
                  R{r}C{c}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Discovery log */}
      <div className="discovery-log">
        <div className="discovery-header">
          <span>Discovery log — {discovered.length} / 60 keys found</span>
          <div className="discovery-actions">
            <button onClick={copyLog} disabled={discovered.length === 0}>Copy</button>
            <button onClick={() => { setDiscovered([]); prevRef.current = null; }}>Clear</button>
          </div>
        </div>
        <div className="discovery-entries">
          {discovered.length === 0
            ? <span className="discovery-empty">Press keys to populate…</span>
            : discovered.map((k, i) => (
                <span key={k.key} className="discovery-entry">
                  {i + 1}.&nbsp;R{k.row}C{k.col}
                </span>
              ))
          }
        </div>
      </div>
    </div>
  );
}

// ─── Visual view (existing keyboard diagram) ─────────────────────────────────

function VisualView({ matrixState, allLayers, firmwareLayer, customLabels, lightingPerKeyColors, tapDanceKeys, macroDescriptions, tapDanceDescriptions, hideHint = false }) {
  // Prefer the firmware-reported layer (tracks TO/TG/DF/tap-dance layer_move
  // with no key held); fall back to held-MO/LT inference on old firmware.
  // Clamp defensively in case layer_state reports a layer beyond what we read.
  const inferredLayer = (matrixState && allLayers.length > 0)
    ? computeActiveLayer(matrixState, allLayers[0])
    : 0;
  const activeLayer = Math.min(firmwareLayer ?? inferredLayer, Math.max(allLayers.length - 1, 0));
  const layerKeymap = allLayers[activeLayer];

  // Live pressed keys → key ids. Recomputed every poll tick (50ms): keep cheap.
  const pressedKeys = useMemo(() => {
    if (!matrixState) return null;
    const set = new Set();
    for (const key of [...HALVES.left, ...HALVES.right]) {
      if (matrixState[key.matrixRow]?.[key.matrixCol]) set.add(key.id);
    }
    return set;
  }, [matrixState]);

  // Same derived maps the editor builds for its current layer, but for the
  // live hardware-active layer.
  const keyLedColors = useMemo(
    () => buildKeyLedColors(lightingPerKeyColors?.[activeLayer]),
    [lightingPerKeyColors, activeLayer]
  );
  const tapDanceBadges = useMemo(
    () => buildTapDanceBadges(tapDanceKeys, activeLayer),
    [tapDanceKeys, activeLayer]
  );

  return (
    <>
      <div className="key-test-layer-badge-row">
        <div className={`layer-badge${activeLayer > 0 ? ' layer-badge-active' : ''}`}>
          Layer {activeLayer}
        </div>
        {!hideHint && <span className="key-test-hint">Hold a layer key to switch layers</span>}
      </div>
      <KeyboardGrid
        keymap={layerKeymap}
        currentLayer={activeLayer}
        pressedKeys={pressedKeys}
        readOnly
        keyLedColors={keyLedColors}
        keyBadges={tapDanceBadges}
        customLabels={customLabels}
        macroDescriptions={macroDescriptions}
        tapDanceDescriptions={tapDanceDescriptions}
      />
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function UnlockOverlay({ unlockKeys, onUnlock, onClose }) {
  const [stage, setStage]         = useState('idle');
  const [countdown, setCountdown] = useState(50);
  const pollRef                   = useRef(null);
  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPoll(), []);

  const startUnlock = async () => {
    try {
      await invoke('vial_unlock_start');
      setStage('waiting');
      setCountdown(50);
      pollRef.current = setInterval(async () => {
        try {
          const r = await invoke('vial_unlock_poll');
          setCountdown(r.countdown);
          if (r.unlocked) { stopPoll(); onUnlock(); }
          else if (!r.in_progress && r.countdown === 0) { stopPoll(); setStage('error'); }
        } catch { stopPoll(); setStage('error'); }
      }, 200);
    } catch { setStage('error'); }
  };

  return (
    <div className="unlock-overlay">
      <div className="unlock-box">
        <div className="unlock-icon">🔒</div>
        <h3 className="unlock-title">Keyboard Locked</h3>
        {stage === 'idle' && (
          <>
            <p className="unlock-body">VIAL requires unlock before the matrix state can be read (keylogger protection).</p>
            {unlockKeys.length > 0 && (
              <p className="unlock-keys">Hold: {unlockKeys.map(([r, c]) => `[row ${r}, col ${c}]`).join(' + ')}</p>
            )}
            <div className="unlock-actions">
              <button className="primary" onClick={startUnlock}>Unlock</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
        {stage === 'waiting' && (
          <>
            <p className="unlock-body">Hold the unlock key combination…</p>
            <div className="unlock-progress">
              <div className="unlock-bar" style={{ width: `${((50 - countdown) / 50) * 100}%` }} />
            </div>
            <p className="unlock-countdown">{countdown > 0 ? `${countdown} steps remaining` : 'Completing…'}</p>
          </>
        )}
        {stage === 'error' && (
          <>
            <p className="unlock-body unlock-error">Unlock failed. Hold all required keys continuously.</p>
            <div className="unlock-actions">
              <button className="primary" onClick={() => setStage('idle')}>Try Again</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function KeyTest({ selectedDevice, numLayers = 4, addDebugLog, logPolling = false, customLabels, lightingPerKeyColors, tapDanceKeys, macroDescriptions, tapDanceDescriptions, overlay = false, onEnterOverlay }) {
  const log = addDebugLog ?? (() => {});

  const [allLayers, setAllLayers] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState('visual');
  const [vialStatus, setVialStatus] = useState(null); // null = not yet checked
  const [showUnlock, setShowUnlock] = useState(false);

  const { matrixState, pollError, firmwareLayer } = useMatrixPolling(phase === 'ready');

  // Surface poll errors.
  useEffect(() => {
    if (pollError) {
      const msg = `Key Test matrix poll failed: ${pollError}`;
      setErrorMsg(`Matrix poll failed: ${pollError}`);
      setPhase('error');
      log(msg);
    }
  }, [pollError]);

  // Log keypresses (rising edge only — not-pressed → pressed).
  // Individual key logs are gated by logPolling; the "first press ever" fires once regardless.
  const prevMatrixRef  = useRef(null);
  const everPressedRef = useRef(false);
  const logPollingRef  = useRef(logPolling);
  useEffect(() => { logPollingRef.current = logPolling; }, [logPolling]);

  useEffect(() => {
    if (!matrixState) return;
    const prev = prevMatrixRef.current;
    if (prev) {
      for (let r = 0; r < matrixState.length; r++) {
        for (let c = 0; c < (matrixState[r]?.length ?? 0); c++) {
          if (matrixState[r][c] && !prev[r]?.[c]) {
            if (!everPressedRef.current) {
              everPressedRef.current = true;
              log(`Key Test: matrix data live — first keypress detected [R${r}C${c}]`);
            }
            if (logPollingRef.current) {
              const via  = HW_TO_VIA.get(`${r},${c}`);
              const name = via
                ? ([...HALVES.left, ...HALVES.right].find(k => k.viaRow === via.viaRow && k.viaCol === via.viaCol)?.label ?? '?')
                : '?';
              log(`Key Test: pressed ${name} [R${r}C${c}]`);
            }
          }
        }
      }
    }
    prevMatrixRef.current = matrixState;
  }, [matrixState]);

  // Reload layers + check VIAL lock status whenever the device changes.
  useEffect(() => {
    if (!selectedDevice) { setPhase('idle'); setAllLayers([]); setVialStatus(null); return; }

    setPhase('loading');
    setAllLayers([]);
    log('Key Test: loading layers…');

    let cancelled = false;
    (async () => {
      try {
        // Check VIAL lock status — matrix state requires unlock when VIAL is running.
        const vs = await invoke('detect_vial');
        if (cancelled) return;
        setVialStatus(vs);
        if (vs.supported && !vs.unlocked) {
          setPhase('idle'); // stop here — show unlock prompt
          log('Key Test: VIAL keyboard locked — unlock required for matrix state');
          return;
        }

        const layers = [];
        for (let i = 0; i < numLayers; i++) {
          const layer = await invoke('read_keymap', { layer: i });
          if (cancelled) return;
          layers.push(layer);
        }
        setAllLayers(layers);
        setPhase('ready');
        log(`Key Test: loaded ${numLayers} layers — matrix polling active`);
      } catch (err) {
        if (!cancelled) {
          const msg = `Key Test layer load failed: ${err}`;
          setErrorMsg(`Layer load failed: ${err}`);
          setPhase('error');
          log(msg);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedDevice, numLayers]);

  // VIAL locked — show unlock prompt
  if (vialStatus?.supported && !vialStatus.unlocked && !showUnlock) return (
    <div className="key-test" style={{ position: 'relative' }}>
      <div className="key-test-placeholder" style={{ flexDirection: 'column', gap: 12 }}>
        <span>VIAL keyboard is locked — unlock to enable Key Test</span>
        <button className="primary" onClick={() => setShowUnlock(true)}>Unlock Keyboard</button>
      </div>
    </div>
  );
  if (showUnlock && vialStatus?.supported && !vialStatus.unlocked) return (
    <div className="key-test" style={{ position: 'relative' }}>
      <UnlockOverlay
        unlockKeys={vialStatus.unlock_keys}
        onUnlock={() => {
          setVialStatus(v => ({ ...v, unlocked: true }));
          setShowUnlock(false);
        }}
        onClose={() => setShowUnlock(false)}
      />
    </div>
  );

  if (phase === 'idle') return (
    <div className="key-test-placeholder">Connect your keyboard to use Key Test</div>
  );
  if (phase === 'loading') return (
    <div className="key-test-placeholder">Loading keymap layers…</div>
  );
  if (phase === 'error') return (
    <div className="key-test-placeholder key-test-error-state">{errorMsg}</div>
  );

  // Overlay variant: just the live visual, no header/mode toggle — the
  // KeyboardOverlay wrapper supplies the chrome (drag strip, opacity, exit).
  if (overlay) return (
    <div className="key-test key-test-overlay">
      <VisualView
        matrixState={matrixState}
        allLayers={allLayers}
        firmwareLayer={firmwareLayer}
        customLabels={customLabels}
        lightingPerKeyColors={lightingPerKeyColors}
        tapDanceKeys={tapDanceKeys}
        macroDescriptions={macroDescriptions}
        tapDanceDescriptions={tapDanceDescriptions}
        hideHint
      />
    </div>
  );

  return (
    <div className="key-test">
      <div className="key-test-header">
        <div className="mode-toggle">
          <button
            className={`mode-btn${mode === 'visual' ? ' active' : ''}`}
            onClick={() => setMode('visual')}
          >
            Visual
          </button>
          <button
            className={`mode-btn${mode === 'raw' ? ' active' : ''}`}
            onClick={() => setMode('raw')}
          >
            Raw Matrix
          </button>
        </div>
        <span className="key-test-hint">
          {mode === 'raw'
            ? 'Press every key to map physical positions → matrix coords'
            : 'Press keys on your keyboard'}
        </span>
        {mode === 'visual' && onEnterOverlay && (
          <button
            className="overlay-enter-btn"
            onClick={onEnterOverlay}
            title="Pop out as a resizable always-on-top desktop overlay (Esc to return)"
          >
            Overlay
          </button>
        )}
      </div>

      {mode === 'visual'
        ? <VisualView
            matrixState={matrixState}
            allLayers={allLayers}
            firmwareLayer={firmwareLayer}
            customLabels={customLabels}
            lightingPerKeyColors={lightingPerKeyColors}
            tapDanceKeys={tapDanceKeys}
            macroDescriptions={macroDescriptions}
            tapDanceDescriptions={tapDanceDescriptions}
          />
        : <RawMatrixView matrixState={matrixState} />
      }
    </div>
  );
}
