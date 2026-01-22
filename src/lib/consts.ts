export const standardRelays = [
  'wss://relay.damus.io', // Fastest
  'wss://kitchen.zap.cooking', // Your relay
  'wss://garden.zap.cooking', // Garden relay (always connected)
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://nostr.wine'
];

export type recipeTag =
  | string
  | {
      title: string;
      visableTitle?: string;
      emoji?: string;
    };

export type recipeTagSimple = {
  title: string;
  emoji?: string;
};

// Default profile image URL
export const DEFAULT_PROFILE_IMAGE = 'https://zap.cooking/default-pfp.jpg';

// NIP-89 Client identification
export const CLIENT_TAG_IDENTIFIER = 'zap.cooking';
export const CLIENT_DISPLAY_NAME = 'Zap Cooking';

// Recipe tag prefixes
// New recipes use 'zapcooking', old recipes use 'nostrcooking' for backward compatibility
export const RECIPE_TAG_PREFIX_NEW = 'zapcooking';
export const RECIPE_TAG_PREFIX_LEGACY = 'nostrcooking';
export const RECIPE_TAGS = [RECIPE_TAG_PREFIX_NEW, RECIPE_TAG_PREFIX_LEGACY]; // For filtering (supports both)

// Gated/Premium recipe kind (addressable event in 30000-39999 range)
// Using 35000 to differentiate from regular recipes (30023)
export const GATED_RECIPE_KIND = 35000;
export const GATED_RECIPE_TAG = 'zapcooking-premium'; // Tag for filtering premium recipes

