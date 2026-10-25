import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// StrictMode is deliberately omitted: it double-invokes effects in dev,
// which tears down and recreates the WebGL context on the same canvas
// and leaves the drawing buffer stuck at 0x0.
createRoot(document.getElementById('root')).render(<App />)
