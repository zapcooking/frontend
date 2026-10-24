/**
 * Automatic pantry categories for presentation.
 *
 * Categories are inferred at display time from the ingredient name.
 * They are not stored on pantry items, so later ontology upgrades do
 * not require a schema bump or a user-facing recategorize step.
 */

import { normalizeIngredientName } from './normalization';
import type { PantryItem } from './schema';

export const PANTRY_CATEGORIES = [
  'produce',
  'meat-seafood',
  'dairy-eggs',
  'grains-pasta',
  'canned-jarred',
  'baking',
  'spices',
  'sauces',
  'frozen',
  'other'
] as const;

export type PantryCategory = (typeof PANTRY_CATEGORIES)[number];

export const PANTRY_CATEGORY_LABELS: Record<PantryCategory, string> = {
  produce: 'Produce',
  'meat-seafood': 'Meat & Seafood',
  'dairy-eggs': 'Dairy & Eggs',
  'grains-pasta': 'Grains & Pasta',
  'canned-jarred': 'Canned & Jarred',
  baking: 'Baking',
  spices: 'Spices & Seasonings',
  sauces: 'Sauces & Condiments',
  frozen: 'Frozen',
  other: 'Other'
};

const KEYWORDS: Record<Exclude<PantryCategory, 'other'>, string[]> = {
  frozen: [
    'frozen',
    'ice cream',
    'popsicle',
    'sorbet',
    'gelato',
    'frozen pea',
    'frozen berry',
    'frozen fruit',
    'frozen vegetable'
  ],
  'canned-jarred': [
    'canned',
    'can of',
    'jarred',
    'jar of',
    'canned tomato',
    'canned bean',
    'canned tuna',
    'canned corn',
    'tomato paste',
    'tomato sauce',
    'crushed tomato',
    'diced tomato',
    'coconut milk',
    'chickpea',
    'garbanzo',
    'black bean',
    'kidney bean',
    'pinto bean',
    'cannellini',
    'refried bean',
    'broth',
    'stock',
    'capers',
    'olives',
    'pickle',
    'sauerkraut',
    'kimchi',
    'applesauce'
  ],
  spices: [
    'black pepper',
    'white pepper',
    'peppercorn',
    'kosher salt',
    'sea salt',
    'table salt',
    'salt',
    'cumin',
    'paprika',
    'chili powder',
    'chilli powder',
    'cayenne',
    'turmeric',
    'cinnamon',
    'nutmeg',
    'clove',
    'allspice',
    'oregano',
    'thyme',
    'rosemary',
    'basil',
    'sage',
    'bay leaf',
    'bay leaves',
    'coriander',
    'cardamom',
    'fennel seed',
    'mustard seed',
    'celery seed',
    'garlic powder',
    'onion powder',
    'chili flake',
    'red pepper flake',
    'italian seasoning',
    'taco seasoning',
    'curry powder',
    'garam masala',
    'zaatar',
    "za'atar",
    'sumac',
    'smoked paprika',
    'seasoning',
    'spice',
    'vanilla extract',
    'vanilla bean'
  ],
  sauces: [
    'olive oil',
    'avocado oil',
    'sesame oil',
    'vegetable oil',
    'canola oil',
    'coconut oil',
    'neutral oil',
    'cooking oil',
    'oil',
    'vinegar',
    'soy sauce',
    'tamari',
    'fish sauce',
    'worcestershire',
    'hot sauce',
    'sriracha',
    'ketchup',
    'mustard',
    'mayonnaise',
    'mayo',
    'bbq sauce',
    'barbecue sauce',
    'teriyaki',
    'hoisin',
    'oyster sauce',
    'pesto',
    'salsa',
    'hummus',
    'tahini',
    'dressing',
    'marinade',
    'chili crisp',
    'chili garlic',
    'gochujang',
    'miso',
    'harissa',
    'chimichurri',
    'aioli'
  ],
  baking: [
    'all purpose flour',
    'all-purpose flour',
    'bread flour',
    'cake flour',
    'whole wheat flour',
    'almond flour',
    'coconut flour',
    'flour',
    'granulated sugar',
    'brown sugar',
    'powdered sugar',
    'confectioner',
    'sugar',
    'baking powder',
    'baking soda',
    'yeast',
    'cocoa',
    'chocolate chip',
    'semi sweet chocolate',
    'dark chocolate',
    'white chocolate',
    'cornstarch',
    'corn starch',
    'cornmeal',
    'corn meal',
    'molasses',
    'honey',
    'maple syrup',
    'vanilla',
    'shortening',
    'sprinkles'
  ],
  'grains-pasta': [
    'rice',
    'pasta',
    'spaghetti',
    'penne',
    'linguine',
    'fettuccine',
    'macaroni',
    'noodle',
    'lasagna',
    'orzo',
    'couscous',
    'quinoa',
    'barley',
    'farro',
    'bulgur',
    'oat',
    'oatmeal',
    'granola',
    'cereal',
    'bread',
    'tortilla',
    'pita',
    'bagel',
    'bun',
    'roll',
    'cracker',
    'breadcrumb',
    'panko',
    'polenta',
    'grits'
  ],
  'dairy-eggs': [
    'milk',
    'cream',
    'half and half',
    'butter',
    'ghee',
    'cheese',
    'parmesan',
    'cheddar',
    'mozzarella',
    'feta',
    'ricotta',
    'goat cheese',
    'cream cheese',
    'cottage cheese',
    'sour cream',
    'yogurt',
    'yoghurt',
    'egg',
    'buttermilk'
  ],
  'meat-seafood': [
    'chicken',
    'beef',
    'steak',
    'ground beef',
    'pork',
    'bacon',
    'sausage',
    'ham',
    'turkey',
    'duck',
    'lamb',
    'veal',
    'fish',
    'salmon',
    'tuna',
    'cod',
    'tilapia',
    'shrimp',
    'prawn',
    'crab',
    'lobster',
    'scallop',
    'clam',
    'mussel',
    'oyster',
    'anchovy',
    'sardine',
    'tofu',
    'tempeh',
    'seitan'
  ],
  produce: [
    'apple',
    'banana',
    'orange',
    'lemon',
    'lime',
    'grape',
    'berry',
    'strawberry',
    'blueberry',
    'raspberry',
    'mango',
    'pineapple',
    'watermelon',
    'melon',
    'peach',
    'pear',
    'plum',
    'avocado',
    'tomato',
    'lettuce',
    'spinach',
    'kale',
    'arugula',
    'cabbage',
    'broccoli',
    'cauliflower',
    'carrot',
    'celery',
    'cucumber',
    'zucchini',
    'squash',
    'bell pepper',
    'jalapeno',
    'jalapeño',
    'chili',
    'onion',
    'shallot',
    'leek',
    'garlic',
    'ginger',
    'potato',
    'sweet potato',
    'yam',
    'mushroom',
    'asparagus',
    'green bean',
    'pea',
    'corn',
    'eggplant',
    'aubergine',
    'beet',
    'radish',
    'turnip',
    'cilantro',
    'parsley',
    'mint',
    'basil',
    'dill',
    'scallion',
    'green onion',
    'chive',
    'herb',
    'fruit',
    'vegetable'
  ]
};

