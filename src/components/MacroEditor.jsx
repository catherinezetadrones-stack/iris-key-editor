import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { KEYCODE_MAP } from '../keyboardLayout';
import { parseBuffer, serializeBuffer } from '../macroCodec';
import './MacroEditor.css';

// ── Key name helper ──────────────────────────────────────────────────────────

function hidName(hid) {
  return KEYCODE_MAP[hid] ?? `0x${hid.toString(16).padStart(2, '0')}`;
}

// ── Action row component ─────────────────────────────────────────────────────

function ActionRow({ action, index, onUpdate, onRemove }) {
  const { type } = action;

  const handleTypeChange = (e) => {
    const t = e.target.value;
    if (t === 'text')  onUpdate(index, { type: 'text', value: '' });
    if (t === 'tap')   onUpdate(index, { type: 'tap',  keycode: 0x28 });
    if (t === 'down')  onUpdate(index, { type: 'down', keycode: 0xE1 });
    if (t === 'up')    onUpdate(index, { type: 'up',   keycode: 0xE1 });
    if (t === 'delay') onUpdate(index, { type: 'delay', ms: 100 });
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
        <div className="action-keycode">
          <span className="action-key-name">{hidName(action.keycode)}</span>
          <input
            className="action-input action-hid-input"
            type="number"
            min={0}
            max={255}
            value={action.keycode}
            onChange={e => onUpdate(index, { ...action, keycode: parseInt(e.target.value, 10) || 0 })}
            title="USB HID keycode (decimal)"
          />
        </div>
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
  const [macros, setMacros]           = useState(null);  // null = not loaded
  const [bufferSize, setBufferSize]   = useState(0);
  const [macroCount, setMacroCount]   = useState(0);
  const [selectedMacro, setSelected]  = useState(0);
  const [status, setStatus]           = useState('');
  const [dirty, setDirty]             = useState(false);

  const load = useCallback(async () => {
    if (!device) return;
    try {
      setStatus('Reading macro data…');
      const info = await invoke('get_macro_info');
      log(`Macros: ${info.count} slots, ${info.buffer_size} byte buffer`);
      const raw  = await invoke('read_macros');
      // Log first non-zero byte to confirm buffer has content
      const firstNonZero = raw.findIndex(b => b !== 0);
      log(`Macro buffer: first non-zero byte at index ${firstNonZero === -1 ? 'none (empty)' : firstNonZero}`);
      const parsed = parseBuffer(raw, info.count);
      const populated = parsed.filter(m => m.length > 0).length;
      log(`Macro parse: ${populated}/${info.count} slots have actions`);
      setMacros(parsed);
      setMacroCount(info.count);
      setBufferSize(info.buffer_size);
      setSelected(0);
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
    setDirty(true);
  };

  const addAction = (type) => {
    const defaults = {
      text:  { type: 'text',  value: '' },
      tap:   { type: 'tap',   keycode: 0x28 },
      delay: { type: 'delay', ms: 100 },
    };
    setMacros(prev => {
      const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
      next[selectedMacro].push(defaults[type] ?? defaults.text);
      return next;
    });
    setDirty(true);
  };

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
        {/* Macro slot selector */}
        <div className="macro-slots">
          <div className="macro-slots-label">Slot</div>
          {macros.map((_, i) => (
            <button
              key={i}
              className={`macro-slot-btn${selectedMacro === i ? ' active' : ''}`}
              onClick={() => setSelected(i)}
            >
              M({i})
            </button>
          ))}
        </div>

        {/* Action list for selected macro */}
        <div className="macro-actions">
          <div className="macro-actions-header">
            <span className="macro-actions-title">M({selectedMacro}) — assign keycodes M(0)–M({macroCount - 1}) to keys to trigger</span>
          </div>

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
    </div>
  );
}
