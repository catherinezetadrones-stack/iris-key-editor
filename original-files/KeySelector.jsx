// components/KeySelector.jsx
import React from 'react';

// Codes are USB-HID usage IDs (== QMK basic keycodes). Layer keys use QMK's
// QK_MOMENTARY range (0x5220 | layer) from current QMK quantum_keycodes.
const commonKeys = [
  { name: 'ESC', code: 0x0029 },
  { name: 'BSPC', code: 0x002a },
  { name: 'TAB', code: 0x002b },
  { name: 'ENT', code: 0x0028 },
  { name: 'SPC', code: 0x002c }, // fixed: was 0x20 (that is KC_3)
  { name: 'LCTL', code: 0x00e0 },
  { name: 'LSFT', code: 0x00e1 },
  { name: 'LALT', code: 0x00e2 },
  { name: 'LGUI', code: 0x00e3 },
  { name: 'MO(1)', code: 0x5221 }, // QK_MOMENTARY | 1
  { name: 'MO(2)', code: 0x5222 }, // QK_MOMENTARY | 2
  { name: 'TRNS', code: 0x0001 },
];

export default function KeySelector({ currentKey, onSelect, onClose }) {
  return (
    <div className="key-selector-modal" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h4>Select Key</h4>
        <div className="key-list">
          {commonKeys.map((key) => (
            <button key={key.code} onClick={() => onSelect(key.name, key.code)}>
              {key.name}
            </button>
          ))}
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
