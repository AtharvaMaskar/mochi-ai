import { useEffect } from 'react';
import { Mochi } from '@mochi/ui/mochi';
import bench from 'virtual:bench';
import { Sky } from './sky/Sky';
import { setActive } from './sky/store';
import { Button } from './parts/ui';
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

function Nav() {
  return (
    <header className="nav">
      <a className="brand" href="#top" aria-label="Mochi Brain, back to top">
        <Mochi size="xs" still label="Mochi" /><span className="t-mochi-wordmark wm">mochi</span><span className="t-title">Brain</span>
      </a>
      <nav className="nav-links t-label" aria-label="Sections">
        <a href="#night">How it works</a><a href="#demo">Demo</a>{bench && <a href="#bench">Benchmark</a>}<a href={LINKS.blog}>Blog</a>
      </nav>
      <div className="nav-end">
        <a className="tlink t-label" href={LINKS.repo}>GitHub</a>
        <Button variant="primary" size="sm" href={LINKS.desk}>Open the platform</Button>
      </div>
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
