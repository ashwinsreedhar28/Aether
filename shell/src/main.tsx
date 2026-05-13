import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Tell main process the renderer is mounted so the splash → reveal
// sequence can fire. Watchdog in main covers the case where this
// never sends (renderer crash, dev-server race).
window.homeOS.signalReady()
