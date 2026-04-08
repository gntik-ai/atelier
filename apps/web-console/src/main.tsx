import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import router from '@/router'
import '@/styles/globals.css'

declare const __APP_VERSION__: string

const versionMeta = document.querySelector('meta[name="version"]')
if (versionMeta) {
  versionMeta.setAttribute('content', __APP_VERSION__)
}

console.info('In Falcone Console', __APP_VERSION__)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
