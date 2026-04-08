import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Disable Chromium browser-only behaviors that feel wrong inside Electron.
// Gated on window.api so pure-browser Vite dev keeps right-click → Inspect
// and normal file-drop semantics.
if (window.api) {
  window.addEventListener('dragover', e => e.preventDefault())
  window.addEventListener('drop', e => e.preventDefault())
  window.addEventListener('contextmenu', e => e.preventDefault())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
