import React, { useState } from 'react';
import KeyButton from './KeyButton';
import { HALVES, decodeQuantum, getSecondary } from '../keyboardLayout';
import './KeyboardGrid.css';

function labelFor(key, keymap, customLabels) {
  if (customLabels?.[key.id]) return customLabels[key.id];
  const code = keymap?.[key.viaRow]?.[key.viaCol];
  if (code === undefined || code === null) return key.label;
  const named = decodeQuantum(code);
  if (named !== null) return named;
  if (code <= 0x00ff) return key.label;
  return `0x${code.toString(16).padStart(4, '0')}`;
}

export default function KeyboardGrid({ keymap, currentLayer, selectedKey, onKeySelect, onKeyRightClick, keyLedColors, keyBadges, customLabels }) {
  const handleKeyClick = (viaRow, viaCol) => {
    onKeySelect?.({ row: viaRow, col: viaCol });
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
              keyName={labelFor(key, keymap, customLabels)}
              subLabel={keyBadges?.get(key.id) ?? getSecondary(keymap?.[key.viaRow]?.[key.viaCol])}
              isThumb={key.thumb}
              isSelected={selectedKey?.row === key.viaRow && selectedKey?.col === key.viaCol}
              onClick={() => handleKeyClick(key.viaRow, key.viaCol)}
              glowColor={keyLedColors?.get(key.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="keyboard-grid" onContextMenu={(e) => e.preventDefault()}>
      <div className="keyboard">
        {renderHalf('left')}
        <div className="keyboard-divider" />
        {renderHalf('right')}
      </div>
    </div>
  );
}
