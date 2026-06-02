// components/DebugConsole.jsx
import React, { useRef, useEffect } from 'react';

export default function DebugConsole({ logs }) {
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="debug-console">
      <h3>DEBUG LOG</h3>
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
