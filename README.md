# Colson.CV — a playable CV

Colson Knight's CV as a small game. The Gardener from [Mycelia 2](https://github.com/coobytron/Mushroom-Sim-2) walks a bioluminescent mushroom grove, and each glowing marker mushroom is one chapter:

1. **CBU** · 2. **Freelance** · 3. **VICE** · 4. **Apple** · 5. **Experiments** · 6. **Local Lab**

The grove is set at golden hour: a low, warm sun through amber haze, with the mushrooms still glowing. The walk is the story: each chapter adds skills, and its garden grows from them. CBU is one small mushroom; Freelance a small, varied cluster; VICE taller and more expressive; Apple a refined garden in ordered rows; Experiments the largest, densest grove, ringing the featured projects. Each garden's dates hang over it in the world, so the timeline reads from the projected view, and each chapter card lists the skills that chapter added. Every skill is also a mushroom: it sprouts beside its chapter's marker, wearing its name, when the Gardener gets there, and stays grown for the rest of the walk. VICE and Apple have their logos floating, glowing, over their markers (glow masks made from the logos in `docs/logos/`; add another with a `logo` key in `src/data/cv.js` and an entry in `src/world/logos.js`). The Experiments are Balloon Type Field, MiloPop, Visual Creature Compiler and StressType. The gardens are grown from data profiles in `src/data/cv.js` (`garden`) by `src/world/garden.js`, deterministically, keeping every stand point, walk and project clear.

It's built to sit behind a live talk. The tour moves only when the presenter says so, and visitors can wander freely afterwards.

## Presentation mode

**P**, the **Present** button (start screen or top right), or `?present` in the URL. The screen keeps just the grove, the card, two big arrows and a progress bar. **→** / **←**, the arrows, a clicker (PageDown / PageUp) or Space step through every section: the five chapters, each experiment in turn after Experiments, then the Local Lab. The Gardener still walks each hop, boredom and the Local Lab handoff work as usual, and the dots on the progress bar jump straight to a section. **P** or **Esc** leaves it on the same stop.

## Controls

