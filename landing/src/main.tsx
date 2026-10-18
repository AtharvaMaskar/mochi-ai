import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mochi/contracts/mochi.css';
import './landing.css';
import './sections.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
