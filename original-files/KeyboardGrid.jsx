// components/KeyboardGrid.jsx
// Visual representation of the Iris-LM keyboard.
//
// The Iris-LM is a column-staggered split (4x6 per half + a 4-key thumb
// cluster per half, same vertical stagger as the Ergodox). This component
// reproduces that physical geometry instead of a flat grid:
//   - each finger column is offset vertically (pinky lowest, index highest)
//   - the thumb cluster wraps the inner-bottom corner in an L:
//       key 1 beside H,  key 2 beside N,  key 3 below N,  key 4 below M
//     (mirrored on the left: beside G, beside B, below B, below V)
//
// Layout is data-driven: every key carries its grid position and the matrix
// (row,col) it maps to, so positions are easy to verify/adjust later.
//
// NEEDS_HW_TEST: the matrix (row,col) coordinates below are a clean logical
// scheme. Confirm they match the firmware's real matrix before trusting
// read/write for any specific physical key.

import React, { useState } from 'react';
import KeyButton from './KeyButton';
import KeySelector from './KeySelector';
import './KeyboardGrid.css';

// Vertical stagger per finger column, in px. Index = least offset.
// Order runs outer-pinky -> index for the left hand.
const STAGGER_LEFT = [48, 40, 32, 24, 16, 0];
// Right hand mirrors it: index (innermost displayed) -> outer pinky.
const STAGGER_RIGHT = [0, 16, 24, 32, 40, 48];

// Default (layer 0) legends, in display order (left-to-right as seen).
const LEFT_ROWS = [
  ['ESC', '1', '2', '3', '4', '5'],
  ['TAB', 'Q', 'W', 'E', 'R', 'T'],
  ['CAPS', 'A', 'S', 'D', 'F', 'G'],
  ['LSFT', 'Z', 'X', 'C', 'V', 'B'],
];
const RIGHT_ROWS = [
  ['6', '7', '8', '9', '0', '-'],
  ['Y', 'U', 'I', 'O', 'P', '['],
  ['H', 'J', 'K', 'L', ';', "'"],
  ['N', 'M', ',', '.', '/', 'RSFT'],
];

// Thumb cluster legends (display order: keys 1..4 as described above).
const LEFT_THUMBS = ['MO1', 'SPC', 'ESC', 'TAB'];
const RIGHT_THUMBS = ['MO2', 'SPC', 'ENT', 'DEL'];

// Build the full descriptor list for one half.
// `side` is 'left' or 'right'.
function buildHalf(side) {
  const rows = side === 'left' ? LEFT_ROWS : RIGHT_ROWS;
  const stagger = side === 'left' ? STAGGER_LEFT : STAGGER_RIGHT;
  const thumbs = side === 'left' ? LEFT_THUMBS : RIGHT_THUMBS;
  // Right-half main matrix is shifted one grid column inward so the inner
  // thumb keys have a column (column 1) to live in.
  const colShift = side === 'left' ? 1 : 2;
  const keys = [];

  // Main 4x6 matrix.
  // Real Iris matrix (from keebio keyboard.json): left half = rows 0-3 with
  // columns in display order; right half = rows 5-8 with columns REVERSED
  // (display index finger -> matrix col 5, pinky -> matrix col 0).
  rows.forEach((row, r) => {
    row.forEach((label, d) => {
      keys.push({
        id: `${side}-m-${r}-${d}`,
        label,
        gridColumn: d + colShift,
        gridRow: r + 1,
        marginTop: stagger[d],
        matrixRow: side === 'left' ? r : r + 5,
        matrixCol: side === 'left' ? d : 5 - d,
        thumb: false,
      });
    });
  });

  // Thumb cluster — explicit grid cells forming the inner-corner L.
  // Real Iris thumb matrix positions (from keebio keyboard.json):
  //   left  thumbs -> [4,5] [4,4] [4,3] [4,2]
  //   right thumbs -> [9,5] [9,4] [9,3] [9,2]
  // Visual key order is key1 (inner-top) -> key4 (outer), which maps inner->
  // outer onto those matrix columns.
  const thumbCells =
    side === 'left'
      ? [
          { col: 7, row: 3, mc: 5 }, // beside G
          { col: 7, row: 4, mc: 4 }, // beside B
          { col: 6, row: 5, mc: 3 }, // below B
          { col: 5, row: 5, mc: 2 }, // below V
        ]
      : [
          { col: 1, row: 3, mc: 5 }, // beside H
          { col: 1, row: 4, mc: 4 }, // beside N
          { col: 2, row: 5, mc: 3 }, // below N
          { col: 3, row: 5, mc: 2 }, // below M
        ];

  const thumbMatrixRow = side === 'left' ? 4 : 9;

  thumbs.forEach((label, t) => {
    keys.push({
      id: `${side}-t-${t}`,
      label,
      gridColumn: thumbCells[t].col,
      gridRow: thumbCells[t].row,
      marginTop: 0,
      matrixRow: thumbMatrixRow,
      matrixCol: thumbCells[t].mc,
      thumb: true,
    });
  });

  return keys;
}

