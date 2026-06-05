import React, { useRef, useState, useCallback } from 'react';
import './ColorPicker.css';

function hsvToRgb(h, s, v) {
  const hDeg = (h / 255) * 360;
  const sN = s / 255, vN = v / 255;
  const c = vN * sN, x = c * (1 - Math.abs((hDeg / 60) % 2 - 1)), m = vN - c;
  let r, g, b;
  if      (hDeg < 60)  { r=c; g=x; b=0; }
  else if (hDeg < 120) { r=x; g=c; b=0; }
  else if (hDeg < 180) { r=0; g=c; b=x; }
  else if (hDeg < 240) { r=0; g=x; b=c; }
  else if (hDeg < 300) { r=x; g=0; b=c; }
  else                  { r=c; g=0; b=x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max, v = max;
  if (max !== min) {
    if      (max === r) h = ((g-b)/d + (g<b?6:0)) / 6;
    else if (max === g) h = ((b-r)/d + 2) / 6;
    else                h = ((r-g)/d + 4) / 6;
  }
  return [Math.round(h*255), Math.round(s*255), Math.round(v*255)];
}

export function hsvToHex(h, s, v) {
  return '#' + hsvToRgb(h,s,v).map(x => x.toString(16).padStart(2,'0').toUpperCase()).join('');
}

export function hexToHsv(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return rgbToHsv(r, g, b);
}

const PRESETS = [
  [0,   255, 200], // Red
  [0,   0,   160], // White
  [20,  255, 200], // Orange
  [43,  255, 200], // Yellow
  [85,  255, 200], // Green
  [128, 255, 200], // Cyan
  [170, 255, 200], // Blue
  [213, 255, 200], // Magenta
  [191, 255, 200], // Purple
  [0,   0,   80],  // Dim white
];

export default function ColorPicker({ hsv, onChange, onClear }) {
  const [hexInput, setHexInput] = useState('');
  const squareRef = useRef(null);
  const hueRef    = useRef(null);
  const dragging  = useRef(null); // 'square' | 'hue' | null

  const [h, s, v] = hsv ?? [0, 255, 200];
  const hueAngle   = Math.round((h / 255) * 360);
  const currentHex = hsv ? hsvToHex(h, s, v) : '#000000';

  const pickFromSquare = useCallback((e) => {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const newS = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 255);
    const newV = Math.round(Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)) * 255);
    onChange([h, newS, newV]);
  }, [h, onChange]);

  const pickFromHue = useCallback((e) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const newH = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 255);
    onChange([newH, s, v]);
  }, [s, v, onChange]);

  const onPointerDown = (area) => (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = area;
    area === 'square' ? pickFromSquare(e) : pickFromHue(e);
  };

  const onPointerMove = (area) => (e) => {
    if (dragging.current !== area) return;
    area === 'square' ? pickFromSquare(e) : pickFromHue(e);
  };

  const onPointerUp = () => { dragging.current = null; };

  const commitHex = () => {
    const val = hexInput.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onChange(hexToHsv(val));
    }
    setHexInput('');
  };

  return (
    <div className="color-picker">
      {/* Saturation / Brightness square */}
      <div
        ref={squareRef}
        className="cp-square"
        style={{ background: `hsl(${hueAngle}deg, 100%, 50%)` }}
        onPointerDown={onPointerDown('square')}
        onPointerMove={onPointerMove('square')}
        onPointerUp={onPointerUp}
      >
        <div className="cp-sq-white" />
        <div className="cp-sq-black" />
        <div className="cp-cursor" style={{ left: `${(s/255)*100}%`, top: `${(1-v/255)*100}%` }} />
      </div>

      {/* Hue strip */}
      <div
        ref={hueRef}
        className="cp-hue"
        onPointerDown={onPointerDown('hue')}
        onPointerMove={onPointerMove('hue')}
        onPointerUp={onPointerUp}
      >
        <div className="cp-hue-cursor" style={{ left: `${(h/255)*100}%` }} />
      </div>

      {/* Hex + Clear */}
      <div className="cp-hex-row">
        <div className="cp-hex-swatch" style={{ background: currentHex }} />
        <input
          className="cp-hex-input"
          value={hexInput || currentHex}
          onChange={e => setHexInput(e.target.value)}
          onBlur={commitHex}
          onFocus={() => setHexInput(currentHex)}
          onKeyDown={e => e.key === 'Enter' && commitHex()}
          maxLength={7}
          spellCheck={false}
        />
        <button className="cp-clear" onClick={onClear}>Clear</button>
      </div>

      {/* Preset swatches */}
      <div className="cp-presets">
        {PRESETS.map((p, i) => (
          <div key={i} className="cp-swatch" style={{ background: hsvToHex(...p) }}
            onClick={() => onChange(p)} title={hsvToHex(...p)} />
        ))}
      </div>
    </div>
  );
}
