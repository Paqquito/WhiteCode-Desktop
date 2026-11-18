import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { applyBrand, BRAND } from './brand.js'

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root introuvable dans index.html')
}

document.title = BRAND.product
applyBrand()

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