| | |
| --- | --- |
| **P** | presentation mode on / off (above) |
| **N** / **PageDown** / **]** | next stop |
| **B** / **PageUp** / **[** | previous stop |
| **1**–**6** | jump to a stop |
| **Q** / **E** | browse the featured projects (from the Experiments stop, a project card, or Free Explore) |
| **L** | jump to the Local Lab from anywhere (Free Explore included) |
| **V** / **I** | labels on / off · info card on / off |
| **+** / **−** | text size: 100, 125, 150, 175% (remembered); also **A−** / **A+** top right |
| **R** | in Free Explore, back to the stop you left (same as **G**) |
| **F** | Free Explore (press again, or **G**, to return to the tour) |
| **Enter** | begin the tour from the start screen |
| **WASD** / arrows, **Shift**, **C** | walk, run, sit (the original Mycelia controls) |
| drag / scroll / pinch | look around and zoom |
| **H** / **?** | hide the interface / show help |

Clicker remotes that send PageUp/PageDown work out of the box. Tapping a mushroom or its label walks the Gardener there. In Free Explore, tapping the ground walks him there too. Deep links such as `/#apple` start the tour at that stop.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (relative paths, GitHub Pages ready)
npm test         # unit tests: boredom clock, career skills, garden growth and layout (no browser needed)
npm run smoke    # just the staged classroom route (below), on a fresh page
npm run qa       # build, then drive the tour in headless Chromium; screenshots + report in .shots/
```

`npm run qa` runs at 1440×900 and 1920×1080. It checks that every stop is reached by walking, not teleporting; that the Gardener holds his place at a stop when left alone; that there's no auto-advance; that Free Explore and back keeps the tour's place; that number-key jumps work; and that the console stays clean. The career section (`--only chapters`) captures every chapter and a wide view of the whole timeline, and checks each date label is shown over its garden, brightest at the current stop and clear of the card and every label; that each card lists exactly its chapter's skills; that the gardens grow chapter by chapter; that each chapter's skills grow in as named mushrooms on arrival (earlier chapters' stay grown, later ones' aren't yet); that the VICE and Apple logos float lit over their markers, on screen and clear of the date; that standing still, every label holds perfectly still; and that the Gardener can walk to and kneel at every project. `--only present` steps through every section of presentation mode with the arrow keys, the on-screen arrows, PageUp and the progress dots. Add `--skip-build` to reuse `dist/`, or `--sizes 1440x900` for a single size.

Software GL renders only a few frames a second, so QA loads the page with `?quality=low&timescale=6`. `timescale` is a test/dev-only URL parameter that runs N simulation steps per rendered frame. It doesn't change anything for a normal visitor.

## State model

`src/modes/CVMode.js` owns the tour state. Later features (the boredom timer, the Local Lab handoff) subscribe with `cv.onState(fn)`:

| field | meaning |
| --- | --- |
| `currentStop` | stop id the tour is on (`null` before it starts); kept through Free Explore |
| `tourMode` | `'intro'`, `'guided'` or `'free'` |
| `presenterPaused` | `true` while the tab is hidden, e.g. after switching to Finder |
| `avatarAtStop` | the Gardener has arrived and is standing at `currentStop` |
| `bored` | he has waited 180 s at the current stop (see below) |
| `labPhase` | the Local Lab beat: `idle`, `sitting`, `speaking`, `handoff`, `away` or `back` (see below) |
| `present` | presentation mode is on (see above) |

While the tour is guided, `CVMode.holdAvatar()` suspends the Gardener's idle behaviour (auto-sit after 6 s, wander home after 40 s). He stays standing at the stop for as long as the presenter talks. Free Explore brings that behaviour back. If a walk gets blocked, the tour tries once from another side, then frames the stop anyway.

## For the day: presenter view, contingencies, and the smoke route

**Presenter view** (top right, and the keys above): show or hide the labels and the info card, bump the text size for a projector (100–175%, remembered), go fullscreen (**Full**, or your browser's own). **H** hides everything. Every control is reachable by keyboard, and each button is at least 24 × 24 px (44 px on touch screens). The tour never advances by itself, and nothing here touches your computer.

**If something goes wrong:**
- **No WebGL, or a broken graphics driver:** the page shows the whole CV as a plain list with the verified links, the experiments included. **Text version** on the start screen opens a simpler list over the grove in any browser: the career only, without the experiments.
- **No network:** nothing is fetched. All content is in the page, and the demo links simply won't open.
- **A demo link is missing:** that card says *Live on Colson's Mac* or *No public link yet*, never a dead button.
- **Graphics context lost** (sleep, GPU reset): a notice appears and the engine recovers on its own. One bad frame is reported once and drawing carries on.
- **Tab hidden / Cmd-Tab to Finder:** the scene holds exactly; the boredom clock pauses; the Local Lab offers Q&A when you return.
- **Reduced motion:** the Gardener's bored loop becomes a stable pose.
- **Phones:** the layout fits (checked at 390 × 844), though the show is built for a laptop and a projector.

**What's verified, and what's yours to check on the day:** see [QA.md](QA.md), with screenshots in [docs/screenshots](docs/screenshots/).

**The staged smoke route** (`npm run smoke`): CBU, Freelance, VICE, Apple, Projects (the first project's demo link), Local Lab, then Cmd-Tab to Finder and back for Q&A. Each hop is checked to be a real walk. It runs on a fresh page at 1440 × 900 and 1920 × 1080 as part of `npm run qa`.

**Deploy (GitHub Pages):** under **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**, not *Deploy from a branch*. Until you do, every deploy of this repo's workflow fails at `configure-pages` with "Get Pages site failed". The site then lives at `https://coobytron.github.io/Colson.CV/`. The build uses relative paths, and QA serves it from `/Colson.CV/` to prove that. It doesn't touch Mycelia 2's own deployment.

**If Pages is set to *Deploy from a branch* by mistake:** GitHub then serves the repo files as they are, not the Vite build. The page still runs, because `index.html` carries an import map that loads three.js 0.180.0 from the jsDelivr CDN. QA boots the unbuilt source to prove it. It needs a network connection for three.js and loads more slowly, so the Actions deploy is the one to use on the day. Without that import map the page would show "The grove couldn't start: Failed to resolve module specifier 'three'" in Safari.

## Local Lab: the handoff to your Mac

The last stop is a small workstation in the grove: a rug, a low desk and a monitor. The Gardener walks over, sits cross-legged with his laptop open, and looks at the monitor. The camera frames his face and the screen. The monitor is only a glowing panel that says the Metal shaders run on your Mac. Nothing in the page runs, opens or asks for anything on your computer.

1. He sits, and after a moment a speech bubble says: *"I can't open Metal shaders in here… they're on my Mac."* It fades on its own.
2. A **LOCAL LAB · LIVE DEMO** card appears beside the scene: *Switch to Finder to open the Metal shaders (⌘ Tab)*. It also has a **Back to the forest** button.
3. You Cmd-Tab to Finder yourself. The page holds exactly as it is. He stays seated, the tour doesn't advance, he doesn't go home, and he doesn't get bored. Nothing restarts.
4. When you come back, the card says **Welcome back**, the status pill reads **Q&A · Local Lab**, and **Back to the forest** (Free Explore) is on offer. The previous-stop arrow is on the card too.

**Jump to Local Lab** with **L** from anywhere, or with the Local Lab chip in the dock (also **6**). It works from the guided tour and from Free Explore. Leaving the lab resets it, so every revisit replays the beat, and pressing **L** while already there replays it too.

**What counts as "away":** the window losing focus (Cmd-Tab) or the tab being hidden. The Local Lab also holds the boredom clock for the whole stay, so a long Q&A at the desk is never treated as boredom.

**Standalone:** it needs no local files and makes no network requests. The Pages build works the same with or without the shaders on any machine.

## Bored at a stop

If the Gardener has been waiting at a stop for **180 seconds**, he gets visibly bored while you keep talking. He eases into a slouch and a 15-second loop of understated gestures: a glance at the audience, a weight shift and foot tap, a look at an invisible watch, a stretch, a sigh. The camera eases in a little so the room can see it. There's no sound, no popup, and the tour never advances on its own. He stays bored for as long as you stay at the stop.

- **When the clock runs:** only in the guided tour, once he has *arrived and stopped* at a career stop. It also runs at a project, where he kneels at the mushroom and stands up when he gets bored. It doesn't run while he's walking, in Free Explore, or on the start screen.
- **What resets it:** walking him (WASD or tap), next/previous, picking a stop or project, Free Explore, or revisiting a stop. Each starts a fresh 180 s. Mouse movement does not reset it.
- **What pauses it** (the elapsed time is kept, not reset): the tab being hidden, and `cv.holdBoredom('handoff', true)`, which the Local Lab handoff will use. It never fires while paused, and returning doesn't trigger it.
- **Reduced motion:** with `prefers-reduced-motion`, he holds a stable slouch with a tilted head instead of the looping gestures.
- **Testing:** `src/avatar/boredom.js` is a pure clock, unit-tested at 179.9 s versus 180.0 s (`npm test`). The browser QA checks **every section on the real 180 s clock** by stepping the simulation directly (an accelerated test clock): at each career stop and at a project, he is not bored at 179.95 s and is bored at 180.00 s, and the Local Lab stays un-bored for four minutes. That `?boredom=5` shortcut exists for local development only and is stripped from production builds, and `cv.boredom.seconds` is 180 for real visitors.

## Content

[`src/data/cv.js`](src/data/cv.js) holds all of it.
- **Career stops** are walked in `presentationOrder`. The copy is intentionally brief, and anything awaiting confirmation goes in a stop's `unconfirmed` field.
- **Featured projects** grow in a clearing behind the Experiments stop. The Experiments card lists them as buttons, so you don't need to hit a mushroom precisely.
- **Project links:** a project card shows **Open demo** only for a `demoLink` that has been checked to load. Otherwise it says *Live on Colson's Mac* (`availability: 'local'`) or *No public link yet*.
- **Repos:** every project with a live GitHub Pages demo also shows a **Code** button to its repo (`repoLink`). Leave `repoLink` as `null` for anything without one.

## Deploy

`.github/workflows/deploy-pages.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`. In the repo, set **Settings → Pages → Source** to **GitHub Actions**. Deploying this repo doesn't touch Mycelia 2's own deployment.

## Source and license

The world, mushrooms, Gardener rig and poses, steering, post-processing and UI helpers are ported from [Mycelia 2](https://github.com/coobytron/Mushroom-Sim-2) (MIT, © 2026 Colson Knight), with the Projects, Garden, Simulate and Ecosystems modes left out. Changes from the source:

- `src/avatar/Avatar.js` gains a `holdAvatar()` mode hook.
- New: `src/modes/CVMode.js`, `src/data/cv.js`, `src/main.js`, `src/cv.css`, `index.html` and `scripts/qa.mjs`.

Everything is [MIT](LICENSE).
