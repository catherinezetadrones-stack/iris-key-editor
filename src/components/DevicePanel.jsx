// components/DevicePanel.jsx
import React from 'react';
import { open } from '@tauri-apps/api/dialog';

export default function DevicePanel({
  devices,
  selectedDevice,
  onSelectDevice,
  onBootloader,
  onFlash,
  isFlashing,
}) {
  // Firmware UPDATE only (not needed for remapping). Uses the Tauri dialog API
  // to get a real filesystem path (browser File objects have no .path).
  const handleFlash = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Firmware', extensions: ['bin', 'hex', 'uf2'] }],
    });
    if (typeof path === 'string') onFlash(path);
  };

  return (
    <div className="device-panel">
      <h3>DEVICE</h3>
      {devices.length > 0 ? (
        <>
          <select
            value={selectedDevice?.port || ''}
            onChange={(e) => {
              const dev = devices.find((d) => d.port === e.target.value);
              onSelectDevice(dev);
            }}
          >
            {devices.map((dev) => (
              <option key={dev.port} value={dev.port}>
                {dev.name}
              </option>
            ))}
          </select>
          <div className="device-actions">
            <button onClick={onBootloader}>BOOTLOADER</button>
            <button onClick={handleFlash} disabled={isFlashing} className="primary">
              {isFlashing ? 'FLASHING...' : 'FLASH FW'}
            </button>
          </div>
        </>
      ) : (
        <p style={{ color: 'var(--text-secondary)' }}>No devices found</p>
      )}
    </div>
  );
}
