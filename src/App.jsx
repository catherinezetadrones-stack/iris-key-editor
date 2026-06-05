import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { decodeQuantum } from './keyboardLayout';
import { parseBuffer, serializeBuffer } from './macroCodec';
import './App.css';

import KeyboardGrid from './components/KeyboardGrid';
import MacroEditor from './components/MacroEditor';
import SettingsPanel from './components/SettingsPanel';
import DebugConsole from './components/DebugConsole';
import KeyTest from './components/KeyTest';
import KeyPicker from './components/KeyPicker';
import TapDanceEditor from './components/TapDanceEditor';
import CombosEditor from './components/CombosEditor';
import FirmwarePanel from './components/FirmwarePanel';
import LightingPanel from './components/LightingPanel';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [currentLayer, setCurrentLayer] = useState(0);
  const [keymap, setKeymap] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [debugLogs, setDebugLogs] = useState([]);
  const [isFlashing, setIsFlashing] = useState(false);
  const [activeTab, setActiveTab] = useState('editor');
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [verboseDebug, setVerboseDebug] = useState(false);
  const [pickerRequest, setPickerRequest] = useState(null);
  const [copiedLayer, setCopiedLayer] = useState(null); // cached keymap for paste
  const [showClearModal, setShowClearModal] = useState(false);
  const [showScanLog, setShowScanLog] = useState(false);

  const verboseRef = useRef(false);
  useEffect(() => { verboseRef.current = verboseDebug; }, [verboseDebug]);

  const scanLogRef = useRef(false);
  useEffect(() => { scanLogRef.current = showScanLog; }, [showScanLog]);

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
        const result = await invoke('read_keymap', { layer });
        setKeymap(result);
        addDebugLog(`Loaded layer ${layer}`);
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
          await loadKeymap(currentLayer);
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
    try {
      await invoke('write_key', { layer: currentLayer, row, col, keycode: newKeycode });
      setKeymap((prev) =>
        prev.map((r, i) => (i === row ? r.map((k, j) => (j === col ? newKeycode : k)) : r))
      );
      addDebugLog(`Key updated [${row},${col}] -> 0x${newKeycode.toString(16).padStart(4, '0')}`);
      logVerbose(`  └─ decoded: ${decodeQuantum(newKeycode) ?? 'unknown'} | layer ${currentLayer}`);
    } catch (err) {
      addDebugLog(`Key write error: ${err}`);
    }
  };

  const handleLayerChange = async (newLayer) => {
    logVerbose(`Layer: ${currentLayer} → ${newLayer}`);
    setCurrentLayer(newLayer);
    setSelectedKey(null);
    await loadKeymap(newLayer);
  };

  const handleKeySelect = (key) => {
    setSelectedKey(key);
    if (key) logVerbose(`Key selected: [${key.row},${key.col}]`);
    else logVerbose('Key deselected');
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
      await invoke('write_layer', { layer: currentLayer, keymap: copiedLayer });
      await loadKeymap(currentLayer);
      addDebugLog(`Pasted to layer ${currentLayer}`);
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
      await invoke('write_layer', { layer: currentLayer, keymap: blank });
      await loadKeymap(currentLayer);
      addDebugLog(`Layer ${currentLayer} cleared`);
    } catch (err) {
      addDebugLog(`Clear error: ${err}`);
    }
  };

  const handleExportThenClear = async () => {
    setShowClearModal(false);
    try {
      addDebugLog('Reading keyboard state...');
      const profile = await buildProfile();
      const saved = await saveProfileToFile(profile);
      if (!saved) { addDebugLog('Export cancelled — clear aborted'); return; }
    } catch (err) {
      addDebugLog(`Export error: ${err} — clear aborted`);
      return;
    }
    await executeClear();
  };

  // Read all keyboard state and return a complete profile object.
  // Macros are decoded from raw bytes into a human-readable action list so the
  // saved JSON is inspectable and not just an opaque array of numbers.
  const buildProfile = async () => {
    const layers = await invoke('read_all_layers');
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
      lighting = Array.from({ length: 4 }, () => ({ ...current }));
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
    return { version: 1, keyboard: 'iris-lm', layers, macros, lighting, tap_dance, combos, lighting_perkey: lightingPerKeyColors, scroll_settings: scrollSettings };
  };

  // Save a profile object to a user-chosen file. Returns true if saved.
  const saveProfileToFile = async (profile) => {
    const saved = await invoke('save_profile', { profile });
    if (saved) addDebugLog('Profile saved');
    else addDebugLog('Save cancelled');
    return saved;
  };

  const handleExportKeymap = async () => {
    if (!selectedDevice) return;
    try {
      addDebugLog('Reading keyboard state...');
      const profile = await buildProfile();
      await saveProfileToFile(profile);
    } catch (err) {
      addDebugLog(`Export error: ${err}`);
    }
  };

  const [macroReloadKey, setMacroReloadKey] = useState(0);

  const [lightingPerKeyColors, setLightingPerKeyColors] = useState(
    () => Array.from({ length: 4 }, () => Array(68).fill(null))
  );
  const [scrollSettings, setScrollSettings] = useState(
    () => Array.from({ length: 4 }, (_, i) => ({ text: '', speed_ms: 150, fg_hsv: [0, 255, 100], bg_on: false, bg_hsv: [170, 255, 30], target_layer: i }))
  );

  const handleImportKeymap = async () => {
    if (!selectedDevice) return;
    try {
      const profile = await invoke('load_profile');
      if (!profile) { addDebugLog('Import cancelled'); return; }
      if (profile.version !== 1) { addDebugLog(`Unknown profile version ${profile.version}`); return; }
      addDebugLog(`Importing ${profile.layers.length} layers...`);
      for (let l = 0; l < profile.layers.length; l++) {
        await invoke('write_layer', { layer: l, keymap: profile.layers[l] });
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
      await loadKeymap(currentLayer);
      addDebugLog('Profile imported');
    } catch (err) {
      addDebugLog(`Import error: ${err}`);
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
            {Array.from({ length: 4 }).map((_, idx) => (
              <button
                key={idx}
                className={`header-layer-btn${currentLayer === idx ? ' active' : ''}`}
                onClick={() => handleLayerChange(idx)}
              >
                {idx}
              </button>
            ))}
          </div>
        </div>

        <div className="header-title">
          <h1>IRIS-LM</h1>
          <span className="subtitle">Keyboard Configuration System</span>
        </div>

        <div className="header-status">
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

      <div className="app-body">
        <div className="app-main">
          <div className="editor-container">
            <div className="tabs">
              <button className={`tab${activeTab === 'editor'    ? ' active' : ''}`} onClick={() => handleTabChange('editor')}>Editor</button>
              <button className={`tab${activeTab === 'macros'    ? ' active' : ''}`} onClick={() => handleTabChange('macros')}>Macros</button>
              <button className={`tab${activeTab === 'tapdance'  ? ' active' : ''}`} onClick={() => handleTabChange('tapdance')}>Tap Dance</button>
              <button className={`tab${activeTab === 'combos'    ? ' active' : ''}`} onClick={() => handleTabChange('combos')}>Combos</button>
              <button className={`tab${activeTab === 'lighting'  ? ' active' : ''}`} onClick={() => handleTabChange('lighting')}>Lighting</button>
              <button className={`tab${activeTab === 'firmware'  ? ' active' : ''}`} onClick={() => handleTabChange('firmware')}>Firmware</button>
              <button className={`tab${activeTab === 'settings'  ? ' active' : ''}`} onClick={() => handleTabChange('settings')}>Settings</button>
              <button className={`tab${activeTab === 'test'      ? ' active' : ''}`} onClick={() => handleTabChange('test')}>Key Test</button>
            </div>

            {activeTab === 'editor' && (
              <div className="layer-toolbar">
                <div className="layer-toolbar-group">
                  <span className="layer-toolbar-label">Layer {currentLayer}</span>
                  <button onClick={handleCopyLayer} disabled={!selectedDevice || !keymap.length} title="Copy this layer's keycodes into clipboard">Copy</button>
                  <button onClick={handlePasteLayer} disabled={!selectedDevice || !copiedLayer} title="Paste copied layer keycodes here">Paste</button>
                  <button onClick={handleClearLayer} disabled={!selectedDevice} title="Set all keys to transparent (KC_TRNS)">Clear</button>
                </div>
                <div className="layer-toolbar-group">
                  <button onClick={handleExportKeymap} disabled={!selectedDevice} title="Save all layers and macros to a JSON profile file">Export Profile</button>
                  <button onClick={handleImportKeymap} disabled={!selectedDevice} title="Restore all layers and macros from a JSON profile file">Import Profile</button>
                </div>
              </div>
            )}

            <div className="tab-content">
              {activeTab === 'editor' && (
                <KeyboardGrid
                  keymap={keymap}
                  currentLayer={currentLayer}
                  selectedKey={selectedKey}
                  onKeySelect={handleKeySelect}
                  onKeyChange={handleKeyChange}
                  onKeyRightClick={handlePickerRequest}
                />
              )}
              {activeTab === 'macros'    && <MacroEditor device={selectedDevice} addDebugLog={addDebugLog} reloadKey={macroReloadKey} />}
              {activeTab === 'tapdance' && <TapDanceEditor device={selectedDevice} />}
              {activeTab === 'combos'   && <CombosEditor  device={selectedDevice} />}
              {activeTab === 'lighting' && (
                <LightingPanel
                  device={selectedDevice}
                  addDebugLog={addDebugLog}
                  layer={currentLayer}
                  perKeyColors={lightingPerKeyColors}
                  onPerKeyColorsChange={setLightingPerKeyColors}
                  scrollSettings={scrollSettings}
                  onScrollSettingsChange={setScrollSettings}
                />
              )}
              {activeTab === 'firmware' && (
                <FirmwarePanel
                  device={selectedDevice}
                  onBootloader={handleBootloader}
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
                />
              )}
              {activeTab === 'test' && (
                <KeyTest selectedDevice={selectedDevice} numLayers={4} addDebugLog={addDebugLog} logPolling={verboseDebug} />
              )}
            </div>
          </div>

          {activeTab === 'editor' && (
            <KeyPicker
              onSelect={(keycode) => selectedKey && handleKeyChange(selectedKey.row, selectedKey.col, keycode)}
              focusRequest={pickerRequest}
            />
          )}
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
