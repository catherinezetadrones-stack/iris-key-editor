import React from 'react';

export default function SettingsPanel({
  showDebugLog = false,
  onToggleDebugLog,
  verboseDebug = false,
  onToggleVerboseDebug,
  showScanLog = false,
  onToggleShowScanLog,
}) {
  return (
    <div className="settings-panel">
      <h3>SETTINGS</h3>
      <div className="settings-group">
        <label>
          <input type="checkbox" defaultChecked /> Auto-save changes
        </label>
        <label>
          <input type="checkbox" defaultChecked /> Show advanced options
        </label>
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