const CATEGORY_ORDER: Exclude<PantryCategory, 'other'>[] = [
  'frozen',
  'canned-jarred',
  'spices',
  'sauces',
  'baking',
  'grains-pasta',
  'dairy-eggs',
  'meat-seafood',
  'produce'
];

function haystackFor(name: string): string {
  const raw = name.toLowerCase();
  const normalized = normalizeIngredientName(name);
  return `${raw} ${normalized}`.trim();
}

/**
 * Infer a pantry category. More specific pantry aisles (frozen, canned,
 * spices, sauces, baking) win over generic produce/protein matches so
 * "black pepper" is a spice and "bell pepper" is produce.
 */
export function inferPantryCategory(name: string): PantryCategory {
  const haystack = haystackFor(name);
  if (!haystack) return 'other';

  for (const category of CATEGORY_ORDER) {
    if (KEYWORDS[category].some((kw) => haystack.includes(kw))) {
      return category;
    }
  }
  return 'other';
}

export interface PantryCategoryGroup {
  category: PantryCategory;
  label: string;
  items: PantryItem[];
}

/**
 * Group pantry items for display. Staples stay in their aisle and are
 * sorted to the top of that group so the list stays visually calm.
 */
export function groupPantryItems(items: PantryItem[]): PantryCategoryGroup[] {
  const buckets = new Map<PantryCategory, PantryItem[]>();
  for (const item of items) {
    const category = inferPantryCategory(item.name);
    const list = buckets.get(category);
    if (list) list.push(item);
    else buckets.set(category, [item]);
  }

  const groups: PantryCategoryGroup[] = [];
  for (const category of PANTRY_CATEGORIES) {
    const list = buckets.get(category);
    if (!list?.length) continue;
    list.sort((a, b) => {
      if (!!a.isStaple !== !!b.isStaple) return a.isStaple ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    groups.push({
      category,
      label: PANTRY_CATEGORY_LABELS[category],
      items: list
    });
  }
  return groups;
}
