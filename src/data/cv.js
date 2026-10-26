// CV content: career chapter stops (walked in presentationOrder) and the featured project mushrooms.
// Copy is deliberately short: the presenter talks to each stop live. Only facts given by Colson are used;
// anything still awaiting confirmation is listed in `unconfirmed` and worded neutrally.
//
// Stop fields: id (stable, used in URLs and by later features), category 'career', label, dates, summary,
//   strain + color (marker mushroom), x / z (marker position), presentationOrder, links ([{ label, href }],
//   public and verified only), unconfirmed (string[]), skills (string[]: what this chapter *added*; the story is
//   cumulative, so each card shows only its own), garden (the chapter's visual profile, see below).
//   `dates` is the one source for the chapter cards, the text version and the date hovering over each garden.
//
// Garden profiles (#15): the career reads as skills compounding into an ever larger living grove, from one
// small mushroom at CBU to the Experiments garden. Each stop's grove is grown from its profile (see
// src/world/garden.js), so the progression lives here rather than as magic numbers in the renderer:
//   marker   scale of the chapter's own mushroom      count   companion mushrooms around it
//   spread   arc (rad) they fan across, behind it     ring    [min, max] distance from the marker
//   scale    [min, max] companion scale               strains which strains grow there (variety of form)
//   variety  genome mutation rate (0 = uniform)       tall    stem height multiplier (VICE stretches up)
//   glow     bioluminescence multiplier               mycelium / twigs  thread strength and branching
//   rows     optional: lay companions out in ordered rows (Apple's structured, intentional garden)
//   view     camera distance when framing the stop
// Project fields: id, category 'project', label, summary, strain + color, demoLink (verified public URL or
//   null), repoLink (repo URL or null; set only where Colson has OK'd it), availability: 'web' (has demoLink),
//   'local' (runs only on Colson's Mac) or 'none' (no public link established yet). Project positions are
//   laid out in a clearing beside the Experiments stop (see projectClearing).
//
// Link check (2026-10-26): every demoLink below returned HTTP 200 with the project's own page title.
// repoLink: Colson's call (2026-10-26) — every project with a live GitHub Pages demo also links its repo.
export default {
  name: 'Colson Knight',
  role: 'Art Director',
  stops: [
    {
      id: 'cbu',
      category: 'career',
      label: 'CBU',
      dates: '2009 – 2011',
      summary: 'Where it started: design education.',
      strain: 'porcelain',
      color: '#e9f1ff',
      x: -8.5, z: 7.5,
      skills: ['Design foundations', 'Typography and composition', 'Visual thinking', 'Interest in code'],
      garden: { marker: 0.78, count: 0, spread: 0, ring: [0, 0], scale: [0, 0], strains: [], variety: 0.12, tall: 1, glow: 0.8, mycelium: 0.5, twigs: 0, view: 7 },
      presentationOrder: 1,
      links: [],
      unconfirmed: [],
    },
    {
      id: 'freelance',
      category: 'career',
      label: 'Freelance',
      dates: '2012 – 2014',
      summary: 'Brand and web work for KREW / Supra, PacSun, Vissla and small businesses; a production assistant role and EPK work on film.',
      strain: 'ember',
      color: '#ff9a3c',
      x: -11.5, z: -0.5,
      skills: ['Production skills', 'Design skills', 'Experimentation'],
      garden: { marker: 1.05, count: 6, spread: 2.2, ring: [1.0, 2.1], scale: [0.32, 0.55], strains: ['ember', 'porcelain', 'moss', 'inkcap'], variety: 0.32, tall: 1, glow: 0.9, mycelium: 0.8, twigs: 1, view: 7.2 },
      presentationOrder: 2,
      links: [],
      unconfirmed: [],
    },
    {
      id: 'vice',
      category: 'career',
      label: 'VICE',
      dates: 'Jan 2014 – Apr 2016',
      summary: 'Designer.',
      strain: 'agaric',
      color: '#ff5c8a',
      x: -6, z: -8.5,
      skills: ['Art direction', 'Experiential design', 'Directing', 'Animation'],
      garden: { marker: 1.35, count: 9, spread: 2.5, ring: [1.0, 2.5], scale: [0.5, 0.85], strains: ['agaric', 'ember', 'inkcap', 'ghost'], variety: 0.3, tall: 1.35, glow: 1.05, mycelium: 1.0, twigs: 2, view: 8 },
      presentationOrder: 3,
      links: [],
      unconfirmed: [],
    },
    {
      id: 'apple',
      category: 'career',
      label: 'Apple',
      dates: 'Apr 2016 – present',
      summary: 'Senior Art Director. Apple Music visual design, Radio and DJ Mix.',
      strain: 'ghost',
      color: '#5ff2e2',
      x: 3.5, z: -9.5,
      skills: ['Creative direction', 'Presentation design', 'Relationships', 'Organizational navigation'],
      garden: { marker: 1.5, count: 13, spread: 2.4, ring: [1.4, 3.4], scale: [0.6, 1.0], strains: ['ghost', 'porcelain'], variety: 0.08, tall: 1.15, glow: 1.15, mycelium: 1.2, twigs: 2, rows: 3, view: 9 },
      presentationOrder: 4,
      links: [],
      unconfirmed: [],
    },
    {
      id: 'experiments',
      category: 'career',
      label: 'Experiments',
      dates: 'Ongoing',
      summary: 'Creative technology on the side. The clearing behind me holds a few favourites.',
      strain: 'violet',
      color: '#a98bff',
      x: 10.5, z: -2.5,
      skills: ['Creative coding', 'Generative systems', 'Prototyping', 'Interactive design', 'Self-directed tool building'],
      garden: { marker: 1.75, count: 46, spread: 3.6, ring: [1.0, 4.8], scale: [0.45, 1.25], strains: ['violet', 'ghost', 'ember', 'agaric', 'moss', 'inkcap', 'porcelain'], variety: 0.4, tall: 1.25, glow: 1.4, mycelium: 1.6, twigs: 3, view: 10.5 },
      presentationOrder: 5,
      links: [],
      unconfirmed: [],
    },
    {
      id: 'local-lab',
      category: 'career',
      label: 'Local Lab',
      dates: 'Live',
      summary: 'The last stop: work that only runs on my Mac.',
      strain: 'moss',
      color: '#b6f45a',
      x: 8, z: 6.5,
      standOff: 2.0, // the Gardener sits at a workstation on the grove side of this marker (see LocalLab.js)
      skills: [],
      garden: { marker: 1.55, count: 4, spread: 2.4, ring: [1.1, 1.8], scale: [0.42, 0.74], strains: ['moss'], variety: 0.22, tall: 1, glow: 1, mycelium: 1, twigs: 1, view: 7.5 },
      presentationOrder: 6,
      links: [],
      unconfirmed: [],
    },
  ],

  // the experimental clearing: centre and radius of the ring the project mushrooms grow in
  projectClearing: { x: 13.6, z: -4.6, r: 2.3, stop: 'experiments' },

  projects: [
    {
      id: 'mycelia-2',
      category: 'project',
      label: 'Mycelia 2',
      summary: 'The world you’re standing in: a bioluminescent mushroom portfolio, garden builder and ecosystem simulator.',
      strain: 'ghost',
      color: '#5ff2e2',
      demoLink: 'https://coobytron.github.io/Mushroom-Sim-2/',
      repoLink: 'https://github.com/coobytron/Mushroom-Sim-2',
      availability: 'web',
    },
    {
      id: 'visual-synth',
      category: 'project',
      label: 'Visual Synth',
      summary: 'Experimental controls for playing visuals like an instrument.',
      strain: 'violet',
      color: '#a98bff',
      demoLink: null,
      repoLink: null,
      availability: 'none',
    },
    {
      id: 'kinetic-type',
      category: 'project',
      label: 'Kinetic Type',
      summary: 'A kinetic typography lab: compose type with gravity, wind, a cursor fan and drag-and-drop letters.',
      strain: 'ember',
      color: '#ff9a3c',
      demoLink: 'https://coobytron.github.io/kinetic-type/',
      repoLink: 'https://github.com/coobytron/kinetic-type',
      availability: 'web',
    },
    {
      id: 'milopop',
      category: 'project',
      label: 'MiloPop',
      summary: 'A character figure maker, built to go from screen to 3D print.',
      strain: 'agaric',
      color: '#ff5c8a',
      demoLink: 'https://coobytron.github.io/MiloPop/',
      repoLink: 'https://github.com/coobytron/MiloPop',
      availability: 'web',
    },
    {
      id: 'draw-things-control',
      category: 'project',
      label: 'Draw Things Control',
      summary: 'Local creative tooling for driving image generation.',
      strain: 'inkcap',
      color: '#cfd6ff',
      demoLink: null,
      repoLink: null,
      availability: 'local',
    },
    {
      id: 'dazzle-camo-studio',
      category: 'project',
      label: 'Dazzle Camo Studio',
      summary: 'A WebGL instrument for designing, studying, mapping and publishing First World War dazzle camouflage.',
      strain: 'porcelain',
      color: '#e9f1ff',
      demoLink: 'https://coobytron.github.io/dazzle-camo-studio/',
      repoLink: 'https://github.com/coobytron/dazzle-camo-studio',
      availability: 'web',
    },
    {
      id: 'nca-splash',
      category: 'project',
      label: 'NCA Splash',
      summary: 'A cellular automata splash page: the homepage copy seeds the Game of Life, so the words become the system.',
      strain: 'moss',
      color: '#b6f45a',
      demoLink: 'https://coobytron.github.io/NCA-Splash/',
      repoLink: 'https://github.com/coobytron/NCA-Splash',
      availability: 'web',
    },
  ],
};
