/**
 * Guia de Winden (2026-11-11): a spoiler-free guide to the first season of "Dark" (Netflix, 2017).
 * Every place, era and person carries the episode from which it may be shown ("watched through
 * episode N"). The gates are deliberately late: something appearing an episode after it first
 * shows on screen costs nothing, one episode early is a spoiler. The text says who people are and
 * where things are, never why anything happens; the mysteries are never explained.
 *
 * Facts only (names, places, relations shown on screen); the descriptions are ours. Episode titles
 * are the original German ones.
 */

export type Era = '2019' | '1986' | '1953';
export const ERAS: { id: Era; from: number }[] = [
  { id: '2019', from: 1 },
  { id: '1986', from: 3 },
  { id: '1953', from: 8 },
];

export const EPISODES = [
  'Geheimnisse',
  'Lügen',
  'Gestern und Heute',
  'Doppelleben',
  'Wahrheiten',
  'Sic Mundus Creatus Est',
  'Kreuzwege',
  'Was man sät, das wird man ernten',
  'Alles ist jetzt',
  'Alpha und Omega',
] as const;
export const EPISODE_COUNT = EPISODES.length;

export type Family = 'kahnwald' | 'nielsen' | 'doppler' | 'tiedemann' | 'outros';
export const FAMILIES: { id: Family; label: string }[] = [
  { id: 'kahnwald', label: 'Kahnwald' },
  { id: 'nielsen', label: 'Nielsen' },
  { id: 'doppler', label: 'Doppler' },
  { id: 'tiedemann', label: 'Tiedemann' },
  { id: 'outros', label: 'Outras pessoas' },
];

/** A text that changes as more is shown: the last entry whose `from` ≤ the episode wins. */
type Staged = { from: number; text: string }[];

export type Place = {
  id: string;
  name: string;
  /** position on the illustrated map (viewBox 1000 × 620) */
  x: number;
  y: number;
  icon: 'cave' | 'plant' | 'school' | 'police' | 'house' | 'hotel' | 'care' | 'clock';
  /** what the place is in each era, and from when */
  eras: Partial<Record<Era, Staged>>;
};

export type Version = {
  era: Era;
  from: number;
  text: Staged;
  places: string[];
};

export type Person = {
  id: string;
  name: string;
  family: Family;
  versions: Version[];
};

