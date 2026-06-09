import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import './FirmwarePanel.css';

// ── Collapsible section ───────────────────────────────────────────────────────

function Collapsible({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`fw-collapsible${open ? ' open' : ''}`}>
      <button className="fw-collapsible-btn" onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className="fw-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="fw-collapsible-body">{children}</div>}
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────

function Badge({ label, variant }) {
  return <span className={`fw-badge fw-badge-${variant}`}>{label}</span>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FirmwarePanel({ device, onBootloader }) {
  const [vialStatus, setVialStatus]     = useState(null);
  const [dfuPresent, setDfuPresent]     = useState(false);
  const [firmwarePath, setFirmwarePath] = useState('');
  const [flashing, setFlashing]         = useState(false);
  const [flashResult, setFlashResult]   = useState(null); // { ok: bool, msg: string }
  const [log, setLog]                   = useState([]);
  const [qmkInfo, setQmkInfo]           = useState(null); // null = detecting
  const [compiling, setCompiling]       = useState(false);
  const logBodyRef                      = useRef(null);

  const addLog = (msg) => setLog(prev => [...prev, msg]);

  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [log]);

  const refreshStatus = useCallback(async () => {
    if (!device) return;
    try {
      const vs = await invoke('detect_vial');
      setVialStatus(vs);
    } catch { setVialStatus(null); }
    try {
      const dfu = await invoke('check_dfu_device');
      setDfuPresent(dfu);
    } catch { setDfuPresent(false); }
  }, [device]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    invoke('detect_qmk')
      .then(setQmkInfo)
      .catch(() => setQmkInfo({ found: false }));
  }, []);

  const handleJumpBootloader = async () => {
    setFlashResult(null);
    addLog('Requesting bootloader jump…');
    try {
      await onBootloader();
    } catch (err) {
      addLog(`Jump failed: ${err}`);
      return;
    }
    addLog('Command sent. Keyboard should be entering DFU mode…');
    addLog('Waiting for DFU device to appear (up to 20 s)…');

    // Poll for up to 20 s — STM32 re-enumeration can take several seconds.
    let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try { found = await invoke('check_dfu_device'); } catch { /* dfu-util not installed */ }
    }

    setDfuPresent(found);

    if (found) {
      addLog('DFU device detected — keyboard is ready to flash.');
      return;
    }

    // Not found — run the lister and show its raw output so the user
    // can see exactly what dfu-util sees (or doesn't).
    addLog('DFU device not found after 20 s. Running dfu-util -l for diagnosis…');
    try {
      const raw = await invoke('list_dfu_devices');
      if (raw) {
        addLog('--- dfu-util -l output ---');
        raw.split('\n').forEach(l => addLog(l));
        addLog('--- end ---');
      } else {
        addLog('dfu-util -l returned no output (no DFU devices visible).');
      }
    } catch (err) {
      addLog(`dfu-util not available: ${err}`);
      addLog('Install dfu-util: open PowerShell as Admin → choco install dfu-util');
      return;
    }

    addLog(
      'Most likely cause on Windows: the Zadig USB driver is not installed. ' +
      'Open the "Windows Setup" guide below and follow the Zadig steps, ' +
      'then try again. The keyboard remains in DFU mode until you unplug it.'
    );
  };

  const handleCompile = async () => {
    setCompiling(true);
    setFlashResult(null);
    addLog('Starting QMK compile for keebio/iris_lm/k1 vial…');

    // Register listeners before invoking so no output lines are missed.
    // unlistenDone uses `let` so the callback can reference it after assignment.
    const unlistenOutput = await listen('compile-output', (event) => {
      if (event.payload.trim()) addLog(event.payload);
    });

    let unlistenDone;
    unlistenDone = await listen('compile-done', (event) => {
      unlistenOutput();
      unlistenDone?.();
      const result = event.payload;
      if (result.success) {
        addLog('Compile successful.');
        if (result.bin_path) {
          setFirmwarePath(result.bin_path);
          addLog(`Firmware ready: ${result.bin_path}`);
        } else {
          addLog('Warning: .bin not found in expected output path — select it manually below.');
        }
      } else {
        addLog('Compile failed — see output above.');
      }
      setCompiling(false);
    });

    try {
      await invoke('compile_firmware', {
        qmkHome: qmkInfo?.qmk_home || null,
      });
    } catch (err) {
      unlistenOutput();
      unlistenDone?.();
      addLog(`Compile error: ${err}`);
      setCompiling(false);
    }
  };

  const handlePickFile = async () => {
    try {
      const path = await invoke('pick_firmware_file');
      if (path) {
        setFirmwarePath(path);
        setFlashResult(null);
        addLog(`Selected: ${path}`);
      }
    } catch (err) {
      addLog(`File picker error: ${err}`);
    }
  };

  const handleFlash = async () => {
    if (!firmwarePath) return;
    setFlashing(true);
    setFlashResult(null);
    addLog(`Flashing ${firmwarePath.split(/[\\/]/).pop()}…`);
    try {
      await invoke('flash_firmware', { firmwarePath });
      addLog('Flash complete. Keyboard is resetting.');
      setFlashResult({ ok: true, msg: 'Flash successful — keyboard is restarting.' });
      setDfuPresent(false);
    } catch (err) {
      addLog(`Flash failed: ${err}`);
      setFlashResult({ ok: false, msg: String(err) });
    } finally {
      setFlashing(false);
    }
  };

  const canFlash = firmwarePath && !flashing && !compiling;

  return (
    <div className="fw-panel">

      {/* ── Firmware status ─────────────────────────────────────────────── */}
      <section className="fw-section">
        <h3 className="fw-section-title">Firmware Status</h3>
        <div className="fw-status-row">
          <span className="fw-status-label">Keyboard</span>
          {device
            ? <span className="fw-status-value">{device.name}</span>
            : <Badge label="No device" variant="muted" />}
        </div>
        <div className="fw-status-row">
          <span className="fw-status-label">Protocol</span>
          {!device
            ? <Badge label="—" variant="muted" />
            : vialStatus === null
            ? <Badge label="Detecting…" variant="muted" />
            : vialStatus.supported
            ? <Badge label="VIAL" variant="success" />
            : <Badge label="VIA only" variant="warn" />}
        </div>
        {vialStatus && !vialStatus.supported && (
          <p className="fw-upgrade-hint">
            Flash VIAL firmware to unlock Tap Dance, Combos, and QMK settings.
          </p>
        )}
        {vialStatus?.supported && (
          <p className="fw-upgrade-hint success">
            VIAL firmware active — Tap Dance and Combos tabs are available.
          </p>
        )}
      </section>

      {/* ── Flash firmware ──────────────────────────────────────────────── */}
      <section className="fw-section">
        <h3 className="fw-section-title">Flash Firmware</h3>

        <div className="fw-steps">

          <div className="fw-step">
            <div className="fw-step-num">1</div>
            <div className="fw-step-body">
              <div className="fw-step-title">Enter Bootloader Mode</div>
              <p className="fw-step-desc">
                The Iris-LM uses an STM32G431 MCU. To enter DFU mode, <strong>hold
                the reset button on the PCB for 1 second then release</strong> — the
                button is accessible through the hole in the bottom plate. The keyboard
                will appear as an STM32 BOOTLOADER USB device.
              </p>
              <p className="fw-step-desc">
                Alternatively, use the button below to trigger a software reset (only
                works when the keyboard is connected and VIA/VIAL is running):
              </p>
              <div className="fw-step-row">
                <button onClick={handleJumpBootloader} disabled={!device || flashing}>
                  Jump to Bootloader
                </button>
                <button
                  onClick={async () => {
                    addLog('Checking for DFU device…');
                    try {
                      const raw = await invoke('list_dfu_devices');
                      const found = await invoke('check_dfu_device');
                      setDfuPresent(found);
                      addLog(found ? 'DFU device found.' : 'No DFU device found.');
                      if (raw) raw.split('\n').forEach(l => addLog(l));
                    } catch (err) {
                      addLog(`dfu-util error: ${err}`);
                    }
                  }}
                  disabled={flashing}
                  title="Manually re-check whether a DFU device is visible"
                >
                  Check Again
                </button>
                {dfuPresent && <Badge label="DFU device detected" variant="success" />}
              </div>
              {!dfuPresent && (
                <p className="fw-step-hint">
                  DFU device not detected. Make sure the STM32 driver is installed —
                  see the Windows Setup guide below. The keyboard stays in DFU mode
                  until unplugged, so install the driver now then click Check Again.
                </p>
              )}
            </div>
          </div>

          <div className="fw-step">
            <div className="fw-step-num">2</div>
            <div className="fw-step-body">
              <div className="fw-step-title">Compile Firmware</div>
              {qmkInfo === null ? (
                <p className="fw-step-desc">Checking for QMK CLI…</p>
              ) : qmkInfo.found ? (
                <p className="fw-step-desc">
                  QMK CLI found{qmkInfo.version ? ` — ${qmkInfo.version}` : ''}.
                  Compiles <code>keebio/iris_lm/k1 vial</code> using{' '}
                  {qmkInfo.qmk_home
                    ? <code>{qmkInfo.qmk_home}</code>
                    : 'the configured QMK home'}.
                </p>
              ) : (
                <p className="fw-step-desc">
                  QMK CLI not found — skip to step 3 to select a pre-built .bin file.
                  To enable compilation, install QMK MSYS2 from <strong>qmk.fm/getting-started</strong>.
                </p>
              )}
              {qmkInfo?.found && (
                <div className="fw-step-row">
                  <button
                    onClick={handleCompile}
                    disabled={compiling || flashing}
                    className={!compiling && !flashing ? 'primary' : ''}
                  >
                    {compiling ? 'Compiling…' : 'Compile Firmware'}
                  </button>
                  {!compiling && firmwarePath && (
                    <Badge label="Ready to flash" variant="success" />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="fw-step">
            <div className="fw-step-num">3</div>
            <div className="fw-step-body">
              <div className="fw-step-title">Select Firmware File</div>
              <p className="fw-step-desc">
                Choose a .hex or .bin firmware file for the Iris-LM (QMK, VIAL, or other).
                If you compiled above, the file is already selected.
              </p>
              <div className="fw-step-row">
                <button onClick={handlePickFile} disabled={flashing}>Browse…</button>
                {firmwarePath && (
                  <span className="fw-file-name" title={firmwarePath}>
                    {firmwarePath.split(/[\\/]/).pop()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="fw-step">
            <div className="fw-step-num">4</div>
            <div className="fw-step-body">
              <div className="fw-step-title">Flash</div>
              <p className="fw-step-desc">
                Writes the firmware using dfu-util. When complete, unplug and replug
                the keyboard to boot into the new firmware.
              </p>
              <button
                className={canFlash ? 'primary' : ''}
                onClick={handleFlash}
                disabled={!canFlash}
              >
                {flashing ? 'Flashing…' : 'Flash Firmware'}
              </button>
              {flashResult && (
                <div className={`fw-flash-result ${flashResult.ok ? 'ok' : 'err'}`}>
                  {flashResult.msg}
                </div>
              )}
            </div>
          </div>

        </div>

        {log.length > 0 && (
          <div className="fw-log">
            <div className="fw-log-title">
              <span>Log</span>
              <button className="fw-log-clear" onClick={() => setLog([])}>Clear</button>
            </div>
            <div className="fw-log-body" ref={logBodyRef}>
              {log.map((l, i) => <div key={i} className="fw-log-line">{l}</div>)}
            </div>
          </div>
        )}
      </section>

      {/* ── Setup guide ─────────────────────────────────────────────────── */}
      <Collapsible title="Windows Setup — Installing the STM32 Driver">
        <div className="fw-guide-body">
          <p>
            Windows needs a special driver to communicate with the STM32 bootloader.
            This is a one-time setup that covers both halves of the keyboard.
          </p>

          <h4>Option A — QMK Toolbox (easiest)</h4>
          <p>
            Keebio's own docs recommend QMK Toolbox, which installs the STM32 driver
            automatically:
          </p>
          <ol className="fw-guide-list">
            <li>Download QMK Toolbox from github.com/qmk/qmk_toolbox/releases</li>
            <li>Open QMK Toolbox, go to <strong>Tools → Install Drivers</strong></li>
            <li>Click Yes/Install for the STM32 Bootloader driver when prompted</li>
            <li>
              Put the keyboard in bootloader mode (hold PCB reset button 1 second).
              QMK Toolbox shows a yellow "connected" line when it sees the DFU device.
            </li>
            <li>
              Come back to this app — click <strong>Check Again</strong> above and
              dfu-util should now detect the keyboard.
            </li>
          </ol>

          <h4>Option B — Zadig (manual)</h4>
          <ol className="fw-guide-list">
            <li>
              Put the keyboard in bootloader mode first (hold PCB reset button 1 second),
              then immediately open Zadig — the device disappears if you wait too long.
            </li>
            <li>
              In Zadig go to <strong>Options → List All Devices</strong> and look for
              <strong> STM32 BOOTLOADER</strong> in the dropdown.
            </li>
            <li>
              Select it, choose <strong>WinUSB</strong> as the driver, click
              <strong> Replace Driver</strong>.
            </li>
            <li>Click Check Again above — the DFU device should now be visible.</li>
          </ol>

          <p className="fw-note">
            The driver is installed per VID:PID (0483:DF11), so it applies to both
            halves automatically — you only need to do this once.
          </p>
        </div>
      </Collapsible>

      <Collapsible title="Getting VIAL Firmware for the Iris-LM">
        <div className="fw-guide-body">
          <p>
            VIAL extends VIA with dynamic Tap Dance, Combos, and QMK settings — all editable
            live without recompiling. Your keymaps and macros survive the firmware flash.
            The Iris-LM is fully supported in <code>vial-kb/vial-qmk</code>.
          </p>

          <h4>Step 1 — identify your switch variant</h4>
          <p>
            The Iris-LM has two hardware variants with separate firmware targets:
          </p>
          <div className="fw-variant-table">
            <div className="fw-variant-row fw-variant-header">
              <span>Variant</span><span>Switches</span><span>QMK target</span>
            </div>
            <div className="fw-variant-row">
              <span><strong>Iris LM-G</strong></span>
              <span>Gateron KS-33 low-profile</span>
              <span><code>keebio/iris_lm/g1</code></span>
            </div>
            <div className="fw-variant-row">
              <span><strong>Iris LM-K</strong></span>
              <span>Kailh Choc V1 &amp; V2</span>
              <span><code>keebio/iris_lm/k1</code></span>
            </div>
          </div>

          <h4>Step 2 — build the VIAL firmware</h4>
          <ol className="fw-guide-list">
            <li>
              Clone <code>vial-kb/vial-qmk</code> and set up the QMK build environment
              (see QMK docs — one-time setup).
            </li>
            <li>
              Run the compile command for your variant:
              <pre className="fw-code"># Iris LM-G (Gateron KS-33){'\n'}qmk compile -kb keebio/iris_lm/g1 -km vial{'\n\n'}# Iris LM-K (Kailh Choc){'\n'}qmk compile -kb keebio/iris_lm/k1 -km vial</pre>
            </li>
            <li>
              The output .hex appears in <code>~/qmk_firmware/.build/</code> — the filename
              will be something like <code>keebio_iris_lm_g1_vial.hex</code>.
            </li>
          </ol>

          <h4>Step 3 — flash both halves</h4>
          <p>
            Each half has its own MCU and must be flashed individually using the same
            .hex file. Disconnect the TRRS cable between halves before flashing.
          </p>
          <ol className="fw-guide-list">
            <li>Plug in <strong>left half only</strong> via USB (TRRS disconnected)</li>
            <li>Hold the PCB reset button for 1 second to enter DFU mode</li>
            <li>Select the firmware file and click Flash in this app</li>
            <li>Repeat steps 1–3 for the <strong>right half</strong></li>
            <li>Reconnect the TRRS cable — done</li>
          </ol>

          <h4>After flashing</h4>
          <p className="fw-note">
            This firmware build runs with <code>VIAL_INSECURE</code> — all features
            (Tap Dance, Combos, Key Test) are available immediately after flashing with
            no unlock step required.
          </p>
        </div>
      </Collapsible>

    </div>
  );
}
