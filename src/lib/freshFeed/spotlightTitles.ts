/**
 * Topic spotlight titles, keyed by the feed relay's NIP-11 topic slugs.
 * A slug without an entry falls back to the topic's own name.
 */
export const SPOTLIGHT_TITLES: Record<string, string> = {
  sourdough: '🍞 The Sourdough Society',
  bread: '🥖 Daily Bread',
  pastry: '🥐 Flaky Business',
  cakes: '🎂 Let Them Eat Cake',
  cookies: '🍪 The Cookie Jar',
  pickles: '🥒 From the Pickle Jar',
  kimchi: '🌶️ Kimchi Corner',
  sauerkraut: '🥬 Sauerkraut Station',
  kombucha: '🫧 Kombucha Club',
  canning: '🫙 Put Up & Preserved',
  bbq: '🔥 Low & Slow',
  smoking: "💨 Where There's Smoke",
  grilling: '🍢 Fire It Up',
  beef: "🥩 Where's the Beef",
  pork: '🐖 Pork Party',
  poultry: '🍗 Winner Winner Chicken Dinner',
  seafood: '🦐 Catch of the Day',
  charcuterie: '🧀 The Board Meeting',
  vegetables: '🥕 Eat Your Veggies',
  salads: '🥗 Toss It Up',
  vegan: '🌱 Plant Power',
  legumes: '🫘 Full of Beans',
  coffee: '☕ GM Coffee Club',
  tea: '🍵 Spill the Tea',
  beer: '🍺 Hop Talk',
  wine: '🍷 Uncorked',
  cocktails: '🍸 Shaken, Not Stirred',
  italian: '🍝 Mangia!',
  mexican: "🌮 Taco 'Bout It",
  japanese: '🍜 Itadakimasu',
  indian: '🍛 Spice Route',
  chinese: '🥟 Dumpling Dynasty',
  breakfast: '🍳 Rise & Dine',
  'soups-stews': "🍲 Soup's On",
  pasta: '🍝 Oodles of Noodles',
  pizza: '🍕 Slice of Life',
  sandwiches: '🥪 Stacked',
  gardening: '🌻 Garden to Table',
  foraging: '🍄 Into the Woods',
  homesteading: '🏡 Homestead Corner',
  'cheese-dairy': '🧀 Say Cheese',
  desserts: '🍰 Just Desserts',
  chocolate: '🍫 Cocoa Loco',
  'ice-cream': '🍦 Brain Freeze'
};

export function spotlightTitle(slug: string, name: string): string {
  return SPOTLIGHT_TITLES[slug] ?? name;
}
