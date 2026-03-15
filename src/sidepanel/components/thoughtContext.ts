export interface ContextSnippet {
  id: string;
  title: string;
  description: string;
  category: 'Entity' | 'Concept' | 'Project';
}

export const LORE_REGISTRY: Record<string, ContextSnippet> = {
  titan: {
    id: 'titan',
    title: 'Project Titan',
    description:
      'A massive, unreleased MMO developed by Blizzard Entertainment from 2007 to 2014 before being cancelled.',
    category: 'Project',
  },
  overwatch: {
    id: 'overwatch',
    title: 'Overwatch',
    description:
      'A team-based hero shooter released by Blizzard in 2016, built using repurposed assets and ideas from Project Titan.',
    category: 'Project',
  },
  blizzard: {
    id: 'blizzard',
    title: 'Blizzard Entertainment',
    description:
      'An American video game developer and publisher known for franchises like Warcraft, Diablo, and StarCraft.',
    category: 'Entity',
  },
  rust: {
    id: 'rust',
    title: 'Rust',
    description:
      'A multiplayer survival game by Facepunch Studios, known for harsh open-world systems and a notoriously aggressive player culture.',
    category: 'Concept',
  },
  spotify: {
    id: 'spotify',
    title: 'Spotify',
    description:
      'A Swedish audio streaming platform that became notable for signing major podcasts to exclusive or semi-exclusive deals.',
    category: 'Entity',
  },
  warcraft: {
    id: 'warcraft',
    title: 'Warcraft',
    description:
      'A Blizzard fantasy franchise spanning strategy games, novels, and World of Warcraft, one of the biggest MMOs ever made.',
    category: 'Project',
  },
};

export const getContextForEntity = (text: string): ContextSnippet | null => {
  const normalized = text.toLowerCase();

  for (const [key, snippet] of Object.entries(LORE_REGISTRY)) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(normalized)) {
      return snippet;
    }
  }

  return null;
};
