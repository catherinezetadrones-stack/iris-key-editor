// macroCodec.js — VIA macro buffer codec
//
// VIA macro buffer format (quantum/via.h, SS_* constants):
//   0x00                     = end of macro (null terminator)
//   0x01 0x01 <hid>          = tap key  (1-byte USB HID keycode)
//   0x01 0x02 <hid>          = key down
//   0x01 0x03 <hid>          = key up
//   0x01 0x04 <digits> 0x7C  = delay ms (ASCII digit bytes, '|' terminator)
//   any other byte           = ASCII character to type
//
// All N macros are stored consecutively, each terminated by 0x00.

export const SS_PREFIX = 0x01;
export const SS_TAP    = 0x01;
export const SS_DOWN   = 0x02;
export const SS_UP     = 0x03;
export const SS_DELAY  = 0x04;
export const SS_END    = 0x00;

// Parse the raw byte buffer into an array of action arrays, one per macro slot.
// Returns: [ [action, ...], [action, ...], ... ]  (length = macroCount)
//
// Action shapes:
//   { type: 'text',  value: string }
//   { type: 'tap',   keycode: number }  // USB HID code
//   { type: 'down',  keycode: number }
//   { type: 'up',    keycode: number }
//   { type: 'delay', ms: number }
export function parseBuffer(buf, macroCount) {
  const macros = [];
  let i = 0;

  for (let m = 0; m < macroCount; m++) {
    const actions = [];

    while (i < buf.length) {
      const b = buf[i++];

      if (b === SS_END) break;

      if (b === SS_PREFIX && i < buf.length) {
        const action = buf[i++];

        if (action === SS_TAP || action === SS_DOWN || action === SS_UP) {
          const hid  = buf[i++] ?? 0;
          const type = action === SS_TAP ? 'tap' : action === SS_DOWN ? 'down' : 'up';
          actions.push({ type, keycode: hid });

        } else if (action === SS_DELAY) {
          let digits = '';
          while (i < buf.length && buf[i] !== 0x7C) {
            digits += String.fromCharCode(buf[i++]);
          }
          i++; // skip '|'
          actions.push({ type: 'delay', ms: parseInt(digits, 10) || 0 });
        }
        // Unknown prefix action — skip silently.

      } else {
        // Accumulate consecutive ASCII text bytes into one action.
        let text = String.fromCharCode(b);
        while (i < buf.length && buf[i] !== SS_END && buf[i] !== SS_PREFIX) {
          text += String.fromCharCode(buf[i++]);
        }
        actions.push({ type: 'text', value: text });
      }
    }

    macros.push(actions);
  }

  return macros;
}

// Serialize decoded macro action arrays back to a flat byte buffer of exactly
// `bufferSize` bytes (padded with zeros, truncated if overflow).
export function serializeBuffer(macros, bufferSize) {
  const out = [];

  for (const actions of macros) {
    for (const a of actions) {
      if (a.type === 'text') {
        for (const ch of a.value) out.push(ch.charCodeAt(0));

      } else if (a.type === 'tap' || a.type === 'down' || a.type === 'up') {
        const code = a.type === 'tap' ? SS_TAP : a.type === 'down' ? SS_DOWN : SS_UP;
        out.push(SS_PREFIX, code, a.keycode & 0xFF);

      } else if (a.type === 'delay') {
        const digits = String(Math.max(0, a.ms));
        out.push(SS_PREFIX, SS_DELAY, ...digits.split('').map(c => c.charCodeAt(0)), 0x7C);
      }
    }
    out.push(SS_END); // null-terminate each macro
  }

  // Pad to bufferSize with zeros.
  while (out.length < bufferSize) out.push(0x00);
  return out.slice(0, bufferSize);
}