const HALVES = {
  left: buildHalf('left'),
  right: buildHalf('right'),
};

// QMK/HID keycode -> short name, for displaying a keymap read from the device.
// Basic keycodes equal their USB-HID usage IDs. This is a common subset; codes
// not listed fall back to the default legend, then to hex. Layer/mod-tap
// quantum keycodes are intentionally not hardcoded (their ranges vary by QMK
// version) — they show as hex so nothing is ever mislabeled.
const KEYCODE_MAP = (() => {
  const m = {
    0x0000: '', // KC_NO
    0x0001: '▽', // KC_TRNS
  };
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 26; i++) m[0x04 + i] = letters[i];
  const digits = '1234567890';
  for (let i = 0; i < 10; i++) m[0x1e + i] = digits[i];
  Object.assign(m, {
    0x28: 'ENT', 0x29: 'ESC', 0x2a: 'BSPC', 0x2b: 'TAB', 0x2c: 'SPC',
    0x2d: '-', 0x2e: '=', 0x2f: '[', 0x30: ']', 0x31: '\\',
    0x33: ';', 0x34: "'", 0x35: '`', 0x36: ',', 0x37: '.', 0x38: '/', 0x39: 'CAPS',
    0x4a: 'HOME', 0x4b: 'PGUP', 0x4c: 'DEL', 0x4d: 'END', 0x4e: 'PGDN',
    0x4f: 'RGHT', 0x50: 'LEFT', 0x51: 'DOWN', 0x52: 'UP',
    0xe0: 'LCTL', 0xe1: 'LSFT', 0xe2: 'LALT', 0xe3: 'LGUI',
    0xe4: 'RCTL', 0xe5: 'RSFT', 0xe6: 'RALT', 0xe7: 'RGUI',
  });
  for (let i = 0; i < 12; i++) m[0x3a + i] = `F${i + 1}`;
  return m;
})();

export default function KeyboardGrid({ keymap, currentLayer, selectedKey, onKeySelect, onKeyChange }) {
  const [showSelector, setShowSelector] = useState(false);
  const [selectorKey, setSelectorKey] = useState(null);

  const handleKeyClick = (matrixRow, matrixCol) => {
    setSelectorKey({ row: matrixRow, col: matrixCol });
    setShowSelector(true);
    onKeySelect?.({ row: matrixRow, col: matrixCol });
  };

  const handleKeySelect = (keyName, keycode) => {
    if (selectorKey) {
      onKeyChange?.(selectorKey.row, selectorKey.col, keycode);
    }
    setShowSelector(false);
  };

  // Show the loaded keymap's keycode if present, otherwise the default legend.
  const labelFor = (key) => {
    const code = keymap?.[key.matrixRow]?.[key.matrixCol];
    if (code === undefined || code === null) return key.label; // no keymap yet
    const named = KEYCODE_MAP[code];
    if (named !== undefined) return named;            // known keycode
    if (code <= 0x00ff) return key.label;             // basic but unlisted -> legend
    return `0x${code.toString(16).padStart(4, '0')}`; // quantum keycode -> hex
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
              keyName={labelFor(key)}
              isThumb={key.thumb}
              isSelected={selectedKey?.row === key.matrixRow && selectedKey?.col === key.matrixCol}
              onClick={() => handleKeyClick(key.matrixRow, key.matrixCol)}
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
