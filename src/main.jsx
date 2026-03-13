import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, color: '#fef08a', fontFamily: 'monospace', fontSize: 12 }}>
          <p>Something went wrong.</p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message ?? String(this.state.error)}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML = '<div style="padding:16px;color:red;">No #root element found.</div>'
} else {
  try {
    const root = createRoot(rootEl)
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    )
  } catch (e) {
    rootEl.innerHTML = `<div style="padding:16px;color:#fef08a;font-family:monospace;font-size:12px;">Failed to mount: ${e?.message ?? String(e)}</div>`
  }
}
