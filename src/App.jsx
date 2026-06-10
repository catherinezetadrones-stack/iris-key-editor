import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { decodeQuantum, KEY_TO_LED, HALVES } from './keyboardLayout';
import { parseBuffer, serializeBuffer } from './macroCodec';
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
import LightingPanel from './components/LightingPanel';

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

  const loadKeymap = useCallback(
    async (layer) => {
      try {
        let result;
        if (layer < firmwareLayerCountRef.current) {
          result = await invoke('read_keymap', { layer });
          allKeymapsRef.current[layer] = result;
        } else {
          result = (allKeymapsRef.current[layer] ??= Array.from({ length: 10 }, () => Array(6).fill(0x0000)));
        }
        setKeymap(result);
        addDebugLog(`Loaded layer ${layer}${layer >= firmwareLayerCountRef.current ? ' (local — beyond firmware capacity)' : ''}`);
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
          await loadKeymap(currentLayer);
          setLayoutDirty(false);
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
      setIsDirty(true);
      addDebugLog(`Key updated [${row},${col}] -> 0x${newKeycode.toString(16).padStart(4, '0')}${withinFirmware ? '' : ' (local only)'}`);
      logVerbose(`  └─ decoded: ${decodeQuantum(newKeycode) ?? 'unknown'} | layer ${currentLayer}`);
    } catch (err) {
      addDebugLog(`Key write error: ${err}`);
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
    setIsDirty(true);
    addDebugLog(`Layer ${newIdx} added (local — write to firmware after updating firmware layer count)`);
  };

  const commitLayerRename = () => {
    if (editingLayerIdx !== null) {
      const trimmed = editingLayerName.trim() || `Layer ${editingLayerIdx}`;
      setLayerNames(names => names.map((n, i) => i === editingLayerIdx ? trimmed : n));
      setEditingLayerIdx(null);
      setIsDirty(true);
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
      await loadKeymap(currentLayer);
      setLayoutDirty(true);
      setIsDirty(true);
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
      await loadKeymap(currentLayer);
      setLayoutDirty(true);
      setIsDirty(true);
      addDebugLog(`Layer ${currentLayer} cleared${currentLayer >= firmwareLayerCountRef.current ? ' (local only)' : ''}`);
    } catch (err) {
      addDebugLog(`Clear error: ${err}`);
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

  // Read all keyboard state and return a complete profile object.
  // Macros are decoded from raw bytes into a human-readable action list so the
  // saved JSON is inspectable and not just an opaque array of numbers.
  const buildProfile = async () => {
    // Read however many layers the firmware supports, then append any locally-cached
    // extra layers so that layers beyond firmware capacity are preserved in the export.
    const firmwareLayers = await invoke('read_all_layers');
    const layers = [...firmwareLayers];
    for (let l = firmwareLayers.length; l < layerCount; l++) {
      layers.push(allKeymapsRef.current[l] ?? Array.from({ length: 10 }, () => Array(6).fill(0x0000)));
    }
    let macros = [];
    try {
      const info    = await invoke('get_macro_info');
      const rawBuf  = await invoke('read_macros');
      macros = parseBuffer(rawBuf, info.count);
    } catch {
      addDebugLog('Macros unavailable — exporting without');
    }
    let lighting = null;
    try {
      const current = await invoke('get_lighting');
      lighting = Array.from({ length: layerCount }, () => ({ ...current }));
    } catch {
      addDebugLog('Lighting unavailable — exporting without');
    }
    let tap_dance = null;
    let combos    = null;
    try {
      const vs = await invoke('detect_vial');
      if (vs.supported) {
        if (vs.td_count > 0) {
          tap_dance = await invoke('vial_get_all_tap_dance', { count: vs.td_count });
          addDebugLog(`Tap dance: exported ${tap_dance.length} entries`);
        }
        if (vs.combo_count > 0) {
          combos = await invoke('vial_get_all_combos', { count: vs.combo_count });
          addDebugLog(`Combos: exported ${combos.length} entries`);
        }
      }
    } catch (err) {
      addDebugLog(`Tap dance/combos unavailable — exporting without: ${err}`);
    }
    return { version: 3, keyboard: 'iris-lm', layers, macros, lighting, tap_dance, combos,
      lighting_perkey: lightingPerKeyColors, scroll_settings: scrollSettings,
      layer_count: layerCount, layer_names: layerNames,
      tap_dance_keys: tapDanceKeys, td_key_assignments: tdKeyAssignments,
      custom_labels: customLabels, extra_macros: extraMacros,
      macro_descriptions: macroDescriptions };
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
        setIsDirty(false);
        setLayoutDirty(false);
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
      allKeymapsRef.current = [];
      setCurrentFilePath(path);
      setIsDirty(false);
      setLayoutDirty(false);
      if (selectedDevice) await loadKeymap(currentLayer);
      else setKeymap([]);
      addDebugLog(`New profile created: ${path.split(/[\\/]/).pop()}`);
    } catch (err) {
      addDebugLog(`New profile error: ${err}`);
    }
  };

  const [macroReloadKey, setMacroReloadKey] = useState(0);

  const [lightingPerKeyColors, setLightingPerKeyColors] = useState(
    () => Array.from({ length: 4 }, () => Array(68).fill(null))
  );
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

  // Wrapped setters that also mark the profile dirty so the UI reflects unsaved changes.
  const handlePerKeyColorsChange = useCallback((colors) => {
    setLightingPerKeyColors(colors);
    setIsDirty(true);
  }, []);
  const handleScrollSettingsChange = useCallback((settings) => {
    setScrollSettings(settings);
    setIsDirty(true);
  }, []);
  const handleTapDanceKeysChange = useCallback((keys) => {
    setTapDanceKeys(keys);
    setIsDirty(true);
  }, []);
  const handleTdKeyAssignmentsChange = useCallback((assignments) => {
    setTdKeyAssignments(assignments);
    setIsDirty(true);
  }, []);
  const handleExtraMacrosChange = useCallback((updater) => {
    setExtraMacros(prev => (typeof updater === 'function' ? updater(prev) : updater));
    setIsDirty(true);
  }, []);
  const handleMacroDescriptionsChange = useCallback((updater) => {
    setMacroDescriptions(prev => (typeof updater === 'function' ? updater(prev) : updater));
    setIsDirty(true);
  }, []);

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
    const colors = lightingPerKeyColors[currentLayer];
    if (!colors) return null;
    const map = new Map();
    KEY_TO_LED.forEach((ledIdx, keyId) => {
      const hsv = colors[ledIdx];
      if (!hsv) return;
      const [h, s, v] = hsv;
      const hDeg = Math.round((h / 255) * 360);
      const sP = Math.round((s / 255) * 100);
      const lP = Math.round((v / 255) * 50);
      map.set(keyId, `hsl(${hDeg}, ${sP}%, ${lP}%)`);
    });
    return map.size > 0 ? map : null;
  }, [activeTab, currentLayer, lightingPerKeyColors]);

  const selectedKeyObj = useMemo(() => {
    if (!selectedKey) return null;
    return [...HALVES.left, ...HALVES.right].find(
      k => k.viaRow === selectedKey.row && k.viaCol === selectedKey.col
    ) ?? null;
  }, [selectedKey]);

  const tapDanceBadges = useMemo(() => {
    if (activeTab !== 'editor') return null;
    const currentLayerTD = tapDanceKeys[currentLayer] ?? {};
    const map = new Map();
    Object.entries(currentLayerTD).forEach(([keyId, e]) => {
      if (e.on_tap || e.on_hold || e.on_double_tap || e.on_tap_hold) map.set(keyId, 'TD');
    });
    return map.size > 0 ? map : null;
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
    setIsDirty(true);
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
    setIsDirty(true);
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
          setMacroReloadKey(k => k + 1); // signal MacroEditor to reload
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
        // Auto-apply TD(n) keycodes to layer 0 for each assigned key
        const allKeys = [...HALVES.left, ...HALVES.right];
        let applied = 0;
        for (let n = 0; n < profile.td_key_assignments.length; n++) {
          const assignment = profile.td_key_assignments[n];
          if (!assignment?.keyId) continue;
          const key = allKeys.find(k => k.id === assignment.keyId);
          if (!key) { addDebugLog(`TD(${n}) assignment: key "${assignment.keyId}" not found — skipped`); continue; }
          const tdKeycode = 0x5700 | n;
          try {
            if (firmwareLayerCountRef.current > 0) {
              await invoke('write_key', { layer: 0, row: key.viaRow, col: key.viaCol, keycode: tdKeycode });
            }
            if (allKeymapsRef.current[0]) {
              allKeymapsRef.current[0] = allKeymapsRef.current[0].map(
                (r, ri) => ri === key.viaRow ? r.map((kc, ci) => ci === key.viaCol ? tdKeycode : kc) : r
              );
            } else {
              addDebugLog(`TD(${n}) auto-apply: layer 0 cache absent — hardware written, cache not updated`);
            }
            applied++;
          } catch (err) {
            addDebugLog(`TD(${n}) auto-apply failed: ${err}`);
          }
        }
        if (applied > 0) addDebugLog(`Auto-applied ${applied} TD keycode(s) to layer 0`);
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
      await loadKeymap(currentLayer);
      setCurrentFilePath(path);
      setIsDirty(false);
      setLayoutDirty(false);
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
                          perKeyColorsFilePath={perKeyColorsFilePath}
                          scrollTextFilePath={scrollTextFilePath}
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
                  reloadKey={macroReloadKey}
                  extraMacros={extraMacros}
                  onExtraMacrosChange={handleExtraMacrosChange}
                  extraMacrosFilePath={extraMacrosFilePath}
                  macroDescriptions={macroDescriptions}
                  onMacroDescriptionsChange={handleMacroDescriptionsChange}
                />
              )}
              {activeTab === 'tapdance' && <TapDanceEditor device={selectedDevice} />}
              {activeTab === 'combos'   && <CombosEditor  device={selectedDevice} />}
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
                />
              )}
              {activeTab === 'firmware' && (
                <FirmwarePanel
                  device={selectedDevice}
                  onBootloader={handleBootloader}
                  allKeymapsRef={allKeymapsRef}
                  layerCount={layerCount}
                  keymapFilePath={keymapFilePath}
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
                <KeyTest selectedDevice={selectedDevice} numLayers={layerCount} addDebugLog={addDebugLog} logPolling={verboseDebug} />
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