export const PLACES: Place[] = [
  {
    id: 'cavernas',
    name: 'Cavernas de Winden',
    x: 520,
    y: 150,
    icon: 'cave',
    eras: {
      '2019': [
        {
          from: 1,
          text: 'Uma rede de cavernas no meio da floresta, perto da usina. Em Winden, as crianças crescem ouvindo que não devem entrar lá.',
        },
      ],
      '1986': [{ from: 3, text: 'As mesmas cavernas, na floresta.' }],
      '1953': [{ from: 8, text: 'As mesmas cavernas, na floresta.' }],
    },
  },
  {
    id: 'usina',
    name: 'Usina nuclear',
    x: 800,
    y: 250,
    icon: 'plant',
    eras: {
      '2019': [
        {
          from: 1,
          text: 'A usina nuclear de Winden, com as torres de resfriamento que se veem de toda a cidade. A maior empregadora da região.',
        },
      ],
      '1986': [{ from: 3, text: 'A usina já funciona e é o centro da vida da cidade.' }],
      '1953': [
        {
          from: 8,
          text: 'A usina ainda não existe: o terreno onde ela vai ficar é um canteiro de obras.',
        },
      ],
    },
  },
  {
    id: 'escola',
    name: 'Escola de Winden',
    x: 330,
    y: 470,
    icon: 'school',
    eras: {
      '2019': [
        {
          from: 1,
          text: 'O colégio da cidade. Jonas, Martha, Bartosz, Magnus e Franziska estudam aqui.',
        },
      ],
      '1986': [{ from: 3, text: 'O mesmo colégio, com outra geração de alunos.' }],
    },
  },
  {
    id: 'delegacia',
    name: 'Delegacia',
    x: 205,
    y: 395,
    icon: 'police',
    eras: {
      '2019': [{ from: 1, text: 'A polícia de Winden, que investiga os desaparecimentos.' }],
      '1986': [{ from: 3, text: 'A polícia investiga o sumiço de Mads Nielsen.' }],
      '1953': [
        {
          from: 8,
          text: 'A polícia investiga o caso dos dois meninos encontrados na obra da usina.',
        },
      ],
    },
  },
  {
    id: 'hotel',
    name: 'Waldhotel Winden',
    x: 230,
    y: 175,
    icon: 'hotel',
    eras: {
      '2019': [{ from: 2, text: 'O hotel da cidade, cercado pela floresta.' }],
    },
  },
  {
    id: 'casa-kahnwald',
    name: 'Casa dos Kahnwald',
    x: 120,
    y: 300,
    icon: 'house',
    eras: {
      '2019': [{ from: 1, text: 'Onde moram Jonas e a mãe, Hannah.' }],
    },
  },
  {
    id: 'casa-nielsen',
    name: 'Casa dos Nielsen',
    x: 470,
    y: 545,
    icon: 'house',
    eras: {
      '2019': [{ from: 1, text: 'Onde moram Ulrich, Katharina e os três filhos.' }],
      '1986': [{ from: 4, text: 'A casa da família de Ulrich e de Mads.' }],
    },
  },
  {
    id: 'casa-doppler',
    name: 'Casa dos Doppler',
    x: 110,
    y: 520,
    icon: 'house',
    eras: {
      '2019': [{ from: 1, text: 'Onde moram Charlotte, Peter e as duas filhas.' }],
    },
  },
  {
    id: 'casa-tiedemann',
    name: 'Casa dos Tiedemann',
    x: 640,
    y: 470,
    icon: 'house',
    eras: {
      '2019': [{ from: 2, text: 'Onde moram Regina, Aleksander e Bartosz.' }],
      '1953': [{ from: 9, text: 'A casa de Egon e Doris Tiedemann, que alugam um quarto.' }],
    },
  },
  {
    id: 'casa-repouso',
    name: 'Casa de repouso',
    x: 360,
    y: 300,
    icon: 'care',
    eras: {
      '2019': [{ from: 7, text: 'A casa de repouso da cidade, na beira da floresta.' }],
    },
  },
  {
    id: 'relojoaria',
    name: 'Relojoaria',
    x: 560,
    y: 380,
    icon: 'clock',
    eras: {
      '2019': [{ from: 6, text: 'A pequena oficina de H. G. Tannhaus, o relojoeiro.' }],
    },
  },
];

const v = (era: Era, from: number, text: string | Staged, places: string[] = []): Version => ({
  era,
  from,
  text: typeof text === 'string' ? [{ from, text }] : text,
  places,
});

