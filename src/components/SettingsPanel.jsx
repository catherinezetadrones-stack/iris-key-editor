// components/SettingsPanel.jsx
import React from 'react';

export default function SettingsPanel() {
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
      </div>
    </div>
  );
}
