import { useEffect, useState } from 'react';
import { Mochi } from '@mochi/ui/mochi';
import bench from 'virtual:bench';
import { Sky } from './sky/Sky';
import { setActive } from './sky/store';
import { Button, Ico } from './parts/ui';
import { LINKS } from './data';
import { Hero } from './sections/Hero';
import { MeetMochi } from './sections/MeetMochi';
import { Ask } from './sections/Ask';
import { Demo } from './sections/Demo';
import { Night } from './sections/Night';
import { Awake } from './sections/Awake';
import { ReceiptsSection } from './sections/Receipts';
import { Tiers } from './sections/Tiers';
import { Bench } from './sections/Bench';
import { BuiltFor, Faq, Cta, Footer } from './sections/Close';

// Lucide paths (github, menu, x), inlined: the landing carries no icon package.
const GITHUB = ['M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4', 'M9 18c-4.51 2-5-2-7-2'];
const MENU = ['M4 6h16', 'M4 12h16', 'M4 18h16'], X = ['M18 6 6 18', 'm6 6 12 12'];

/** Resizable navbar (aceternity.md §9): full width at the top; past 80px it becomes a centred floating pill. */
function Nav() {
  const [pill, setPill] = useState(false), [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setPill(scrollY > 80);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    on(); addEventListener('scroll', on, { passive: true }); addEventListener('keydown', esc);
    return () => { removeEventListener('scroll', on); removeEventListener('keydown', esc); };
  }, []);
  const close = () => setOpen(false);
  const links = <><a href="#night" onClick={close}>How it works</a><a href="#demo" onClick={close}>Demo</a>{bench && <a href="#bench" onClick={close}>Benchmark</a>}<a href={LINKS.blog}>Blog</a></>;
  return (
    <header className="nav" data-pill={pill || undefined} data-open={open || undefined}>
      <div className="nav-body">
        <a className="brand" href="#top" aria-label="Mochi Brain, back to top">
          <Mochi size="xs" still label="Mochi" /><span className="t-mochi-wordmark wm">mochi</span><span className="t-title">Brain</span>
        </a>
        <nav className="nav-links t-label" aria-label="Sections">{links}</nav>
        <div className="nav-end">
          <a className="nav-icon" href={LINKS.repo} aria-label="Code on GitHub"><Ico d={GITHUB} /></a>
          <Button variant="primary" size="sm" href={LINKS.desk}>Open the platform</Button>
          <button type="button" className="nav-icon nav-menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="nav-sheet" onClick={() => setOpen((o) => !o)}><Ico d={open ? X : MENU} /></button>
        </div>
      </div>
      <nav id="nav-sheet" className="nav-sheet t-title" aria-label="Sections" hidden={!open}>
        {links}<a href={LINKS.repo}>Code on GitHub</a>
      </nav>
    </header>
  );
}

/** The section at the viewport's centre owns the sky. */
function useSkyDirector() {
  useEffect(() => {
    let raf = 0;
    const pick = () => {
      raf = 0;
      const mid = innerHeight / 2;
      for (const el of document.querySelectorAll<HTMLElement>('[data-sky]')) {
        const r = el.getBoundingClientRect();
        if (r.top <= mid && r.bottom > mid) { setActive(el.dataset.sky!); return; }
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(pick); };
    pick(); addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); };
  }, []);
}

export function App() {
  useSkyDirector();
  return (
    <>
      <Sky />
      <Nav />
      <main>
        <Hero />
        <MeetMochi />
        <Ask />
        <Demo />
        <Night />
        <Awake />
        <ReceiptsSection />
        <Tiers />
        {bench && <Bench results={bench} />}
        <BuiltFor />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
