// src/main.jsx — Vite/React entry point
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './components/components.css';

class ErrorBoundary extends React.Component {
  state = { error: null };
  componentDidCatch(error, info) { this.setState({ error, info }); }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#ff4757', padding: 24, background: '#0a0e27', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 13 }}>
          <div style={{ color: '#00d9ff', marginBottom: 8, fontSize: 16 }}>Runtime Error</div>
          {String(this.state.error)}{'\n\n'}{this.state.error?.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
