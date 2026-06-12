// components/KeyboardOverlay.jsx
//
// Chrome for overlay mode: an auto-hiding draggable control strip (opacity
// slider + exit) floating over a container that scales its children (the live
// Key Test visual) to fit the window. The window itself is made borderless /
// always-on-top by App.enterOverlay(); this component handles the in-page
// presentation plus manual resize grips (Tauri v1 undecorated windows have no
// reliable native edge resize, so the grips drive appWindow.setSize directly).

import React, { useState, useEffect, useRef } from 'react';
import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import './KeyboardOverlay.css';

const MIN_W = 420;
const MIN_H = 240;
const STRIP_HIDE_MS = 2200;

export default function KeyboardOverlay({ opacity, onOpacityChange, onExit, children }) {
  const fitRef = useRef(null);    // available area
  const innerRef = useRef(null);  // natural-size content (unscaled layout size)
  const [scale, setScale] = useState(1);
  const [stripVisible, setStripVisible] = useState(true);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const compute = () => {
      const fit = fitRef.current;
      const inner = innerRef.current;
      if (!fit || !inner) return;
      // scrollWidth/Height report layout size unaffected by the CSS transform.
      const natW = inner.scrollWidth;
      const natH = inner.scrollHeight;
      if (!natW || !natH) return;
      setScale(Math.min(fit.clientWidth / natW, fit.clientHeight / natH, 2));
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (fitRef.current) ro.observe(fitRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, []);

  // Control strip auto-hide: visible while the mouse is over the overlay
  // (mousemove keeps resetting the timer), slowly fades out otherwise.
  const showStrip = () => {
    setStripVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setStripVisible(false), STRIP_HIDE_MS);
  };

  useEffect(() => {
    showStrip();
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  // Manual window resize: pointer-drag on a grip adjusts the window size via
  // setSize (axis: 'x', 'y', or 'xy'). Coordinates use screenX/Y so the math
  // is independent of in-window layout.
  const startResize = async (e, axis) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.screenX;
    const startY = e.screenY;
    let baseW, baseH;
    try {
      const [size, factor] = await Promise.all([appWindow.innerSize(), appWindow.scaleFactor()]);
      baseW = size.width / factor;
      baseH = size.height / factor;
    } catch {
      return; // window API unavailable — leave native (bottom-edge) resize only
    }
    let raf = null;
    let latest = null;
    const onMove = (ev) => {
      latest = {
        w: axis.includes('x') ? Math.max(MIN_W, baseW + (ev.screenX - startX)) : baseW,
        h: axis.includes('y') ? Math.max(MIN_H, baseH + (ev.screenY - startY)) : baseH,
      };
      if (raf === null) {
        raf = requestAnimationFrame(() => {
          raf = null;
          if (latest) appWindow.setSize(new LogicalSize(latest.w, latest.h)).catch(() => {});
        });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="kb-overlay"
      style={{ background: `rgba(8, 10, 22, ${opacity})` }}
      onMouseMove={showStrip}
      onMouseLeave={() => { clearTimeout(hideTimerRef.current); setStripVisible(false); }}
    >
      <div className={`kb-overlay-strip${stripVisible ? '' : ' hidden'}`} data-tauri-drag-region>
        <span className="kb-overlay-drag-hint" data-tauri-drag-region>⠿ Iris overlay — drag to move</span>
        <label className="kb-overlay-opacity">
          BG
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
            title="Background opacity"
          />
        </label>
        <button className="kb-overlay-exit" onClick={onExit} title="Exit overlay (Esc)">✕ Exit</button>
      </div>

      <div className="kb-overlay-fit" ref={fitRef}>
        {/* Scaled via CSS zoom, NOT transform: on a transparent WebView2
            window a dynamically-updated transform promotes this subtree to a
            GPU-composited surface that loses its alpha and renders on an
            opaque white box. zoom rescales at layout time instead. */}
        <div className="kb-overlay-content" ref={innerRef} style={{ zoom: scale }}>
          {children}
        </div>
      </div>

      {/* Resize grips — right edge, bottom edge, bottom-right corner */}
      <div className="kb-overlay-grip grip-e" onPointerDown={(e) => startResize(e, 'x')} title="Resize" />
      <div className="kb-overlay-grip grip-s" onPointerDown={(e) => startResize(e, 'y')} title="Resize" />
      <div
        className={`kb-overlay-grip grip-se${stripVisible ? ' visible' : ''}`}
        onPointerDown={(e) => startResize(e, 'xy')}
        title="Resize"
      >
        ◢
      </div>
    </div>
  );
}
