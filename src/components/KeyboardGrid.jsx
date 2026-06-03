// components/KeyboardGrid.jsx
// Visual Iris-LM layout editor.  Matrix coordinates and key names come from
// keyboardLayout.js, which is the single source of truth for physical↔matrix
// mapping (measured from real hardware with the Raw Matrix tool).

import React, { useState } from 'react';
import KeyButton from './KeyButton';
import KeySelector from './KeySelector';
import { HALVES, decodeQuantum } from '../keyboardLayout';
import './KeyboardGrid.css';

function labelFor(key, keymap) {
  const code = keymap?.[key.viaRow]?.[key.viaCol];
  if (code === undefined || code === null) return key.label;
  const named = decodeQuantum(code);
  if (named !== null) return named;
  if (code <= 0x00ff) return key.label;
  return `0x${code.toString(16).padStart(4, '0')}`;
}

export default function KeyboardGrid({ keymap, currentLayer, selectedKey, onKeySelect, onKeyChange }) {
  const [showSelector, setShowSelector] = useState(false);
  const [selectorKey, setSelectorKey] = useState(null);

  const handleKeyClick = (viaRow, viaCol) => {
    setSelectorKey({ row: viaRow, col: viaCol });
    setShowSelector(true);
    onKeySelect?.({ row: viaRow, col: viaCol });
  };

  const handleKeySelect = (keyName, keycode) => {
    if (selectorKey) {
      onKeyChange?.(selectorKey.row, selectorKey.col, keycode);
    }
    setShowSelector(false);
  };

  const renderHalf = (side) => (
    <div className={`keyboard-half ${side}`}>
      <div className="hand-label">{side.toUpperCase()}</div>
      <div className="key-grid">
        {HALVES[side].map((key) => (
          <div
            key={key.id}
            className="key-cell"
            style={{ gridColumn: key.gridColumn, gridRow: key.gridRow, marginTop: key.marginTop }}
          >
            <KeyButton
              keyName={labelFor(key, keymap)}
              isThumb={key.thumb}
              isSelected={selectedKey?.row === key.viaRow && selectedKey?.col === key.viaCol}
              onClick={() => handleKeyClick(key.viaRow, key.viaCol)}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="keyboard-grid">
      <div className="grid-info">
        <h2>Layer {currentLayer}</h2>
        <span className="info-text">Click keys to remap</span>
      </div>

      <div className="keyboard">
        {renderHalf('left')}
        <div className="keyboard-divider" />
        {renderHalf('right')}
      </div>

      {showSelector && (
        <KeySelector
          currentKey={selectorKey}
          onSelect={handleKeySelect}
          onClose={() => setShowSelector(false)}
        />
      )}
    </div>
  );
}
