import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';

export default function SettingsPanel({
  showDebugLog = false,
  onToggleDebugLog,
  verboseDebug = false,
  onToggleVerboseDebug,
  showScanLog = false,
  onToggleShowScanLog,
  perKeyColorsFilePath = '',
  onPerKeyColorsFilePathChange,
  tapDanceFilePath = '',
  onTapDanceFilePathChange,
  hiddenTabs = {},
  onHiddenTabsChange,
}) {
  const handleBrowse = async () => {
    try {
      const path = await invoke('pick_c_output_file');
      if (path) onPerKeyColorsFilePathChange?.(path);
    } catch (err) {
      console.error('File pick error:', err);
    }
  };

  const handleTdBrowse = async () => {
    try {
      const path = await invoke('pick_c_output_file');
      if (path) onTapDanceFilePathChange?.(path);
    } catch (err) {
      console.error('File pick error:', err);
    }
  };

  return (
    <div className="settings-panel">
      <h3>SETTINGS</h3>

      <div className="settings-group">
        <div className="settings-group-label">Firmware C Output</div>
        <div className="settings-desc">
          Path where "Generate C code" saves <code>per_key_colors.c</code>.
          Add <code>#include "per_key_colors.c"</code> to your <code>keymap.c</code> once.
        </div>
        <div className="settings-path-row">
          <input
            type="text"
            className="settings-path-input"
            value={perKeyColorsFilePath}
            onChange={e => onPerKeyColorsFilePathChange?.(e.target.value)}
            placeholder="C:\…\keymaps\vial\per_key_colors.c"
            spellCheck={false}
          />
          <button onClick={handleBrowse}>Browse…</button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-label">Tap Dance C Output</div>
        <div className="settings-desc">
          Path where "Generate C code" saves <code>tap_dance_keys.c</code>.
          Add <code>#include "tap_dance_keys.c"</code> to your <code>keymap.c</code> once,
          after the shared TD type definitions.
        </div>
        <div className="settings-path-row">
          <input
            type="text"
            className="settings-path-input"
            value={tapDanceFilePath}
            onChange={e => onTapDanceFilePathChange?.(e.target.value)}
            placeholder="C:\…\keymaps\vial\tap_dance_keys.c"
            spellCheck={false}
          />
          <button onClick={handleTdBrowse}>Browse…</button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-label">Visible Tabs</div>
        <label>
          <input
            type="checkbox"
            checked={!hiddenTabs.lighting}
            onChange={e => onHiddenTabsChange?.({ ...hiddenTabs, lighting: !e.target.checked })}
          />{' '}
          Lighting
        </label>
        <label>
          <input
            type="checkbox"
            checked={!hiddenTabs.tapdance}
            onChange={e => onHiddenTabsChange?.({ ...hiddenTabs, tapdance: !e.target.checked })}
          />{' '}
          Tap Dance
        </label>
      </div>

      <div className="settings-group">
        <div className="settings-group-label">Debug</div>
        <label>
          <input
            type="checkbox"
            checked={showDebugLog}
            onChange={(e) => onToggleDebugLog?.(e.target.checked)}
          />{' '}
          Show debug log
        </label>
        <label className={`settings-sub-option${showDebugLog ? '' : ' disabled'}`}>
          <input
            type="checkbox"
            checked={verboseDebug}
            disabled={!showDebugLog}
            onChange={(e) => onToggleVerboseDebug?.(e.target.checked)}
          />{' '}
          Verbose logging
        </label>
        <label className={`settings-sub-option${showDebugLog ? '' : ' disabled'}`}>
          <input
            type="checkbox"
            checked={showScanLog}
            disabled={!showDebugLog}
            onChange={(e) => onToggleShowScanLog?.(e.target.checked)}
          />{' '}
          Device scan messages
        </label>
      </div>
    </div>
  );
}