export const PEOPLE: Person[] = [
  // ── Kahnwald ──
  {
    id: 'jonas',
    name: 'Jonas Kahnwald',
    family: 'kahnwald',
    versions: [
      v(
        '2019',
        1,
        'Adolescente, filho de Hannah e Michael. Volta ao colégio depois de meses afastado.',
        ['casa-kahnwald', 'escola'],
      ),
    ],
  },
  {
    id: 'hannah',
    name: 'Hannah Kahnwald',
    family: 'kahnwald',
    versions: [
      v('2019', 1, 'Mãe de Jonas, viúva de Michael.', ['casa-kahnwald']),
      v('1986', 4, 'Hannah adolescente, colega de escola de Ulrich e Katharina.', ['escola']),
    ],
  },
  {
    id: 'michael',
    name: 'Michael Kahnwald',
    family: 'kahnwald',
    versions: [
      v('2019', 1, 'Pai de Jonas. Morreu pouco antes de a série começar.', ['casa-kahnwald']),
    ],
  },
  {
    id: 'ines',
    name: 'Ines Kahnwald',
    family: 'kahnwald',
    versions: [
      v('2019', 4, 'Mãe de Michael e avó de Jonas.'),
      v('1986', 5, 'Ines mais jovem, enfermeira.'),
    ],
  },
  // ── Nielsen ──
  {
    id: 'ulrich',
    name: 'Ulrich Nielsen',
    family: 'nielsen',
    versions: [
      v(
        '2019',
        1,
        [
          { from: 1, text: 'Policial. Casado com Katharina, pai de Magnus, Martha e Mikkel.' },
          {
            from: 3,
            text: 'Policial. Casado com Katharina, pai de Magnus, Martha e Mikkel. O irmão mais novo dele, Mads, sumiu em 1986.',
          },
        ],
        ['delegacia', 'casa-nielsen'],
      ),
      v('1986', 3, 'Ulrich adolescente, irmão mais velho de Mads.', ['escola', 'casa-nielsen']),
    ],
  },
  {
    id: 'katharina',
    name: 'Katharina Nielsen',
    family: 'nielsen',
    versions: [
      v('2019', 1, 'Diretora do colégio. Casada com Ulrich.', ['escola', 'casa-nielsen']),
      v('1986', 4, 'Katharina adolescente, namorada de Ulrich.', ['escola']),
    ],
  },
  {
    id: 'magnus',
    name: 'Magnus Nielsen',
    family: 'nielsen',
    versions: [v('2019', 1, 'O filho mais velho dos Nielsen.', ['escola', 'casa-nielsen'])],
  },
  {
    id: 'martha',
    name: 'Martha Nielsen',
    family: 'nielsen',
    versions: [
      v('2019', 1, 'Filha dos Nielsen. Amiga de Jonas e namorada de Bartosz.', [
        'escola',
        'casa-nielsen',
      ]),
    ],
  },
  {
    id: 'mikkel',
    name: 'Mikkel Nielsen',
    family: 'nielsen',
    versions: [
      v('2019', 1, 'O caçula dos Nielsen. Desaparece na noite do primeiro episódio.', [
        'casa-nielsen',
        'cavernas',
      ]),
      v('1986', 3, 'Mikkel, perdido em 1986.'),
    ],
  },
  {
    id: 'mads',
    name: 'Mads Nielsen',
    family: 'nielsen',
    versions: [v('1986', 3, 'Irmão mais novo de Ulrich. Está desaparecido há um mês.')],
  },
  {
    id: 'tronte',
    name: 'Tronte Nielsen',
    family: 'nielsen',
    versions: [
      v('2019', 1, 'Pai de Ulrich.'),
      v('1986', 4, 'Pai de Ulrich e de Mads.', ['casa-nielsen']),
      v('1953', 9, 'Tronte ainda menino, recém-chegado a Winden com a mãe.', ['casa-tiedemann']),
    ],
  },
  {
    id: 'jana',
    name: 'Jana Nielsen',
    family: 'nielsen',
    versions: [
      v('2019', 1, [
        { from: 1, text: 'Mãe de Ulrich.' },
        { from: 3, text: 'Mãe de Ulrich e de Mads, o filho que sumiu em 1986.' },
      ]),
      v('1986', 4, 'Mãe de Ulrich e de Mads.', ['casa-nielsen']),
    ],
  },
  {
    id: 'agnes',
    name: 'Agnes Nielsen',
    family: 'nielsen',
    versions: [
      v('1953', 9, 'Recém-chegada a Winden com o filho pequeno, Tronte.', ['casa-tiedemann']),
    ],
  },
  // ── Doppler ──
  {
    id: 'charlotte',
    name: 'Charlotte Doppler',
    family: 'doppler',
    versions: [
      v('2019', 1, 'Chefe de polícia de Winden. Casada com Peter.', ['delegacia', 'casa-doppler']),
    ],
  },
  {
    id: 'peter',
    name: 'Peter Doppler',
    family: 'doppler',
    versions: [
      v('2019', 1, 'Psicoterapeuta, atende Jonas. Casado com Charlotte, filho de Helge.', [
        'casa-doppler',
      ]),
    ],
  },
  {
    id: 'franziska',
    name: 'Franziska Doppler',
    family: 'doppler',
    versions: [v('2019', 1, 'A filha mais velha dos Doppler.', ['escola', 'casa-doppler'])],
  },
  {
    id: 'elisabeth',
    name: 'Elisabeth Doppler',
    family: 'doppler',
    versions: [
      v('2019', 1, 'A filha caçula dos Doppler. É surda e conversa em língua de sinais.', [
        'casa-doppler',
      ]),
    ],
  },
  {
    id: 'helge',
    name: 'Helge Doppler',
    family: 'doppler',
    versions: [
      v('2019', 2, 'Pai de Peter. Idoso, confuso e de poucas palavras.', ['casa-repouso']),
      v('1986', 5, 'Helge adulto. Trabalha na usina.', ['usina']),
      v('1953', 8, 'Helge ainda menino.'),
    ],
  },
  {
    id: 'bernd',
    name: 'Bernd Doppler',
    family: 'doppler',
    versions: [
      v('1986', 5, 'Pai de Helge. Fundador da usina.', ['usina']),
      v('1953', 9, 'Bernd jovem, que planeja a usina.', ['usina']),
    ],
  },
  {
    id: 'greta',
    name: 'Greta Doppler',
    family: 'doppler',
    versions: [v('1953', 9, 'Mãe de Helge. Severa.')],
  },
  // ── Tiedemann ──
  {
    id: 'regina',
    name: 'Regina Tiedemann',
    family: 'tiedemann',
    versions: [
      v('2019', 2, 'Dona do hotel. Casada com Aleksander, mãe de Bartosz.', [
        'hotel',
        'casa-tiedemann',
      ]),
      v('1986', 4, 'Regina adolescente, colega de escola de Katharina e Hannah.', ['escola']),
    ],
  },
  {
    id: 'aleksander',
    name: 'Aleksander Tiedemann',
    family: 'tiedemann',
    versions: [
      v('2019', 1, 'Diretor da usina nuclear. Casado com Regina.', ['usina', 'casa-tiedemann']),
    ],
  },
  {
    id: 'bartosz',
    name: 'Bartosz Tiedemann',
    family: 'tiedemann',
    versions: [
      v('2019', 1, 'Melhor amigo de Jonas e namorado de Martha.', ['escola', 'casa-tiedemann']),
    ],
  },
  {
    id: 'claudia',
    name: 'Claudia Tiedemann',
    family: 'tiedemann',
    versions: [
      v('1986', 4, 'Dirige a usina. Mãe de Regina.', ['usina']),
      v('1953', 9, 'Claudia ainda menina, filha de Egon e Doris.', ['casa-tiedemann']),
    ],
  },
  {
    id: 'egon',
    name: 'Egon Tiedemann',
    family: 'tiedemann',
    versions: [
      v(
        '1986',
        4,
        [
          { from: 4, text: 'Policial veterano, à frente da investigação do sumiço de Mads.' },
          {
            from: 9,
            text: 'Policial veterano, à frente da investigação do sumiço de Mads. Pai de Claudia.',
          },
        ],
        ['delegacia'],
      ),
      v('1953', 8, 'Egon jovem, policial que investiga os meninos encontrados na obra da usina.', [
        'delegacia',
        'usina',
      ]),
    ],
  },
  {
    id: 'doris',
    name: 'Doris Tiedemann',
    family: 'tiedemann',
    versions: [v('1953', 9, 'Casada com Egon, mãe da pequena Claudia.', ['casa-tiedemann'])],
  },
  // ── outras pessoas ──
  {
    id: 'estranho',
    name: 'O forasteiro',
    family: 'outros',
    versions: [
      v('2019', 2, 'Um homem que chega à cidade e se hospeda no hotel. Ninguém sabe quem ele é.', [
        'hotel',
      ]),
    ],
  },
  {
    id: 'tannhaus',
    name: 'H. G. Tannhaus',
    family: 'outros',
    versions: [v('2019', 6, 'O velho relojoeiro de Winden.', ['relojoaria'])],
  },
  {
    id: 'woller',
    name: 'Torben Wöller',
    family: 'outros',
    versions: [v('2019', 2, 'Policial, colega de Ulrich e Charlotte.', ['delegacia'])],
  },
  {
    id: 'erik',
    name: 'Erik Obendorf',
    family: 'outros',
    versions: [
      v('2019', 1, 'Adolescente da cidade, desaparecido há semanas quando a série começa.'),
    ],
  },
  {
    id: 'noah',
    name: 'Noah',
    family: 'outros',
    versions: [v('1986', 10, 'Um homem misterioso. Ninguém sabe ao certo quem ele é.')],
  },
];

