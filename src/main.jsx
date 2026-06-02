// src/main.jsx — Vite/React entry point
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './components/components.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
