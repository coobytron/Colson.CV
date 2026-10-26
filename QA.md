# Classroom readiness: what's verified, and what's yours to check

Written for the day of the talk. The first half is what the automated QA proves. The second half is what only a person on a real machine can confirm.

## Verified automatically (`npm run build`, `npm test`, `npm run qa`)

Run in headless Chromium with software rendering, at **1440 × 900** and **1920 × 1080**, on a fresh page each time. Screenshots land in `.shots/` (not committed; a few are in [`docs/screenshots/`](docs/screenshots/)).

**The staged smoke route** (`npm run smoke`): CBU → Freelance → VICE → Apple → Projects (the first project's demo link) → Local Lab → Cmd-Tab to Finder and back → Q&A. Each hop is a real walk, not a jump.

**The 3-minute boredom, on the real 180 s clock, per section.** The simulation is stepped directly (an accelerated test clock) so 180 s takes seconds. At CBU, Freelance, VICE, Apple, Experiments and at a project: not bored at 179.95 s, bored at 180.00 s. The default limit is checked to be 180 s, with nothing shortened. Local Lab stays un-bored for four minutes. The clock logic is also unit-tested (`npm test`, 10 tests).

**Presenter controls:** V (labels), I (card), + / − and A− / A+ (text size 100–175%, remembered across a reload), Full, H, L (Local Lab), F / G / R (Free Explore and back), N / B / 1–6 (stops). At every text size the card, dock and top bar stay on screen, the card clears the dock, and nothing scrolls sideways.

**Accessibility basics:** every control is reachable by keyboard; every visible button and link is at least 24 × 24 px (the WCAG 2.2 AA minimum); the speech bubble is a polite live region; reduced motion swaps the Gardener's looping gestures for a stable pose.

**Contingencies:**
- **No WebGL:** the whole CV shows as a list with exactly the verified links.
- **Text version** opens the same list over the grove; Esc closes it.
- **No network:** no request leaves the page's own origin, anywhere.
- **Hidden tab / Cmd-Tab:** the scene holds exactly, with no restart, no walking home and no boredom.
- **Phone width (390 × 844):** the layout fits.
- **GitHub Pages sub-path:** the build is served from `/Colson.CV/` with no failed requests.
- **Console:** no errors in any run.

## Not verified: your on-device pass (about 10 minutes)

None of this can be checked from a build session. In rough order:

1. **Pages source = GitHub Actions** (Settings → Pages → Build and deployment → Source; not *Deploy from a branch*), then check the live URL: `https://coobytron.github.io/Colson.CV/`. With the wrong source the workflow fails at `configure-pages`, and the site is served unbuilt through the CDN import map (it works, but it needs the network). Check the live page really is the built one: its `<script src>` should point into `assets/`, not `src/main.js`.
2. **Open it on the real projector or display**, at its real resolution, in **Chrome and Safari**. QA only ran Chromium, in software. Check the frame rate and that nothing stutters on the Gardener's walks.
3. **Run the smoke route with your clicker** (PageDown / PageUp should work).
4. **A real Cmd-Tab at the Local Lab.** Switch to Finder, open one of your Metal shaders, come back. Check the scene is exactly as you left it and the card says Welcome back. QA simulates blur and focus events, not a real app switch.
5. **Text size from the back of the room.** Try 150% and 175% on the projector.
6. **Contrast on the projector.** I checked layout and size but did not measure colour contrast. Projectors wash out dim text, such as the grey notes on the cards. Tell me what's hard to read and I'll lift it.
7. **The look of it.** The Gardener is a dark silhouette lit mostly by the laptop and monitor glow, and the Local Lab desk and monitor are simple props. This is your art direction call, not a test.
8. **Real boredom, once.** Sit at a stop for three real minutes and watch it. The accelerated test proves the timing. Only you can judge how the gag looks and feels.
9. **Every Open demo and Code button** on the project cards, from the live site. Note that the Mycelia 2 Code button points at `Mushroom-Sim-2`; if that repo is private, visitors will get a 404.
10. **Fullscreen** (the Full button) in your browser. Browsers differ on whether they allow it.
11. **Touch screens and trackpads:** I did not test on real touch hardware.

## Known limits

- Only headless Chromium on software GL was tested. Safari, Firefox and real GPUs weren't.
- Visual Synth has no public link yet, and Draw Things Control is "Live on Colson's Mac" by design.
- "Away" at the Local Lab means the window losing focus or the tab being hidden. Switching to Finder does that, but so does clicking into DevTools or another window. The card then says Welcome back when you click back into the page.
