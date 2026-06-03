// components/DebugConsole.jsx
import React, { useRef, useEffect } from 'react';

export default function DebugConsole({ logs, onClear }) {
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="debug-console">
      <div className="debug-console-header">
        <h3>DEBUG LOG</h3>
        <button className="debug-clear-btn" onClick={onClear} disabled={logs.length === 0}>
          Clear
        </button>
      </div>
      <div className="log-container">
        {logs.map((log, idx) => (
          <div key={idx} className="log-entry">
            {log}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