// ── what may be shown ─────────────────────────────────────────────────────────

export function stagedText(text: Staged, ep: number): string | null {
  let out: string | null = null;
  for (const s of text) if (s.from <= ep) out = s.text;
  return out;
}

export function erasUnlocked(ep: number): Era[] {
  return ERAS.filter((e) => e.from <= ep).map((e) => e.id);
}

/** The places on the map for an era at episode `ep`, with what to say about each. */
export function placesFor(era: Era, ep: number): (Place & { text: string })[] {
  if (!erasUnlocked(ep).includes(era)) return [];
  return PLACES.flatMap((p) => {
    const text = p.eras[era] ? stagedText(p.eras[era], ep) : null;
    return text ? [{ ...p, text }] : [];
  });
}

export type ShownVersion = { person: Person; version: Version; text: string };

/** The people of an era at episode `ep`. */
export function peopleFor(era: Era, ep: number): ShownVersion[] {
  if (!erasUnlocked(ep).includes(era)) return [];
  return PEOPLE.flatMap((person) =>
    person.versions.flatMap((version) => {
      if (version.from > ep || version.era !== era) return [];
      const text = stagedText(version.text, ep);
      return text ? [{ person, version, text }] : [];
    }),
  );
}

/** Who is linked to a place in an era (only places shown in that era count). */
export function peopleAt(placeId: string, era: Era, ep: number): ShownVersion[] {
  const shownPlaces = new Set(placesFor(era, ep).map((p) => p.id));
  if (!shownPlaces.has(placeId)) return [];
  return peopleFor(era, ep).filter((s) => s.version.places.includes(placeId));
}

