# Colson.CV — a playable CV

Colson Knight's CV as a small game. The Gardener from [Mycelia 2](https://github.com/coobytron/Mushroom-Sim-2) walks a bioluminescent mushroom grove, and each glowing marker mushroom is one chapter:

1. **CBU** · 2. **Freelance** · 3. **VICE** · 4. **Apple** · 5. **Experiments** · 6. **Local Lab**

It's built to sit behind a live talk. The tour moves only when the presenter says so, and visitors can wander freely afterwards.

## Controls

| | |
| --- | --- |
| **N** / **PageDown** / **]** | next stop |
| **B** / **PageUp** / **[** | previous stop |
| **1**–**6** | jump to a stop |
| **Q** / **E** | browse the featured projects (from the Experiments stop, a project card, or Free Explore) |
| **L** | jump to the Local Lab from anywhere (Free Explore included) |
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
npm test         # unit tests for the boredom clock (no browser needed)
npm run qa       # build, then drive the tour in headless Chromium; screenshots + report in .shots/
```

`npm run qa` runs at 1440×900 and 1920×1080. It checks that every stop is reached by walking, not teleporting; that the Gardener holds his place at a stop when left alone; that there's no auto-advance; that Free Explore and back keeps the tour's place; that number-key jumps work; and that the console stays clean. Add `--skip-build` to reuse `dist/`, or `--sizes 1440x900` for a single size.

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

While the tour is guided, `CVMode.holdAvatar()` suspends the Gardener's idle behaviour (auto-sit after 6 s, wander home after 40 s). He stays standing at the stop for as long as the presenter talks. Free Explore brings that behaviour back. If a walk gets blocked, the tour tries once from another side, then frames the stop anyway.

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
- **Testing:** `src/avatar/boredom.js` is a pure clock, unit-tested at 179.9 s versus 180.0 s (`npm test`). In the browser, tests set `cv.boredom.seconds`. For local development only, `?boredom=5` shortens it, and that parameter is stripped from production builds.

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
