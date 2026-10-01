import React from 'react';
import { createRoot } from 'react-dom/client';
import type { DesktopBridge } from '../../shared/contracts';
import { App } from './App';
import './styles/index.css';
declare global {
  interface Window {
    desktop: DesktopBridge;
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
