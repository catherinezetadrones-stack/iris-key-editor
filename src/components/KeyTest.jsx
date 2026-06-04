// components/KeyTest.jsx
//
// Two modes:
//   Visual    — keyboard diagram with live highlights using the verified matrix map
//   Raw Matrix — full [row,col] grid from the VIA firmware for diagnosing mapping issues

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { HALVES, decodeQuantum, getSecondary } from '../keyboardLayout';
import './KeyTest.css';

const MO_BASE = 0x5220; // MO(n) = 0x5220 | n
const MO_MASK = 0xFFF0;
const LT_BASE = 0x4000; // LT(n,key) = 0x4000 | (n<<8) | key
const LT_HMASK = 0xF000;
const ROWS = 10; // QMK matrix: rows 0-4 = left half, rows 5-9 = right half
const COLS = 6;

function labelFor(key, layerKeymap) {
  const code = layerKeymap?.[key.viaRow]?.[key.viaCol];
  if (code === undefined || code === null) return key.label;
  const named = decodeQuantum(code);
  if (named !== null) return named;
  if (code <= 0x00ff) return key.label;
  return `0x${code.toString(16).padStart(4, '0')}`;
}

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
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    const poll = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const state = await invoke('get_matrix_state');
        setMatrixState(state);
        setPollError(null);
      } catch (err) {
        setPollError(String(err));
      } finally {
        inFlightRef.current = false;
      }
    };

    const id = setInterval(poll, 50);
    poll();
    return () => clearInterval(id);
  }, [active]);

  return { matrixState, pollError };
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

function VisualView({ matrixState, allLayers }) {
  const activeLayer = (matrixState && allLayers.length > 0)
    ? computeActiveLayer(matrixState, allLayers[0])
    : 0;
  const layerKeymap = allLayers[activeLayer];

  const renderHalf = (side) => (
    <div className={`keyboard-half ${side}`}>
      <div className="hand-label">{side.toUpperCase()}</div>
      <div className="key-grid">
        {HALVES[side].map((key) => {
          const pressed = matrixState?.[key.matrixRow]?.[key.matrixCol] ?? false;
          return (
            <div
              key={key.id}
              className="key-cell"
              style={{ gridColumn: key.gridColumn, gridRow: key.gridRow, marginTop: key.marginTop }}
            >
              <div className={`test-key${pressed ? ' pressed' : ''}${key.thumb ? ' thumb' : ''}`}>
                {(() => {
                  const code = layerKeymap?.[key.viaRow]?.[key.viaCol];
                  const sub  = getSecondary(code);
                  return (
                    <>
                      {sub && <span className="test-key-sub">{sub}</span>}
                      <span>{labelFor(key, layerKeymap)}</span>
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <div className="key-test-layer-badge-row">
        <div className={`layer-badge${activeLayer > 0 ? ' layer-badge-active' : ''}`}>
          Layer {activeLayer}
        </div>
        <span className="key-test-hint">Hold a layer key to switch layers</span>
      </div>
      <div className="keyboard">
        {renderHalf('left')}
        <div className="keyboard-divider" />
        {renderHalf('right')}
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function KeyTest({ selectedDevice, numLayers = 4 }) {
  const [allLayers, setAllLayers] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState('raw'); // start in raw so user can map first

  const { matrixState, pollError } = useMatrixPolling(phase === 'ready');

  // Surface poll errors.
  useEffect(() => {
    if (pollError) {
      setErrorMsg(`Matrix poll failed: ${pollError}`);
      setPhase('error');
    }
  }, [pollError]);

  // Reload layers whenever the device changes.
  useEffect(() => {
    if (!selectedDevice) { setPhase('idle'); setAllLayers([]); return; }

    setPhase('loading');
    setAllLayers([]);

    let cancelled = false;
    (async () => {
      try {
        const layers = [];
        for (let i = 0; i < numLayers; i++) {
          const layer = await invoke('read_keymap', { layer: i });
          if (cancelled) return;
          layers.push(layer);
        }
        setAllLayers(layers);
        setPhase('ready');
      } catch (err) {
        if (!cancelled) { setErrorMsg(`Layer load failed: ${err}`); setPhase('error'); }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedDevice, numLayers]);

  if (phase === 'idle') return (
    <div className="key-test-placeholder">Connect your keyboard to use Key Test</div>
  );
  if (phase === 'loading') return (
    <div className="key-test-placeholder">Loading keymap layers…</div>
  );
  if (phase === 'error') return (
    <div className="key-test-placeholder key-test-error-state">{errorMsg}</div>
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
      </div>

      {mode === 'visual'
        ? <VisualView matrixState={matrixState} allLayers={allLayers} />
        : <RawMatrixView matrixState={matrixState} />
      }
    </div>
  );
}