export const recipeTags: recipeTagSimple[] = [
  { title: 'Alcohol', emoji: '🍸' },
  { title: 'Nuts', emoji: '🥜' },
  { title: 'American', emoji: '🇺🇸' },
  { title: 'Apple', emoji: '🍎' },
  { title: 'Argentinian', emoji: '🇦🇷' },
  { title: 'Asian', emoji: '🥢' },
  { title: 'Australian', emoji: '🇦🇺' },
  { title: 'Austrian', emoji: '🇦🇹' },
  { title: 'Bacon', emoji: '🥓' },
  { title: 'Baked', emoji: '⏲️' },
  { title: 'Beans', emoji: '🧆' },
  { title: 'Beef', emoji: '🐄' },
  { title: 'Belgian', emoji: '🇧🇪' },
  { title: 'Blended', emoji: '🥤' },
  { title: 'Brazilian', emoji: '🇧🇷' },
  { title: 'Bread', emoji: '🍞' },
  { title: 'Breakfast', emoji: '🍳' },
  { title: 'Broccoli' },
  { title: 'Cabbage' },
  { title: 'Cajun' },
  { title: 'Cake', emoji: '🍰' },
  { title: 'Caribbean', emoji: '🏝️' },
  { title: 'Cheese', emoji: '🧀' },
  { title: 'Chicken', emoji: '🍗' },
  { title: 'Chinese', emoji: '🥡' },
  { title: 'Chocolate', emoji: '🍫' },
  { title: 'Christmas', emoji: '🎄' },
  { title: 'Cocktail', emoji: '🍹' },
  { title: 'Coconut', emoji: '🥥' },
  { title: 'Cookies', emoji: '🍪' },
  { title: 'Coffee', emoji: '☕' },
  { title: 'Corn', emoji: '🌽' },
  { title: 'Cream', emoji: '🥛' },
  { title: 'Curry', emoji: '🍛' },
  { title: 'Danish' },
  { title: 'Dessert', emoji: '🧁' },
  { title: 'Dominican', emoji: '🇩🇴' },
  { title: 'Dressing' },
  { title: 'Drinks', emoji: '🥤' },
  { title: 'Duck', emoji: '🦆' },
  { title: 'Dumpling', emoji: '🥟' },
  { title: 'Dutch', emoji: '🇳🇱' },
  { title: 'Easter', emoji: '🐰' },
  { title: 'Easy', emoji: '😌' },
  { title: 'Eggs', emoji: '🥚' },
  { title: 'English', emoji: '🏴' },
  { title: 'Ethiopian', emoji: '🇪🇹' },
  { title: 'Feta', emoji: '🧀' },
  { title: 'Filipino', emoji: '🇵🇭' },
  { title: 'Fish', emoji: '🐟' },
  { title: 'French', emoji: '🇫🇷' },
  { title: 'Frozen', emoji: '🥶' },
  { title: 'Fruit', emoji: '🍇' },
  { title: 'Fry', emoji: '🍟' },
  { title: 'Galician' },
  { title: 'Garlic', emoji: '🧄' },
  { title: 'German', emoji: '🇩🇪' },
  { title: 'Greek', emoji: '🇬🇷' },
  { title: 'Ham', emoji: '🍖' },
  { title: 'Hungarian', emoji: '🇭🇺' },
  { title: 'Indian', emoji: '🇮🇳' },
  { title: 'Irish', emoji: '☘️' },
  { title: 'Israeli', emoji: '🇮🇱' },
  { title: 'Italian', emoji: '🇮🇹' },
  { title: 'Jamaican', emoji: '🇯🇲' },
  { title: 'Jam' },
  { title: 'Japanese', emoji: '🇯🇵' },
  { title: 'Korean', emoji: '🇰🇷' },
  { title: 'Keto', emoji: '🥓' },
  { title: 'Lamb', emoji: '🐑' },
  { title: 'Lebanese', emoji: '🇱🇧' },
  { title: 'Lemons', emoji: '🍋' },
  { title: 'Lentil' },
  { title: 'Liquor', emoji: '🥃' },
  { title: 'Liver', emoji: '🍖' },
  { title: 'Lunch', emoji: '🥪' },
  { title: 'Meat', emoji: '🥩' },
  { title: 'Mediterranean', emoji: '🏖️' },
  { title: 'Mexican', emoji: '🇲🇽' },
  { title: 'Middle-Eastern', emoji: '🧆' },
  { title: 'Milk', emoji: '🥛' },
  { title: 'Moroccan', emoji: '🇲🇦' },
  { title: 'Mushrooms', emoji: '🍄' },
  { title: 'Mutton', emoji: '🐑' },
  { title: 'Nigerian', emoji: '🇳🇬' },
  { title: 'Noodles', emoji: '🍜' },
  { title: 'Oven', emoji: '🔥' },
  { title: 'Palestinian' },
  { title: 'Pancake', emoji: '🥞' },
  { title: 'Pasta', emoji: '🍝' },
  { title: 'Pastry', emoji: '🥐' },
  { title: 'Pate' },
  { title: 'Peppers', emoji: '🌶️' },
  { title: 'Persian', emoji: '🇮🇷' },
  { title: 'Peruvian', emoji: '🇵🇪' },
  { title: 'Pie', emoji: '🥧' },
  { title: 'Pizza', emoji: '🍕' },
  { title: 'Polish', emoji: '🇵🇱' },
  { title: 'Pork', emoji: '🐖' },
  { title: 'Portuguese', emoji: '🇵🇹' },
  { title: 'Potato', emoji: '🥔' },
  { title: 'Pub' },
  { title: 'Quebec', emoji: '🍁' },
  { title: 'Quick', emoji: '🌭' },
  { title: 'Raw' },
  { title: 'Rice', emoji: '🍚' },
  { title: 'Roast', emoji: '🍖' },
  { title: 'Romanian', emoji: '🇷🇴' },
  { title: 'Russian', emoji: '🇷🇺' },
  { title: 'Salad', emoji: '🥗' },
  { title: 'Sandwich', emoji: '🥪' },
  { title: 'Sauce', emoji: '🍲' },
  { title: 'Sausage', emoji: '🌭' },
  { title: 'Seafood', emoji: '🦐' },
  { title: 'Shaken', emoji: '🫨' },
  { title: 'Shrimp', emoji: '🦐' },
  { title: 'Side' },
  { title: 'Slowcooked', emoji: '⏳' },
  { title: 'Snack', emoji: '🍿' },
  { title: 'Somali', emoji: '🇸🇴' },
  { title: 'Soup', emoji: '🍲' },
  { title: 'Sourdough', emoji: '🍞' },
  { title: 'Southern' },
  { title: 'Southwest' },
  { title: 'Spanish', emoji: '🇪🇸' },
  { title: 'Spice', emoji: '🌶️' },
  { title: 'Spicy', emoji: '🌶️' },
  { title: 'Spinach', emoji: '🍃' },
  { title: 'Spread' },
  { title: 'Squash' },
  { title: 'Steak', emoji: '🥩' },
  { title: 'Stew', emoji: '🍲' },
  { title: 'Stirred', emoji: '🥄' },
  { title: 'Stock', emoji: '🍲' },
  { title: 'Supper', emoji: '🍽️' },
  { title: 'Swedish', emoji: '🇸🇪' },
  { title: 'Sweet', emoji: '🍬' },
  { title: 'Swiss', emoji: '🇨🇭' },
  { title: 'Syrup', emoji: '🍯' },
  { title: 'Thai', emoji: '🇹🇭' },
  { title: 'Tofu', emoji: '🥢' },
  { title: 'Tomato', emoji: '🍅' },
  { title: 'Tortilla', emoji: '🌮' },
  { title: 'Traditional' },
  { title: 'Traybake' },
  { title: 'Tuna', emoji: '🐟' },
  { title: 'Tunisian', emoji: '🇹🇳' },
  { title: 'Turkey', emoji: '🦃' },
  { title: 'Turkish', emoji: '🇹🇷' },
  { title: 'Ukrainian', emoji: '🇺🇦' },
  { title: 'Uzbek', emoji: '🇺🇿' },
  { title: 'Veal', emoji: '🐄' },
  { title: 'Vegetables', emoji: '🥦' },
  { title: 'Vegan', emoji: '🌱' },
  { title: 'Raw Vegan' },
  { title: 'Vietnamese', emoji: '🇻🇳' },
  { title: 'Wholemeal' },
  { title: 'Wine', emoji: '🍷' },
  { title: 'Yucatecan', emoji: '🇲🇽' },
  { title: 'Healthy', emoji: '🍏' },
  { title: 'Gluten Free', emoji: '🥗' }
];

