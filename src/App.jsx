import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { decodeQuantum, HALVES } from './keyboardLayout';
import { parseBuffer, serializeBuffer } from './macroCodec';
import { TD_FIELDS } from './codegen/tapDanceKeys';
import { buildKeyLedColors, buildTapDanceBadges } from './keyDerived';
import './App.css';

import KeyboardGrid from './components/KeyboardGrid';
import MacroEditor from './components/MacroEditor';
import SettingsPanel from './components/SettingsPanel';
import DebugConsole from './components/DebugConsole';
import KeyTest from './components/KeyTest';
import KeyPicker from './components/KeyPicker';
import TapDanceEditor from './components/TapDanceEditor';
import TapDanceKeyPanel from './components/TapDanceKeyPanel';
import CombosEditor from './components/CombosEditor';
import FirmwarePanel from './components/FirmwarePanel';
import LightingPanel, { DEFAULT_STATE as DEFAULT_LIGHTING_STATE } from './components/LightingPanel';
import KeyboardOverlay from './components/KeyboardOverlay';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [currentLayer, setCurrentLayer] = useState(0);
  const [keymap, setKeymap] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(new Set()); // Set<"row,col"> for multi-select
  const [debugLogs, setDebugLogs] = useState([]);
  const [isFlashing, setIsFlashing] = useState(false);
  const [activeTab, setActiveTab] = useState('editor');
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [verboseDebug, setVerboseDebug] = useState(false);
  const [pickerRequest, setPickerRequest] = useState(null);
  const [copiedLayer, setCopiedLayer] = useState(null); // cached keymap for paste
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showDeleteLayerModal, setShowDeleteLayerModal] = useState(false);
  const [overlayMode, setOverlayMode] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.1);
  const [showScanLog, setShowScanLog] = useState(false);
  const [perKeyColorsFilePath, setPerKeyColorsFilePath] = useState(
    () => localStorage.getItem('perKeyColorsFilePath') || ''
  );
  const updatePerKeyColorsFilePath = (path) => {
    localStorage.setItem('perKeyColorsFilePath', path);
    setPerKeyColorsFilePath(path);
  };

  const [tapDanceFilePath, setTapDanceFilePath] = useState(
    () => localStorage.getItem('tapDanceFilePath') || ''
  );
  const updateTapDanceFilePath = (path) => {
    localStorage.setItem('tapDanceFilePath', path);
    setTapDanceFilePath(path);
  };

  const [scrollTextFilePath, setScrollTextFilePath] = useState(
    () => localStorage.getItem('scrollTextFilePath') || ''
  );
  const updateScrollTextFilePath = (path) => {
    localStorage.setItem('scrollTextFilePath', path);
    setScrollTextFilePath(path);
  };

  const [keymapFilePath, setKeymapFilePath] = useState(
    () => localStorage.getItem('keymapFilePath') || ''
  );
  const updateKeymapFilePath = (path) => {
    localStorage.setItem('keymapFilePath', path);
    setKeymapFilePath(path);
  };

  const [extraMacrosFilePath, setExtraMacrosFilePath] = useState(
    () => localStorage.getItem('extraMacrosFilePath') || ''
  );
  const updateExtraMacrosFilePath = (path) => {
    localStorage.setItem('extraMacrosFilePath', path);
    setExtraMacrosFilePath(path);
  };

  const [currentFilePath, setCurrentFilePath] = useState(null); // null = no file open
  const [isDirty, setIsDirty] = useState(false);
  // Bumped whenever the current state should become the new "clean" baseline
  // (device connect, Save, Save As, New, Open). See the dirty-compare effect.
  const [baselineToken, setBaselineToken] = useState(0);

  const [hiddenTabs, setHiddenTabs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hiddenTabs') || '{}'); }
    catch { return {}; }
  });
  const updateHiddenTabs = (tabs) => {
    localStorage.setItem('hiddenTabs', JSON.stringify(tabs));
    setHiddenTabs(tabs);
    setActiveTab(prev => tabs[prev] ? 'editor' : prev);
  };
  const [editorMode, setEditorMode] = useState('keys'); // 'keys' | 'lighting' | 'tap-dance'
  const [layerCount, setLayerCount] = useState(4);
  const [layerNames, setLayerNames] = useState(() => ['Layer 0', 'Layer 1', 'Layer 2', 'Layer 3']);
  const [showLayerDropdown, setShowLayerDropdown] = useState(false);
  const [editingLayerIdx, setEditingLayerIdx] = useState(null);
  const [editingLayerName, setEditingLayerName] = useState('');
  const [isEditingLayerName, setIsEditingLayerName] = useState(false);
  const [editLayerNameText, setEditLayerNameText] = useState('');

  const verboseRef = useRef(false);
  useEffect(() => { verboseRef.current = verboseDebug; }, [verboseDebug]);

  const scanLogRef = useRef(false);
  useEffect(() => { scanLogRef.current = showScanLog; }, [showScanLog]);

  // Firmware-reported layer count (from keyboard at connect time). Layers at or
  // beyond this index cannot be read/written to the firmware and must be cached locally.
  const firmwareLayerCountRef = useRef(4);

  // Local keycode cache for ALL layers. Firmware layers are written through here
  // on load; layers beyond firmware capacity live here only.
  const allKeymapsRef = useRef([]);

  // True once a profile file is associated with the session (Open, Save As, New).
  // When true the profile is the source of truth: hardware reads must not
  // overwrite app state on (re)connect — e.g. plugging in the not-yet-flashed
  // half of the split must not pull its stale EEPROM config into the editor.
  const profileLoadedRef = useRef(false);

  // Profile-held copies of the hardware-backed sections (VIA macros, VIAL tap
  // dance/combos). Seeded from the profile on Open and updated after each
  // successful "save to keyboard", so buildProfile() can export them without
  // reading a possibly-stale half plugged in mid-flash. null = not seeded —
  // fall back to a hardware read.
  const profileHwSectionsRef = useRef({ macros: null, macroMeta: null, tap_dance: null, combos: null });

  const layerDropdownRef = useRef(null);
  const buildProfileRef = useRef(null); // always points to the latest buildProfile closure
  useEffect(() => {
    if (!showLayerDropdown) return;
    const onMouseDown = (e) => {
      if (layerDropdownRef.current && !layerDropdownRef.current.contains(e.target))
        setShowLayerDropdown(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showLayerDropdown]);

  const addDebugLog = useCallback((message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [...prev.slice(verboseRef.current ? -499 : -99), `[${timestamp}] ${message}`]);
  }, []);

  const logVerbose = useCallback((msg) => {
    if (verboseRef.current) addDebugLog(msg);
  }, [addDebugLog]);

  // fromHardware defaults to "only when no profile is loaded" — with a profile
  // loaded the local cache is authoritative. Read-back-after-write call sites
  // (paste, clear, open) pass { fromHardware: true } explicitly.
  const loadKeymap = useCallback(
    async (layer, { fromHardware = !profileLoadedRef.current } = {}) => {
      try {
        let result;
        if (layer < firmwareLayerCountRef.current && fromHardware) {
          result = await invoke('read_keymap', { layer });
          allKeymapsRef.current[layer] = result;
        } else {
          result = (allKeymapsRef.current[layer] ??= Array.from({ length: 10 }, () => Array(6).fill(0x0000)));
        }
        setKeymap(result);
        addDebugLog(`Loaded layer ${layer}${layer >= firmwareLayerCountRef.current ? ' (local — beyond firmware capacity)' : (!fromHardware ? ' (cached — profile is source of truth)' : '')}`);
        logVerbose(`  └─ ${result.length} rows × ${result[0]?.length ?? 0} cols`);
      } catch (err) {
        addDebugLog(`Keymap load error: ${err}`);
      }
    },
    [addDebugLog, logVerbose]
  );

  useEffect(() => {
    let cancelled = false;

    const scan = async () => {
      try {
        const result = await invoke('detect_devices');
        if (cancelled) return;
        setDevices(result);
        if (scanLogRef.current) addDebugLog(`Scan: ${result.length} device(s)${result.length ? ` — ${result.map((d) => d.name).join(', ')}` : ' (none)'}`);

        if (result.length === 0) {
          if (selectedDevice) {
            setSelectedDevice(null);
            addDebugLog('Device disconnected');
          }
          return;
        }

        const stillPresent = selectedDevice && result.some((d) => d.port === selectedDevice.port);
        if (!stillPresent) {
          setSelectedDevice(result[0]);
          addDebugLog(`Found ${result.length} device(s): ${result[0].name}`);
          logVerbose(`  └─ port: ${result[0].port ?? 'unknown'}`);
          // Query how many layers the firmware actually supports
          try {
            const n = await invoke('get_layer_count');
            firmwareLayerCountRef.current = n;
            addDebugLog(`Firmware layer count: ${n}`);
          } catch {
            firmwareLayerCountRef.current = 4; // safe fallback
          }
          if (!profileLoadedRef.current) {
            // No profile loaded — the keyboard is the source of truth, pull its state.
            // Fill the local cache for every firmware layer up front so the dirty-flag
            // baseline is complete — lazy per-layer loads later must not register as diffs.
            try {
              const all = await invoke('read_all_layers');
              all.forEach((km, i) => { allKeymapsRef.current[i] = km; });
            } catch { /* per-layer loads below still work */ }
            await loadKeymap(currentLayer);
            setLayoutDirty(false);
            setBaselineToken(t => t + 1);
          } else {
            // Profile loaded — it is the source of truth. Do not pull the connected
            // device's (possibly stale) config or reset the dirty baseline.
            addDebugLog('Profile loaded — keeping editor state, not reading config from keyboard');
          }
          applyPerKeyColors(currentLayer, lightingPerKeyColors[currentLayer]);
        }
      } catch (err) {
        if (!cancelled) addDebugLog(`Device scan error: ${err}`);
      }
    };

    scan();
    const interval = setInterval(scan, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedDevice, currentLayer, loadKeymap, addDebugLog, logVerbose]);

  const handleKeyChange = async (row, col, newKeycode) => {
    if (!selectedDevice) {
      addDebugLog('No device selected');
      return;
    }
    const withinFirmware = currentLayer < firmwareLayerCountRef.current;
    try {
      if (withinFirmware) {
        await invoke('write_key', { layer: currentLayer, row, col, keycode: newKeycode });
      }
      setKeymap((prev) =>
        prev.map((r, i) => (i === row ? r.map((k, j) => (j === col ? newKeycode : k)) : r))
      );
      // Keep local cache in sync for all layers
      if (allKeymapsRef.current[currentLayer]) {
        allKeymapsRef.current[currentLayer] = allKeymapsRef.current[currentLayer].map(
          (r, i) => (i === row ? r.map((k, j) => (j === col ? newKeycode : k)) : r)
        );
      }
      setLayoutDirty(true);
      addDebugLog(`Key updated [${row},${col}] -> 0x${newKeycode.toString(16).padStart(4, '0')}${withinFirmware ? '' : ' (local only)'}`);
      logVerbose(`  └─ decoded: ${decodeQuantum(newKeycode) ?? 'unknown'} | layer ${currentLayer}`);
    } catch (err) {
      addDebugLog(`Key write error: ${err}`);
    }
  };

  // Layers where this key has any tap dance action configured. TD(n) must sit
  // on each of them — the generated firmware callbacks switch on the active
  // layer, so the keycode itself has to be present per layer to trigger at all.
  const tdConfiguredLayers = (tdKeys, keyId) =>
    Object.entries(tdKeys ?? {})
      .filter(([, layerObj]) => {
        const e = layerObj?.[keyId];
        return e && TD_FIELDS.some(f => (e[f.key] ?? 0) !== 0);
      })
      .map(([layer]) => parseInt(layer, 10));

  // Write TD(n) for an assignment to hardware + caches on every configured
  // layer. Shared by profile import and the panel's Assign button. `tdKeys` is
  // passed explicitly because import runs before the state update lands.
  const applyTdAssignment = async (n, keyId, tdKeys) => {
    const key = [...HALVES.left, ...HALVES.right].find(k => k.id === keyId);
    if (!key) { addDebugLog(`TD(${n}): key "${keyId}" not found — skipped`); return 0; }
    const tdKeycode = 0x5700 | n;
    let layers = tdConfiguredLayers(tdKeys, keyId);
    if (layers.length === 0) layers = [0]; // legacy profiles without per-layer TD config
    let applied = 0;
    for (const L of layers) {
      try {
        if (L < firmwareLayerCountRef.current) {
          await invoke('write_key', { layer: L, row: key.viaRow, col: key.viaCol, keycode: tdKeycode });
        }
        if (allKeymapsRef.current[L]) {
          allKeymapsRef.current[L] = allKeymapsRef.current[L].map(
            (r, ri) => ri === key.viaRow ? r.map((kc, ci) => ci === key.viaCol ? tdKeycode : kc) : r
          );
        }
        if (L === currentLayer) {
          setKeymap(prev => prev.map(
            (r, ri) => ri === key.viaRow ? r.map((kc, ci) => ci === key.viaCol ? tdKeycode : kc) : r
          ));
        }
        addDebugLog(`TD(${n}) → layer ${L} [${key.viaRow},${key.viaCol}]`);
        applied++;
      } catch (err) {
        addDebugLog(`TD(${n}) apply to layer ${L} failed: ${err}`);
      }
    }
    if (applied > 0) setLayoutDirty(true);
    return applied;
  };

  // Undo applyTdAssignment: clear TD(n) back to KC_NO on every layer where this
  // key currently holds exactly that keycode (so manually-placed keys with other
  // codes are never touched). Used when an assignment or TD entry is removed.
  const clearTdAssignment = async (n, keyId, onlyLayers = null) => {
    const key = [...HALVES.left, ...HALVES.right].find(k => k.id === keyId);
    if (!key) return;
    const tdKeycode = 0x5700 | n;
    for (let L = 0; L < allKeymapsRef.current.length; L++) {
      if (onlyLayers && !onlyLayers.includes(L)) continue;
      if (allKeymapsRef.current[L]?.[key.viaRow]?.[key.viaCol] !== tdKeycode) continue;
      try {
        if (L < firmwareLayerCountRef.current) {
          await invoke('write_key', { layer: L, row: key.viaRow, col: key.viaCol, keycode: 0x0000 });
        }
        allKeymapsRef.current[L] = allKeymapsRef.current[L].map(
          (r, ri) => ri === key.viaRow ? r.map((kc, ci) => ci === key.viaCol ? 0x0000 : kc) : r
        );
        if (L === currentLayer) {
          setKeymap(prev => prev.map(
            (r, ri) => ri === key.viaRow ? r.map((kc, ci) => ci === key.viaCol ? 0x0000 : kc) : r
          ));
        }
        setLayoutDirty(true);
        addDebugLog(`TD(${n}) cleared from layer ${L} [${key.viaRow},${key.viaCol}]`);
      } catch (err) {
        addDebugLog(`TD(${n}) clear on layer ${L} failed: ${err}`);
      }
    }
  };

  const applyPerKeyColors = useCallback(async (layer, colors) => {
    try { await invoke('set_lighting', { state: { effect: 1, speed: 128, hue: 0, sat: 255, val: 100 } }); }
    catch { /* keyboard may not be ready yet */ }
    // Send all 68 LEDs so previous layer's colors are cleared; unset keys become black
    const hsvList = Array.from({ length: 68 }, (_, i) => colors?.[i] ?? [0, 0, 0]);
    await invoke('apply_led_colors', { hsvList }).catch(() => {});
  }, []);

  const handleLayerChange = async (newLayer) => {
    logVerbose(`Layer: ${currentLayer} → ${newLayer}`);
    setCurrentLayer(newLayer);
    setSelectedKey(null);
    setSelectedKeys(new Set());
    await loadKeymap(newLayer);
    if (selectedDevice) {
      applyPerKeyColors(newLayer, lightingPerKeyColors[newLayer]);
    }
  };

  const handleAddLayer = () => {
    if (layerCount >= 16) return;
    const newIdx = layerCount;
    // Pre-populate local cache with KC_NO — keys start silent until user assigns them
    allKeymapsRef.current[newIdx] = Array.from({ length: 10 }, () => Array(6).fill(0x0000));
    setLayerCount(n => n + 1);
    setLayerNames(names => [...names, `Layer ${newIdx}`]);
    setLightingPerKeyColors(prev => [...prev, Array(68).fill(null)]);
    setScrollSettings(prev => [...prev, { text: '', speed_ms: 150, fg_hsv: [0, 255, 100], bg_on: false, bg_hsv: [170, 255, 30], target_layer: newIdx }]);
    addDebugLog(`Layer ${newIdx} added (local — write to firmware after updating firmware layer count)`);
  };

  const commitLayerRename = () => {
    if (editingLayerIdx !== null) {
      const trimmed = editingLayerName.trim() || `Layer ${editingLayerIdx}`;
      setLayerNames(names => names.map((n, i) => i === editingLayerIdx ? trimmed : n));
      setEditingLayerIdx(null);
    }
  };

  const handleKeySelect = (key, shiftHeld = false) => {
    if (!key) {
      setSelectedKey(null);
      setSelectedKeys(new Set());
      logVerbose('Key deselected');
      return;
    }
    if (shiftHeld) {
      setSelectedKeys(prev => {
        const next = new Set(prev);
        const id = `${key.row},${key.col}`;
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setSelectedKey(key);
    } else {
      setSelectedKey(key);
      setSelectedKeys(new Set([`${key.row},${key.col}`]));
    }
    logVerbose(`Key selected: [${key.row},${key.col}]${shiftHeld ? ' (multi)' : ''}`);
  };

  const applyKeycodeToSelection = async (keycode) => {
    for (const id of selectedKeys) {
      const [r, c] = id.split(',').map(Number);
      await handleKeyChange(r, c, keycode);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    logVerbose(`Tab: ${tab}`);
  };

  // ── Keyboard overlay mode ───────────────────────────────────────────────────
  // Transforms the MAIN window into a small always-on-top transparent overlay
  // (single window keeps HID polling/state in one place). The config minimum
  // size (1100x700) must be relaxed before shrinking, and restored on exit.
  // Exit always re-maximizes, matching the configured startup state.

  // Last overlay geometry (logical px), restored on the next enter so the
  // overlay reappears exactly where the user left it. Persisted across runs.
  const overlayBoundsRef = useRef((() => {
    try { return JSON.parse(localStorage.getItem('overlayBounds')) ?? null; }
    catch { return null; }
  })());

  const enterOverlay = async () => {
    setOverlayMode(true);
    try {
      await appWindow.setMinSize(new LogicalSize(420, 240));
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setDecorations(false);
      await appWindow.unmaximize();
      const b = overlayBoundsRef.current;
      const w = b?.w ?? 980;
      const h = b?.h ?? 460;
      await appWindow.setSize(new LogicalSize(w, h));
      if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
        await appWindow.setPosition(new LogicalPosition(b.x, b.y));
      }
      // WebView2 can miss the bounds change when the window leaves the
      // maximized state and shrinks in one motion, leaving stale white window
      // surface where the webview no longer paints. After a short settle,
      // jiggle the size by 1px to force the webview child to recompute its
      // bounds — same effect as the user dragging a resize edge.
      await new Promise(r => setTimeout(r, 80));
      await appWindow.setSize(new LogicalSize(w + 1, h));
      await appWindow.setSize(new LogicalSize(w, h));
      addDebugLog('Overlay mode entered (Esc or Exit to leave)');
    } catch (err) {
      addDebugLog(`Overlay enter error: ${err}`);
    }
  };

  const exitOverlay = async () => {
    // Capture the overlay's geometry before restoring the main window so the
    // next enter returns to the same spot/size.
    try {
      const [pos, size, factor] = await Promise.all([
        appWindow.outerPosition(), appWindow.innerSize(), appWindow.scaleFactor(),
      ]);
      const b = {
        x: pos.x / factor, y: pos.y / factor,
        w: size.width / factor, h: size.height / factor,
      };
      overlayBoundsRef.current = b;
      try { localStorage.setItem('overlayBounds', JSON.stringify(b)); } catch { /* ignore */ }
    } catch { /* geometry capture is best-effort */ }
    setOverlayMode(false);
    try {
      await appWindow.setAlwaysOnTop(false);
      await appWindow.setDecorations(true);
      await appWindow.setMinSize(new LogicalSize(1100, 700));
      await appWindow.maximize();
      addDebugLog('Overlay mode exited');
    } catch (err) {
      addDebugLog(`Overlay exit error: ${err}`);
    }
  };

  // Transparent document background + Esc-to-exit while the overlay is active.
  // Layout effect so the body class lands before paint — avoids a one-frame
  // flash of the opaque normal background behind the near-transparent overlay.
  useLayoutEffect(() => {
    // Both <html> and <body> paint opaque backgrounds (inline style in
    // index.html) — both must go transparent for the desktop to show through.
    document.documentElement.classList.toggle('overlay-active', overlayMode);
    document.body.classList.toggle('overlay-active', overlayMode);
    if (!overlayMode) return;
    const onKey = (e) => { if (e.key === 'Escape') exitOverlay(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('overlay-active');
      document.body.classList.remove('overlay-active');
    };
  }, [overlayMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePickerRequest = (req) => {
    setPickerRequest(req);
    if (req) {
      const name = decodeQuantum(req.code) ?? `0x${req.code.toString(16).padStart(4, '0')}`;
      logVerbose(`Right-click → picker: ${name} (0x${req.code.toString(16).padStart(4, '0')})`);
    }
  };

  // ── Layer tools ────────────────────────────────────────────────────────────

  const handleCopyLayer = () => {
    setCopiedLayer(keymap);
    addDebugLog(`Layer ${currentLayer} copied`);
  };

  const handlePasteLayer = async () => {
    if (!copiedLayer || !selectedDevice) return;
    try {
      allKeymapsRef.current[currentLayer] = copiedLayer;
      if (currentLayer < firmwareLayerCountRef.current) {
        await invoke('write_layer', { layer: currentLayer, keymap: copiedLayer });
      }
      await loadKeymap(currentLayer, { fromHardware: true });
      setLayoutDirty(true);
      addDebugLog(`Pasted to layer ${currentLayer}${currentLayer >= firmwareLayerCountRef.current ? ' (local only)' : ''}`);
    } catch (err) {
      addDebugLog(`Paste error: ${err}`);
    }
  };

  const handleClearLayer = () => {
    if (!selectedDevice) return;
    setShowClearModal(true);
  };

  const executeClear = async () => {
    setShowClearModal(false);
    const blank = Array.from({ length: 10 }, () => Array(6).fill(0x0001)); // KC_TRNS
    try {
      allKeymapsRef.current[currentLayer] = blank;
      if (currentLayer < firmwareLayerCountRef.current) {
        await invoke('write_layer', { layer: currentLayer, keymap: blank });
      }
      await loadKeymap(currentLayer, { fromHardware: true });
      setLayoutDirty(true);
      addDebugLog(`Layer ${currentLayer} cleared${currentLayer >= firmwareLayerCountRef.current ? ' (local only)' : ''}`);
    } catch (err) {
      addDebugLog(`Clear error: ${err}`);
    }
  };

  const handleDeleteLayer = () => {
    if (!selectedDevice || layerCount <= 1) return;
    setShowDeleteLayerModal(true);
  };

  // Remove the current layer everywhere: every per-layer structure shifts down
  // by one, the shift is mirrored to the keyboard (shifted layers rewritten,
  // old top layer blanked), and the layout is marked dirty. The profile file is
  // NOT saved here — the user saves manually afterward.
  const executeDeleteLayer = async () => {
    setShowDeleteLayerModal(false);
    const L = currentLayer;
    const newCount = layerCount - 1;
    if (newCount < 1) return;
    try {
      // Object keyed by layer index (tapDanceKeys, customLabels): drop L,
      // renumber everything above it.
      const shiftLayerKeyed = (obj) => {
        const next = {};
        Object.entries(obj ?? {}).forEach(([k, v]) => {
          const n = parseInt(k, 10);
          if (Number.isNaN(n) || n === L) return;
          next[n > L ? n - 1 : n] = v;
        });
        return next;
      };

      allKeymapsRef.current.splice(L, 1);
      setLayerNames(prev => prev.filter((_, i) => i !== L));
      setLightingPerKeyColors(prev => prev.filter((_, i) => i !== L));
      setGlobalLightingConfigs(prev => prev.filter((_, i) => i !== L));
      setScrollSettings(prev => prev
        .filter((_, i) => i !== L)
        .map(s => ({ ...s, target_layer: s.target_layer > L ? s.target_layer - 1 : s.target_layer })));
      setTapDanceKeys(prev => shiftLayerKeyed(prev));
      setCustomLabels(prev => shiftLayerKeyed(prev));
      setLayerCount(newCount);

      // Mirror the shift to the keyboard within firmware capacity.
      const blank = Array.from({ length: 10 }, () => Array(6).fill(0x0000));
      for (let i = L; i < newCount && i < firmwareLayerCountRef.current; i++) {
        await invoke('write_layer', { layer: i, keymap: allKeymapsRef.current[i] ?? blank });
      }
      if (newCount < firmwareLayerCountRef.current) {
        await invoke('write_layer', { layer: newCount, keymap: blank });
      }

      const newCurrent = Math.min(L, newCount - 1);
      setCurrentLayer(newCurrent);
      setSelectedKey(null);
      setSelectedKeys(new Set());
      await loadKeymap(newCurrent);
      setLayoutDirty(true);
      addDebugLog(`Layer ${L} deleted — ${newCount} layer(s) remain. Save the profile to persist.`);
    } catch (err) {
      addDebugLog(`Delete layer error: ${err}`);
    }
  };

  const handleExportThenClear = async () => {
    setShowClearModal(false);
    try {
      addDebugLog('Reading keyboard state...');
      const profile = await buildProfile();
      const savedPath = await handleSaveAs(profile);
      if (!savedPath) { addDebugLog('Save cancelled — clear aborted'); return; }
    } catch (err) {
      addDebugLog(`Save error: ${err} — clear aborted`);
      return;
    }
    await executeClear();
  };

  // Build a complete profile object. With a profile loaded the in-app caches
  // are authoritative — saving must not pull state from a possibly-stale half
  // plugged in mid-flash. With no profile the keyboard is read directly and
  // the caches are seeded so the Save As that follows starts a profile-backed
  // session. Macros are decoded from raw bytes into a human-readable action
  // list so the saved JSON is inspectable.
  const buildProfile = async () => {
    const fromProfile = profileLoadedRef.current;
    const cached = profileHwSectionsRef.current;
    const blankLayer = () => Array.from({ length: 10 }, () => Array(6).fill(0x0000));

    let layers;
    if (fromProfile) {
      // The local cache holds every layer (profile import wrote through it).
      layers = Array.from({ length: layerCount }, (_, l) => allKeymapsRef.current[l] ?? blankLayer());
    } else {
      // Read however many layers the firmware supports, then append any locally-cached
      // extra layers so that layers beyond firmware capacity are preserved in the export.
      const firmwareLayers = await invoke('read_all_layers');
      layers = [...firmwareLayers];
      for (let l = firmwareLayers.length; l < layerCount; l++) {
        layers.push(allKeymapsRef.current[l] ?? blankLayer());
      }
    }

    let macros = [];
    if (fromProfile && cached.macros) {
      macros = cached.macros;
    } else {
      try {
        const info    = await invoke('get_macro_info');
        const rawBuf  = await invoke('read_macros');
        macros = parseBuffer(rawBuf, info.count);
        cached.macros = macros;
        cached.macroMeta = { macroCount: info.count, bufferSize: info.buffer_size };
      } catch {
        addDebugLog('Macros unavailable — exporting without');
      }
    }

    let lighting = null;
    if (fromProfile) {
      lighting = Array.from({ length: layerCount }, (_, i) => globalLightingConfigs[i] ?? { ...DEFAULT_LIGHTING_STATE });
    } else {
      try {
        const current = await invoke('get_lighting');
        lighting = Array.from({ length: layerCount }, () => ({ ...current }));
        setGlobalLightingConfigs(lighting.map(c => ({ ...c })));
      } catch {
        addDebugLog('Lighting unavailable — exporting without');
      }
    }

    let tap_dance = fromProfile ? cached.tap_dance : null;
    let combos    = fromProfile ? cached.combos    : null;
    if (tap_dance === null || combos === null) {
      try {
        const vs = await invoke('detect_vial');
        if (vs.supported) {
          if (tap_dance === null && vs.td_count > 0) {
            tap_dance = await invoke('vial_get_all_tap_dance', { count: vs.td_count });
            cached.tap_dance = tap_dance;
            addDebugLog(`Tap dance: exported ${tap_dance.length} entries`);
          }
          if (combos === null && vs.combo_count > 0) {
            combos = await invoke('vial_get_all_combos', { count: vs.combo_count });
            cached.combos = combos;
            addDebugLog(`Combos: exported ${combos.length} entries`);
          }
        }
      } catch (err) {
        addDebugLog(`Tap dance/combos unavailable — exporting without: ${err}`);
      }
    }
    return { version: 3, keyboard: 'iris-lm', layers, macros, lighting, tap_dance, combos,
      lighting_perkey: lightingPerKeyColors, scroll_settings: scrollSettings,
      layer_count: layerCount, layer_names: layerNames,
      tap_dance_keys: tapDanceKeys, td_key_assignments: tdKeyAssignments,
      custom_labels: customLabels, extra_macros: extraMacros,
      macro_descriptions: macroDescriptions,
      tap_dance_descriptions: tapDanceDescriptions,
      combo_descriptions: comboDescriptions };
  };
  // Keep ref current so handleSave always calls the latest snapshot, avoiding stale closure.
  buildProfileRef.current = buildProfile;

  // Save As — opens a dialog. Returns the path that was written, or null if cancelled.
  const handleSaveAs = async (profileArg) => {
    if (!selectedDevice) return null;
    try {
      addDebugLog('Reading keyboard state...');
      const profile = profileArg ?? await buildProfile();
      const savedPath = await invoke('save_profile', { profile });
      if (savedPath) {
        setCurrentFilePath(savedPath);
        profileLoadedRef.current = true;
        setIsDirty(false);
        setLayoutDirty(false);
        setBaselineToken(t => t + 1);
        addDebugLog(`Profile saved: ${savedPath.split(/[\\/]/).pop()}`);
      } else {
        addDebugLog('Save cancelled');
      }
      return savedPath ?? null;
    } catch (err) {
      addDebugLog(`Save As error: ${err}`);
      return null;
    }
  };

  // Save — write directly to currentFilePath. Falls back to Save As if no file is open.
  const handleSave = useCallback(async () => {
    if (!selectedDevice) return;
    if (!currentFilePath) { await handleSaveAs(); return; }
    try {
      addDebugLog('Saving...');
      const profile = await buildProfileRef.current();
      await invoke('save_profile_to_path', { profile, path: currentFilePath });
      setIsDirty(false);
      setLayoutDirty(false);
      setBaselineToken(t => t + 1);
      addDebugLog(`Saved: ${currentFilePath.split(/[\\/]/).pop()}`);
    } catch (err) {
      addDebugLog(`Save error: ${err}`);
    }
  }, [selectedDevice, currentFilePath, addDebugLog]); // eslint-disable-line react-hooks/exhaustive-deps

  // New — pick a folder, write a default profile there, reset in-memory state.
  const handleNew = async () => {
    try {
      const path = await invoke('new_profile');
      if (!path) { addDebugLog('New profile cancelled'); return; }
      // Reset all profile state to defaults
      setLayerCount(4);
      setLayerNames(['Layer 0', 'Layer 1', 'Layer 2', 'Layer 3']);
      setLightingPerKeyColors(Array.from({ length: 4 }, () => Array(68).fill(null)));
      setScrollSettings(Array.from({ length: 4 }, (_, i) => ({ text: '', speed_ms: 150, fg_hsv: [0, 255, 100], bg_on: false, bg_hsv: [170, 255, 30], target_layer: i })));
      setTapDanceKeys({});
      setTdKeyAssignments([]);
      setCustomLabels({});
      setExtraMacros(Array.from({ length: 32 }, () => []));
      setMacroDescriptions({ via: {}, qmk: {} });
      setTapDanceDescriptions({});
      setComboDescriptions({});
      // Clear the hardware-section caches — null means the next Save (or
      // editor load) falls back to reading the connected keyboard.
      profileHwSectionsRef.current = { macros: null, macroMeta: null, tap_dance: null, combos: null };
      setGlobalLightingConfigs(Array.from({ length: 4 }, () => ({ ...DEFAULT_LIGHTING_STATE })));
      setEditorReloadKey(k => k + 1); // editors re-read hardware and re-seed the cleared caches
      allKeymapsRef.current = [];
      setCurrentFilePath(path);
      profileLoadedRef.current = true;
      setIsDirty(false);
      setLayoutDirty(false);
      if (selectedDevice) {
        // Refill the full layer cache so the new dirty baseline is complete
        try {
          const all = await invoke('read_all_layers');
          all.forEach((km, i) => { allKeymapsRef.current[i] = km; });
        } catch { /* per-layer loads refill lazily */ }
        await loadKeymap(currentLayer);
      } else {
        setKeymap([]);
      }
      setBaselineToken(t => t + 1);
      addDebugLog(`New profile created: ${path.split(/[\\/]/).pop()}`);
    } catch (err) {
      addDebugLog(`New profile error: ${err}`);
    }
  };

  // Bumped after Open so the macro/tap dance/combo editors reload from the
  // freshly-seeded profile caches (or from hardware when no cache exists).
  const [editorReloadKey, setEditorReloadKey] = useState(0);

  const [lightingPerKeyColors, setLightingPerKeyColors] = useState(
    () => Array.from({ length: 4 }, () => Array(68).fill(null))
  );
  // Global (per-layer) lighting configs — owned here rather than by
  // LightingPanel so its two instances (compact editor-mode + Lighting tab)
  // share one state and the profile can persist it.
  const [globalLightingConfigs, setGlobalLightingConfigs] = useState(
    () => Array.from({ length: 4 }, () => ({ ...DEFAULT_LIGHTING_STATE }))
  );
  // Extend lighting configs when layers are added
  useEffect(() => {
    setGlobalLightingConfigs(prev => {
      if (prev.length >= layerCount) return prev;
      return [...prev, ...Array.from({ length: layerCount - prev.length }, () => ({ ...DEFAULT_LIGHTING_STATE }))];
    });
  }, [layerCount]);
  const [scrollSettings, setScrollSettings] = useState(
    () => Array.from({ length: 4 }, (_, i) => ({ text: '', speed_ms: 150, fg_hsv: [0, 255, 100], bg_on: false, bg_hsv: [170, 255, 30], target_layer: i }))
  );

  const [tapDanceKeys, setTapDanceKeys] = useState({});
  const [tdKeyAssignments, setTdKeyAssignments] = useState([]); // Array<{ keyId } | null>, index = TD(n)
  const [customLabels, setCustomLabels]   = useState({});
  // Compile-time macros, MU(0)-MU(31). Each slot is an array of action objects
  // matching the VIA macro action shape ({type, keycode|value|ms}).
  const [extraMacros, setExtraMacros] = useState(() => Array.from({ length: 32 }, () => []));
  // Per-slot macro descriptions, keyed by slot index, kept separately per macro
  // mode ('via' = M(n) slots, 'qmk' = MU(n) compile-time slots).
  const [macroDescriptions, setMacroDescriptions] = useState(() => ({ via: {}, qmk: {} }));
  // Per-slot tap dance descriptions, keyed by TD(n) slot index.
  const [tapDanceDescriptions, setTapDanceDescriptions] = useState(() => ({}));
  // Per-slot combo descriptions, keyed by combo slot index.
  const [comboDescriptions, setComboDescriptions] = useState(() => ({}));

  // Wrapped setters kept as the stable prop API for child components. Dirty tracking
  // happens in the baseline-compare effect below, so these are plain pass-throughs.
  const handlePerKeyColorsChange = useCallback((colors) => {
    setLightingPerKeyColors(colors);
  }, []);
  const handleScrollSettingsChange = useCallback((settings) => {
    setScrollSettings(settings);
  }, []);
  const handleTapDanceKeysChange = useCallback((keys) => {
    setTapDanceKeys(keys);
  }, []);
  const handleTdKeyAssignmentsChange = useCallback((assignments) => {
    setTdKeyAssignments(assignments);
  }, []);
  const handleExtraMacrosChange = useCallback((updater) => {
    setExtraMacros(prev => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);
  const handleMacroDescriptionsChange = useCallback((updater) => {
    setMacroDescriptions(prev => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);
  const handleTapDanceDescriptionsChange = useCallback((updater) => {
    setTapDanceDescriptions(prev => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);
  const handleComboDescriptionsChange = useCallback((updater) => {
    setComboDescriptions(prev => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  // Cache writers handed to the editors — they mirror hardware reads and
  // successful "save to keyboard" writes into the profile-held section caches.
  const handleViaMacrosChange = useCallback(({ macros, macroCount, bufferSize }) => {
    profileHwSectionsRef.current.macros = macros;
    profileHwSectionsRef.current.macroMeta = { macroCount, bufferSize };
  }, []);
  const handleTapDanceEntriesChange = useCallback((entries) => {
    profileHwSectionsRef.current.tap_dance = entries;
  }, []);
  const handleComboEntriesChange = useCallback((entries) => {
    profileHwSectionsRef.current.combos = entries;
  }, []);

  // ── Refined dirty flag ───────────────────────────────────────────────────────
  // isDirty is computed by deep-comparing the profile-contributing state against a
  // baseline snapshot, so manually reverting a change back to its original value
  // clears the flag again. The baseline is recaptured whenever baselineToken bumps
  // (device connect, Save, Save As, New, Open) and once on mount.
  // Hardware-backed data (VIA macro buffer, global lighting, VIAL tap dance and
  // combo entries) lives on the keyboard, not in this component, and is excluded.
  const baselineRef = useRef(null);
  const lastBaselineTokenRef = useRef(null);

  // JSON.stringify with sorted object keys so key insertion order can't fake a diff
  const stableStringify = (value) => JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((acc, k) => { acc[k] = v[k]; return acc; }, {})
      : v
  );

  // No dependency array on purpose: allKeymapsRef is a ref, so its mutations never
  // trigger renders themselves — running on every render guarantees the comparison
  // never goes stale. The snapshot is a few KB, so the cost is negligible.
  useEffect(() => {
    const snapshot = stableStringify({
      keymaps: allKeymapsRef.current,
      lightingPerKeyColors, scrollSettings, layerCount, layerNames,
      tapDanceKeys, tdKeyAssignments, customLabels, extraMacros,
      macroDescriptions, tapDanceDescriptions, comboDescriptions,
    });
    if (baselineRef.current === null || baselineToken !== lastBaselineTokenRef.current) {
      lastBaselineTokenRef.current = baselineToken;
      baselineRef.current = snapshot;
      setIsDirty(false);
      return;
    }
    setIsDirty(snapshot !== baselineRef.current);
  });

  // Ctrl+S / Cmd+S global shortcut for Save
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  // Computed per-key glow colors for the keyboard grid in lighting editor mode
  const keyLedColors = useMemo(() => {
    if (activeTab !== 'editor') return null;
    return buildKeyLedColors(lightingPerKeyColors[currentLayer]);
  }, [activeTab, currentLayer, lightingPerKeyColors]);

  const selectedKeyObj = useMemo(() => {
    if (!selectedKey) return null;
    return [...HALVES.left, ...HALVES.right].find(
      k => k.viaRow === selectedKey.row && k.viaCol === selectedKey.col
    ) ?? null;
  }, [selectedKey]);

  const tapDanceBadges = useMemo(() => {
    if (activeTab !== 'editor') return null;
    return buildTapDanceBadges(tapDanceKeys, currentLayer);
  }, [activeTab, currentLayer, tapDanceKeys]);

  const setLabelField = useCallback((field, val) => {
    if (!selectedKeyObj) return;
    setCustomLabels(prev => {
      const layerMap = { ...(prev[currentLayer] ?? {}) };
      const ex = layerMap[selectedKeyObj.id];
      const cur = ex && typeof ex === 'object' ? ex : (typeof ex === 'string' ? { primary: ex } : {});
      const upd = { ...cur, [field]: val };
      Object.keys(upd).forEach(k => { if (!upd[k]) delete upd[k]; });
      if (Object.keys(upd).length === 0) delete layerMap[selectedKeyObj.id];
      else layerMap[selectedKeyObj.id] = upd;
      const res = { ...prev, [currentLayer]: layerMap };
      if (Object.keys(res[currentLayer] ?? {}).length === 0) delete res[currentLayer];
      return res;
    });
  }, [selectedKeyObj, currentLayer]);

  const clearAllLabels = useCallback(() => {
    if (!selectedKeyObj) return;
    setCustomLabels(prev => {
      const layerMap = { ...(prev[currentLayer] ?? {}) };
      delete layerMap[selectedKeyObj.id];
      const res = { ...prev, [currentLayer]: layerMap };
      if (Object.keys(res[currentLayer] ?? {}).length === 0) delete res[currentLayer];
      return res;
    });
  }, [selectedKeyObj, currentLayer]);

  const currentKeyEntry = selectedKeyObj ? (customLabels[currentLayer]?.[selectedKeyObj.id] ?? null) : null;
  const keyPrimaryLabel = currentKeyEntry
    ? (typeof currentKeyEntry === 'string' ? currentKeyEntry : (currentKeyEntry.primary ?? ''))
    : '';
  const keySecondaryLabel = currentKeyEntry && typeof currentKeyEntry === 'object'
    ? (currentKeyEntry.secondary ?? '')
    : '';
  const keyTertiaryLabel = currentKeyEntry && typeof currentKeyEntry === 'object'
    ? (currentKeyEntry.tertiary ?? '')
    : '';

  const selectedKeyDisplayName = (() => {
    if (!selectedKeyObj) return '';
    const code = keymap?.[selectedKeyObj.viaRow]?.[selectedKeyObj.viaCol];
    if (code === undefined || code === null || code === 0x0000) return '';
    return decodeQuantum(code) || selectedKeyObj.label;
  })();

  const handleOpen = async () => {
    if (!selectedDevice) return;
    try {
      const result = await invoke('load_profile');
      if (!result) { addDebugLog('Open cancelled'); return; }
      const { profile, path } = result;
      if (profile.version !== 1 && profile.version !== 2 && profile.version !== 3) { addDebugLog(`Unknown profile version ${profile.version}`); return; }
      // Seed the profile-held hardware-section caches up front so any editor
      // reload during this import already sees the profile's data, and Save
      // exports it without reading hardware.
      profileHwSectionsRef.current = {
        // null (not []) when the profile lacks a section — null falls back to a
        // hardware read; [] would claim "profile says no macros" and silently
        // export empty macros on Save.
        macros: Array.isArray(profile.macros) ? profile.macros : null,
        macroMeta: null,
        tap_dance: Array.isArray(profile.tap_dance) ? profile.tap_dance : null,
        combos: Array.isArray(profile.combos) ? profile.combos : null,
      };
      setGlobalLightingConfigs(
        Array.isArray(profile.lighting) && profile.lighting.length > 0
          ? profile.lighting
          : Array.from({ length: 4 }, () => ({ ...DEFAULT_LIGHTING_STATE }))
      );
      addDebugLog(`Importing ${profile.layers.length} layers (firmware supports ${firmwareLayerCountRef.current})...`);
      for (let l = 0; l < profile.layers.length; l++) {
        allKeymapsRef.current[l] = profile.layers[l]; // cache all layers locally
        if (l < firmwareLayerCountRef.current) {
          await invoke('write_layer', { layer: l, keymap: profile.layers[l] });
        } else {
          addDebugLog(`  Layer ${l} stored locally (beyond firmware capacity)`);
        }
      }
      const macroSlots = Array.isArray(profile.macros) ? profile.macros.length : 0;
      addDebugLog(`Profile macros: ${macroSlots} slots found`);
      if (macroSlots > 0) {
        try {
          // VIAL gates macro writes behind its lock mechanism. Check before writing
          // so we get a clear error instead of a silent no-op.
          const vialStatus = await invoke('detect_vial').catch(() => null);
          if (vialStatus?.supported && !vialStatus.unlocked) {
            addDebugLog('⚠ Keyboard is VIAL-locked — macro write blocked. Go to the Tap Dance tab → Unlock Keyboard, then re-import.');
            throw new Error('Keyboard locked — unlock via Tap Dance tab first');
          }
          const info  = await invoke('get_macro_info');
          addDebugLog(`Keyboard macro buffer: ${info.count} slots, ${info.buffer_size} bytes`);
          const bytes = serializeBuffer(profile.macros, info.buffer_size);
          addDebugLog(`Writing ${bytes.filter(b => b !== 0).length} non-zero macro bytes…`);
          await invoke('write_macros', { data: bytes });
          addDebugLog('Macros restored');
        } catch (err) {
          addDebugLog(`Macro restore failed: ${err}`);
        }
      } else {
        addDebugLog('No macros in profile — skipped');
      }
      if (Array.isArray(profile.lighting) && profile.lighting.length > 0) {
        try {
          await invoke('set_lighting', { state: profile.lighting[0] });
          await invoke('save_lighting');
          addDebugLog('Lighting restored (layer 0 preset applied)');
        } catch (err) {
          addDebugLog(`Lighting restore failed: ${err}`);
        }
      }
      // Tap dance + combos are VIAL-locked — check once, apply both
      const hasVialData = Array.isArray(profile.tap_dance) || Array.isArray(profile.combos);
      if (hasVialData) {
        let vialOk = false;
        try {
          const vs = await invoke('detect_vial').catch(() => null);
          if (!vs?.supported) {
            addDebugLog('VIAL not detected — tap dance/combos skipped');
          } else if (!vs.unlocked) {
            addDebugLog('⚠ Keyboard locked — tap dance/combos skipped. Unlock via Tap Dance tab then re-import.');
          } else {
            vialOk = true;
          }
        } catch (err) {
          addDebugLog(`VIAL check failed: ${err}`);
        }
        if (vialOk) {
          if (Array.isArray(profile.tap_dance) && profile.tap_dance.length > 0) {
            try {
              for (let i = 0; i < profile.tap_dance.length; i++)
                await invoke('vial_set_tap_dance_entry', { idx: i, entry: profile.tap_dance[i] });
              addDebugLog(`Tap dance restored (${profile.tap_dance.length} entries)`);
            } catch (err) { addDebugLog(`Tap dance restore failed: ${err}`); }
          }
          if (Array.isArray(profile.combos) && profile.combos.length > 0) {
            try {
              for (let i = 0; i < profile.combos.length; i++)
                await invoke('vial_set_combo_entry', { idx: i, entry: profile.combos[i] });
              addDebugLog(`Combos restored (${profile.combos.length} entries)`);
            } catch (err) { addDebugLog(`Combos restore failed: ${err}`); }
          }
        }
      }
      if (Array.isArray(profile.lighting_perkey)) {
        setLightingPerKeyColors(profile.lighting_perkey);
        addDebugLog('Per-key colors restored');
      }
      if (Array.isArray(profile.scroll_settings)) {
        setScrollSettings(profile.scroll_settings);
        addDebugLog('Scroll settings restored');
      }
      if (typeof profile.layer_count === 'number' && profile.layer_count > 0) {
        setLayerCount(profile.layer_count);
        addDebugLog(`Layer count restored: ${profile.layer_count}`);
      }
      if (Array.isArray(profile.layer_names) && profile.layer_names.length > 0) {
        setLayerNames(profile.layer_names);
        addDebugLog('Layer names restored');
      }
      if (profile.tap_dance_keys && typeof profile.tap_dance_keys === 'object') {
        setTapDanceKeys(profile.tap_dance_keys);
        addDebugLog('Tap dance key config restored');
      }
      if (Array.isArray(profile.td_key_assignments) && profile.td_key_assignments.length > 0) {
        setTdKeyAssignments(profile.td_key_assignments);
        addDebugLog('TD key assignments restored');
        // Auto-apply TD(n) to every layer where the key has tap dance config —
        // the firmware callbacks are per-layer, so the keycode must live on
        // those same layers (previously this was hardcoded to layer 0).
        let applied = 0;
        for (let n = 0; n < profile.td_key_assignments.length; n++) {
          const assignment = profile.td_key_assignments[n];
          if (!assignment?.keyId) continue;
          applied += await applyTdAssignment(n, assignment.keyId, profile.tap_dance_keys);
        }
        if (applied > 0) addDebugLog(`Auto-applied TD keycode(s) to ${applied} layer slot(s)`);
      }
      if (profile.custom_labels && typeof profile.custom_labels === 'object') {
        let labels = profile.custom_labels;
        if (profile.version <= 2) {
          // Migrate flat { keyId: string } → { 0: { keyId: { primary: string } } }
          const migrated = {};
          Object.entries(labels).forEach(([k, v]) => {
            migrated[0] = migrated[0] ?? {};
            migrated[0][k] = typeof v === 'string' ? { primary: v } : v;
          });
          labels = migrated;
          addDebugLog('Custom labels migrated to per-layer format (applied to layer 0)');
        }
        setCustomLabels(labels);
        addDebugLog('Custom labels restored');
      }
      if (Array.isArray(profile.extra_macros)) {
        const restored = Array.from({ length: 32 }, (_, i) => profile.extra_macros[i] ?? []);
        setExtraMacros(restored);
        addDebugLog('Extra macros restored');
      }
      if (profile.macro_descriptions && typeof profile.macro_descriptions === 'object') {
        setMacroDescriptions({
          via: profile.macro_descriptions.via ?? {},
          qmk: profile.macro_descriptions.qmk ?? {},
        });
        addDebugLog('Macro descriptions restored');
      }
      if (profile.tap_dance_descriptions && typeof profile.tap_dance_descriptions === 'object') {
        setTapDanceDescriptions(profile.tap_dance_descriptions);
        addDebugLog('Tap dance descriptions restored');
      }
      if (profile.combo_descriptions && typeof profile.combo_descriptions === 'object') {
        setComboDescriptions(profile.combo_descriptions);
        addDebugLog('Combo descriptions restored');
      }
      // Land on layer 0 after open — it always exists in a valid profile, so the
      // read-back can never hit a layer the profile doesn't define (which would
      // otherwise be pulled from possibly-stale hardware).
      setCurrentLayer(0);
      await loadKeymap(0, { fromHardware: true });
      setCurrentFilePath(path);
      profileLoadedRef.current = true;
      setEditorReloadKey(k => k + 1); // macro/TD/combo editors reload from the seeded caches
      setIsDirty(false);
      setLayoutDirty(false);
      setBaselineToken(t => t + 1);
      addDebugLog(`Profile opened: ${path.split(/[\\/]/).pop()}`);
    } catch (err) {
      addDebugLog(`Open error: ${err}`);
    }
  };

  const handleBootloader = async () => {
    if (!selectedDevice) { addDebugLog('No device selected'); return; }
    try {
      addDebugLog('Jumping to bootloader (for firmware update)...');
      await invoke('jump_bootloader');
      addDebugLog('Bootloader mode requested - device will re-enumerate in DFU mode');
    } catch (err) {
      addDebugLog(`Bootloader error: ${err}`);
    }
  };

  const handleFlashFirmware = async (firmwarePath) => {
    setIsFlashing(true);
    try {
      await invoke('flash_firmware', { firmwarePath });
      addDebugLog('Firmware flash successful');
    } catch (err) {
      addDebugLog(`Flash error: ${err}`);
    } finally {
      setIsFlashing(false);
    }
  };

  // Overlay mode replaces the entire app tree: nothing else renders (so there
  // is exactly one matrix poller), and the body background goes transparent
  // via the overlay-active class.
  if (overlayMode) {
    return (
      <KeyboardOverlay
        opacity={overlayOpacity}
        onOpacityChange={setOverlayOpacity}
        onExit={exitOverlay}
      >
        <KeyTest
          overlay
          selectedDevice={selectedDevice}
          numLayers={layerCount}
          addDebugLog={addDebugLog}
          customLabels={customLabels}
          lightingPerKeyColors={lightingPerKeyColors}
          tapDanceKeys={tapDanceKeys}
          macroDescriptions={macroDescriptions}
          tapDanceDescriptions={tapDanceDescriptions}
        />
      </KeyboardOverlay>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-layers">
          <span className="header-layers-label">LAYER</span>
          <div className="header-layer-btns">
            {Array.from({ length: Math.min(layerCount, 4) }).map((_, idx) => (
              <button
                key={idx}
                className={`header-layer-btn${currentLayer === idx ? ' active' : ''}`}
                onClick={() => handleLayerChange(idx)}
                title={layerNames[idx]}
              >
                {idx}
              </button>
            ))}

            {layerCount > 4 && (
              <div className="header-layer-dropdown-wrap" ref={layerDropdownRef}>
                <button
                  className={`header-layer-btn header-layer-more${currentLayer >= 4 ? ' active' : ''}`}
                  onClick={() => setShowLayerDropdown(v => !v)}
                  title="More layers"
                >
                  {currentLayer >= 4 && <span>{currentLayer}</span>}
                  <span className={`header-layer-caret${showLayerDropdown ? ' open' : ''}`}>▾</span>
                </button>
                {showLayerDropdown && (
                  <div className="header-layer-dropdown">
                    {Array.from({ length: layerCount - 4 }, (_, i) => i + 4).map(idx => (
                      <button
                        key={idx}
                        className={`header-layer-dropdown-item${currentLayer === idx ? ' active' : ''}`}
                        onClick={() => { handleLayerChange(idx); setShowLayerDropdown(false); }}
                      >
                        <span className="dropdown-layer-num">{idx}</span>
                        <span>{layerNames[idx]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              className="header-layer-btn header-layer-add"
              onClick={handleAddLayer}
              disabled={layerCount >= 16}
              title={layerCount >= 16 ? 'Maximum 16 layers (QMK limit)' : 'Add layer'}
            >
              +
            </button>
          </div>
        </div>

        <div className="header-title">
          <h1>IRIS-LM</h1>
          <span className="subtitle">Keyboard Configuration System</span>
          <div className="header-file-status">
            {currentFilePath ? (
              <>
                <span className="header-filename">{currentFilePath.split(/[\\/]/).pop()}</span>
                {isDirty && <span className="header-dirty-dot" title="Unsaved changes">●</span>}
              </>
            ) : (
              <span className="header-filename header-filename--none">No profile open</span>
            )}
          </div>
        </div>

        <div className="header-status">
          {layoutDirty && selectedDevice && (
            <div className="dirty-indicator" title="Layout modified since last connect or import">MODIFIED</div>
          )}
          {selectedDevice ? (
            <>
              <div className="status-indicator connected" />
              <span>{selectedDevice.name}</span>
            </>
          ) : (
            <>
              <div className="status-indicator disconnected" />
              <span>No Device</span>
            </>
          )}
        </div>
      </header>

      <div className="app-toolbar">
        <div className="layer-toolbar-group">
          <button onClick={handleCopyLayer} disabled={!selectedDevice || !keymap.length} title="Copy this layer's keycodes into clipboard">Copy</button>
          <button onClick={handlePasteLayer} disabled={!selectedDevice || !copiedLayer} title="Paste copied layer keycodes here">Paste</button>
          <button onClick={handleClearLayer} disabled={!selectedDevice} title="Set all keys to transparent (KC_TRNS)">Clear</button>
          <button onClick={handleDeleteLayer} disabled={!selectedDevice || layerCount <= 1} title="Delete this layer — higher layers shift down">Delete</button>
        </div>
        <div className="layer-toolbar-group">
          <button onClick={handleNew} title="Create a new profile file">New</button>
          <button onClick={handleOpen} disabled={!selectedDevice} title="Open a profile and write it to the keyboard">Open</button>
          <button onClick={handleSave} disabled={!selectedDevice} title="Save to current file (Ctrl+S)">Save</button>
          <button onClick={() => handleSaveAs()} disabled={!selectedDevice} title="Save to a new file">Save As</button>
        </div>
      </div>

      <div className="app-body">
        <div className="app-main">
          <div className="editor-container">
            <div className="tabs">
              <button className={`tab${activeTab === 'editor'    ? ' active' : ''}`} onClick={() => handleTabChange('editor')}>Editor</button>
              <button className={`tab${activeTab === 'macros'    ? ' active' : ''}`} onClick={() => handleTabChange('macros')}>Macros</button>
              {!hiddenTabs.tapdance && <button className={`tab${activeTab === 'tapdance' ? ' active' : ''}`} onClick={() => handleTabChange('tapdance')}>Tap Dance</button>}
              <button className={`tab${activeTab === 'combos'    ? ' active' : ''}`} onClick={() => handleTabChange('combos')}>Combos</button>
              {!hiddenTabs.lighting && <button className={`tab${activeTab === 'lighting' ? ' active' : ''}`} onClick={() => handleTabChange('lighting')}>Lighting</button>}
              <button className={`tab${activeTab === 'settings'  ? ' active' : ''}`} onClick={() => handleTabChange('settings')}>Settings</button>
              <button className={`tab${activeTab === 'firmware'  ? ' active' : ''}`} onClick={() => handleTabChange('firmware')}>Firmware</button>
              <button className={`tab${activeTab === 'test'      ? ' active' : ''}`} onClick={() => handleTabChange('test')}>Key Test</button>
            </div>

            <div className={`tab-content${activeTab === 'editor' ? ' tab-content-editor' : ''}`}>
              {activeTab === 'editor' && (
                <div className="editor-content">
                  <div className="editor-body">
                    <div className="editor-center">
                      <div className="keyboard-header">
                        {isEditingLayerName ? (
                          <input
                            autoFocus
                            className="layer-name-input"
                            value={editLayerNameText}
                            onChange={e => setEditLayerNameText(e.target.value)}
                            onBlur={() => {
                              const t = editLayerNameText.trim();
                              if (t) setLayerNames(prev => prev.map((n, i) => i === currentLayer ? t : n));
                              setIsEditingLayerName(false);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') setIsEditingLayerName(false);
                            }}
                          />
                        ) : (
                          <h2 className="layer-name-heading" onClick={() => { setEditLayerNameText(layerNames[currentLayer]); setIsEditingLayerName(true); }} title="Click to rename">
                            {layerNames[currentLayer]}
                          </h2>
                        )}
                        <div className="editor-mode-pill">
                          {[['keys', 'Keys'], ['lighting', 'Lighting'], ['tap-dance', 'Tap Dance']].map(([mode, label]) => (
                            <button key={mode} className={`pill-btn${editorMode === mode ? ' active' : ''}`}
                              onClick={() => setEditorMode(mode)}>
                              {label}
                            </button>
                          ))}
                        </div>
                        {selectedKey ? (
                          <button className="deselect-btn" onClick={() => handleKeySelect(null)}>Deselect</button>
                        ) : (
                          <span className="info-text">Click a key</span>
                        )}
                      </div>
                      <KeyboardGrid
                        keymap={keymap}
                        currentLayer={currentLayer}
                        selectedKey={selectedKey}
                        selectedKeys={selectedKeys}
                        onKeySelect={handleKeySelect}
                        onKeyChange={handleKeyChange}
                        onKeyRightClick={handlePickerRequest}
                        keyLedColors={keyLedColors}
                        keyBadges={tapDanceBadges}
                        customLabels={customLabels}
                        macroDescriptions={macroDescriptions}
                        tapDanceDescriptions={tapDanceDescriptions}
                      />
                    </div>
                    <div className="editor-right">
                      {editorMode === 'keys' && (
                        <>
                          {selectedKeyObj && (
                            <div className="editor-custom-label">
                              <span className="editor-custom-label-title">
                                Custom Labels — <em>{selectedKeyDisplayName}</em>
                              </span>
                              {[
                                { field: 'primary',   label: 'Center',    placeholder: 'Replaces decoded keycode', max: 12, val: keyPrimaryLabel },
                                { field: 'secondary', label: 'Top-right', placeholder: 'Shifted char / alt',       max: 6,  val: keySecondaryLabel },
                                { field: 'tertiary',  label: 'Bottom',    placeholder: 'Tertiary label',           max: 8,  val: keyTertiaryLabel },
                              ].map(({ field, label, placeholder, max, val }) => (
                                <div key={field} className="editor-custom-label-row">
                                  <span className="editor-custom-label-field-name">{label}</span>
                                  <input
                                    type="text"
                                    className="editor-custom-label-input"
                                    placeholder={placeholder}
                                    value={val}
                                    onChange={e => setLabelField(field, e.target.value)}
                                    maxLength={max}
                                  />
                                  {val && (
                                    <button
                                      className="editor-custom-label-clear"
                                      onClick={() => setLabelField(field, '')}
                                      title="Clear"
                                    >✕</button>
                                  )}
                                </div>
                              ))}
                              {(keyPrimaryLabel || keySecondaryLabel || keyTertiaryLabel) && (
                                <button className="editor-custom-label-clear-all" onClick={clearAllLabels}>
                                  Clear All
                                </button>
                              )}
                            </div>
                          )}
                          <KeyPicker
                            onSelect={applyKeycodeToSelection}
                            focusRequest={pickerRequest}
                            macroDescriptions={macroDescriptions}
                            tapDanceDescriptions={tapDanceDescriptions}
                          />
                        </>
                      )}
                      {editorMode === 'lighting' && (
                        <LightingPanel
                          device={selectedDevice}
                          addDebugLog={addDebugLog}
                          layer={currentLayer}
                          layerCount={layerCount}
                          perKeyColors={lightingPerKeyColors}
                          onPerKeyColorsChange={handlePerKeyColorsChange}
                          scrollSettings={scrollSettings}
                          onScrollSettingsChange={handleScrollSettingsChange}
                          compact
                          selectedKey={selectedKey}
                          selectedKeys={selectedKeys}
                          perKeyColorsFilePath={perKeyColorsFilePath}
                          scrollTextFilePath={scrollTextFilePath}
                          globalConfigs={globalLightingConfigs}
                          onGlobalConfigsChange={setGlobalLightingConfigs}
                          profileLoaded={currentFilePath !== null}
                        />
                      )}
                      {editorMode === 'tap-dance' && (
                        <TapDanceKeyPanel
                          selectedKey={selectedKey}
                          currentLayer={currentLayer}
                          tapDanceKeys={tapDanceKeys}
                          onTapDanceKeysChange={handleTapDanceKeysChange}
                          tapDanceFilePath={tapDanceFilePath}
                          tdKeyAssignments={tdKeyAssignments}
                          onTdKeyAssignmentsChange={handleTdKeyAssignmentsChange}
                          onApplyTdAssignment={(n, keyId) => applyTdAssignment(n, keyId, tapDanceKeys)}
                          onClearTdAssignment={clearTdAssignment}
                          tapDanceDescriptions={tapDanceDescriptions}
                          onTapDanceDescriptionsChange={handleTapDanceDescriptionsChange}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'macros'    && (
                <MacroEditor
                  device={selectedDevice}
                  addDebugLog={addDebugLog}
                  reloadKey={editorReloadKey}
                  extraMacros={extraMacros}
                  onExtraMacrosChange={handleExtraMacrosChange}
                  extraMacrosFilePath={extraMacrosFilePath}
                  macroDescriptions={macroDescriptions}
                  onMacroDescriptionsChange={handleMacroDescriptionsChange}
                  profileLoaded={currentFilePath !== null}
                  viaMacrosCache={profileHwSectionsRef.current.macros}
                  onViaMacrosChange={handleViaMacrosChange}
                />
              )}
              {activeTab === 'tapdance' && (
                <TapDanceEditor
                  device={selectedDevice}
                  tapDanceDescriptions={tapDanceDescriptions}
                  macroDescriptions={macroDescriptions}
                  reloadKey={editorReloadKey}
                  profileLoaded={currentFilePath !== null}
                  tapDanceCache={profileHwSectionsRef.current.tap_dance}
                  onTapDanceChange={handleTapDanceEntriesChange}
                />
              )}
              {activeTab === 'combos'   && (
                <CombosEditor
                  device={selectedDevice}
                  comboDescriptions={comboDescriptions}
                  onComboDescriptionsChange={handleComboDescriptionsChange}
                  macroDescriptions={macroDescriptions}
                  tapDanceDescriptions={tapDanceDescriptions}
                  reloadKey={editorReloadKey}
                  profileLoaded={currentFilePath !== null}
                  combosCache={profileHwSectionsRef.current.combos}
                  onCombosChange={handleComboEntriesChange}
                />
              )}
              {activeTab === 'lighting' && (
                <LightingPanel
                  device={selectedDevice}
                  addDebugLog={addDebugLog}
                  layer={currentLayer}
                  layerCount={layerCount}
                  perKeyColors={lightingPerKeyColors}
                  onPerKeyColorsChange={handlePerKeyColorsChange}
                  scrollSettings={scrollSettings}
                  onScrollSettingsChange={handleScrollSettingsChange}
                  perKeyColorsFilePath={perKeyColorsFilePath}
                  scrollTextFilePath={scrollTextFilePath}
                  globalConfigs={globalLightingConfigs}
                  onGlobalConfigsChange={setGlobalLightingConfigs}
                  profileLoaded={currentFilePath !== null}
                />
              )}
              {activeTab === 'firmware' && (
                <FirmwarePanel
                  device={selectedDevice}
                  onBootloader={handleBootloader}
                  allKeymapsRef={allKeymapsRef}
                  layerCount={layerCount}
                  keymapFilePath={keymapFilePath}
                  perKeyColors={lightingPerKeyColors}
                  scrollSettings={scrollSettings}
                  tapDanceKeys={tapDanceKeys}
                  tdKeyAssignments={tdKeyAssignments}
                  extraMacros={extraMacros}
                  profileLoaded={currentFilePath !== null}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsPanel
                  showDebugLog={showDebugLog}
                  onToggleDebugLog={setShowDebugLog}
                  verboseDebug={verboseDebug}
                  onToggleVerboseDebug={setVerboseDebug}
                  showScanLog={showScanLog}
                  onToggleShowScanLog={setShowScanLog}
                  perKeyColorsFilePath={perKeyColorsFilePath}
                  onPerKeyColorsFilePathChange={updatePerKeyColorsFilePath}
                  tapDanceFilePath={tapDanceFilePath}
                  onTapDanceFilePathChange={updateTapDanceFilePath}
                  scrollTextFilePath={scrollTextFilePath}
                  onScrollTextFilePathChange={updateScrollTextFilePath}
                  keymapFilePath={keymapFilePath}
                  onKeymapFilePathChange={updateKeymapFilePath}
                  extraMacrosFilePath={extraMacrosFilePath}
                  onExtraMacrosFilePathChange={updateExtraMacrosFilePath}
                  hiddenTabs={hiddenTabs}
                  onHiddenTabsChange={updateHiddenTabs}
                />
              )}
              {activeTab === 'test' && (
                <KeyTest
                  selectedDevice={selectedDevice}
                  numLayers={layerCount}
                  addDebugLog={addDebugLog}
                  logPolling={verboseDebug}
                  customLabels={customLabels}
                  lightingPerKeyColors={lightingPerKeyColors}
                  tapDanceKeys={tapDanceKeys}
                  macroDescriptions={macroDescriptions}
                  tapDanceDescriptions={tapDanceDescriptions}
                  onEnterOverlay={enterOverlay}
                />
              )}
            </div>
          </div>
        </div>

        {showDebugLog && (
          <aside className={`panel debug-panel${verboseDebug ? ' verbose' : ''}`}>
            <DebugConsole logs={debugLogs} onClear={() => setDebugLogs([])} />
          </aside>
        )}
      </div>
      {showDeleteLayerModal && (
        <div className="clear-modal-overlay" onClick={() => setShowDeleteLayerModal(false)}>
          <div className="clear-modal" onClick={e => e.stopPropagation()}>
            <h3 className="clear-modal-title">Delete Layer {currentLayer}{layerNames[currentLayer] ? ` — ${layerNames[currentLayer]}` : ''}</h3>
            <p className="clear-modal-body">
              This removes the layer's keys, lighting, scroll text, tap dance config, and labels,
              and shifts all higher layers down by one — on the keyboard immediately.
              Keys that reference layer numbers (MO, TG, TO, LT, tap dance definitions) are
              <strong> not</strong> renumbered — review them afterward.
              Save the profile manually to persist the change.
            </p>
            <div className="clear-modal-actions">
              <button className="primary" onClick={executeDeleteLayer}>Delete Layer</button>
              <button onClick={() => setShowDeleteLayerModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showClearModal && (
        <div className="clear-modal-overlay" onClick={() => setShowClearModal(false)}>
          <div className="clear-modal" onClick={e => e.stopPropagation()}>
            <h3 className="clear-modal-title">Clear Layer {currentLayer}</h3>
            <p className="clear-modal-body">
              All keys will be set to transparent (KC_TRNS) and written to the keyboard immediately.
              Export a JSON backup first to preserve the current layout.
            </p>
            <div className="clear-modal-actions">
              <button className="primary" onClick={handleExportThenClear}>Export JSON &amp; Clear</button>
              <button onClick={executeClear}>Clear Anyway</button>
              <button onClick={() => setShowClearModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
