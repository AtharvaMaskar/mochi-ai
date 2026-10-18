# Aceternity UI — research for the Mochi Brain landing sky

Researched 2026-10-18. Source: https://ui.aceternity.com/components (113 component pages, all fetched),
plus each component's shadcn registry JSON at `https://ui.aceternity.com/registry/<name>.json`, which holds
the full source (e.g. https://ui.aceternity.com/registry/shooting-stars.json). Dependency and technique columns
come from reading that source, not from the marketing copy. Line counts are source lines.

Scope reminder (CLAUDE.md, landing-page exception, 2026-10-18): only the landing page may animate the sky;
it must use design-system tokens, be GPU-light, pause off-screen, and be fully still under
`prefers-reduced-motion`. Product surfaces (desk, chat, reports) stay flat. No blue-purple gradients.

Legend: **tech** = canvas (2D), WebGL (raw or three.js), SVG, CSS (keyframes/gradients/transforms),
motion (= `motion/react`, ex framer-motion). **Free** = source shown publicly and installable.
Every one of the 113 component pages is Free. Pro ("All-Access") content is the *blocks* and *templates*,
listed at the end of section 1.

---

## 1. Index (113 free components, grouped as the site's sidebar groups them)

URL pattern for every row: `https://ui.aceternity.com/components/<slug>`.

### Backgrounds & Effects (31)
| slug | what it does | tech | deps | lines |
|---|---|---|---|---|
| shooting-stars-and-stars-background | twinkling dot starfield + one diagonal streak at a time | canvas (stars) + SVG rect (streak), rAF | none | 289 |
| cloud-shader | procedural drifting cumulus clouds on a 2-stop sky, sun glow, cirrus | raw WebGL1 fragment shader | none | 368 |
| aurora-background | soft banded light curtains drifting slowly | CSS repeating-linear-gradient + blur + mix-blend-difference, 60s keyframe | none | 61 |
| background-gradient-animation | 5 big radial blobs orbiting + pointer blob, goo-blurred | CSS keyframes + SVG goo filter + blend modes | none | 181 |
| noise-background | radial gradients wandering inside a box + noise.webp overlay (button/card bg) | motion (useAnimationFrame, useMotionTemplate) | motion | 231 |
| wavy-background | 5 thick blurred noise-driven sine bands | canvas 2D + `ctx.filter blur` | simplex-noise | 132 |
| vortex | particle swirl along a 3D-noise flow field, hue-shifted | canvas 2D | simplex-noise, motion | 268 |
| sparkles | configurable twinkling particle field | tsParticles | @tsparticles/react, engine, slim, motion | 434 |
| meteors | N diagonal 1px streaks with 50px gradient tails, CSS loop | CSS keyframes (+motion fade-in) | motion | 44 |
| glowing-stars-effect | 18x6 dot grid in a card; 5 random dots glow every 3s | motion + setInterval | motion | 158 |
| dotted-glow-background | dot grid; dots pulse opacity and glow at random speeds | canvas 2D, rAF | none | 320 |
| background-beams | ~50 SVG curved paths with travelling gradient highlights | SVG + motion animated linearGradient | motion | 141 |
| background-beams-with-collision | vertical beams fall and "explode" into particles at the floor | motion + DOM collision checks | motion | 259 |
| background-lines | SVG wave paths that draw/animate in a loop (height.app style) | SVG + motion pathLength | motion | 147 |
| background-boxes | huge skewed isometric grid of cells that flash colour on hover | DOM (150x100 motion.divs) + CSS skew | motion, mini-svg-data-uri | 76 |
| background-cubes-grid | 3D cube field rippling under the cursor; isometric or tilted-perspective variant | three.js (instanced) + JS wave sim | three, motion | 937 |
| background-ripple-effect | grid of cells; click sends a CSS ripple outward | CSS keyframes per cell | motion | 133 |
| background-gradient | animated conic/radial gradient border glow behind a card | motion | motion | 72 |
| chromatic-image | image with pointer-driven RGB split, band displacement, zoom and tilt | raw WebGL1 + CSS 3D transform | none | 336 |
| spotlight | one-shot SVG ellipse "stage light" sweeping in | SVG + CSS keyframe (2s, once) | none | 56 |
| spotlight-new | left+right layered radial light cones that sway | motion | motion | 128 |
| lamp-effect | Linear-style lamp: two conic gradients opening + glow bar | CSS conic gradients + motion width tween | motion | 104 |
| canvas-reveal-effect | dot matrix that ripples outward on hover (Clerk style) | three.js / R3F shader | three, @react-three/fiber | 308 |
| svg-mask-effect | circular cursor mask reveals a second layer | CSS mask-image + motion | motion | 83 |
| tracing-beam | vertical SVG line whose gradient segment tracks scroll | SVG + motion useScroll/useSpring | motion | 126 |
| grid-and-dot-backgrounds | static CSS grid / dot pattern with radial fade mask | CSS (linear/radial-gradient + mask) | none | snippet |
| glowing-effect | conic-gradient border that rotates toward the pointer (Cursor style) | CSS vars + motion animate() | motion, lucide-react | 190 |
| google-gemini-effect | 5 SVG paths drawing in with scroll (Gemini site) | SVG + motion pathLength | motion | 161 |
| webcam-pixel-grid | live webcam rendered as a pixel grid | canvas 2D + getUserMedia | none | 535 |
| images-badge | badge that fans out stacked images on hover | motion | none (motion import) | 177 |
| parallax-hero-images | images at different depths follow the mouse, blur-fade in | motion springs | motion | 188 |
| scales | repeating diagonal/horizontal/vertical hairline pattern | CSS repeating-linear-gradient | none | 81 |

### Card components (18)
| slug | what | tech | deps |
|---|---|---|---|
| 3d-card-effect | card tilts toward cursor; children pop forward on translateZ | CSS 3D transforms, plain JS | none |
| evervault-card | hover reveals random-character noise under a gradient mask | motion + SVG | motion |
| card-stack | cards rotate to the back of a stack on an interval | motion | motion |
| card-hover-effect | highlight pill slides to hovered card | motion layoutId | motion |
| wobble-card | card translates/scales with mouse | motion | motion |
| expandable-card | click card, expands to modal (layout animation) | motion | motion (inline source on page) |
| card-spotlight | radial spotlight following pointer + canvas-reveal dots | motion + WebGL (reuses canvas-reveal) | motion |
| focus-cards | hovered card sharp, siblings blur | CSS | none |
| infinite-moving-cards | marquee of testimonial cards | CSS keyframe (40s) | none |
| draggable-card | drag, tilt, bounce on bounds | motion | none |
| comet-card | Perplexity-Comet style 3D tilt with glare | motion | none |
| glare-card | Linear-style glare sheen on hover | CSS vars + pointer JS | none |
| direction-aware-hover | overlay slides in from the entry side | motion | motion |
| keyboard | macOS keyboard with key sounds | motion + SVG | motion, @tabler/icons-react |
| terminal | mac terminal, bash highlight, typewriter | plain React | none |
| tooltip-card | tooltip card follows pointer | motion | none |
| ascii-art | image to animated ASCII | canvas 2D | motion |
| pixelated-canvas | image pixelates/distorts under mouse (Tailwind site) | canvas 2D | none |

### Scroll & Parallax (5)
| slug | what | tech | deps |
|---|---|---|---|
| container-scroll-animation | tilted (rotateX 20°) device frame flattens as you scroll | motion useScroll/useTransform, CSS perspective | motion |
| macbook-scroll | image lifts out of a laptop screen and flies down on scroll (Fey.com) | motion + CSS 3D, big DOM keyboard | motion, @tabler/icons-react |
| hero-parallax | 3 rows of 5 product shots slide sideways, tilt flat, on scroll | motion useScroll + useSpring | motion |
| parallax-scroll | 3-column image grid, outer columns move up, middle down (also `parallax-scroll-2` with rotation) | motion useScroll | motion |
| sticky-scroll-reveal | sticky media panel swaps as text blocks scroll past | motion useScroll (container) | motion |

### Text (13)
| slug | what | tech | deps |
|---|---|---|---|
| text-generate-effect | words fade+unblur in one by one | motion stagger(0.2), 0.5s, blur 10px | motion |
| typewriter-effect | characters type out with cursor | motion | motion |
| flip-words | word swaps every 3s with blur/y transition | motion AnimatePresence | motion |
| layout-text-flip | flipping word resizes surrounding layout | motion layout | motion |
| container-text-flip | box width animates to each word | motion | none |
| encrypted-text | gibberish resolves into text | motion + rAF | motion |
| colourful-text | per-letter colour/blur/scale cycling | motion | none |
| squiggly-text | SVG turbulence displacement wobble | SVG filter + motion | none |
| canvas-text | colourful curved lines clipped to glyphs | canvas 2D | none |
| text-hover-effect | outline gradient follows cursor over big text (x.ai) | SVG + motion | motion |
| hero-highlight | dot background + text highlighter sweep | motion + CSS mask | motion, mini-svg-data-uri |
| text-reveal-card | mouse reveals second text under a wipe | motion | motion |
| text-flipping-board | Vestaboard split-flap characters | motion | motion |

### Buttons (6)
magnetic-button (spring drift toward cursor; motion) · noise-background (see above; used as button bg) ·
tailwindcss-buttons (static Tailwind class snippets; CSS) · hover-border-gradient (rotating gradient border; motion) ·
moving-border (dot of light orbits border via SVG path; motion) · stateful-button (loading then success check; motion+SVG).

### Loaders (3)
image-generation-loader (canvas scan with pixel grids and progress; canvas) · multi-step-loader (step list ticks off; motion+SVG) ·
loader (several small SVG/motion loaders).

### Navigation (8)
notch (floating pill, animated active state; motion) · floating-navbar (hides on scroll down; motion) · navbar-menu (mega-menu hover; motion) ·
sidebar (expand on hover; motion) · floating-dock (macOS dock magnification; motion) · tabs (sliding tab bg; motion + @radix-ui/react-tabs) ·
resizable-navbar (shrinks on scroll; motion) · sticky-banner (hides on scroll; motion+SVG).

### Inputs & Forms (4)
signup-form (shadcn inputs + hover glow; inline source) · placeholders-and-vanish-input (cycling placeholders; on submit text is
rasterised to canvas and dissolves into drifting pixels; canvas+motion) · file-upload (drag-drop with grid bg; motion, react-dropzone) ·
gooey-input (search pill expands via SVG goo filter; motion).

### Overlays & Popovers (4)
dither-shader (ordered dithering of images, interactive; canvas) · animated-modal (compound modal; motion) ·
animated-tooltip (avatar row; tooltip springs up and rotates with pointer x; motion) · link-preview (hover shows site screenshot; motion, radix hover-card).

### Carousels & Sliders (4)
images-slider (full-bleed keyboard slider; motion) · carousel (3D-ish slider; plain) · apple-cards-carousel (apple.com cards, expand; motion) ·
animated-testimonials (stacked photos rotate with quote; motion).

### Layout & Grid (3)
layout-grid (click to expand tile; motion layout) · bento-grid (static grid; CSS) · container-cover ("Cover": beams + speed lines on hover; motion+SVG).

### Data & Visualization (5)
github-globe (three-globe arcs; three, R3F, three-globe) · world-map (dotted map + animated great-circle-ish arcs; SVG+motion, dotted-map) ·
timeline (sticky year headers + scroll-filled beam; motion) · compare (before/after slider, optional autoplay, sparkles; motion) ·
code-block (react-syntax-highlighter wrapper).

### Cursor & Pointer (3)
following-pointer (custom cursor with label; motion) · pointer-highlight (box draws around text in view with a pointer; motion+SVG) ·
lens (zoom lens over any content; motion).

### 3D (3)
3d-globe (realistic globe, tooltips, avatars; three + drei + R3F) · 3d-pin (gradient pin rises on hover; motion) ·
3d-marquee (image grid rotated `rotateX(55deg) rotateZ(-45deg)`, columns drift ±100px over 10/15s; motion).

### Free sections (3)
feature-sections-free · cards-free · hero-sections-free (inline Tailwind snippets, no registry entry).

### Pro (paywalled) — only names are public
- **Shaders blocks** (https://ui.aceternity.com/blocks/shaders): Lines Gradient Shader, Dot Distortion Shader, Spotlight Shader, Ribbon Gradient Shader.
- **Backgrounds blocks** (https://ui.aceternity.com/blocks/backgrounds): Background with full video, with shooting stars, with dots, Noise Grid
  (uses `noise.webp`), dots masked, dots masked vertical, grid with dots, grid with dots and animations, skewed rectangles, skewed lines.
- **Illustrations blocks** (https://ui.aceternity.com/blocks/illustrations): 22, incl. Isometric Box, Box Illustration, Animated Beam Path,
  World Map, Collaborative Cursors, Uptime Status, MacBook/iPhone/iPad.
- Hero sections (27), feature sections (24), testimonials, CTA, etc., 17 templates. Nothing in Pro is needed: the free
  `cloud-shader`, `shooting-stars`, `stars-background`, `background-cubes-grid` already cover the sky and cubes.

---

## 2. Licence and usage terms

Sources:
- Licence page: https://ui.aceternity.com/licence — written for "Aceternity UI Pro". Permits unlimited end products (sites, apps,
  freely distributed). **Prohibits** "re-distribut[ing] the Item as a stock image or its source files, regardless of modifications",
  marketplace resale, and making templates/derivative products to sell.
- Pricing FAQ (structured data on https://ui.aceternity.com/pricing): free tier "100+ copy-paste components ... that you can use in
  personal and commercial projects"; "The only restriction is that you cannot resell or redistribute the components themselves as a
  competing template or component library."
- Site terms: https://ui.aceternity.com/terms — boilerplate: "You must not ... Reproduce, duplicate or copy material from
  ui.aceternity.com ... Redistribute content". This contradicts the copy-paste model; it is generic site T&C text, but it exists.
- No OSS licence is published for the components (no MIT/Apache file; the source is served only via the registry JSON).

**Verdict.**
- Using free components inside our product/landing page: allowed (end product, commercial or not).
- Copying their source verbatim into a **public MIT-licensed repo**: grey zone. The repo makes the source files publicly
  downloadable, which is close to "redistribute the source files", and we cannot relicense their code as MIT anyway.
  Risk is low for a hackathon, but the clean path is: **re-implement from the algorithm** (this doc records the parameters), in our own
  code, with our tokens. Most of these are 40–300 lines and we are rewriting them without Tailwind/motion regardless, so the port is a
  rewrite, not a copy.
- If any file is copied substantially (most likely `cloud-shader`'s GLSL, which is original Aceternity work per its header comment
  "Original cloud shader for Aceternity UI"), keep it out of the MIT grant: put a header `// Adapted from Aceternity UI
  (ui.aceternity.com/components/cloud-shader), Aceternity licence, not MIT` and list it in README's third-party section.
- Attribution: **not required** by any page. Credit anyway in the README and blog ("inspired by Aceternity UI"); CLAUDE.md requires
  disclosure of what we didn't write.

---

## 3. Deep notes on the most relevant components

Port pattern used throughout: one `useEffect` that owns a canvas or element ref, a `ResizeObserver`, an
`IntersectionObserver` that stops the rAF loop off-screen, a `matchMedia('(prefers-reduced-motion: reduce)')` check that
renders one still frame, and colours read from CSS custom properties via `getComputedStyle(el).getPropertyValue('--sky')`.
Scroll-linked ones use one shared hook that writes progress into a CSS variable (below), so CSS does the transform.

```ts
// shared: scroll progress of `el` into --p (0..1), rAF-throttled. Replaces motion's useScroll+useTransform.
function useScrollVar(ref, start = 'top top', end = 'bottom top') { /* compute on scroll, el.style.setProperty('--p', p) */ }
```
CSS then does `transform: rotateX(calc((1 - var(--p)) * 20deg))`. Where supported (Chrome 115+, Safari 26),
`animation-timeline: view()` does the same with zero JS; keep the hook as the fallback.

### 3.1 Shooting Stars + Stars Background — https://ui.aceternity.com/components/shooting-stars-and-stars-background
**Stars** (`stars-background.tsx`, canvas 2D):
- count = `floor(width*height*starDensity)`, `starDensity = 0.00015` → ~311 stars at 1920x1080.
- radius `0.5 + rand*0.05` (practically uniform 0.5px), base opacity `0.5–1`.
- twinkle: `allStarsTwinkle = true` (else `twinkleProbability 0.7`); per star `twinkleSpeed 0.5–1`;
  opacity = `0.5 + |sin(now*0.001 / twinkleSpeed)| * 0.5` — a 1.6–3.1s period, all in phase-ish since phase is time only.
- fill hard-coded `rgba(255,255,255,a)`; no devicePixelRatio scaling (blurry on retina); redraws every star every frame forever;
  regenerates all stars on resize.
**Shooting star** (`shooting-stars.tsx`, SVG `<rect>`):
- one star at a time. Spawn: random edge of `window` (not the container), angle 45/135/225/315°.
- `speed` 10–30 **px per frame** (frame-rate dependent: 2x faster at 120Hz), next spawn after `minDelay 1200`–`maxDelay 4200` ms.
- length = `starWidth(10) * (1 + distance/100)`, so the streak grows to ~200px crossing a screen; height `starHeight 1`.
- trail = `linearGradient` from `trailColor` (opacity 0) to `starColor` (opacity 1). Defaults `#9E00FF`/`#2EB9DF` (purple-cyan, off-palette).
- Bugs to not copy: the `setTimeout` chain is never cleared on unmount; React state update per frame (re-render per frame);
  global `id="gradient"` collides if two instances mount (the demo layers two).
**Port** (effort: S, ~120 lines total): one canvas for both. Stars: precompute `Float32Array` of x,y,r,phase,period; give each a
random phase; scale by DPR; colour from `--star` (night: `#FFFFFF`, dawn tint: yuzu `#F3C66B` at low alpha). Shooting stars: an array
(allow 0–3 concurrent), velocity in px/second × dt, spawn interval from a prop driven by "dream intensity", draw with
`createLinearGradient` along the segment, tail length capped. Reduced motion: draw stars at base opacity, no streaks.
Pause via IntersectionObserver. Cost: trivial (≤400 arcs/frame); can drop to 30fps for twinkle.

### 3.2 Cloud Shader — https://ui.aceternity.com/components/cloud-shader
The closest match to our hero. Raw WebGL1, one full-screen triangle, no deps.
- Uniforms: `u_res, u_time, u_count(1–6), u_cloud, u_skyTop, u_skyBottom`. Props: `speed=1, count=6, cloudColor #fbf8f2,
  skyTopColor #3876ba, skyBottomColor #8cbfe8`. Colours are re-read from a ref **every frame**, so changing them is free: the
  time-of-day transition is just lerping three uniforms.
- Sky: vertical mix bottom→top; horizon haze `smoothstep(0.35,0,uv.y)*0.5`; sun glow at `(0.78*aspect, 0.92)`,
  `exp(-d²*5)*0.28` of `(1,.95,.82)`; cirrus band uv.y 0.55–0.9 from stretched fbm `(x*1.6 - t*.006, y*12)`.
- Each cloud: ellipse envelope with dome top and flattened base (`ry*0.42` below centre), `env = 1-length(q/r)`;
  detail = domain-warped billow noise (5 octaves `1-|2n-1|`) warped by two 4-octave fbm; density `env + (detail-0.62)*0.62`.
  Self-shadow: a second density sample `r.y*0.55` above; `occl = clamp((dUp-d)*1.1 + d*0.55)`; lit = `cloud*1.04`,
  shadow = `mix(cloud*0.6, sky, 0.38)`; silver rim on thin edges; atmospheric fade `mix(col, sky, dist*0.35)`.
- 6 clouds in 3 depth layers: far (y .84/.73, r .20–.24, speed .006–.008), mid (.60/.47, r .30–.34, .011–.013),
  near (.35/.20, r .46–.56, .016–.020). x wraps with `fract(t*spd+phase)`; vertical bob `sin(t*.05)*.012`.
- DPR capped at 2. Reduced motion sets time 0 but **still renders every frame** (wasteful; render once instead). No off-screen pause.
- **Cost: the heaviest thing on the page.** Per pixel: up to 6 clouds × 2 density samples × (2 fbm×4 + billow×5 = 13 noise) ≈ 156
  value-noise calls (624 hashes), plus the envelope early-out. At 2880x1800 that is a real GPU load on integrated graphics.
  Fixes: render at 0.5 scale (`canvas.width = clientWidth*0.5`, CSS stretches it; clouds are soft so nobody sees it), cap 30fps,
  `count=4` on small screens, stop the loop when hidden.
**Port** (effort: S–M): it is already plain React + WebGL; strip `cn`/Tailwind, add IntersectionObserver + half-res + reduced-motion
single frame, and feed `u_skyTop/u_skyBottom/u_cloud` from our time-of-day keyframes. Add two uniforms we need: `u_part` (0..1, pushes
clouds away from the centre column so the product frame "clears the sky") and `u_night` (darkens clouds to `mix(cloud, ube, .4)`
and fades sun glow). Licence note in section 2 applies: treat the GLSL as adapted code.

### 3.3 Aurora Background — https://ui.aceternity.com/components/aurora-background
- Two layered `repeating-linear-gradient(100deg, ...)` images: a white/transparent stripe mask (`#fff 0–7%, transparent 10–12%,
  #fff 16%`) over the colour band (`blue-500 10%, indigo-300 15%, blue-300 20%, violet-200 25%, blue-400 30%`).
  `background-size: 300%, 200%`; `::after` repeats it at `200%, 100%`, `background-attachment: fixed`, `mix-blend-mode: difference`.
- `filter: blur(10px) invert(1)` in light mode, `opacity .5`; optional `mask-image: radial-gradient(ellipse at 100% 0%, black 10%,
  transparent 70%)` keeps it to the top-right corner.
- Keyframe `aurora 60s linear infinite`: `background-position 50% 50% → 350% 50%`.
- Cost: animating background-position on a blurred full-screen layer repaints every frame (not compositor-only). Cheap-ish on desktop,
  noticeable on low-end. Better: put the gradient on an oversized element and animate `transform: translateX` instead.
**Port** (S, pure CSS ~30 lines): swap colours to `sky`/`ube`/`sakura` at low saturation; it is our best **dusk/dream band**. The invert
trick is for dark-on-light; with our palette skip invert and use `mix-blend-mode: soft-light` over the sky gradient.

### 3.4 Background Gradient Animation — https://ui.aceternity.com/components/background-gradient-animation
- Five `radial-gradient(circle, rgba(c,.8) 0, rgba(c,0) 50%)` discs, each `--size: 80%` of the box, centred, with offset
  `transform-origin`s (`50%-400px`, `50%+400px`, `50%-200px`, `-800px/+800px`) so `rotate` keyframes make them orbit.
- Keyframes: first `moveVertical 30s ease`, second `moveInCircle 20s reverse`, third `moveInCircle 40s linear`,
  fourth `moveHorizontal 40s ease` (translateX −50%→50%, Y −10%→10%), fifth `moveInCircle 20s ease`.
- `mix-blend-mode: hard-light` (prop `blendingValue`); container filter `url(#blurMe) blur(40px)` where `#blurMe` is a goo filter
  (feGaussianBlur stdDeviation 10 + feColorMatrix alpha `18 -8`); Safari uses `blur-2xl` only.
- Optional pointer blob eased toward the cursor (`cur += (tg-cur)/20` per frame).
- Sets its CSS vars on `document.body` (leaks globally; don't copy that).
- Cost: transforms are compositor-friendly, but the 40px blur + SVG filter over a full-screen layer is expensive to re-rasterise every
  frame. On Safari it is the most common source of jank in this library.
**Port** (S): CSS only. Use our agent colours as the five discs at 25–35% alpha, `mix-blend-mode: multiply` (light palette: hard-light
over `#F7F8FA` washes out; multiply keeps tints), drop the goo filter, pre-blur via `radial-gradient` falloff instead of `filter: blur`.
Good for the **dawn** state (yuzu + sakura low and warm).

### 3.5 Sparkles — https://ui.aceternity.com/components/sparkles
- tsParticles slim config: `particleDensity` 120 (density-enabled count), size `minSize 1`–`maxSize 3`, opacity 0.1–1 animated at
  `speed 4` with random start, move speed 0.1–1 random direction, `fpsLimit 120`, colour `#fff`.
- Cost: the dependency (tsParticles engine + slim + react) is far bigger than the effect.
**Port** (S, ~60 lines canvas): 40–80 particles in a small canvas under Mochi; ease opacity with per-particle sine; colour from the
active agent's token (sky/ube/sakura/yuzu/matcha). Do not import tsParticles.

### 3.6 Meteors — https://ui.aceternity.com/components/meteors
- `number` spans (default 20), 0.5x0.5 dots with a `::before` 50px `linear-gradient(to right, #64748b, transparent)` tail,
  `rotate(215deg)`, keyframe `meteor`: translateX 0 → −500px, opacity 1 until 70% then 0. Duration 5–10s random, delay 0–5s random.
  Positions spread across an 800px range centred (`idx*(800/n) - 400`), top −40px.
- Cost: compositor-only transforms; cheap.
**Port** (XS, pure CSS): this is the zero-JS alternative to canvas shooting stars. Weakness: fixed, repeating paths; streaks can't carry
labels driven by data. Use only as the reduced-JS fallback.

### 3.7 Background Beams / Lamp / Spotlight — https://ui.aceternity.com/components/background-beams · /lamp-effect · /spotlight · /spotlight-new
- Beams: ~50 hard-coded SVG curve paths, each with a `motion.linearGradient` whose x1/x2/y1/y2 animate 0→100% over 10–20s with 0–10s
  delay, stops `#18CCFC → #6344F5 → #AE48FF` (the exact blue-purple CLAUDE.md bans).
- Lamp: two `conic-gradient(var(--conic-position), cyan-500, transparent)` wedges 30rem wide that widen from 15rem to 30rem over 0.8s
  (delay 0.3) + a blurred cyan bar. Dark-only by design.
- Spotlight: an SVG ellipse with a Gaussian blur, keyframe once 2s (delay .75s): opacity 0, `translate(-72%,-62%) scale(.5)` →
  `translate(-50%,-40%) scale(1)`.
- Spotlight New: three `radial-gradient(... hsla(210,100%,85%,.08) ...)` cones per side, 560x1380, `translateY -350`, swaying
  ±`xOffset 100`px over `duration 7`s, alternate.
**Assessment**: these are light-on-dark "stage" effects. The only useful idea is Spotlight New's very-low-alpha cones as **god rays at
dawn** (yuzu at 6–8% alpha). Port is S (CSS keyframes). Beams and Lamp: skip.

### 3.8 3D Card Effect — https://ui.aceternity.com/components/3d-card-effect
- Container `perspective: 1000px`; on mousemove `rotateY = (x - w/2)/25` deg, `rotateX = (y - h/2)/25` deg (so ~±10° on a 500px card).
  Children (`CardItem`) set `translateZ(n px)` on enter and reset on leave; `transform-style: preserve-3d`; CSS transition does the easing.
- No deps, no motion. Cost: trivial.
**Port** (XS): exactly what the floating product frame needs. Clamp to ±6° (the frame is big), damp with `transition: transform .4s`
(CLAUDE.md motion: 0.4s), lift the receipt pill and the brief card on `translateZ(24px)` / `translateZ(40px)`. Disable under reduced
motion and on touch.

### 3.9 Container Scroll Animation — https://ui.aceternity.com/components/container-scroll-animation
Exact values from source:
- Outer container: height **60rem mobile / 80rem md+**, padding `p-2` / `md:p-20`; this element is the `useScroll` target.
- `useScroll({ target })` with no offset → motion's default `["start start", "end end"]`: progress 0 when the container's top hits
  the viewport top, 1 when its bottom hits the viewport bottom. Scroll distance = container height − viewport height
  (80rem = 1280px − 900px viewport ≈ 380px of scroll). If the section is not at page top, the frame starts already mid-tilt — set the
  range explicitly in our port.
- Inner wrapper: `perspective: 1000px`, `py-10` / `md:py-40`.
- `rotateX`: **20° → 0°** over progress [0,1] (linear, no spring).
- `scale`: desktop **1.05 → 1**; mobile (`innerWidth <= 768`) **0.7 → 0.9**.
- `translateY` on the **title only**: **0 → −100px**. (The card also receives `translate` but ignores it.)
- Card: `max-w-5xl` (64rem), height **30rem / md 40rem**, `-mt-12` (−3rem), border 4px `#6C6C6C`, bg `#222222`, padding 8px / md 24px,
  radius 30px; inner screen radius 16px, `overflow: hidden`. Shadow stack:
  `0 0 #0000004d, 0 9px 20px #0000004a, 0 37px 37px #00000042, 0 84px 50px #00000026, 0 149px 60px #0000000a, 0 233px 65px #00000003`.
- transform-origin is the default centre, so the top edge recedes.
- Cost: one composited layer transform per frame; cheap. Mobile detection by resize listener (use a media query instead).
**Port** (S, ~40 lines, no motion): `useScrollVar` writes `--p` on the section; CSS:
```css
.frame { transform: perspective(1000px) rotateX(calc((1 - var(--p)) * 20deg)) scale(calc(1 + (1 - var(--p)) * .05)); }
.frame-title { transform: translateY(calc(var(--p) * -100px)); }
@media (max-width: 768px) { .frame { transform: perspective(1000px) rotateX(calc((1 - var(--p)) * 20deg)) scale(calc(.7 + var(--p) * .2)); } }
@media (prefers-reduced-motion: reduce) { .frame { transform: none; } }
```
Swap the dark bezel for our paper bezel (`bg-page` + 1px `line`, radius 20px) and a softer 3-layer shadow (light palette).
**Use for us:** (a) continuation of the hero: the hero frame starts at a smaller tilt (e.g. 8°) and this section takes it 8°→0° as the
sky scrolls away, so it reads as one object settling onto the desk; keep the same frame component, just pass a different `--tilt-max`.
(b) demo-video card: same mechanism, the `<video>` poster inside; start playback only when `--p > .9` (IntersectionObserver ratio).

### 3.10 Macbook Scroll — https://ui.aceternity.com/components/macbook-scroll
- Target section `min-height: 200vh`, `perspective: 800px`, whole thing `scale(.35)` mobile / `.5` sm / `1` md; offset
  `["start start","end start"]`.
- Lid: rotateX keyframes `[0.1, 0.12, 0.3] → [-28°, -28°, 0°]`; screen image `scaleX 1.2 → 1.5`, `scaleY 0.6 → 1.5` over [0, .3]
  (mobile → 1), `translateY 0 → 1500px` over [0,1], `transform-origin: top`; title `translateY 0→100`, `opacity 1→0` over [0,.2].
- 655 lines, most of it a DOM keyboard with ~70 Tabler icons. Dark device styling.
**Assessment**: a second device metaphor competes with our product frame; the laptop is off-brand. Effort to port M. Skip unless the
demo video needs a "screen lifting out" moment; container-scroll does that job with a tenth of the code.

### 3.11 Hero Parallax — https://ui.aceternity.com/components/hero-parallax
- Section `height: 300vh`, `perspective: 1000px`, offset `["start start","end start"]`, spring `{stiffness 300, damping 30}` on all.
- Rows of 5 (15 products): row 1 and 3 `translateX 0→1000px`, row 2 `0→−1000px` over [0,1].
- Whole stack over [0, .2]: `rotateX 15°→0`, `rotateZ 20°→0`, `translateY −700→500px`, `opacity .2→1`.
- Cards 24rem x 30rem; hover lifts `y −20` and shows a black 80% overlay with title.
**Port** (S): CSS vars from `useScrollVar`; springs replaced by `transition: transform .15s linear` or plain. Needs 10–15 screenshots.

### 3.12 Sticky Scroll Reveal, Tracing Beam, Timeline — /sticky-scroll-reveal · /tracing-beam · /timeline
- Sticky scroll: tracks scroll **of its own overflow container** (30rem tall, `overflow-y: auto`) — a nested scroller, bad for a landing
  page; switch to window target. Active card = nearest breakpoint `index/n` to progress; swaps bg colour (slate/black/neutral) and a
  gradient panel. Port S with IntersectionObserver per text block (no scroll math needed).
- Tracing beam: SVG path `M1 0 V-36 l18 24 V(h*.8) l-18 24 V h`; gradient y1 = spring(`[0,.8] → [50, h]`), y2 = spring(`[0,1] → [50,
  h−200]`), stiffness 500, damping 90; a dot at the top fills when progress > 0. Port S: two CSS vars on a `<linearGradient>` via JS.
- Timeline: offset `["start 10%", "end 50%"]`; beam height `0 → contentHeight`, opacity `0→1` over [0,.1]; sticky year headings.
  Port S. This is the natural vehicle for "**paths that draw**" (micro-interactions.md) on a "how a ticket gets briefed" section.

### 3.13 Text Generate Effect / Flip Words — /text-generate-effect · /flip-words
- Text generate: split words; each `opacity 0→1`, `filter blur(10px)→0`, duration 0.5s, `stagger(0.2)`.
- Flip words: every 3000ms swap word; enter `opacity 0, y 10, blur 8px` → settled (spring stiffness 100, damping 10); exit
  `y −40, x 40, scale 2, blur 8px, opacity 0`; words stagger 0.3s, letters 0.05s.
**Port** (XS): CSS `@keyframes` + `animation-delay: calc(var(--i) * .2s)`. Use text-generate for the **morning report headline** landing at
dawn ("Overnight I retired 7 facts."). Flip-words is a cliché in hero headlines; skip or use once for agent names.

### 3.14 Placeholders and Vanish Input — /placeholders-and-vanish-input
- Placeholders cycle every 3s (motion). On submit: draws the input text into an 800x800 canvas, reads `getImageData`, keeps non-empty
  pixels as particles `{x,y,r:1,color}`, then each frame every particle random-walks ±1px, `r -= 0.05*rand`, a left-to-right sweep
  `pos -= 8` px/frame removes them; done when empty.
**Use**: a landing "ask the brain" input whose question dissolves into the sky (particles drift up and become stars). Port S (~100 lines).

### 3.15 Animated Tooltip — /animated-tooltip
- Hover avatar: tooltip enters `y 20, scale .6` → spring (stiffness 260, damping 10); `rotate` and `translateX` mapped from pointer x
  offset (−100..100 → −45..45° and −50..50px) through spring (100, 15).
**Use**: the five agent avatars (sky/ube/sakura/yuzu/matcha) under the hero. Port S with CSS transitions; drop the rotate wobble.

### 3.16 Glowing Effect — /glowing-effect
- Border made by a conic gradient masked to a ring; JS computes `atan2` angle from the card centre to the pointer and tweens `--start`
  toward it via the shortest arc (duration `movementDuration 2`s); active only within `proximity` and outside `inactiveZone .7` of the
  centre; `spread 20`°. Port S (CSS vars + one pointermove). Light palette: use `accent`-free agent tint at 40% alpha, 1px.
**Use**: optional on the "receipt" card when hovered. Low priority.

### 3.17 World Map — /world-map
- `dotted-map` generates an SVG dot map (radius .22, diagonal grid, 100 rows) as a data URI image; arcs are quadratic Béziers from
  equirectangular projection `x=(lng+180)*800/360, y=(90-lat)*400/180` with control point 50px above the higher end; each path
  animates `pathLength 0→1` over 1s, staggered `0.5*i`s, colour `#0ea5e9`.
**Use**: the "Bézier arc with stagger" is exactly how a **path receipt** should draw between graph nodes. The map itself is irrelevant
(our broker is fictional). Port XS: SVG `stroke-dasharray` + CSS `animation-delay`.

### 3.18 Canvas Reveal Effect — /canvas-reveal-effect
- R3F full-screen shader: dot matrix (`totalSize 4`, `dotSize 2`), per-cell random opacity from `opacities [.3,.3,.3,.5,.5,.5,.8,.8,.8,1]`,
  reveal radiates from the centre at `animationSpeed .4`; `maxFps 60`.
- Pulls three + @react-three/fiber for a dot grid. Port to a 2D canvas or raw WebGL is S. Idea for us: constellation "reveal" at dusk.

### 3.19 Background Cubes Grid — https://ui.aceternity.com/components/background-cubes-grid  (Free)
Two variants in one 937-line file; deps **three** (+ examples: EffectComposer, RenderPass, ShaderPass, OutputPass, RoundedBoxGeometry)
and motion (`useAnimationFrame`, `useReducedMotion`).
- **Isometric** (default): orthographic camera; one `InstancedBufferGeometry` of `BoxGeometry(1-gap, 16, 1-gap)` (tall pillars, so tops
  move, sides show). Per-instance `aOffset`, `aHeight`, `aGlow`. Grid size from `cellSize = 150` px. Custom shader colours faces by
  normal: `topColor #fafaf9`, `leftColor #e7e5e4`, `rightColor #d6d3d1` (stone greys — already light-palette friendly); troughs shade
  the top toward the left colour; glow `glowColor #a8a29e` × `glow .5`, strongest near the rim of sides.
  Height curve in the vertex shader: `mix(x*1.5, tanh(x), smoothstep(-.6,.6,x))` × `amplitude .7` (crests round, troughs sink deeper).
  Physics: CPU **2D wave equation** at fixed 120Hz (`SIM_HZ`), nine-point Laplacian `(4*edges + corners − 20h)/6`, `speed 7`,
  `damping .08`, separate "flow" vs "settle" drag that ramps in 0.15s after the pointer stops; pointer raycast onto the y=0 plane
  injects `PUSH_PER_CELL .16` along the swept segment with `BRUSH_RADIUS 1.1` cells. Glow eases to local energy (up ×0.08, down
  ×0.015 per step). `idleRipples` drop random ripples after `idleDelay 1.5`s. Pointer listened on **window** (content above doesn't block).
- **Perspective**: `PerspectiveCamera(40)`, `gridSize 44` (1,936 `RoundedBoxGeometry` instances), Phong material patched via
  `onBeforeCompile`, trail of up to 128 pointer points in a float `DataTexture`, waves `speed 6, frequency 1.2, width 3, fadeTime 2`;
  ACES tone mapping, **PCF shadow map 1024²**, key + rim + ambient lights, fog, and a post-process `VignetteRGBShiftShader`
  (shift .004 — that is the chromatic fringe at the edges). Defaults dark: base `#2a2a30`, wave `#ff6a2b`, bg `#0b0b0d`.
- Reduced motion: disables idle ripples (pointer ripples still happen). No IntersectionObserver pause found.
**GPU cost**: isometric = one instanced draw of a few hundred boxes, cheap on GPU; the CPU wave sim at 120Hz over the grid is the real
cost (fine for ≤ 40x40). Perspective = shadows + postprocessing + 1.9k rounded boxes: **heavy**, laptop-fan territory; plus ~600KB of
three.js. **Port** (M): the isometric variant only, and not with three.js: our use is 4 layers, not a field (see section 7), so draw the
cubes as **CSS 3D or SVG isometric**, and keep only the idea of energy-based glow easing. If a real ripple field is wanted, a 2D canvas
isometric renderer with the same wave sim at 60Hz is ~200 lines and drops three.js.

### 3.20 Background Boxes — https://ui.aceternity.com/components/background-boxes  (Free)
- 150 rows × 100 cols = **15,000 `motion.div`s**, each 4rem x 2rem with slate borders, a "+" SVG on every other cell, the whole grid
  `skewX(-48deg) skewY(14deg) scale(.675)` to fake isometric. Hover sets an instant random background from 9 Tailwind pastels.
- Cost: huge DOM and 15k motion components; slow mount (~hundreds of ms), memory heavy, hover hit-testing on skewed nodes. Visually it is
  a flat grid, not cubes. **Do not port.** The skew transform trick is the only reusable bit (one CSS line).

### 3.21 Chromatic Image — https://ui.aceternity.com/components/chromatic-image  (Free)
- Raw WebGL1, no deps, 336 lines. Input is an **image URL** uploaded as a texture (not live DOM). `<img>` shows until the texture is
  ready, then the canvas (oversized `-inset 2.5%`, 105%) fades in.
- Fragment shader: pointer direction `dir = movement / max(len, .2)`; zoom toward centre `uZoom(.2) * progress * .28`;
  horizontal band displacement `sin(uv.y*24 + px*5)*.72 + sin(uv.y*71 − py*4)*.28` × `uWarp (displacement .05)` × .16; vertical push
  `dir.y * warp * .12`; RGB split: R sampled at `+split`, B at `−split`, G centre, `split = dir * chromaticShift(.01) * progress`
  plus band-driven x jitter `* .35`.
- `progress` eases 0→1 on pointer enter (`approach` exponential, rate 10), pointer eases at rate 30; tilt
  `rotateX/Y = (0.5 − p) * tilt(.3) * 18°` applied as CSS `perspective(900px)` on the canvas.
- Renders **on demand only** (stops when settled) — well written. Reduced motion: progress forced 0 and tilt 0 (still image).
**GPU cost**: 4 texture fetches per pixel, only while moving. Negligible.
**Port** (S): drop `cn`/Tailwind; the rest is plain. Replace pointer-driven `progress` with a prop (or ref) so we can **drive it on a
timeline** (0→1→0 over ~600ms) for a transition. Because it needs an image, for the product frame we would pass a pre-rendered
screenshot (`frame-day.png`) of the frame; live DOM cannot be fed to WebGL. Pure-CSS alternative for live DOM: an SVG filter
(`feColorMatrix` to isolate R and B, `feOffset dx=±3`, `feBlend screen`) applied with `filter: url(#rgb-split)` for 400ms — costs a full
re-raster of the frame per frame while active, acceptable for a 0.4s moment.

Related: the perspective cubes' `VignetteRGBShiftShader` is a second chromatic source (edge-weighted RGB shift) — the same 3-fetch trick.
Labs and Pro list nothing else named "glitch" or "distortion" except the Pro "Dot Distortion Shader" (name only).

---

## 4. Layering recipes for the day-to-night sky

Shared state: one `--tod` (time of day, 0 = morning, 0.33 = day, 0.6 = dusk, 0.8 = night/dream, 1 = dawn) set on the hero root,
driven by scroll (hero) or a looping demo clock. Every layer reads it; nothing has its own clock. All layers `pointer-events: none`,
`position: absolute; inset: 0`, z-index ascending as listed. Product frame always on top at z 50.
Sky palette keyframes (CSS, interpolated by JS into `--sky-top`/`--sky-bottom`/`--cloud`): day `#7FAEE6 → #F7F8FA`, dusk
`#A99BE0 → #F2A7B5`, night `#2B2F52 → #4A4470` (the one dark moment, still ube-based, not black), dawn `#F2A7B5 → #F3C66B`.

**R1 — "Paper sky" (recommended baseline).** Cost: low-medium (one WebGL pass at half res).
1. z0 `cloud-shader` port at 0.5 res, 30fps, sky uniforms from `--tod`, `count 5`.
2. z1 paper grain: static 128px noise PNG tile (or our GLSL paper shader if it is already in `mochi-brain-blog.html`),
   `mix-blend-mode: multiply`, opacity .06. Static = free.
3. z2 stars canvas, `opacity: smoothstep(.55, .75, --tod)`, colour `#FFFFFF`→yuzu at dawn.
4. z3 shooting-stars canvas, spawn rate 0 by day, 1 per 1.2–4.2s at night (or one per retired fact, see 5.1).
5. z4 sparkle canvas under Mochi (60 particles, active-agent tint), `mix-blend-mode: screen`, only while Mochi "works".
Total: 1 WebGL + 3 small 2D canvases (could merge 3–5 into one canvas). Pause everything off-screen.

**R2 — "No WebGL" (fallback / mobile).** Cost: lowest.
1. z0 CSS linear-gradient sky on `--sky-top/--sky-bottom` (`@property` registered so it can transition).
2. z1 3–4 SVG cloud blobs (hand-drawn, Mochi-shaped puffs) at 3 depths, `translateX` keyframes 120/180/260s, scroll parallax
   `translateY(calc(var(--p) * -40px * depth))`.
3. z2 aurora port as the dusk band, opacity tied to `--tod`, `mix-blend-mode: soft-light`.
4. z3 CSS meteors (8 spans) at night only.
Compositor-only except the aurora; works under battery saver.

**R3 — "Dream" (night section, deliberately richer).** Cost: medium.
1. z0 night gradient.
2. z1 aurora (ube + sakura, 30% opacity, `mask-image` radial top) — the dream band.
3. z2 stars canvas with constellation layer (5.2) drawn on the same canvas.
4. z3 shooting stars carrying labels (5.1).
5. z4 low cloud bank at the bottom edge (cloud-shader with `count 2`, near layer only, darkened), so the dream sits "above the clouds".
Blend: stars `normal`, aurora `screen`, labels `normal` on top for legibility.

**R4 — "Dawn report".** Cost: low.
1. z0 dawn gradient (sakura → yuzu).
2. z1 background-gradient-animation port, two discs only (yuzu, sakura), `multiply`, 25% alpha, 60s cycle.
3. z2 Spotlight-New god rays (yuzu 6% alpha), 7s sway — or static.
4. z3 stars fading out (`opacity: 1 - smoothstep(.85,.95,--tod)`), last shooting star.
5. z4 text-generate headline for the morning report.

**R5 — "Hero card focus".** Product-frame interplay, on top of any recipe. Cost: low.
- Frame: 3d-card tilt (±6°, translateZ on brief + receipt), container-scroll continuation below the fold.
- Cloud parting (5.3): `u_part` uniform in the shader, or in R2 the SVG clouds translate outward by `--part`.
- Soft contact shadow under the frame on the sky: an ellipse `radial-gradient(rgba(16,24,40,.18), transparent 70%)`, scales with tilt.

Performance rules for all: one rAF scheduler for every canvas; DPR ≤ 1.5 for 2D canvases, 0.5x for the shader; stop on
`document.hidden` and when the hero leaves view; reduced motion = one static frame at `--tod = .33` (day) with no stars moving.

---

## 5. Variations to invent (tied to the product)

5.1 **Shooting stars = retired facts.** During the dream, each temporally invalidated fact spawns one streak; a tiny mono label
(the fact ID, e.g. `fact:cust_219.plan`) rides 8px behind the head and fades at 70% of the path. Spawn order from the real dream log
(or the seeded demo log). Count on screen = the dream report's "facts retired" number; the number links to its Cypher like every number.
Implementation: canvas streaks + one absolutely positioned DOM label per live star (≤3) so text stays crisp and accessible
(`aria-hidden`, with a visually hidden list of the same facts).

5.2 **Stars are graph nodes.** At dusk, ~40 of the stars are not random: they are the node positions of a small force layout of
the demo customer's subgraph. When the brief's path receipt draws (Customer → Ticket → Fix → Team), the corresponding stars brighten and
lines draw between them (stroke-dash animation, world-map-style quadratic arcs, staggered 0.3s). The constellation *is* the traversal.

5.3 **Clouds part when the brief loads.** Shader uniform `u_part` (0→1 over 0.8s) adds `sign(x - .5) * u_part * .35` to each cloud's
x and raises them slightly; the sky behind the frame clears exactly as the briefing card fills. Reverse when the frame scrolls away.

5.4 **Mochi as the sun/moon.** The sun glow in the cloud shader moves to Mochi's position; at night Mochi dims to a moon and the glow
becomes a soft ube halo. Sparkles under Mochi only while "dreaming".

5.5 **Weather = queue load.** Cloud count and speed map to the open-ticket count in the seeded data (4 clouds calm, 6 busy). Honest,
cheap, and it is data, not decoration.

5.6 **Ask-the-sky input.** placeholders-and-vanish: the typed question dissolves into particles that rise and settle as new stars
(a new memory). One-time, on submit.

5.7 **Dawn report rises.** At `--tod ≈ 1` the morning report card slides up from the cloud bank (6px rise / 0.4s per CLAUDE.md) and
its headline uses the text-generate stagger.

---

## 6. Things to avoid

- **Banned palette**: background-beams, lamp, beams-with-collision, shooting-stars defaults (`#9E00FF`/`#2EB9DF`), aurora defaults
  (blue-500/indigo-300/violet-200), wavy (`#38bdf8 #818cf8 #c084fc #e879f9`), gradient-animation defaults. All blue-purple "AI" gradients.
- **Dark-only stage effects**: lamp, spotlight, spotlight-new at default alpha, vortex, perspective cubes, evervault, glowing-stars card.
  They need a black page to read; on `#F7F8FA` they turn muddy.
- **Generic AI-site tells**: hero-parallax wall of screenshots, flip-words headline, infinite marquee of logos/testimonials,
  3d-marquee tilted grid, text-hover-effect giant outline word, moving-border buttons, "sparkles under the logo" on a black hero.
- **Heavy GPU / bundle**: perspective cubes (shadows + postprocess + three.js), github-globe / 3d-globe (three-globe/drei),
  canvas-reveal (R3F for a dot grid), sparkles via tsParticles, background-boxes (15k DOM nodes), wavy-background (full-screen
  `ctx.filter = blur` every frame is slow in Safari/Firefox), vortex (thousands of particles + full-screen glow composite).
- **Global side effects** to not copy: gradient-animation writes CSS vars to `document.body`; shooting-stars uses `window` size and a
  global SVG `id`; stars canvas ignores DPR; cloud-shader renders every frame under reduced motion; none pause off-screen.
- **Nested scrollers**: sticky-scroll-reveal and parallax-scroll scroll their own 30–40rem `overflow-y: auto` box; on a landing page that
  traps the wheel. Re-target to the window.
- **Product surfaces**: none of this goes into desk, chat or reports (CLAUDE.md: flat).

---

## 7. Where cubes and chromatic fit

**Cubes as the multigraph memory tiers** (company / team_* / user_* / cust_* as stacked layers lighting up on hover) — **yes, but not
with the Aceternity component.** The metaphor is right: four graphs, one stacked over the next, a query lighting the cells it touches.
The Aceternity cubes are a wave *field* (hundreds of identical pillars reacting to the cursor), which reads as "physics toy", not
"four tiers". Build instead: four isometric slabs (CSS 3D: `rotateX(55deg) rotateZ(-45deg)` like 3d-marquee, `translateZ` 0/60/120/180px),
each a 6x6 grid of small cubes with top/left/right face colours from the tier's token (company = ink-tinted neutral, team = sky,
user = ube, cust = sakura). Hover a tier: it lifts 12px and its cells glow; hover the path receipt: the cells a traversal touched light
up in order across slabs (borrow the "glow eases up fast, decays slow" rule: rise ×0.08, fall ×0.015 per tick). 144 DOM cubes or one
SVG, zero WebGL, compositor-only. Effort M (~150 lines). Placement: the "Memory tiers" section, after the hero, before the dream.
Reduced motion: static slabs, hover changes colour only.

**Chromatic aberration as "the dream rewrites memory"** — **yes, as one short moment, driven by a timeline, not the pointer.** When the
sky crosses into night (`--tod` 0.6→0.8) the product frame (as a screenshot texture in chromatic-image, or live DOM via the SVG
`rgb-split` filter) gets `progress` 0→1→0 over ~600ms while a retired fact's row in the frame swaps to its new value. That makes
temporal invalidation visible: the old fact smears, the new one lands sharp. Keep `chromaticShift ≤ .006` and displacement ≤ .02 — at
default strength it reads as a glitch/cyberpunk effect, which is off-brand. Reduced motion: crossfade only.

**Chromatic on the demo-video poster** — **acceptable, low value.** Pointer-driven RGB split + tilt on the poster image invites the
click and costs nothing (on-demand render, 4 fetches). But it duplicates the 3d-card tilt already on the hero frame; pick one. If the
video card uses container-scroll (3.9), skip chromatic there.

**Product dashboard** — **no strong reason exists.** CLAUDE.md keeps desk/chat/reports flat; micro-interactions there are clicks
answering in 100ms, rolling numbers and paths that draw. Cubes on the desk would compete with the path receipt, which already shows
tier membership as text. The only candidate considered was a one-time chromatic flicker on a fact the dream just invalidated, and the
existing "receipt grows from its pill" + strike-through of the old value says the same thing more clearly. Recommendation: none in
the product; landing page only.

---

## 8. Parallax ideas (every parallax/scroll component, mapped to our sections)

Assumed landing sections: Hero (sky + floating frame) → Memory tiers → How a brief is built → The dream → Morning report → Benchmarks
→ Demo video → Footer/CTA.

| component | mechanism (exact) | where it fits | verdict |
|---|---|---|---|
| container-scroll-animation | rotateX 20→0, scale 1.05→1, title −100px, perspective 1000px over the section | Hero → section 2 hand-off (frame settles flat), and the demo-video card | **Use** (3.9) |
| parallax-hero-images | mouse-driven, each image `translate ±40px*depth` (maxOffset 40), springs (damping 25, stiffness 120), blur 20px→0 fade-in staggered .12s | Hero clouds/Mochi/frame at depths 0.2/0.5/1 following the mouse (not scroll) — adds the "more interactive" ask cheaply | **Use**, port with CSS transition |
| hero-parallax | 300vh, rows ±1000px X, stack rotateX 15→0, rotateZ 20→0, Y −700→500, opacity .2→1 over first 20% | Could show "the day's tickets" sliding past as cards before the dream consolidates them | Skip — generic, needs 15 images, 300vh of scroll |
| parallax-scroll (Grid) | 3 columns, outer `translateY 0→−200`, middle `0→+200` | Benchmarks or "what the brain remembered": three columns of fact/ticket chips drifting in opposite directions | Maybe — port to window scroll; text chips not images |
| parallax-scroll-2 | as above + outer columns `translateX ∓200`, `rotateZ ∓20°` | — | Skip — the rotation reads as noise |
| macbook-scroll | lid rotateX −28→0, screen scale up to 1.5, flies 1500px, 200vh | — | Skip — laptop device is off-brand, 655 lines |
| sticky-scroll-reveal | sticky panel swaps by nearest breakpoint; bg colour changes | "How a brief is built": left text steps (find customer → similar tickets → likely cause → owner), right sticky frame highlights each hop of the path receipt | **Use**, IntersectionObserver per step |
| tracing-beam | gradient segment on a vertical SVG tracks scroll (spring stiffness 500, damping 90) | Spine of "How a brief is built" or the blog-like decision log section | Maybe — pick this or timeline |
| timeline | beam height 0→content, offset `start 10%`→`end 50%`, sticky headings | "The dream" as a night timeline: 23:00 consolidate → 01:00 retire facts → 03:00 mismatches → 06:00 report; the sky behind shifts `--tod` with the same progress | **Use** — couples scroll to time of day |
| google-gemini-effect | 5 paths `pathLength` from scroll | Paths drawing between tiers in the memory section | Maybe — our own SVG is simpler |
| 3d-marquee | rotated grid, columns drift ±100px, 10/15s | Its transform is the isometric base for the tier slabs (section 7) | Borrow the transform only |
| Sky itself (ours) | clouds `translateY(var(--p) * -40px * depth)` in 3 depths, stars at 0.2 depth | Hero scroll-out: near clouds leave fastest, stars stay — classic depth without a library | **Use** |

Port note for all scroll rows: one `useScrollVar` per section writing `--p`; CSS computes transforms; `will-change: transform` only
while the section is in view; reduced motion sets `--p` to 1 (final, flat state) and skips listeners.

---

## Top picks

1. **cloud-shader** — already our hero; drive its three colour uniforms from `--tod`, add `u_part`/`u_night`, render at half res.
2. **shooting-stars + stars-background** — rewrite as one canvas; streaks carry retired-fact labels during the dream.
3. **container-scroll-animation** — hero frame settles flat as the sky scrolls away; same for the demo-video card.
4. **3d-card-effect** — ±6° tilt and translateZ layers for the floating product frame; zero deps.
5. **timeline / sticky-scroll-reveal** — scroll-coupled time of day for the dream section and the hop-by-hop brief walkthrough.
Honourable: aurora (dusk band, pure CSS), chromatic-image (one 600ms "memory rewritten" moment), cubes idea as CSS isometric tier slabs.

---

## 9. Text components, navbar and footer blocks (read 2026-10-18)

Numbered 9, not 4: code comments already cite §4–§8 above. Values are from the registry source
(`ui.aceternity.com/registry/<slug>.json`); every component except Container Text Flip and Canvas Text imports `motion`.

| component | measured values | verdict |
|---|---|---|
| Canvas Text | canvas 2D; curved lines clipped to glyphs: `animationDuration 5`s, `lineWidth 1.5`, `lineGap 10`, `curveIntensity 60`, 5+ hex rainbow colours | skip: rainbow lines inside type, decorative motion |
| Encrypted Text | scramble resolves left to right: `revealDelayMs 50`/char, `flipDelayMs 50` re-randomise | skip: reads as "hacker" trope, hurts legibility |
| Layout Text Flip | word every `3000`ms; enter `y −40, blur 10px` → 0, exit `y 50, blur 10px, opacity 0`, `0.5`s; `popLayout` | skip: Container Text Flip covers it |
| Colourful Text | per-letter cycle every `5000`ms over 10 rgb colours; `y [0,−3,0]`, `scale [1,1.01,1]`, `blur 0→5→0`, `0.5`s, `delay i·0.05` | skip: agent colours as text colour breaks the colour rule |
| Squiggly Text | SVG turbulence: `steps 5`, `stepDuration 80`ms, `scale [6,8]`, `baseFrequency .02`, `numOctaves 3` | skip: wobble is cuteness |
| Text Generate Effect | words `opacity 0→1`, `blur 10px→0`, `duration 0.5`s (falls back to 1), `stagger(0.2)` | fits Mochi: morning-report headline at dawn (already §3.13) |
| Typewriter Effect | chars `stagger(0.1)`, `0.3`s; cursor blink `0.8`s; smooth variant width `0→fit` over `2`s, `delay 1`s | skip: Cypher typing in receipts already does this, on-system |
| Flip Words | every `3000`ms; word enter `opacity 0, y 10` spring `stiffness 100, damping 10`; letters `opacity 0, y 10, blur 8px` → 0, `0.2`s, `delay word·0.3 + letter·0.05`; exit `y −40, x 40, scale 2, blur 8px, absolute` | fits Mochi: the CTA subject ("Ask Mochi about …"); exit toned to `y −.35em, scale 1.08`, letters `30`ms apart |
| Text Hover Effect | SVG `viewBox 0 0 300 100`, `text-7xl` bold, `strokeWidth 0.3`; outline draws in `strokeDashoffset 1000→0` over `4`s; hover stroke = linear gradient (yellow/red/blue/cyan/violet) masked by a radial gradient `r 20%` at the cursor, mask move `duration 0` (spring `300/50` suggested) | fits Mochi: footer "mochi" wordmark, Instrument Serif, gradient sky → ube → sakura, rAF ease 0.22, still outline on touch / reduced motion, no draw-in |
| Container Text Flip | `interval 3000`, `animationDuration 700`; width = word `scrollWidth + 30`px animated over `animationDuration/2000` = `0.35`s; letters `blur 10px → 0`, `delay i·0.02`; grey gradient + inset shadow box | fits Mochi (width only): the CTA blank's width follows its word in `0.35`s; the gradient box is dropped |
| Hero Highlight | 16px dot grid (`r 2.5`), `200px` radial reveal at cursor; highlighter `backgroundSize 0→100%` in `2`s, `delay 0.5` | skip: dot-grid hero is a template trope |
| Text Reveal Card | `clipPath inset(0 X% 0 0)` follows cursor, rotate `(w−50)·0.1`°, release `0.4`s; star field `20–30`s | skip: hides text behind a gesture |
| Text Flipping Board | split-flap 6×22: `BASE_STEP_MS 55`, `BASE_FLIP_S 0.35`, `col delay 30`ms, `row delay 20`ms, `rotateX −100°` | skip for now: the "next dream" line stays quiet |

**Resizable Navbar** (`/components/resizable-navbar`): `scrollY > 100` → `width 100% → 40%` (`minWidth 800px`), `y 0 → 20`,
`backdropFilter blur(10px)`, six-layer soft shadow, `bg-white/80`, spring `stiffness 200, damping 50`, `rounded-full`; mobile
`width 90%`, sheet at `top-16`, fade. Ours: past `80`px, `max-width 860`px, `y 6`px, blur `12`px, surface `--fg-inv` 90%
(flips dark with the sky), `--line` hairline, `--shadow-layer`, width on the page's spring ease; reduced motion keeps size and blur.

**Footers** (`/blocks/footers`): Simple four grids, Centered with logo, Huge footer with grid, Footer With Big Text. We followed
**Footer With Big Text** (`px-8 py-10`; columns `gap-10 pt-10 pb-10 border-b`; wordmark `text-[20rem] leading-none`, `-mb-[11%]`)
because it is the only one with columns above a hairline, a thin legal row and the brand word big at the bottom; we keep the
whole "mochi" (no negative margin) so the serif's feet stay on the page.
