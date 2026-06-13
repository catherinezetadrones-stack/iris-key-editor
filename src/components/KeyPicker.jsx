import React, { useState, useEffect, useRef } from 'react';
import { decodeQuantum, getSecondary } from '../keyboardLayout';
import { resolveKeyDescription } from '../keycodeDescriptions';
import './KeyPicker.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const _L = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (l, i) => ({ name: l, code: 0x04 + i }));
const _byName = (n) => _L.find((k) => k.name === n);

const HOME_ROW  = ['A','S','D','F','G','H','J','K','L'].map(_byName);
const HOME_KEYS = [...HOME_ROW, { name: 'SCLN', code: 0x33 }];
const SPECIAL_MT = [
  { name: 'SPC', code: 0x2c }, { name: 'ENT',  code: 0x28 },
  { name: 'BSPC', code: 0x2a }, { name: 'TAB', code: 0x2b },
  { name: 'ESC', code: 0x29 },
];

function makeLT(layer, keys) {
  return keys.map((k) => ({ name: `LT${layer}·${k.name}`, code: 0x4000 | (layer << 8) | k.code }));
}

function makeMT(modName, modCode, keys) {
  return keys.map((k) => ({ name: `${modName}·${k.name}`, code: 0x6000 | (modCode << 8) | k.code }));
}

const LT_BASE = [
  { name: 'SPC', code: 0x2c }, { name: 'ENT',  code: 0x28 }, { name: 'BSPC', code: 0x2a },
  { name: 'TAB', code: 0x2b }, { name: 'ESC',  code: 0x29 }, { name: 'DEL',  code: 0x4c },
];

const NUM_KEYS = Array.from({ length: 10 }, (_, i) => ({
  name: i === 9 ? '0' : String(i + 1),
  code: 0x1e + i,
}));

// Key set for MEH / HYPR / RAGR: home row + numbers + common specials
const POWER_MT_KEYS = [...HOME_KEYS, ...NUM_KEYS, ...SPECIAL_MT];

// ── Category definitions ──────────────────────────────────────────────────────

