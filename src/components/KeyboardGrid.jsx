import React from 'react';
import KeyButton from './KeyButton';
import { HALVES, decodeQuantum, getSecondary } from '../keyboardLayout';
import './KeyboardGrid.css';

function labelFor(key, keymap) {
  const code = keymap?.[key.viaRow]?.[key.viaCol];
  if (code === undefined || code === null) return key.label;
  const named = decodeQuantum(code);
  if (named !== null) return named;
  if (code <= 0x00ff) return key.label;
  return `0x${code.toString(16).padStart(4, '0')}`;
}

export default function KeyboardGrid({ keymap, currentLayer, selectedKey, onKeySelect, onKeyRightClick }) {
  const handleKeyClick = (viaRow, viaCol) => {
    onKeySelect?.({ row: viaRow, col: viaCol });
  };

  const handleDeselect = () => {
    onKeySelect?.(null);
  };

  const handleKeyRightClick = (e, viaRow, viaCol) => {
    e.preventDefault();
    const code = keymap?.[viaRow]?.[viaCol];
    if (code != null) onKeyRightClick?.({ code });
  };

  const renderHalf = (side) => (
    <div className={`keyboard-half ${side}`}>
      <div className="key-grid">
        {HALVES[side].map((key) => (
          <div
            key={key.id}
            className="key-cell"
            style={{
              gridColumn: key.gridColumn,
              gridRow:    key.gridRow,
              marginTop:  key.marginTop,
              marginLeft: key.marginLeft,
              transform:  key.rotation ? `rotate(${key.rotation}deg)` : undefined,
            }}
            onContextMenu={(e) => handleKeyRightClick(e, key.viaRow, key.viaCol)}
          >
            <KeyButton
              keyName={labelFor(key, keymap)}
              subLabel={getSecondary(keymap?.[key.viaRow]?.[key.viaCol])}
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
    <div className="keyboard-grid" onContextMenu={(e) => e.preventDefault()}>
      <div className="grid-info">
        <h2>Layer {currentLayer}</h2>
        {selectedKey ? (
          <button className="deselect-btn" onClick={handleDeselect}>
            Deselect key
          </button>
        ) : (
          <span className="info-text">Click keys to remap</span>
        )}
      </div>

      <div className="keyboard">
        {renderHalf('left')}
        <div className="keyboard-divider" />
        {renderHalf('right')}
      </div>
    </div>
  );
}
