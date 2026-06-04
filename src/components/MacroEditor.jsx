import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { KEYCODE_MAP } from '../keyboardLayout';
import { parseBuffer, serializeBuffer } from '../macroCodec';
import KeyPicker from './KeyPicker';
import './MacroEditor.css';

// ── Key name helper ──────────────────────────────────────────────────────────

function hidName(hid) {
  return KEYCODE_MAP[hid] ?? `0x${hid.toString(16).padStart(2, '0')}`;
}

// ── Action row component ─────────────────────────────────────────────────────

function ActionRow({ action, index, onUpdate, onRemove, onKeyClick, isActive }) {
  const { type } = action;

  const handleTypeChange = (e) => {
    const t = e.target.value;
    let updated;
    if      (t === 'text')  updated = { type: 'text',  value: '' };
    else if (t === 'tap')   updated = { type: 'tap',   keycode: 0x28 };
    else if (t === 'down')  updated = { type: 'down',  keycode: 0xE1 };
    else if (t === 'up')    updated = { type: 'up',    keycode: 0xE1 };
    else if (t === 'delay') updated = { type: 'delay', ms: 100 };
    if (!updated) return;
    onUpdate(index, updated);
    if (updated.keycode !== undefined) onKeyClick(index, updated.keycode);
  };

  return (
    <div className="action-row">
      <select value={type} onChange={handleTypeChange} className="action-type-sel">
        <option value="text">Text</option>
        <option value="tap">Tap key</option>
        <option value="down">Key down</option>
        <option value="up">Key up</option>
        <option value="delay">Delay</option>
      </select>

      {type === 'text' && (
        <input
          className="action-input"
          value={action.value}
          onChange={e => onUpdate(index, { ...action, value: e.target.value })}
          placeholder="text to type…"
        />
      )}
      {(type === 'tap' || type === 'down' || type === 'up') && (
        <button
          className={`macro-kc-btn${isActive ? ' active-field' : ''}`}
          onClick={() => onKeyClick(index, action.keycode)}
        >
          {hidName(action.keycode)}
        </button>
      )}
      {type === 'delay' && (
        <div className="action-keycode">
          <input
            className="action-input action-hid-input"
            type="number"
            min={0}
            max={9999}
            value={action.ms}
            onChange={e => onUpdate(index, { ...action, ms: parseInt(e.target.value, 10) || 0 })}
          />
          <span className="action-unit">ms</span>
        </div>
      )}

      <button className="action-remove-btn" onClick={() => onRemove(index)} title="Remove action">×</button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MacroEditor({ device, addDebugLog, reloadKey = 0 }) {
  const log = addDebugLog ?? (() => {});
  const [macros, setMacros]             = useState(null);
  const [bufferSize, setBufferSize]     = useState(0);
  const [macroCount, setMacroCount]     = useState(0);
  const [selectedMacro, setSelected]    = useState(0);
  const [status, setStatus]             = useState('');
  const [dirty, setDirty]               = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [pickerRequest, setPickerRequest] = useState(null);

  const load = useCallback(async () => {
    if (!device) return;
    try {
      setStatus('Reading macro data…');
      const info = await invoke('get_macro_info');
      log(`Macros: ${info.count} slots, ${info.buffer_size} byte buffer`);
      const raw  = await invoke('read_macros');
      const firstNonZero = raw.findIndex(b => b !== 0);
      log(`Macro buffer: first non-zero byte at index ${firstNonZero === -1 ? 'none (empty)' : firstNonZero}`);
      const parsed = parseBuffer(raw, info.count);
      const populated = parsed.filter(m => m.length > 0).length;
      log(`Macro parse: ${populated}/${info.count} slots have actions`);
      setMacros(parsed);
      setMacroCount(info.count);
      setBufferSize(info.buffer_size);
      setSelected(0);
      setActiveAction(null);
      setPickerRequest(null);
      setDirty(false);
      setStatus('');
    } catch (err) {
      setStatus(`Load error: ${err}`);
      log(`Macro load error: ${err}`);
    }
  }, [device]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const handleSave = async () => {
    if (!macros) return;
    try {
      setStatus('Saving…');
      const bytes = serializeBuffer(macros, bufferSize);
      await invoke('write_macros', { data: bytes });
      setDirty(false);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setStatus(`Save error: ${err}`);
    }
  };

  const updateAction = (actionIdx, updated) => {
    setMacros(prev => {
      const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
      next[selectedMacro][actionIdx] = updated;
      return next;
    });
    setDirty(true);
  };

  const removeAction = (actionIdx) => {
    setMacros(prev => {
      const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
      next[selectedMacro].splice(actionIdx, 1);
      return next;
    });
    if (activeAction === actionIdx) setActiveAction(null);
    else if (activeAction > actionIdx) setActiveAction(a => a - 1);
    setDirty(true);
  };

  const addAction = (type) => {
    const defaults = {
      text:  { type: 'text',  value: '' },
      tap:   { type: 'tap',   keycode: 0x28 },
      delay: { type: 'delay', ms: 100 },
    };
    const newAction = defaults[type] ?? defaults.text;
    const newIdx = (macros?.[selectedMacro]?.length) ?? 0;
    setMacros(prev => {
      const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
      next[selectedMacro].push(newAction);
      return next;
    });
    setDirty(true);
    if (newAction.keycode !== undefined) {
      setActiveAction(newIdx);
      setPickerRequest({ code: newAction.keycode });
    }
  };

  const handleKeyClick = (actionIdx, currentCode) => {
    setActiveAction(actionIdx);
    setPickerRequest({ code: currentCode });
  };

  const handlePickerSelect = (code) => {
    if (activeAction === null) return;
    const action = (macros?.[selectedMacro] ?? [])[activeAction];
    if (!action) return;
    updateAction(activeAction, { ...action, keycode: code });
  };

  const handleSelectMacro = (i) => {
    if (selectedMacro === i) return;
    setSelected(i);
    setDirty(false);
    setActiveAction(null);
    setPickerRequest(null);
  };

  // ── Early returns ──────────────────────────────────────────────────────────

  if (!device) {
    return (
      <div className="macro-editor">
        <h3>Macro Editor</h3>
        <p className="macro-hint">Connect the keyboard to edit macros.</p>
      </div>
    );
  }

  if (macros === null) {
    return (
      <div className="macro-editor">
        <h3>Macro Editor</h3>
        <p className="macro-hint">{status || 'Loading…'}</p>
      </div>
    );
  }

  const currentActions = macros[selectedMacro] ?? [];

  const pickerLabel = (() => {
    if (activeAction === null) return 'Select a key action to edit';
    const a = currentActions[activeAction];
    if (!a) return 'Select a key action to edit';
    const typeLabel = a.type === 'tap' ? 'Tap key' : a.type === 'down' ? 'Key down' : 'Key up';
    return `Action ${activeAction + 1} — ${typeLabel}`;
  })();

  return (
    <div className="macro-editor">
      <div className="macro-header">
        <h3>Macro Editor</h3>
        <div className="macro-header-right">
          {status && <span className={`macro-status${status.startsWith('Save') || status.startsWith('Load') ? ' error' : ''}`}>{status}</span>}
          <button onClick={load}>Reload</button>
          <button className={dirty ? 'primary' : ''} onClick={handleSave} disabled={!dirty}>Save to keyboard</button>
        </div>
      </div>

      <div className="macro-body">
        {/* Left: Macro slot selector */}
        <div className="macro-slots">
          <div className="macro-slots-label">Slot</div>
          {macros.map((_, i) => (
            <button
              key={i}
              className={`macro-slot-btn${selectedMacro === i ? ' active' : ''}`}
              onClick={() => handleSelectMacro(i)}
            >
              M({i})
            </button>
          ))}
        </div>

        {/* Center: Action list */}
        <div className="macro-center">
          <div className="macro-center-title">
            M({selectedMacro}) — assign keycodes M(0)–M({macroCount - 1}) to keys to trigger
          </div>

          <div className="macro-actions">
            {currentActions.length === 0 && (
              <p className="macro-empty">No actions yet. Add one below.</p>
            )}

            {currentActions.map((a, i) => (
              <ActionRow
                key={i}
                action={a}
                index={i}
                onUpdate={updateAction}
                onRemove={removeAction}
                onKeyClick={handleKeyClick}
                isActive={activeAction === i}
              />
            ))}

            <div className="macro-add-row">
              <span className="macro-add-label">Add:</span>
              <button onClick={() => addAction('text')}>Text</button>
              <button onClick={() => addAction('tap')}>Tap key</button>
              <button onClick={() => addAction('delay')}>Delay</button>
            </div>

            <div className="macro-buffer-info">
              Buffer: {serializeBuffer(macros, bufferSize).filter((_, i) => i < bufferSize).length}/{bufferSize} bytes used
            </div>
          </div>
        </div>

        {/* Right: Key picker — always visible */}
        <div className="macro-picker-panel">
          <div className="macro-picker-label">
            Editing: <strong>{pickerLabel}</strong>
          </div>
          <KeyPicker
            onSelect={handlePickerSelect}
            focusRequest={pickerRequest}
          />
        </div>
      </div>
    </div>
  );
}
