// CV chapter stops, in walk order. Copy is deliberately short: the presenter talks to each stop live.
// Facts come from the issue brief only; anything not yet confirmed is marked `unconfirmed` and worded
// neutrally. Full stop copy and the project mushrooms are issue #2.
//
// Fields: id (stable, used in URLs and by later features), title, dates, summary, strain + color
// (the stop's marker mushroom), x / z (marker position in the grove), links ([{ label, href }], public
// URLs only), unconfirmed (string[] of details awaiting confirmation).
export default {
  name: 'Colson Knight',
  role: 'Art Director',
  stops: [
    {
      id: 'cbu',
      title: 'CBU',
      dates: '2009 – 2011',
      summary: 'Where it started: design education.',
      strain: 'porcelain',
      color: '#e9f1ff',
      x: -8.5, z: 7.5,
      links: [],
      unconfirmed: [],
    },
    {
      id: 'freelance',
      title: 'Freelance',
      dates: '2012 – 2014',
      summary: 'Brand and web work for KRCW / Supra, PacSun, Vissla and small businesses; a production assistant role and EPK work on film.',
      strain: 'ember',
      color: '#ff9a3c',
      x: -11.5, z: -0.5,
      links: [],
      unconfirmed: ['KRCW / Supra spelling'],
    },
    {
      id: 'vice',
      title: 'VICE',
      dates: 'Jan 2014 – Apr 2016',
      summary: 'Creative and design work.',
      strain: 'agaric',
      color: '#ff5c8a',
      x: -6, z: -8.5,
      links: [],
      unconfirmed: ['Formal title'],
    },
    {
      id: 'apple',
      title: 'Apple',
      dates: 'c. 2017 – present',
      summary: 'Senior Art Director. Apple Music visual design, Radio and DJ Mix.',
      strain: 'ghost',
      color: '#5ff2e2',
      x: 3.5, z: -9.5,
      links: [],
      unconfirmed: ['Start date'],
    },
    {
      id: 'experiments',
      title: 'Experiments',
      dates: 'Ongoing',
      summary: 'Creative technology on the side: simulations, type, characters and tools.',
      strain: 'violet',
      color: '#a98bff',
      x: 10.5, z: -2.5,
      links: [{ label: 'GitHub', href: 'https://github.com/coobytron' }],
      unconfirmed: [],
    },
    {
      id: 'local-lab',
      title: 'Local Lab',
      dates: 'Live',
      summary: 'The last stop: work that only runs on my Mac.',
      strain: 'moss',
      color: '#b6f45a',
      x: 8, z: 6.5,
      links: [],
      unconfirmed: [],
    },
  ],
};
