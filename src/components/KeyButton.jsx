// components/KeyButton.jsx
// Individual key component with press feedback

import React, { useState } from 'react';
import './KeyButton.css';

export default function KeyButton({ keyName, subLabel, isSelected, onClick, isThumb = false, glowColor }) {
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

  const glowStyle = glowColor && !isSelected ? {
    boxShadow: `0 0 0 2px ${glowColor}, 0 0 10px 2px ${glowColor}66, 0 4px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)`,
    borderColor: glowColor,
  } : undefined;

  return (
    <button
      className={`key-button ${isSelected ? 'selected' : ''} ${isPressed ? 'pressed' : ''} ${isThumb ? 'thumb' : ''}`}
      style={glowStyle}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      title={keyName}
    >
      {subLabel && <span className="key-sublabel">{subLabel}</span>}
      <span className="key-label">{displayName}</span>
      {isSelected && <span className="key-indicator">→</span>}
    </button>
  );
}
