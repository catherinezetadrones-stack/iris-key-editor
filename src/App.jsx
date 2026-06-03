// App.jsx - Iris-LM Editor Main Application
//
// Industrial/brutalist aesthetic with neon accents; the keyboard layout editor
// is the visual centerpiece. The backend speaks the stock VIA protocol over raw
// HID, so remapping is live and persisted to EEPROM by the firmware — no flash.

import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import './App.css';

import KeyboardGrid from './components/KeyboardGrid';
import LayerPanel from './components/LayerPanel';
import DevicePanel from './components/DevicePanel';
import MacroEditor from './components/MacroEditor';
import SettingsPanel from './components/SettingsPanel';
import DebugConsole from './components/DebugConsole';
import KeyTest from './components/KeyTest';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [currentLayer, setCurrentLayer] = useState(0);
  const [keymap, setKeymap] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [debugLogs, setDebugLogs] = useState([]);
  const [isFlashing, setIsFlashing] = useState(false);
  const [activeTab, setActiveTab] = useState('editor'); // 'editor' | 'macros' | 'settings' | 'test'

  // Defined before the effects that use it to avoid a temporal-dead-zone error.
  const addDebugLog = useCallback((message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [...prev.slice(-99), `[${timestamp}] ${message}`]);
  }, []);

  const loadKeymap = useCallback(
    async (layer) => {
      try {
        const result = await invoke('read_keymap', { layer });
        setKeymap(result);
        addDebugLog(`Loaded layer ${layer}`);
      } catch (err) {
        addDebugLog(`Keymap load error: ${err}`);
      }
    },
    [addDebugLog]
  );

  // Poll for devices. The VIA backend has no event stream, so a light 2s poll
  // handles plug/unplug. Re-selects and reloads when the device set changes.
  useEffect(() => {
    let cancelled = false;

    const scan = async () => {
      try {
        const result = await invoke('detect_devices');
        if (cancelled) return;
        setDevices(result);

        if (result.length === 0) {
          if (selectedDevice) {
            setSelectedDevice(null);
            addDebugLog('Device disconnected');
          }
          return;
        }

        // Auto-select the first device and load its keymap once.
        const stillPresent = selectedDevice && result.some((d) => d.port === selectedDevice.port);
        if (!stillPresent) {
          setSelectedDevice(result[0]);
          addDebugLog(`Found ${result.length} device(s): ${result[0].name}`);
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
  }, [selectedDevice, currentLayer, loadKeymap, addDebugLog]);

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
      addDebugLog(`Key updated [${row},${col}] -> 0x${newKeycode.toString(16)}`);
    } catch (err) {
      addDebugLog(`Key write error: ${err}`);
    }
  };

  const handleLayerChange = async (newLayer) => {
    setCurrentLayer(newLayer);
    await loadKeymap(newLayer);
  };

  const handleBootloader = async () => {
    if (!selectedDevice) {
      addDebugLog('No device selected');
      return;
    }
    try {
      addDebugLog('Jumping to bootloader (for firmware update)...');
      await invoke('jump_bootloader');
      addDebugLog('Bootloader mode requested - device will re-enumerate in DFU mode');
    } catch (err) {
      addDebugLog(`Bootloader error: ${err}`);
    }
  };

  // Firmware UPDATE only — unrelated to remapping. flash_firmware resolves when
  // dfu-util finishes, so reset the flashing flag in finally().
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
        <div className="header-title">
          <h1>IRIS-LM</h1>
          <span className="subtitle">Keyboard Configuration System</span>
        </div>
        <div className="header-status">
          {selectedDevice ? (
            <>
              <div className="status-indicator connected"></div>
              <span>{selectedDevice.name}</span>
            </>
          ) : (
            <>
              <div className="status-indicator disconnected"></div>
              <span>No Device</span>
            </>
          )}
        </div>
      </header>

      <div className="app-container">
        <aside className="panel left-panel">
          <DevicePanel
            devices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            onBootloader={handleBootloader}
            onFlash={handleFlashFirmware}
            isFlashing={isFlashing}
          />
          <LayerPanel currentLayer={currentLayer} maxLayers={4} onLayerChange={handleLayerChange} />
        </aside>

        <main className="editor-container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'editor' ? 'active' : ''}`}
              onClick={() => setActiveTab('editor')}
            >
              Editor
            </button>
            <button
              className={`tab ${activeTab === 'macros' ? 'active' : ''}`}
              onClick={() => setActiveTab('macros')}
            >
              Macros
            </button>
            <button
              className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </button>
            <button
              className={`tab ${activeTab === 'test' ? 'active' : ''}`}
              onClick={() => setActiveTab('test')}
            >
              Key Test
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'editor' && (
              <KeyboardGrid
                keymap={keymap}
                currentLayer={currentLayer}
                selectedKey={selectedKey}
                onKeySelect={setSelectedKey}
                onKeyChange={handleKeyChange}
              />
            )}
            {activeTab === 'macros' && <MacroEditor device={selectedDevice} />}
            {activeTab === 'settings' && <SettingsPanel />}
            {activeTab === 'test' && (
              <KeyTest selectedDevice={selectedDevice} numLayers={4} />
            )}
          </div>
        </main>

        <aside className="panel right-panel">
          <DebugConsole logs={debugLogs} />
        </aside>
      </div>
    </div>
  );
}
