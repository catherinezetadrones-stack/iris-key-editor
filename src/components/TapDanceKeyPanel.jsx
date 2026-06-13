import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { decodeQuantum, HALVES } from '../keyboardLayout';
import KeyPicker from './KeyPicker';
import { buildTapDanceCCode, TD_FIELDS as FIELDS } from '../codegen/tapDanceKeys';
import './TapDanceKeyPanel.css';

const EMPTY_ENTRY = { on_tap: 0, on_hold: 0, on_double_tap: 0, on_tap_hold: 0, tapping_term_ms: 0 };

function TdCodeModal({ code, onClose, copied, onCopy, tapDanceFilePath, onSave, fileSaveStatus }) {
  return (
    <div className="td-modal-overlay" onClick={onClose}>
      <div className="td-modal" onClick={e => e.stopPropagation()}>
        <div className="td-modal-header">
          <span>Generated Tap Dance C Code</span>
          <div className="td-modal-btns">
            <button onClick={onCopy}>{copied ? '✓ Copied' : 'Copy'}</button>
            {tapDanceFilePath && (
              <button onClick={onSave}>{fileSaveStatus || 'Save to file'}</button>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <pre className="td-modal-code">{code}</pre>
        <div className="td-modal-hint">
          Include in <code>keymap.c</code> with <code>#include "tap_dance_keys.c"</code> after the shared TD types.
          Use <code>TD(TD_LEFT_M_X_X)</code> in keymap layers.
        </div>
      </div>
    </div>
  );
}

export default function TapDanceKeyPanel({ selectedKey, currentLayer, tapDanceKeys, onTapDanceKeysChange, tapDanceFilePath, tdKeyAssignments = [], onTdKeyAssignmentsChange, onApplyTdAssignment, onClearTdAssignment, tapDanceDescriptions, onTapDanceDescriptionsChange }) {
  const [activeTdField, setActiveTdField] = useState(null);
  const [pickerRequest, setPickerRequest]   = useState(null);
  const [showMods, setShowMods]             = useState(false);
  const [showCodeModal, setShowCodeModal]   = useState(false);
  const [copied, setCopied]                 = useState(false);
  const [fileSaveStatus, setFileSaveStatus] = useState('');
  const [assignIndexInput, setAssignIndexInput] = useState(0);
  const [assignConflict, setAssignConflict]     = useState('');

  // Keep key selection unobstructed: the "Add modifiers" area starts hidden each
  // time a different field's picker is opened (or the picker closes).
  useEffect(() => { setShowMods(false); }, [activeTdField]);

  const keyObj = selectedKey
    ? [...HALVES.left, ...HALVES.right].find(
        k => k.viaRow === selectedKey.row && k.viaCol === selectedKey.col
      )
    : null;

  const layerKeys = tapDanceKeys[currentLayer] ?? {};
  const keyId  = keyObj?.id ?? null;
  const entry  = (keyId && layerKeys[keyId]) ?? { ...EMPTY_ENTRY };
  const hasAny = keyId && FIELDS.some(f => (entry[f.key] ?? 0) !== 0);

  // Count all configured keys across all layers
  const totalConfigured = Object.values(tapDanceKeys).reduce((sum, layerObj) =>
    sum + Object.values(layerObj).filter(e => FIELDS.some(f => (e[f.key] ?? 0) !== 0)).length, 0
  );

  // Implicit TD index from the code generator's key ordering (same logic as buildTapDanceCCode)
  const suggestedIndex = (() => {
    if (!keyId) return 0;
    const seen = new Set();
    Object.values(tapDanceKeys).forEach(layerObj => {
      Object.entries(layerObj ?? {}).forEach(([kid, e]) => {
        if (FIELDS.some(f => (e[f.key] ?? 0) !== 0)) seen.add(kid);
      });
    });
    const ordered = [...seen];
    const idx = ordered.indexOf(keyId);
    return idx >= 0 ? idx : ordered.length;
  })();

  // Index of this key in tdKeyAssignments (-1 if not assigned)
  const currentAssignedIndex = tdKeyAssignments.findIndex(a => a?.keyId === keyId);

  // Description for the assigned TD(n) slot, persisted with the profile.
  const currentDescription = tapDanceDescriptions?.[currentAssignedIndex] ?? '';

  const handleDescriptionChange = (text) => {
    onTapDanceDescriptionsChange?.(prev => {
      const base = prev && typeof prev === 'object' ? prev : {};
      const next = { ...base };
      if (text) next[currentAssignedIndex] = text;
      else delete next[currentAssignedIndex];
      return next;
    });
  };

  // Reset assignment input when selected key changes.
  // suggestedIndex is intentionally omitted from deps: stale suggestions between
  // tapDanceKeys edits are acceptable since the user can override before clicking Assign.
  // The input resets to the current suggestedIndex only when switching keys.
  useEffect(() => {
    setAssignIndexInput(suggestedIndex >= 0 ? suggestedIndex : 0);
    setAssignConflict('');
  }, [keyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAssign = () => {
    const n = assignIndexInput;
    const conflict = tdKeyAssignments[n]?.keyId;
    if (conflict && conflict !== keyId) {
      setAssignConflict(`TD(${n}) already used by ${conflict}`);
      return;
    }
    setAssignConflict('');
    onTdKeyAssignmentsChange(prev => {
      const next = [...prev];
      // Remove any existing assignment for this keyId
      for (let i = 0; i < next.length; i++) {
        if (next[i]?.keyId === keyId) next[i] = null;
      }
      next[n] = { keyId };
      return next;
    });
    // Write TD(n) to the keymap (hardware + cache) on every layer this key has
    // tap dance config — previously nothing was written until the next import.
    onApplyTdAssignment?.(n, keyId);
  };

  const handleRemoveAssignment = () => {
    // Clear the TD(n) keycode we wrote to the keymap, then drop the record.
    onClearTdAssignment?.(currentAssignedIndex, keyId);
    onTdKeyAssignmentsChange(prev => {
      const next = [...prev];
      next[currentAssignedIndex] = null;
      return next;
    });
  };

  const updateEntry = (field, code) => {
    if (!keyId) return;
    onTapDanceKeysChange(prev => ({
      ...prev,
      [currentLayer]: {
        ...(prev[currentLayer] ?? {}),
        [keyId]: { ...((prev[currentLayer] ?? {})[keyId] ?? EMPTY_ENTRY), [field]: code },
      },
    }));
  };

  const removeEntry = () => {
    if (!keyId) return;
    // Does any OTHER layer still have tap dance config for this key? If so the
    // TD(n) slot stays valid there and only this layer's keycode is cleared.
    const stillConfiguredElsewhere = Object.entries(tapDanceKeys).some(([L, layerObj]) => {
      if (parseInt(L, 10) === currentLayer) return false;
      const e = layerObj?.[keyId];
      return e && FIELDS.some(f => (e[f.key] ?? 0) !== 0);
    });
    onTapDanceKeysChange(prev => {
      const layerCopy = { ...(prev[currentLayer] ?? {}) };
      delete layerCopy[keyId];
      return { ...prev, [currentLayer]: layerCopy };
    });
    if (currentAssignedIndex >= 0) {
      if (stillConfiguredElsewhere) {
        onClearTdAssignment?.(currentAssignedIndex, keyId, [currentLayer]);
      } else {
        // Last layer with config — clear the keycode everywhere and drop the
        // assignment so the slot is not re-applied on next import.
        onClearTdAssignment?.(currentAssignedIndex, keyId);
        onTdKeyAssignmentsChange?.(prev => {
          const next = [...prev];
          next[currentAssignedIndex] = null;
          return next;
        });
      }
    }
    setActiveTdField(null);
  };

  const handleFieldClick = (field) => {
    const newActive = activeTdField === field ? null : field;
    setActiveTdField(newActive);
    if (newActive) setPickerRequest({ code: entry[newActive] ?? 0 });
  };

  const handlePickerSelect = (code) => {
    if (activeTdField) updateEntry(activeTdField, code);
  };

  const codeContent = buildTapDanceCCode(tapDanceKeys, tdKeyAssignments);

  const copyCode = () => {
    navigator.clipboard.writeText(codeContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const saveToFile = async () => {
    if (!tapDanceFilePath) return;
    try {
      await invoke('write_text_file', { path: tapDanceFilePath, content: codeContent });
      setFileSaveStatus('Saved!');
      setTimeout(() => setFileSaveStatus(''), 2000);
    } catch (err) {
      setFileSaveStatus(`Error: ${err}`);
      setTimeout(() => setFileSaveStatus(''), 4000);
    }
  };

  return (
    <div className="td-panel">
      <div className="td-panel-header">
        <span className="td-panel-title">Tap Dance</span>
        {totalConfigured > 0 && (
          <span className="td-panel-count">{totalConfigured} key{totalConfigured !== 1 ? 's' : ''} configured</span>
        )}
      </div>

      {!keyObj ? (
        <div className="td-no-selection">
          <p>Click a key on the grid to configure its tap dance behavior.</p>
        </div>
      ) : (
        <>
          <div className="td-key-label">
            <span className="td-key-name">{keyObj.label}</span>
            <div className="td-key-id-wrap">
              <span className="td-key-id">{keyId}</span>
              {currentAssignedIndex >= 0 && (
                <span className="td-key-badge">TD({currentAssignedIndex})</span>
              )}
            </div>
            <input
              className="td-key-desc-input"
              value={currentDescription}
              onChange={e => handleDescriptionChange(e.target.value)}
              disabled={currentAssignedIndex < 0}
              placeholder={currentAssignedIndex >= 0
                ? `TD(${currentAssignedIndex}) — add a description…`
                : 'Assign a TD(n) slot below to add a description'}
              title={currentAssignedIndex >= 0 ? 'Saved with the profile.' : 'Assign this key to a TD(n) slot first.'}
            />
          </div>

          <div className="td-fields">
            {FIELDS.map(({ key, label }) => (
              <div
                key={key}
                className={`td-field-row${activeTdField === key ? ' active' : ''}`}
                onClick={() => handleFieldClick(key)}
              >
                <span className="td-field-label">{label}</span>
                <span className={`td-field-code${(entry[key] ?? 0) === 0 ? ' empty' : ''}`}>
                  {(entry[key] ?? 0) === 0
                    ? '—'
                    : (decodeQuantum(entry[key]) ?? `0x${entry[key].toString(16)}`)}
                </span>
              </div>
            ))}
          </div>

          <div className="td-term-row">
            <span className="td-term-label">Tapping Term</span>
            <input
              type="number"
              className="td-term-input"
              value={entry.tapping_term_ms ?? 0}
              min={0}
              max={2000}
              placeholder="0"
              onChange={e => updateEntry('tapping_term_ms', parseInt(e.target.value) || 0)}
            />
            <span className="td-term-unit">ms (0 = global, 200 ms)</span>
          </div>

          {hasAny && (
            <button className="td-remove-btn" onClick={removeEntry}>
              Remove TD from this key
            </button>
          )}

          {hasAny && (
            <div className="td-assign-section">
              <span className="td-assign-label">Keymap Assignment</span>
              {currentAssignedIndex >= 0 ? (
                <div className="td-assign-row">
                  <span className="td-assign-badge">TD({currentAssignedIndex})</span>
                  <span className="td-assign-desc">written to configured layers; re-applied on import</span>
                  <button className="td-assign-remove" onClick={handleRemoveAssignment}>Remove</button>
                </div>
              ) : (
                <>
                  <div className="td-assign-row">
                    <span className="td-assign-text">Assign as TD(</span>
                    <input
                      type="number"
                      className="td-assign-input"
                      value={assignIndexInput}
                      min={0}
                      max={31}
                      onChange={e => { setAssignIndexInput(parseInt(e.target.value) || 0); setAssignConflict(''); }}
                    />
                    <span className="td-assign-text">)</span>
                    <button className="td-assign-btn" onClick={handleAssign}>Assign</button>
                  </div>
                  {assignConflict && <div className="td-assign-warning">{assignConflict}</div>}
                </>
              )}
            </div>
          )}

          {activeTdField && (
            <div className="td-picker-wrap">
              <div className="td-picker-hint">
                Selecting: <strong>{FIELDS.find(f => f.key === activeTdField)?.label}</strong>
                <button className="td-picker-close" onClick={() => setActiveTdField(null)}>✕</button>
              </div>
              <KeyPicker onSelect={handlePickerSelect} focusRequest={pickerRequest} enableModifiers showModifiers={showMods} />
            </div>
          )}
        </>
      )}

      <div className="td-actions">
        <button
          className={`td-mods-toggle-btn${showMods ? ' active' : ''}`}
          onClick={() => setShowMods(s => !s)}
          disabled={!activeTdField}
          title={activeTdField ? 'Show/hide the modifier toggles in the key picker' : 'Open a key field to add modifiers'}
        >
          Add Modifiers
        </button>
        <button
          className="td-generate-btn"
          onClick={() => setShowCodeModal(true)}
          disabled={totalConfigured === 0}
        >
          Generate C Code
        </button>
      </div>

      {showCodeModal && (
        <TdCodeModal
          code={codeContent}
          onClose={() => setShowCodeModal(false)}
          copied={copied}
          onCopy={copyCode}
          tapDanceFilePath={tapDanceFilePath}
          onSave={saveToFile}
          fileSaveStatus={fileSaveStatus}
        />
      )}
    </div>
  );
}
