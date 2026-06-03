import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { decodeQuantum } from './keyboardLayout';
import './App.css';

import KeyboardGrid from './components/KeyboardGrid';
import MacroEditor from './components/MacroEditor';
import SettingsPanel from './components/SettingsPanel';
import DebugConsole from './components/DebugConsole';
import KeyTest from './components/KeyTest';
import KeyPicker from './components/KeyPicker';

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

  const verboseRef = useRef(false);
  useEffect(() => { verboseRef.current = verboseDebug; }, [verboseDebug]);

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
        logVerbose(`Scan: ${result.length} device(s)${result.length ? ` — ${result.map((d) => d.name).join(', ')}` : ' (none)'}`);

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
              <button className={`tab${activeTab === 'editor'   ? ' active' : ''}`} onClick={() => handleTabChange('editor')}>Editor</button>
              <button className={`tab${activeTab === 'macros'   ? ' active' : ''}`} onClick={() => handleTabChange('macros')}>Macros</button>
              <button className={`tab${activeTab === 'settings' ? ' active' : ''}`} onClick={() => handleTabChange('settings')}>Settings</button>
              <button className={`tab${activeTab === 'test'     ? ' active' : ''}`} onClick={() => handleTabChange('test')}>Key Test</button>
            </div>

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
              {activeTab === 'macros'   && <MacroEditor device={selectedDevice} />}
              {activeTab === 'settings' && (
                <SettingsPanel
                  showDebugLog={showDebugLog}
                  onToggleDebugLog={setShowDebugLog}
                  verboseDebug={verboseDebug}
                  onToggleVerboseDebug={setVerboseDebug}
                />
              )}
              {activeTab === 'test' && (
                <KeyTest selectedDevice={selectedDevice} numLayers={4} />
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
    </div>
  );
}
