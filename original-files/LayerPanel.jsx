// components/LayerPanel.jsx
import React from 'react';

export default function LayerPanel({ currentLayer, maxLayers, onLayerChange }) {
  return (
    <div className="layer-panel">
      <h3>LAYERS</h3>
      <div className="layer-buttons">
        {Array.from({ length: maxLayers }).map((_, idx) => (
          <button
            key={idx}
            className={`layer-btn ${currentLayer === idx ? 'active' : ''}`}
            onClick={() => onLayerChange(idx)}
          >
            {idx}
          </button>
        ))}
      </div>
    </div>
  );
}
