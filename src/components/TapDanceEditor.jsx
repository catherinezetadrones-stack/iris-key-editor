import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { decodeQuantum } from '../keyboardLayout';
import KeyPicker from './KeyPicker';
import './TapDanceEditor.css';

const KC_NONE = 0x0000;
const DEFAULT_FIELD = { key: 'on_tap', label: 'On Tap' };

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

// ── Entry editor ──────────────────────────────────────────────────────────────

const FIELDS = [
  { key: 'on_tap',        label: 'On Tap' },
  { key: 'on_hold',       label: 'On Hold' },
  { key: 'on_double_tap', label: 'Double Tap' },
  { key: 'on_tap_hold',   label: 'Tap + Hold' },
];

function EntryEditor({ entry, activeField, onFieldClick, onChange }) {
  return (
    <div className="td-entry">
      {FIELDS.map(({ key, label }) => (
        <div key={key} className="td-field">
          <span className="td-field-label">{label}</span>
          <button
            className={`td-kc-btn${activeField === key ? ' active-field' : ''}`}
            onClick={() => onFieldClick(key, label)}
          >
            {keyName(entry[key])}
          </button>
        </div>
      ))}
      <div className="td-field">
        <span className="td-field-label">Tapping Term</span>
        <div className="td-term-wrap">
          <input
            className="td-term-input"
            type="number"
            min={0}
            max={9999}
            value={entry.tapping_term_ms}
            onChange={e => onChange({ ...entry, tapping_term_ms: parseInt(e.target.value, 10) || 0 })}
          />
          <span className="td-term-unit">ms{entry.tapping_term_ms === 0 ? ' (global)' : ''}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const EMPTY_ENTRY = { on_tap: 0, on_hold: 0, on_double_tap: 0, on_tap_hold: 0, tapping_term_ms: 0 };

export default function TapDanceEditor({ device }) {
  const [vialStatus, setVialStatus]   = useState(null);
  const [entries, setEntries]         = useState([]);
  const [selected, setSelected]       = useState(0);
  const [dirty, setDirty]             = useState(false);
  const [status, setStatus]           = useState('');
  const [showUnlock, setShowUnlock]   = useState(false);
  const [activeField, setActiveField] = useState(DEFAULT_FIELD);
  // pickerRequest is set ONCE when user clicks a field button — not on every
  // render — so the picker doesn't jump back to the current key's category
  // while the user is browsing other categories.
  const [pickerRequest, setPickerRequest] = useState(null);

  const load = useCallback(async () => {
    if (!device) return;
    setStatus('Detecting VIAL…');
    try {
      const vs = await invoke('detect_vial');
      setVialStatus(vs);
      if (!vs.supported) { setStatus(''); return; }
      if (!vs.unlocked)  { setStatus(''); return; }
      if (vs.td_count === 0) { setStatus('No tap dance slots (firmware not compiled with TAP_DANCE_ENABLE)'); return; }
      setStatus('Loading…');
      const data = await invoke('vial_get_all_tap_dance', { count: vs.td_count });
      setEntries(data);
      setSelected(0);
      setActiveField(DEFAULT_FIELD);
      setPickerRequest({ code: data[0]?.[DEFAULT_FIELD.key] ?? 0 });
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
      await invoke('vial_set_tap_dance_entry', { idx: selected, entry: entries[selected] });
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

  // ── Early return states ───────────────────────────────────────────────────

  if (!device) return (
    <div className="td-editor"><h3>Tap Dance</h3>
      <p className="td-hint">Connect the keyboard to edit tap dance.</p>
    </div>
  );
  if (vialStatus === null) return (
    <div className="td-editor"><h3>Tap Dance</h3>
      <p className="td-hint">{status || 'Detecting VIAL…'}</p>
    </div>
  );
  if (!vialStatus.supported) return (
    <div className="td-editor"><h3>Tap Dance</h3>
      <div className="td-vial-required">
        <p className="td-vial-title">VIAL firmware required</p>
        <p className="td-vial-body">Flash VIAL firmware (Firmware tab) to unlock dynamic tap dance.</p>
      </div>
    </div>
  );
  if (!vialStatus.unlocked && !showUnlock) return (
    <div className="td-editor"><h3>Tap Dance</h3>
      <div className="td-locked">
        <p>Keyboard is locked. Unlock to edit tap dance entries.</p>
        <button className="primary" onClick={() => setShowUnlock(true)}>Unlock Keyboard</button>
      </div>
    </div>
  );
  if (showUnlock && !vialStatus.unlocked) return (
    <div className="td-editor td-editor-relative">
      <UnlockOverlay
        unlockKeys={vialStatus.unlock_keys}
        onUnlock={() => { setShowUnlock(false); load(); }}
        onClose={() => setShowUnlock(false)}
      />
    </div>
  );
  if (vialStatus.td_count === 0 || entries.length === 0) return (
    <div className="td-editor"><h3>Tap Dance</h3>
      <p className="td-hint">{status || 'No tap dance slots available.'}</p>
    </div>
  );

  return (
    <div className="td-editor">
      <div className="td-header">
        <h3>Tap Dance</h3>
        <div className="td-header-right">
          {status && <span className="td-status">{status}</span>}
          <button onClick={load}>Reload</button>
          <button className={dirty ? 'primary' : ''} onClick={handleSave} disabled={!dirty}>
            Save slot {selected}
          </button>
        </div>
      </div>

      <div className="td-body">
        {/* Slot list */}
        <div className="td-slots">
          <div className="td-slots-label">Slot</div>
          {entries.map((_, i) => (
            <button
              key={i}
              className={`td-slot-btn${selected === i ? ' active' : ''}`}
              onClick={() => {
            if (selected !== i) {
              setSelected(i);
              setDirty(false);
              setActiveField(DEFAULT_FIELD);
              setPickerRequest({ code: entries[i]?.[DEFAULT_FIELD.key] ?? 0 });
            }
          }}
            >
              TD({i})
            </button>
          ))}
        </div>

        {/* Entry form */}
        <div className="td-main">
          <div className="td-slot-title">
            TD({selected}) — assign <code>TD({selected})</code> to a key to trigger
          </div>
          <EntryEditor
            entry={currentEntry}
            activeField={activeField.key}
            onFieldClick={(key, label) => {
              setActiveField({ key, label });
              setPickerRequest({ code: currentEntry[key] });
            }}
            onChange={updateEntry}
          />
        </div>

        {/* Inline key picker — always visible */}
        <div className="td-picker-panel">
          <div className="td-picker-label">
            Editing: <strong>{activeField.label}</strong>
          </div>
          <KeyPicker
            onSelect={(code) => updateEntry({ ...currentEntry, [activeField.key]: code })}
            focusRequest={pickerRequest}
          />
        </div>
      </div>
    </div>
  );
}
