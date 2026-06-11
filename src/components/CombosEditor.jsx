import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { decodeQuantum } from '../keyboardLayout';
import KeyPicker from './KeyPicker';
import './CombosEditor.css';

const KC_NONE = 0x0000;
const DEFAULT_FIELD = { type: 'input', idx: 0, label: 'Input Key 1' };

function keyName(code) {
  if (code === KC_NONE) return '—';
  return decodeQuantum(code) ?? `0x${code.toString(16).padStart(4, '0')}`;
}

// ── Unlock overlay ────────────────────────────────────────────────────────────

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
            <p className="unlock-body">Hold the key combination below for ~5 seconds to unlock.</p>
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

// ── Combo entry editor ────────────────────────────────────────────────────────

function ComboEntryEditor({ entry, activeField, onFieldClick, onChange }) {
  const setKey = (idx, code) => {
    const keys = [...entry.keys];
    keys[idx] = code;
    onChange({ ...entry, keys });
  };

  const fieldId = (f) => f.type === 'output' ? 'output' : `input-${f.idx}`;
  const isActive = (f) => activeField && fieldId(activeField) === fieldId(f);

  return (
    <div className="combo-entry">
      <div className="combo-section-label">Input Keys <span className="combo-hint-inline">(hold simultaneously)</span></div>
      <div className="combo-inputs">
        {entry.keys.map((code, i) => (
          <button
            key={i}
            className={`combo-kc-btn${code === KC_NONE ? ' empty' : ''}${isActive({ type: 'input', idx: i }) ? ' active-field' : ''}`}
            onClick={() => onFieldClick({ type: 'input', idx: i, label: `Input Key ${i + 1}` })}
          >
            {keyName(code)}
          </button>
        ))}
      </div>

      <div className="combo-section-label">Output Key</div>
      <button
        className={`combo-kc-btn combo-output-btn${isActive({ type: 'output' }) ? ' active-field' : ''}`}
        onClick={() => onFieldClick({ type: 'output', label: 'Output Key' })}
      >
        {keyName(entry.output)}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const EMPTY_ENTRY = { keys: [0, 0, 0, 0], output: 0 };

export default function CombosEditor({ device, comboDescriptions, onComboDescriptionsChange, macroDescriptions, tapDanceDescriptions }) {
  const [vialStatus, setVialStatus] = useState(null);
  const [entries, setEntries]       = useState([]);
  const [selected, setSelected]     = useState(0);
  const [dirty, setDirty]           = useState(false);
  const [status, setStatus]         = useState('');
  const [showUnlock, setShowUnlock] = useState(false);
  const [activeField, setActiveField] = useState(DEFAULT_FIELD);
  const [pickerRequest, setPickerRequest] = useState(null);
  const [visibleCount, setVisibleCount]   = useState(1);

  const load = useCallback(async () => {
    if (!device) return;
    setStatus('Detecting VIAL…');
    try {
      const vs = await invoke('detect_vial');
      setVialStatus(vs);
      if (!vs.supported)       { setStatus(''); return; }
      if (!vs.unlocked)        { setStatus(''); return; }
      if (vs.combo_count === 0) { setStatus('No combo slots (firmware not compiled with COMBO_ENABLE)'); return; }
      setStatus('Loading…');
      const data = await invoke('vial_get_all_combos', { count: vs.combo_count });
      setEntries(data);
      const nonEmpty = data.filter(e => e.output !== 0 || e.keys.some(k => k !== 0)).length;
      setVisibleCount(Math.max(nonEmpty, 1));
      setSelected(0);
      setActiveField(DEFAULT_FIELD);
      setPickerRequest({ code: data[0]?.keys[0] ?? 0 });
      setDirty(false);
      setStatus('');
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }, [device]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!dirty) return;
    try {
      setStatus('Saving…');
      await invoke('vial_set_combo_entry', { idx: selected, entry: entries[selected] });
      setDirty(false);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setStatus(`Save error: ${err}`);
    }
  };

  const updateEntry = (updated) => {
    setEntries(prev => prev.map((e, i) => i === selected ? updated : e));
    setDirty(true);
  };

  const currentEntry = entries[selected] ?? EMPTY_ENTRY;

  // Per-slot description, persisted with the profile by the parent.
  const currentDescription = comboDescriptions?.[selected] ?? '';

  const handleDescriptionChange = (text) => {
    onComboDescriptionsChange?.(prev => {
      const base = prev && typeof prev === 'object' ? prev : {};
      const next = { ...base };
      if (text) next[selected] = text;
      else delete next[selected];
      return next;
    });
  };

  const currentFieldCode = activeField
    ? activeField.type === 'output'
      ? currentEntry.output
      : currentEntry.keys[activeField.idx]
    : null;

  const handlePickerSelect = (code) => {
    if (!activeField) return;
    if (activeField.type === 'output') {
      updateEntry({ ...currentEntry, output: code });
    } else {
      const keys = [...currentEntry.keys];
      keys[activeField.idx] = code;
      updateEntry({ ...currentEntry, keys });
    }
  };

  // ── Early return states ───────────────────────────────────────────────────

  if (!device) return (
    <div className="combo-editor"><h3>Combos</h3>
      <p className="combo-hint">Connect the keyboard to edit combos.</p>
    </div>
  );
  if (vialStatus === null) return (
    <div className="combo-editor"><h3>Combos</h3>
      <p className="combo-hint">{status || 'Detecting VIAL…'}</p>
    </div>
  );
  if (!vialStatus.supported) return (
    <div className="combo-editor"><h3>Combos</h3>
      <div className="combo-vial-required">
        <p className="combo-vial-title">VIAL firmware required</p>
        <p className="combo-vial-body">Flash VIAL firmware (Firmware tab) to unlock dynamic combos.</p>
      </div>
    </div>
  );
  if (!vialStatus.unlocked && !showUnlock) return (
    <div className="combo-editor"><h3>Combos</h3>
      <div className="combo-locked">
        <p>Keyboard is locked. Unlock to edit combos.</p>
        <button className="primary" onClick={() => setShowUnlock(true)}>Unlock Keyboard</button>
      </div>
    </div>
  );
  if (showUnlock && !vialStatus.unlocked) return (
    <div className="combo-editor combo-editor-relative">
      <UnlockOverlay
        unlockKeys={vialStatus.unlock_keys}
        onUnlock={() => { setShowUnlock(false); load(); }}
        onClose={() => setShowUnlock(false)}
      />
    </div>
  );
  if (vialStatus.combo_count === 0 || entries.length === 0) return (
    <div className="combo-editor"><h3>Combos</h3>
      <p className="combo-hint">{status || 'No combo slots available.'}</p>
    </div>
  );

  return (
    <div className="combo-editor">
      <div className="combo-header">
        <h3>Combos</h3>
        <div className="combo-header-right">
          {status && <span className="combo-status">{status}</span>}
          <button onClick={load}>Reload</button>
          <button className={dirty ? 'primary' : ''} onClick={handleSave} disabled={!dirty}>
            Save combo {selected}
          </button>
        </div>
      </div>

      <div className="combo-body">
        {/* Slot list */}
        <div className="combo-slots">
          <div className="combo-slots-label">
            Slot
            <span className="combo-slots-count">{visibleCount}/{vialStatus.combo_count}</span>
          </div>
          {entries.slice(0, visibleCount).map((_, i) => (
            <button
              key={i}
              className={`combo-slot-btn${selected === i ? ' active' : ''}`}
              onClick={() => {
                if (selected !== i) {
                  setSelected(i);
                  setDirty(false);
                  setActiveField(DEFAULT_FIELD);
                  setPickerRequest({ code: entries[i]?.keys[0] ?? 0 });
                }
              }}
            >
              C({i})
            </button>
          ))}
          <button
            className="combo-add-btn"
            onClick={() => {
              const next = visibleCount;
              setVisibleCount(n => n + 1);
              setSelected(next);
              setDirty(false);
              setActiveField(DEFAULT_FIELD);
              setPickerRequest({ code: 0 });
            }}
            disabled={visibleCount >= vialStatus.combo_count}
            title={visibleCount >= vialStatus.combo_count ? `Firmware limit: ${vialStatus.combo_count} combos` : 'Add combo'}
          >
            + Add
          </button>
        </div>

        {/* Entry form */}
        <div className="combo-main">
          <div className="combo-slot-title">
            Combo {selected} — press all input keys simultaneously to send the output
            <input
              className="combo-desc-input"
              value={currentDescription}
              onChange={e => handleDescriptionChange(e.target.value)}
              placeholder={`Combo ${selected} — add a description…`}
              title="Saved with the profile."
            />
          </div>
          <ComboEntryEditor
            entry={currentEntry}
            activeField={activeField}
            onFieldClick={(f) => {
              setActiveField(f);
              const code = f.type === 'output' ? currentEntry.output : currentEntry.keys[f.idx];
              setPickerRequest({ code });
            }}
            onChange={updateEntry}
          />
        </div>

        {/* Inline key picker — always visible */}
        <div className="combo-picker-panel">
          <div className="combo-picker-label">
            Editing: <strong>{activeField.label}</strong>
          </div>
          <KeyPicker
            onSelect={handlePickerSelect}
            focusRequest={pickerRequest}
            macroDescriptions={macroDescriptions}
            tapDanceDescriptions={tapDanceDescriptions}
          />
        </div>
      </div>
    </div>
  );
}
