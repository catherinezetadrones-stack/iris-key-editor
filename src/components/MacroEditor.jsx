import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { KEYCODE_MAP, HALVES } from '../keyboardLayout';
import { parseBuffer, serializeBuffer } from '../macroCodec';
import { buildExtraMacroCCode, isSendStringSafe } from '../extraMacroCodec';
import KeyPicker from './KeyPicker';
import './MacroEditor.css';

// ── Key name helper ──────────────────────────────────────────────────────────

function hidName(hid) {
  return KEYCODE_MAP[hid] ?? `0x${hid.toString(16).padStart(2, '0')}`;
}

// ── Action row component ─────────────────────────────────────────────────────

function ActionRow({ action, index, onUpdate, onRemove, onKeyClick, isActive, validateText }) {
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

  const textInvalid = type === 'text' && validateText && !validateText(action.value);

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
          className={`action-input${textInvalid ? ' invalid' : ''}`}
          value={action.value}
          onChange={e => onUpdate(index, { ...action, value: e.target.value })}
          placeholder="text to type…"
          title={textInvalid ? 'Contains characters not supported by SEND_STRING (printable ASCII, newline, tab only)' : undefined}
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

// ── Generated C code modal ───────────────────────────────────────────────────

function ExtraMacroCodeModal({ code, onClose, copied, onCopy, filePath, onSave, fileSaveStatus }) {
  return (
    <div className="macro-modal-overlay" onClick={onClose}>
      <div className="macro-modal" onClick={e => e.stopPropagation()}>
        <div className="macro-modal-header">
          <span>Generated Extra Macros C Code</span>
          <div className="macro-modal-btns">
            <button onClick={onCopy}>{copied ? '✓ Copied' : 'Copy'}</button>
            {filePath && (
              <button onClick={onSave}>{fileSaveStatus || 'Save to file'}</button>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <pre className="macro-modal-code">{code}</pre>
        <div className="macro-modal-hint">
          Include in <code>keymap.c</code> with <code>#include "extra_macros.c"</code>.
          Use <code>MU(n)</code> in keymap layers.
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MacroEditor({ device, addDebugLog, reloadKey = 0, extraMacros, onExtraMacrosChange, extraMacrosFilePath, macroDescriptions, onMacroDescriptionsChange }) {
  const log = addDebugLog ?? (() => {});
  const [macros, setMacros]             = useState(null);
  const [bufferSize, setBufferSize]     = useState(0);
  const [macroCount, setMacroCount]     = useState(0);
  const [macroMode, setMacroMode]       = useState('via'); // 'via' | 'compile'
  const [selectedMacro, setSelected]    = useState(0);
  const [status, setStatus]             = useState('');
  const [dirty, setDirty]               = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [pickerRequest, setPickerRequest] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [copied, setCopied]               = useState(false);
  const [fileSaveStatus, setFileSaveStatus] = useState('');
  const prevMatrixRef = useRef(null);
  const layer0SnapshotRef = useRef(null);

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

  const activeList = macroMode === 'via' ? macros : extraMacros;

  // Routes list edits to either local VIA macro state (with dirty tracking) or
  // the parent-owned compile-time macro state, depending on the active mode.
  const setActiveList = useCallback((updater) => {
    if (macroMode === 'via') {
      setMacros(prev => (typeof updater === 'function' ? updater(prev) : updater));
      setDirty(true);
    } else {
      onExtraMacrosChange?.(updater);
    }
  }, [macroMode, onExtraMacrosChange]);

  const handleModeChange = (mode) => {
    if (mode === macroMode) return;
    if (isRecording) stopRecording();
    setMacroMode(mode);
    setSelected(0);
    setActiveAction(null);
    setPickerRequest(null);
  };

  const updateAction = (actionIdx, updated) => {
    setActiveList(prev => {
      const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
      next[selectedMacro][actionIdx] = updated;
      return next;
    });
  };

  const removeAction = (actionIdx) => {
    setActiveList(prev => {
      const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
      next[selectedMacro].splice(actionIdx, 1);
      return next;
    });
    if (activeAction === actionIdx) setActiveAction(null);
    else if (activeAction > actionIdx) setActiveAction(a => a - 1);
  };

  const addAction = (type) => {
    const defaults = {
      text:  { type: 'text',  value: '' },
      tap:   { type: 'tap',   keycode: 0x28 },
      delay: { type: 'delay', ms: 100 },
    };
    const newAction = defaults[type] ?? defaults.text;
    const newIdx = (activeList?.[selectedMacro]?.length) ?? 0;
    setActiveList(prev => {
      const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
      next[selectedMacro].push(newAction);
      return next;
    });
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
    const action = (activeList?.[selectedMacro] ?? [])[activeAction];
    if (!action) return;
    updateAction(activeAction, { ...action, keycode: code });
  };

  // Per-slot descriptions are stored separately for the two modes ('via'/'qmk')
  // and persisted with the profile by the parent.
  const descModeKey = macroMode === 'via' ? 'via' : 'qmk';
  const currentDescription = macroDescriptions?.[descModeKey]?.[selectedMacro] ?? '';

  const handleDescriptionChange = (text) => {
    onMacroDescriptionsChange?.(prev => {
      const base = prev && typeof prev === 'object' ? prev : { via: {}, qmk: {} };
      const modeDescs = { ...(base[descModeKey] ?? {}) };
      if (text) modeDescs[selectedMacro] = text;
      else delete modeDescs[selectedMacro];
      return { ...base, [descModeKey]: modeDescs };
    });
  };

  const handleSelectMacro = (i) => {
    if (selectedMacro === i) return;
    setSelected(i);
    setDirty(false);
    setActiveAction(null);
    setPickerRequest(null);
  };

  const startRecording = async () => {
    if (!device) return;
    if (macroMode === 'via' && !macros) return;
    try {
      const snapshot = await invoke('read_keymap', { layer: 0 });
      layer0SnapshotRef.current = snapshot;
      prevMatrixRef.current = null;
      setIsRecording(true);
    } catch (err) {
      log(`Recorder: failed to read layer 0 — ${err}`);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    prevMatrixRef.current = null;
  };

  useEffect(() => {
    if (!isRecording) return;
    const allKeys = [...HALVES.left, ...HALVES.right];

    const id = setInterval(async () => {
      try {
        const matrix = await invoke('get_matrix_state');
        const prev = prevMatrixRef.current;

        if (prev !== null) {
          const newTaps = [];
          for (const key of allKeys) {
            const cur = matrix[key.matrixRow]?.[key.matrixCol];
            const was = prev[key.matrixRow]?.[key.matrixCol];
            if (cur && !was) {
              const kc = layer0SnapshotRef.current?.[key.viaRow]?.[key.viaCol];
              if (kc != null && kc >= 0x04 && kc <= 0x00ff) {
                newTaps.push({ type: 'tap', keycode: kc });
              }
            }
          }
          if (newTaps.length > 0) {
            setActiveList(prev => {
              const next = prev.map((m, i) => i === selectedMacro ? [...m] : m);
              next[selectedMacro] = [...next[selectedMacro], ...newTaps];
              return next;
            });
          }
        }

        prevMatrixRef.current = matrix;
      } catch (err) {
        log(`Recorder: poll error — ${err}`);
        setIsRecording(false);
      }
    }, 60);

    return () => clearInterval(id);
  }, [isRecording, selectedMacro, setActiveList]);

  // ── Generated C code (compile mode) ─────────────────────────────────────────

  const codeContent = macroMode === 'compile' ? buildExtraMacroCCode(extraMacros) : '';

  const copyCode = () => {
    navigator.clipboard.writeText(codeContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const saveCodeToFile = async () => {
    if (!extraMacrosFilePath) return;
    try {
      await invoke('write_text_file', { path: extraMacrosFilePath, content: codeContent });
      setFileSaveStatus('Saved!');
      setTimeout(() => setFileSaveStatus(''), 2000);
    } catch (err) {
      setFileSaveStatus(`Error: ${err}`);
      setTimeout(() => setFileSaveStatus(''), 4000);
    }
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

  if (macroMode === 'via' && macros === null) {
    return (
      <div className="macro-editor">
        <h3>Macro Editor</h3>
        <p className="macro-hint">{status || 'Loading…'}</p>
      </div>
    );
  }

  const currentActions = activeList?.[selectedMacro] ?? [];

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
          {macroMode === 'via' && status && (
            <span className={`macro-status${status.startsWith('Save') || status.startsWith('Load') ? ' error' : ''}`}>{status}</span>
          )}
          <button
            className={isRecording ? 'record-btn-active' : ''}
            onClick={isRecording ? stopRecording : startRecording}
            title={isRecording ? 'Stop recording keystrokes' : 'Record keystrokes into this macro slot'}
          >
            {isRecording ? 'Stop' : 'Record'}
          </button>
          {macroMode === 'via' && (
            <>
              <button onClick={load} disabled={isRecording}>Reload</button>
              <button className={dirty ? 'primary' : ''} onClick={handleSave} disabled={!dirty || isRecording}>Save to keyboard</button>
            </>
          )}
          {macroMode === 'compile' && (
            <button onClick={() => setShowCodeModal(true)} disabled={isRecording}>Generate C Code</button>
          )}
        </div>
      </div>

      <div className="macro-mode-tabs">
        <button
          className={`macro-mode-tab${macroMode === 'via' ? ' active' : ''}`}
          onClick={() => handleModeChange('via')}
        >
          VIA Macros
        </button>
        <button
          className={`macro-mode-tab${macroMode === 'compile' ? ' active' : ''}`}
          onClick={() => handleModeChange('compile')}
        >
          QMK Macros
        </button>
      </div>

      <div className="macro-body">
        {/* Left: Macro slot selector */}
        <div className="macro-slots">
          <div className="macro-slots-label">Slot</div>
          {(activeList ?? []).map((_, i) => (
            <button
              key={i}
              className={`macro-slot-btn${selectedMacro === i ? ' active' : ''}`}
              onClick={() => handleSelectMacro(i)}
              disabled={isRecording}
            >
              {macroMode === 'via' ? `M(${i})` : `MU(${i})`}
            </button>
          ))}
        </div>

        {/* Center: Action list */}
        <div className="macro-center">
          <div className="macro-center-title">
            <input
              className="macro-desc-input"
              value={currentDescription}
              onChange={e => handleDescriptionChange(e.target.value)}
              disabled={isRecording}
              placeholder={`${macroMode === 'via' ? `M(${selectedMacro})` : `MU(${selectedMacro})`} — add a description…`}
              title={macroMode === 'via'
                ? `Saved with the profile. Assign M(0)–M(${macroCount - 1}) to keys to trigger.`
                : 'Saved with the profile. Assign MU(0)–MU(31) to keys; requires a firmware compile.'}
            />
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
                validateText={macroMode === 'compile' ? isSendStringSafe : null}
              />
            ))}

            <div className="macro-add-row">
              <span className="macro-add-label">Add:</span>
              <button onClick={() => addAction('text')}>Text</button>
              <button onClick={() => addAction('tap')}>Tap key</button>
              <button onClick={() => addAction('delay')}>Delay</button>
            </div>

            {macroMode === 'via' && (
              <div className="macro-buffer-info">
                Buffer: {serializeBuffer(macros, bufferSize).filter((_, i) => i < bufferSize).length}/{bufferSize} bytes used
              </div>
            )}
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

      {showCodeModal && (
        <ExtraMacroCodeModal
          code={codeContent}
          onClose={() => setShowCodeModal(false)}
          copied={copied}
          onCopy={copyCode}
          filePath={extraMacrosFilePath}
          onSave={saveCodeToFile}
          fileSaveStatus={fileSaveStatus}
        />
      )}
    </div>
  );
}