/** Places of a version that are on the map for its era right now. */
export function placesOf(s: ShownVersion, era: Era, ep: number): string[] {
  const shown = new Set(placesFor(era, ep).map((p) => p.id));
  return s.version.places.filter((id) => shown.has(id));
}

export function clampEpisode(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n);
  return Number.isInteger(x) && x >= 1 && x <= EPISODE_COUNT ? x : 1;
}

// ── photos (2026-11-12): one slot per person per era, filled in from the dashboard ─────────

export const GUIDE_ID = 'dark';

/** "<person>:<era>", the key of a photo (the database CHECK takes exactly this shape). */
export function slotOf(personId: string, era: Era): string {
  return `${personId}:${era}`;
}

export type Slot = { slot: string; name: string; era: Era; family: Family; from: number };

/** Every photo slot of the guide (all eras and episodes: the dashboard shows everything). */
export function allSlots(): Slot[] {
  return PEOPLE.flatMap((p) =>
    p.versions.map((v) => ({
      slot: slotOf(p.id, v.era),
      name: p.name,
      era: v.era,
      family: p.family,
      from: v.from,
    })),
  );
}

// ── spoilers (2026-11-12): the whole first season, behind a button ────────────────────────

/**
 * What the first season reveals, for people who finished it (or don't mind). Shown only when the
 * viewer opens it; never part of the page until then. The big reveals only, in our own words.
 */
export const SPOILERS: { title: string; text: string }[] = [
  {
    title: 'As cavernas atravessam o tempo',
    text: 'A passagem nas cavernas leva quem a atravessa 33 anos para trás ou para a frente: 2019, 1986, 1953.',
  },
  {
    title: 'Mikkel é Michael',
    text: 'Mikkel vai parar em 1986 e não consegue voltar. É criado por Ines Kahnwald e cresce como Michael Kahnwald, o pai de Jonas. Ou seja: Ulrich e Katharina são avós de Jonas, e Martha é tia dele.',
  },
  {
    title: 'O menino encontrado morto',
    text: 'O corpo de menino achado em 2019, com roupas antigas, é de Mads Nielsen, o irmão de Ulrich que sumiu em 1986.',
  },
  {
    title: 'Quem é o forasteiro',
    text: 'O homem hospedado no hotel é o próprio Jonas, adulto, vindo do futuro.',
  },
  {
    title: 'Os sumiços de crianças',
    text: 'Noah está por trás deles: com a ajuda de Helge Doppler, leva crianças a um bunker na floresta, onde testa uma máquina de viajar no tempo.',
  },
  {
    title: 'Ulrich em 1953',
    text: 'Ulrich atravessa a caverna até 1953 para impedir o pequeno Helge. Não consegue e acaba preso pelo jovem policial Egon Tiedemann.',
  },
  {
    title: 'O fim da temporada',
    text: 'Jonas é levado para o futuro: uma Winden destruída, em 2052.',
  },
];
