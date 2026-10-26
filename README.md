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

While the tour is guided, `CVMode.holdAvatar()` suspends the Gardener's idle behaviour (auto-sit after 6 s, wander home after 40 s). He stays standing at the stop for as long as the presenter talks. Free Explore brings that behaviour back. If a walk gets blocked, the tour tries once from another side, then frames the stop anyway.

## Content

[`src/data/cv.js`](src/data/cv.js) holds all of it.
- **Career stops** are walked in `presentationOrder`. The copy is intentionally brief, and anything awaiting confirmation goes in a stop's `unconfirmed` field.
- **Featured projects** grow in a clearing behind the Experiments stop. The Experiments card lists them as buttons, so you don't need to hit a mushroom precisely.
- **Project links:** a project card shows **Open demo** only for a `demoLink` that has been checked to load. Otherwise it says *Live on Colson's Mac* (`availability: 'local'`) or *No public link yet*.
- **Repos:** `repoLink` stays `null` unless the repo is confirmed public. Never put a private repo URL there.

## Deploy

`.github/workflows/deploy-pages.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`. In the repo, set **Settings → Pages → Source** to **GitHub Actions**. Deploying this repo doesn't touch Mycelia 2's own deployment.

## Source and license

The world, mushrooms, Gardener rig and poses, steering, post-processing and UI helpers are ported from [Mycelia 2](https://github.com/coobytron/Mushroom-Sim-2) (MIT, © 2026 Colson Knight), with the Projects, Garden, Simulate and Ecosystems modes left out. Changes from the source:

- `src/avatar/Avatar.js` gains a `holdAvatar()` mode hook.
- New: `src/modes/CVMode.js`, `src/data/cv.js`, `src/main.js`, `src/cv.css`, `index.html` and `scripts/qa.mjs`.

Everything is [MIT](LICENSE).
