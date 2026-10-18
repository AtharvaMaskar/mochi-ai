import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mochi/contracts/mochi.css';
import './app.css';
import './motion.css';
import './thread.css';
import './artifacts.css';
import './entity.css';
import { TopBar, useRoute } from './components/shell.tsx';
import { Tickets } from './screens/Tickets.tsx';
import { Overview } from './screens/Overview.tsx';
import { Report } from './screens/Report.tsx';
import { Chat } from './screens/Chat.tsx';
import { Preview } from './screens/Preview.tsx';

document.documentElement.dataset.theme = 'light'; // light only; no switcher

function App() {
  const r = useRoute();
  const current = r.name === 'preview' ? '' : r.name;
  return (
    <div className="mb-app">
      <TopBar current={current} working={r.name === 'tickets'} />
      <div className="mb-main">
        {r.name === 'tickets' && <Tickets />}
        {r.name === 'overview' && <Overview />}
        {r.name === 'report' && <Report key={`${r.id}@${r.version}`} id={r.id} version={r.version} asOf={r.asOf} kind={r.kind} />}
        {r.name === 'chat' && <Chat />}
        {r.name === 'preview' && <Preview />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
