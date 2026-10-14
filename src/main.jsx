import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import './App.css'
/* Last import on purpose: the motion policy has to outrank the animations it
   governs. See src/motion.css. */
import './motion.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* One place gates every framer-motion transform, scale and blur in the app.
        `user` drops the movement and keeps the opacity cross-fade, so a state
        change still reads under prefers-reduced-motion. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
