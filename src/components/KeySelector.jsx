// components/KeySelector.jsx
//
// USB HID usage IDs == QMK basic keycodes (0x00–0xFF).
// Layer keys use the QK_MOMENTARY range confirmed for this firmware: MO(n) = 0x5220 | n.
import React, { useState } from 'react';

const KEY_CATEGORIES = [
  {
    name: 'Special',
    keys: [
      { name: 'TRNS', code: 0x0001 },
      { name: 'NO',   code: 0x0000 },
    ],
  },
  {
    name: 'Numbers',
    keys: [
      { name: '1', code: 0x001e }, { name: '2', code: 0x001f },
      { name: '3', code: 0x0020 }, { name: '4', code: 0x0021 },
      { name: '5', code: 0x0022 }, { name: '6', code: 0x0023 },
      { name: '7', code: 0x0024 }, { name: '8', code: 0x0025 },
      { name: '9', code: 0x0026 }, { name: '0', code: 0x0027 },
    ],
  },
  {
    name: 'Letters',
    keys: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (l, i) => ({ name: l, code: 0x0004 + i })),
  },
  {
    name: 'Function',
    keys: [
      ...Array.from({ length: 12 }, (_, i) => ({ name: `F${i + 1}`,  code: 0x003a + i })),
      ...Array.from({ length: 12 }, (_, i) => ({ name: `F${i + 13}`, code: 0x0068 + i })),
    ],
  },
  {
    name: 'Common',
    keys: [
      { name: 'ESC',  code: 0x0029 }, { name: 'ENT',  code: 0x0028 },
      { name: 'BSPC', code: 0x002a }, { name: 'TAB',  code: 0x002b },
      { name: 'SPC',  code: 0x002c }, { name: 'CAPS', code: 0x0039 },
      { name: 'DEL',  code: 0x004c }, { name: 'INS',  code: 0x0049 },
      { name: 'APP',  code: 0x0065 },
    ],
  },
  {
    name: 'Navigation',
    keys: [
      { name: 'UP',   code: 0x0052 }, { name: 'DOWN', code: 0x0051 },
      { name: 'LEFT', code: 0x0050 }, { name: 'RGHT', code: 0x004f },
      { name: 'HOME', code: 0x004a }, { name: 'END',  code: 0x004d },
      { name: 'PGUP', code: 0x004b }, { name: 'PGDN', code: 0x004e },
    ],
  },
  {
    name: 'Modifiers',
    keys: [
      { name: 'LCTL', code: 0x00e0 }, { name: 'LSFT', code: 0x00e1 },
      { name: 'LALT', code: 0x00e2 }, { name: 'LGUI', code: 0x00e3 },
      { name: 'RCTL', code: 0x00e4 }, { name: 'RSFT', code: 0x00e5 },
      { name: 'RALT', code: 0x00e6 }, { name: 'RGUI', code: 0x00e7 },
    ],
  },
  {
    name: 'Symbols',
    keys: [
      { name: '-',   code: 0x002d }, { name: '=',   code: 0x002e },
      { name: '[',   code: 0x002f }, { name: ']',   code: 0x0030 },
      { name: '\\',  code: 0x0031 }, { name: ';',   code: 0x0033 },
      { name: "'",   code: 0x0034 }, { name: '`',   code: 0x0035 },
      { name: ',',   code: 0x0036 }, { name: '.',   code: 0x0037 },
      { name: '/',   code: 0x0038 },
    ],
  },
  {
    name: 'Numpad',
    keys: [
      { name: 'NLCK', code: 0x0053 }, { name: 'P/',   code: 0x0054 },
      { name: 'P*',   code: 0x0055 }, { name: 'P-',   code: 0x0056 },
      { name: 'P+',   code: 0x0057 }, { name: 'PEnt', code: 0x0058 },
      { name: 'P1',   code: 0x0059 }, { name: 'P2',   code: 0x005a },
      { name: 'P3',   code: 0x005b }, { name: 'P4',   code: 0x005c },
      { name: 'P5',   code: 0x005d }, { name: 'P6',   code: 0x005e },
      { name: 'P7',   code: 0x005f }, { name: 'P8',   code: 0x0060 },
      { name: 'P9',   code: 0x0061 }, { name: 'P0',   code: 0x0062 },
      { name: 'P.',   code: 0x0063 },
    ],
  },
  {
    name: 'System',
    keys: [
      { name: 'PSCR', code: 0x0046 },
      { name: 'SCRL', code: 0x0047 },
      { name: 'PAUS', code: 0x0048 },
    ],
  },
  {
    name: 'Layer',
    keys: [
      { name: 'MO(0)', code: 0x5220 },
      { name: 'MO(1)', code: 0x5221 },
      { name: 'MO(2)', code: 0x5222 },
      { name: 'MO(3)', code: 0x5223 },
    ],
  },
];

const ALL_KEYS = KEY_CATEGORIES.flatMap((c) => c.keys);

export default function KeySelector({ currentKey, onSelect, onClose }) {
  const [category, setCategory] = useState('Numbers');
  const [search, setSearch] = useState('');

  const keys = search
    ? ALL_KEYS.filter((k) => k.name.toLowerCase().includes(search.toLowerCase()))
    : (KEY_CATEGORIES.find((c) => c.name === category)?.keys ?? []);

  return (
    <div className="key-selector-modal" onClick={onClose}>
      <div className="modal-content key-selector-content" onClick={(e) => e.stopPropagation()}>
        <h4>Select Key</h4>
        <input
          className="key-search"
          placeholder="Search keycodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {!search && (
          <div className="key-category-tabs">
            {KEY_CATEGORIES.map((c) => (
              <button
                key={c.name}
                className={`cat-tab${category === c.name ? ' active' : ''}`}
                onClick={() => setCategory(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="key-list key-list-wide">
          {keys.map((key) => (
            <button key={key.code} onClick={() => onSelect(key.name, key.code)}>
              {key.name}
            </button>
          ))}
        </div>
        <button className="close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