// Curated tags for the discovery page (60 tags)
export const CURATED_TAGS: string[] = [
  // Intent
  'Easy',
  'Quick',
  'Breakfast',
  'Lunch',
  'Supper',
  'Dessert',
  'Snack',
  'Drinks',
  // Cuisines
  'American',
  'Asian',
  'Chinese',
  'French',
  'German',
  'Greek',
  'Indian',
  'Italian',
  'Japanese',
  'Mexican',
  'Spanish',
  'Thai',
  'Turkish',
  'Vietnamese',
  'Mediterranean',
  'Middle-Eastern',
  'Brazilian',
  'Filipino',
  'Lebanese',
  // Proteins
  'Beef',
  'Chicken',
  'Fish',
  'Lamb',
  'Pork',
  'Seafood',
  'Steak',
  'Turkey',
  'Duck',
  'Eggs',
  'Tofu',
  // Ingredients
  'Apple',
  'Beans',
  'Bread',
  'Cheese',
  'Chocolate',
  'Coconut',
  'Corn',
  'Cream',
  'Fruit',
  'Garlic',
  'Mushrooms',
  'Noodles',
  'Pasta',
  'Peppers',
  'Potato',
  'Rice',
  'Spinach',
  'Tomato',
  'Vegetables',
  // Meals
  'Pizza',
  'Pasta',
  'Soup',
  'Salad',
  'Sandwich',
  // Methods
  'Baked',
  'Fry',
  'Oven',
  'Roast',
  'Slowcooked',
  // Lifestyle
  'Vegan',
  'Keto',
  'Healthy',
  'Gluten Free',
  // Flavor
  'Spicy',
  'Sweet',
  'Curry'
];

// Tag sections for the discovery page
export type TagSection = {
  emoji: string;
  title: string;
  tags: string[];
};

export const CURATED_TAG_SECTIONS: TagSection[] = [
  {
    emoji: '🍽️',
    title: 'Why are you cooking?',
    tags: ['Easy', 'Quick', 'Breakfast', 'Lunch', 'Supper', 'Dessert', 'Snack', 'Drinks']
  },
  {
    emoji: '🌍',
    title: 'Explore by culture',
    tags: [
      'American',
      'Asian',
      'Chinese',
      'French',
      'German',
      'Greek',
      'Indian',
      'Italian',
      'Japanese',
      'Mexican',
      'Spanish',
      'Thai',
      'Turkish',
      'Vietnamese',
      'Mediterranean',
      'Middle-Eastern',
      'Brazilian',
      'Filipino',
      'Lebanese'
    ]
  },
  {
    emoji: '🥩',
    title: 'Proteins',
    tags: [
      'Beef',
      'Chicken',
      'Fish',
      'Lamb',
      'Pork',
      'Seafood',
      'Steak',
      'Turkey',
      'Duck',
      'Eggs',
      'Tofu'
    ]
  },
  {
    emoji: '🥕',
    title: 'Ingredients',
    tags: [
      'Apple',
      'Beans',
      'Bread',
      'Cheese',
      'Chocolate',
      'Coconut',
      'Corn',
      'Cream',
      'Fruit',
      'Garlic',
      'Mushrooms',
      'Noodles',
      'Pasta',
      'Peppers',
      'Potato',
      'Rice',
      'Spinach',
      'Tomato',
      'Vegetables'
    ]
  },
  {
    emoji: '🍳',
    title: 'Meals',
    tags: ['Pizza', 'Pasta', 'Soup', 'Salad', 'Sandwich', 'Breakfast', 'Lunch', 'Supper']
  },
  {
    emoji: '🔥',
    title: 'Methods',
    tags: ['Baked', 'Fry', 'Oven', 'Roast', 'Slowcooked']
  },
  {
    emoji: '🥗',
    title: 'Lifestyle',
    tags: ['Vegan', 'Keto', 'Healthy', 'Gluten Free']
  },
  {
    emoji: '🌶️',
    title: 'Flavor',
    tags: ['Spicy', 'Sweet', 'Curry']
  }
];

// Tag aliases for normalization (maps variations to canonical tag names)
export const TAG_ALIASES: Record<string, string> = {
  Spice: 'Spicy',
  Spices: 'Spicy',
  Hot: 'Spicy',
  Vegetarian: 'Vegan', // Note: This is a simplification, but helps with normalization
  'Gluten-Free': 'Gluten Free',
  GlutenFree: 'Gluten Free',
  'Middle Eastern': 'Middle-Eastern',
  MiddleEastern: 'Middle-Eastern'
};