const KEY_CATEGORIES = [
  {
    name: 'Letters',
    keys: _L,
  },
  {
    name: 'Numbers',
    keys: [
      { name: '1', code: 0x001e }, { name: '2', code: 0x001f }, { name: '3', code: 0x0020 },
      { name: '4', code: 0x0021 }, { name: '5', code: 0x0022 }, { name: '6', code: 0x0023 },
      { name: '7', code: 0x0024 }, { name: '8', code: 0x0025 }, { name: '9', code: 0x0026 },
      { name: '0', code: 0x0027 },
    ],
  },
  {
    name: 'Common',
    keys: [
      { name: 'ESC',  code: 0x0029 }, { name: 'ENT',  code: 0x0028 }, { name: 'BSPC', code: 0x002a },
      { name: 'TAB',  code: 0x002b }, { name: 'SPC',  code: 0x002c }, { name: 'CAPS', code: 0x0039 },
      { name: 'DEL',  code: 0x004c }, { name: 'INS',  code: 0x0049 }, { name: 'APP',  code: 0x0065 },
    ],
  },
  {
    name: 'Function',
    keys: [
      ...Array.from({ length: 12 }, (_, i) => ({ name: `F${i + 1}`,  code: 0x003a + i })),
      ...Array.from({ length: 12 }, (_, i) => ({ name: `F${i + 13}`, code: 0x0068 + i })),
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
    name: 'Mouse',
    keys: [
      { name: 'MS_UP',   code: 0x00cd }, { name: 'MS_DOWN', code: 0x00ce },
      { name: 'MS_LEFT', code: 0x00cf }, { name: 'MS_RGHT', code: 0x00d0 },
      { name: 'MS_BTN1', code: 0x00d1 }, { name: 'MS_BTN2', code: 0x00d2 },
      { name: 'MS_BTN3', code: 0x00d3 }, { name: 'MS_BTN4', code: 0x00d4 },
      { name: 'MS_BTN5', code: 0x00d5 }, { name: 'MS_BTN6', code: 0x00d6 },
      { name: 'MS_BTN7', code: 0x00d7 }, { name: 'MS_BTN8', code: 0x00d8 },
      { name: 'MS_WHLU', code: 0x00d9 }, { name: 'MS_WHLD', code: 0x00da },
      { name: 'MS_WHLL', code: 0x00db }, { name: 'MS_WHLR', code: 0x00dc },
      { name: 'MS_ACL0', code: 0x00dd }, { name: 'MS_ACL1', code: 0x00de },
      { name: 'MS_ACL2', code: 0x00df },
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
      { name: 'PSCR', code: 0x0046 }, { name: 'SCRL', code: 0x0047 }, { name: 'PAUS', code: 0x0048 },
      { name: 'PWR',  code: 0x00a5 }, { name: 'SLEP', code: 0x00a6 }, { name: 'WAKE', code: 0x00a7 },
    ],
  },
  {
    name: 'Media',
    keys: [
      { name: 'MUTE', code: 0x00a8 }, { name: 'VOLU', code: 0x00a9 }, { name: 'VOLD', code: 0x00aa },
      { name: 'MPLY', code: 0x00ae }, { name: 'MSTP', code: 0x00ad }, { name: 'MNXT', code: 0x00ab },
      { name: 'MPRV', code: 0x00ac }, { name: 'MSEL', code: 0x00af }, { name: 'EJCT', code: 0x00b0 },
      { name: 'BRIU', code: 0x00bb }, { name: 'BRID', code: 0x00bc },
      { name: 'MAIL', code: 0x00b1 }, { name: 'CALC', code: 0x00b2 }, { name: 'MYCM', code: 0x00b3 },
      { name: 'WSCH', code: 0x00b4 }, { name: 'WHOM', code: 0x00b5 }, { name: 'WBAK', code: 0x00b6 },
      { name: 'WFWD', code: 0x00b7 }, { name: 'WSTP', code: 0x00b8 }, { name: 'WREF', code: 0x00b9 },
      { name: 'WFAV', code: 0x00ba },
    ],
  },
  {
    name: 'Layer',
    keys: [
      ...Array.from({ length: 10 }, (_, n) => ({ name: `MO(${n})`,  code: 0x5220 + n })),
      ...Array.from({ length: 10 }, (_, n) => ({ name: `TG(${n})`,  code: 0x5230 + n })),
      ...Array.from({ length: 10 }, (_, n) => ({ name: `TO(${n})`,  code: 0x5200 + n })),
      ...Array.from({ length: 10 }, (_, n) => ({ name: `TT(${n})`,  code: 0x5240 + n })),
      ...Array.from({ length: 10 }, (_, n) => ({ name: `OSL(${n})`, code: 0x5260 + n })),
      ...Array.from({ length: 10 }, (_, n) => ({ name: `DF(${n})`,  code: 0x5250 + n })),
    ],
  },
  {
    name: 'LT',
    keys: [
      ...makeLT(1, LT_BASE),
      ...makeLT(2, LT_BASE),
      ...makeLT(3, LT_BASE),
    ],
  },
  {
    name: 'MT·SFT',
    keys: makeMT('SFT', 0x02, [..._L, ...SPECIAL_MT]),
  },
  {
    name: 'MT·CTL',
    keys: makeMT('CTL', 0x01, [...HOME_KEYS, ...SPECIAL_MT]),
  },
  {
    name: 'MT·ALT',
    keys: makeMT('ALT', 0x04, [...HOME_KEYS, ...SPECIAL_MT]),
  },
  {
    name: 'MT·GUI',
    keys: makeMT('GUI', 0x08, [...HOME_KEYS, ...SPECIAL_MT]),
  },
  {
    name: 'MT·RSFT',
    keys: makeMT('RSFT', 0x12, [...HOME_KEYS, ...SPECIAL_MT]),
  },
  {
    name: 'MT·RCTL',
    keys: makeMT('RCTL', 0x11, [...HOME_KEYS, ...SPECIAL_MT]),
  },
  {
    name: 'MT·RALT',
    keys: makeMT('RALT', 0x14, [...HOME_KEYS, ...SPECIAL_MT]),
  },
  {
    name: 'MT·RGUI',
    keys: makeMT('RGUI', 0x18, [...HOME_KEYS, ...SPECIAL_MT]),
  },
  {
    name: 'MT·MEH',
    keys: makeMT('MEH', 0x07, POWER_MT_KEYS),
  },
  {
    name: 'MT·HYPR',
    keys: makeMT('HYPR', 0x0f, POWER_MT_KEYS),
  },
  {
    name: 'MT·RAGR',
    keys: makeMT('RAGR', 0x1c, POWER_MT_KEYS),
  },
  {
    name: 'Macro',
    keys: Array.from({ length: 16 }, (_, n) => ({ name: `M(${n})`, code: 0x7700 + n })),
  },
  {
    name: 'Macro (FW)',
    keys: Array.from({ length: 32 }, (_, n) => ({ name: `MU(${n})`, code: 0x7E40 + n })),
  },
  {
    name: 'Tap Dance',
    keys: Array.from({ length: 32 }, (_, n) => ({ name: `TD(${n})`, code: 0x5700 + n })),
  },
  {
    name: 'RGB',
    keys: [
      { name: 'RGB_TOG',  code: 0x7800 },
      { name: 'RGB_MOD',  code: 0x7801 },
      { name: 'RGB_RMOD', code: 0x7802 },
      { name: 'RGB_HUI',  code: 0x7803 },
      { name: 'RGB_HUD',  code: 0x7804 },
      { name: 'RGB_SAI',  code: 0x7805 },
      { name: 'RGB_SAD',  code: 0x7806 },
      { name: 'RGB_VAI',  code: 0x7807 },
      { name: 'RGB_VAD',  code: 0x7808 },
      { name: 'RGB_SPI',  code: 0x7809 },
      { name: 'RGB_SPD',  code: 0x780a },
    ],
  },
  {
    name: 'Special',
    keys: [
      { name: 'TRNS',    code: 0x0001 },
      { name: 'NO',      code: 0x0000 },
      { name: 'QK_BOOT', code: 0x7c00 },
    ],
  },
];

const ALL_KEYS = KEY_CATEGORIES.flatMap((c) => c.keys);

// ── "Add modifiers" (QK_MODS) helpers ─────────────────────────────────────────
// Mod-wrapped keycodes: 0x0100–0x1FFF = basic keycode | (mod bits << 8).
// Bits: 0x01 Ctrl, 0x02 Shift, 0x04 Alt, 0x08 GUI; 0x10 makes ALL of them
// right-hand (QMK shares a single right-hand flag — left/right cannot mix).

const MOD_BUTTONS = [
  { label: 'Left Shift', bit: 0x02, right: false }, { label: 'Right Shift', bit: 0x02, right: true },
  { label: 'Left Ctrl',  bit: 0x01, right: false }, { label: 'Right Ctrl',  bit: 0x01, right: true },
  { label: 'Left Alt',   bit: 0x04, right: false }, { label: 'Right Alt',   bit: 0x04, right: true },
  { label: 'Left Win',   bit: 0x08, right: false }, { label: 'Right Win',   bit: 0x08, right: true },
];

const isBasicCode = (code) => code > 0x0000 && code <= 0x00ff;
const isModWrapped = (code) => code >= 0x0100 && code <= 0x1fff;

// Combine a base key with mod bits. Mods only apply to basic keycodes;
// anything else (layer keys, TD, LT, MT, macros…) passes through untouched.
function composeMods(base, mods) {
  return mods !== 0 && isBasicCode(base) ? ((mods << 8) | base) : base;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function KeyPicker({ onSelect, focusRequest, macroDescriptions, tapDanceDescriptions, enableModifiers = false, showModifiers = false }) {
  const [category, setCategory] = useState('Numbers');
  const [search, setSearch] = useState('');
  const [highlightCode, setHighlightCode] = useState(null);
  const [hoveredCode, setHoveredCode] = useState(null);
  // Current base key + toggled mod bits — only meaningful when enableModifiers.
  const [baseCode, setBaseCode] = useState(0);
  const [modBits, setModBits]   = useState(0);
  const highlightTimerRef = useRef(null);

  const clearHighlight = () => {
    clearTimeout(highlightTimerRef.current);
    setHighlightCode(null);
  };

  useEffect(() => {
    if (focusRequest == null) return;
    let code = focusRequest.code;
    // Seed the modifier toggles from the current field value, and focus the
    // base key in the grid (mod-wrapped codes have no picker button of their own).
    if (enableModifiers && isModWrapped(code)) {
      setBaseCode(code & 0x00ff);
      setModBits((code >> 8) & 0x1f);
      code = code & 0x00ff;
    } else {
      setBaseCode(code);
      setModBits(0);
    }
    const cat = KEY_CATEGORIES.find((c) => c.keys.some((k) => k.code === code));
    if (cat) {
      setSearch('');
      setCategory(cat.name);
    } else {
      // Key not in picker — fall back to search with decoded name
      const decoded = decodeQuantum(code) ?? `0x${code.toString(16).padStart(4, '0')}`;
      setSearch(decoded);
    }
    setHighlightCode(code);
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightCode(null), 3500);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector(`[data-keycode="${code}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }));
  }, [focusRequest]);

  const keys = search
    ? ALL_KEYS.filter((k) => k.name.toLowerCase().includes(search.toLowerCase()))
    : (KEY_CATEGORIES.find((c) => c.name === category)?.keys ?? []);

  const handleKeyClick = (code) => {
    let emit = code;
    if (enableModifiers) {
      if (isBasicCode(code) || code === 0) {
        // Toggled modifiers persist across base-key picks (Oryx-style): the
        // active toggles below the grid wrap whichever basic key is clicked.
        emit = composeMods(code, modBits);
        setBaseCode(code);
      } else {
        // Non-basic keys (layers, TD, LT, MT, macros…) can't carry mods.
        setBaseCode(code);
        setModBits(0);
      }
    }
    onSelect(emit);
    clearHighlight();
  };

  const handleModToggle = (bit, right) => {
    let next = modBits ^ bit;
    if ((next & 0x0f) === 0) next = 0;            // no mods left → clear right flag too
    else next = right ? (next | 0x10) : (next & 0x0f);
    setModBits(next);
    if (isBasicCode(baseCode)) onSelect(composeMods(baseCode, next));
  };

  const modsUnavailable = baseCode > 0x00ff;       // non-basic selection
  const modsActive      = (modBits & 0x0f) !== 0;
  const rightActive     = (modBits & 0x10) !== 0;
  const composedCode    = composeMods(baseCode, modBits);

  // Hovering a key takes priority; otherwise fall back to the current selection
  // (with mods applied) so the description tracks the combo being built.
  const currentCode = enableModifiers && focusRequest != null ? composedCode : (focusRequest?.code ?? null);
  const descriptionCode = hoveredCode ?? currentCode;
  const description = resolveKeyDescription(descriptionCode, macroDescriptions, tapDanceDescriptions);

  return (
    <div className="key-picker">
      <div className="key-picker-description" title={description}>{description}</div>
      <div className="key-picker-body">

        <div className="key-picker-left">
          <div className="key-picker-search">
            <input
              placeholder="Search…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); clearHighlight(); }}
            />
          </div>
          <div className="key-picker-cat-wrap">
            <div className="key-picker-categories">
              {KEY_CATEGORIES.map((c) => (
                <button
                  key={c.name}
                  className={`picker-cat${!search && category === c.name ? ' active' : ''}`}
                  onClick={() => { setSearch(''); setCategory(c.name); clearHighlight(); }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="key-picker-keys">
          {keys.map((key) => {
            const sub = getSecondary(key.code);
            return (
              <button
                key={key.code}
                className={`picker-key${highlightCode === key.code ? ' highlighted' : ''}`}
                data-keycode={key.code}
                onClick={() => handleKeyClick(key.code)}
                onMouseEnter={() => setHoveredCode(key.code)}
                onMouseLeave={() => setHoveredCode(null)}
              >
                {sub && <span className="picker-key-sub">{sub}</span>}
                {key.name}
              </button>
            );
          })}
        </div>

      </div>

      {enableModifiers && showModifiers && (
        <div className="key-picker-mods">
          <div className="key-picker-mods-header">
            <span className="key-picker-mods-title">Add modifiers</span>
            <span className="key-picker-mods-preview">
              {modsUnavailable
                ? 'Not available for layer/TD/macro keys'
                : modsActive
                  ? (isBasicCode(baseCode)
                      ? (decodeQuantum(composedCode) || `0x${composedCode.toString(16).padStart(4, '0')}`)
                      : 'Pick a key to apply the modifiers')
                  : 'Send e.g. Ctrl + Backspace by holding just this one key'}
            </span>
          </div>
          <div className="key-picker-mods-grid">
            {MOD_BUTTONS.map(({ label, bit, right }) => {
              const active = (modBits & bit) !== 0 && right === rightActive;
              // QMK has one shared right-hand flag — left and right mods can't mix.
              const disabled = modsUnavailable || (modsActive && right !== rightActive);
              return (
                <button
                  key={label}
                  className={`picker-mod-btn${active ? ' active' : ''}`}
                  disabled={disabled}
                  title={disabled && !modsUnavailable ? 'Left and right modifiers cannot be combined' : undefined}
                  onClick={() => handleModToggle(bit, right)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
