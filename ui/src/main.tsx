import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mochi/contracts/mochi.css';
import './app.css';
import './motion.css';
import './thread.css';
import './artifacts.css';
import './entity.css';
import './print.css';
import './reports.css';
import { TopBar, useRoute } from './components/shell.tsx';
import { Tickets } from './screens/Tickets.tsx';
import { Overview } from './screens/Overview.tsx';
import { Report } from './screens/Report.tsx';
import { Reports } from './screens/Reports.tsx';
import { Chat } from './screens/Chat.tsx';
import { Preview } from './screens/Preview.tsx';
import { Login } from './screens/Login.tsx';

document.documentElement.dataset.theme = 'light'; // light only; no switcher

function App() {
  const r = useRoute();
  if (location.hash.startsWith('#/login')) return <Login />; // the sign-in gate (api.ts sends 401s here)
  const current = r.name === 'preview' ? '' : r.name === 'reports' ? 'report' : r.name;
  return (
    <div className="mb-app">
      <TopBar current={current} working={r.name === 'tickets'} />
      <div className="mb-main">
        {r.name === 'tickets' && <Tickets />}
        {r.name === 'overview' && <Overview />}
        {r.name === 'report' && <Report key={`${r.id}@${r.version}`} id={r.id} version={r.version} asOf={r.asOf} kind={r.kind} />}
        {r.name === 'reports' && <Reports id={r.id} version={r.version} asOf={r.asOf} />}
        {r.name === 'chat' && <Chat />}
        {r.name === 'preview' && <Preview />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
