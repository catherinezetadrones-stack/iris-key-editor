// components/KeyButton.jsx
// Individual key component with press feedback

import React, { useState } from 'react';
import './KeyButton.css';

export default function KeyButton({ keyName, isSelected, onClick, isThumb = false }) {
  const [isPressed, setIsPressed] = useState(false);

  const handleMouseDown = () => {
    setIsPressed(true);
  };

  const handleMouseUp = () => {
    setIsPressed(false);
  };

  const handleClick = () => {
    onClick?.();
  };

  // Abbreviate long key names for display
  const displayName = keyName.replace('KC_', '').substring(0, 8);

  return (
    <button
      className={`key-button ${isSelected ? 'selected' : ''} ${isPressed ? 'pressed' : ''} ${isThumb ? 'thumb' : ''}`}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      title={keyName}
    >
      <span className="key-label">{displayName}</span>
      {isSelected && <span className="key-indicator">→</span>}
    </button>
  );
}
