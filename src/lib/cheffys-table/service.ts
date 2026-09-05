/** Cheffy's Table. Local cooking model, not real food-safety timing guidance. */
export type Cook = 'saute' | 'roast' | 'steam' | 'assemble';
export type Style = 'bowl' | 'toast' | 'plate';
export type Role = 'vegetable' | 'protein' | 'base' | 'aromatic' | 'finish';
export type Ingredient = {
  id: string;
  name: string;
  role: Role;
  note: string;
  likes: Cook[];
  rich?: boolean;
  bright?: boolean;
  crunch?: boolean;
  plant: boolean;
  aromatic?: boolean;
};
export const pantry: Ingredient[] = [
  {
    id: 'tomato',
    name: 'Tomato',
    role: 'vegetable',
    note: 'Juicy sweetness; fresh or softened into a sauce.',
    likes: ['saute', 'roast', 'assemble'],
    bright: true,
    plant: true
  },
  {
    id: 'spinach',
    name: 'Spinach',
    role: 'vegetable',
    note: 'Tender greens. Gentle, brief cooking keeps their character.',
    likes: ['saute', 'steam', 'assemble'],
    plant: true
  },
  {
    id: 'carrot',
    name: 'Carrot',
    role: 'vegetable',
    note: 'Crunchy fresh; sweeter and softer when roasted.',
    likes: ['roast', 'steam', 'assemble'],
    crunch: true,
    plant: true
  },
  {
    id: 'mushroom',
    name: 'Mushroom',
    role: 'vegetable',
    note: 'Savory depth. Dry heat brings out browned flavor.',
    likes: ['saute', 'roast'],
    plant: true
  },
  {
    id: 'broccoli',
    name: 'Broccoli',
    role: 'vegetable',
    note: 'Steam for a tender bite; roast for browned edges.',
    likes: ['roast', 'steam'],
    crunch: true,
    plant: true
  },
  {
    id: 'egg',
    name: 'Cooked egg',
    role: 'protein',
    note: 'A prepared egg adds richness and a satisfying center.',
    likes: ['assemble', 'steam'],
    rich: true,
    plant: false
  },
  {
    id: 'chicken',
    name: 'Cooked chicken',
    role: 'protein',
    note: 'Prepared chicken takes well to aromatics and a bright finish.',
    likes: ['saute', 'roast', 'assemble'],
    plant: false
  },
  {
    id: 'tofu',
    name: 'Tofu',
    role: 'protein',
    note: 'Mild and versatile; great with aromatics or browned edges.',
    likes: ['saute', 'roast', 'steam'],
    plant: true
  },
  {
    id: 'salmon',
    name: 'Cooked salmon',
    role: 'protein',
    note: 'Rich prepared fish; lemon gives it a bright contrast.',
    likes: ['assemble', 'steam'],
    rich: true,
    plant: false
  },
  {
    id: 'chickpeas',
    name: 'Chickpeas',
    role: 'protein',
    note: 'Earthy, hearty and plant-based. Roast for texture.',
    likes: ['roast', 'saute', 'assemble'],
    plant: true
  },
  {
    id: 'rice',
    name: 'Cooked rice',
    role: 'base',
    note: 'A prepared base that carries a sauce and turns ingredients into a bowl.',
    likes: ['saute', 'steam', 'assemble'],
    plant: true
  },
  {
    id: 'pasta',
    name: 'Cooked pasta',
    role: 'base',
    note: 'Prepared pasta needs a little moisture and a flavorful coating.',
    likes: ['saute', 'assemble'],
    plant: true
  },
  {
    id: 'bread',
    name: 'Sourdough',
    role: 'base',
    note: 'A crisp foundation. Wet toppings go on at the end.',
    likes: ['roast', 'assemble'],
    crunch: true,
    plant: true
  },
  {
    id: 'potato',
    name: 'Par-cooked potato',
    role: 'base',
    note: 'A prepared potato loves roasting for a crisp outside.',
    likes: ['roast', 'saute', 'steam'],
    plant: true
  },
  {
    id: 'garlic',
    name: 'Garlic',
    role: 'aromatic',
    note: 'Use as a supporting flavor. Prolonged high heat can make it bitter.',
    likes: ['saute', 'roast'],
    aromatic: true,
    plant: true
  },
  {
    id: 'oil',
    name: 'Olive oil',
    role: 'aromatic',
    note: 'Carries aromatic flavors and helps ingredients brown.',
    likes: ['saute', 'roast', 'assemble'],
    rich: true,
    plant: true
  },
  {
    id: 'lemon',
    name: 'Lemon',
    role: 'finish',
    note: 'Acidity cuts through richness. Add as a finishing touch.',
    likes: ['assemble', 'steam'],
    bright: true,
    plant: true
  },
  {
    id: 'parmesan',
    name: 'Parmesan',
    role: 'finish',
    note: 'A salty, savory finish. A small amount adds a lot.',
    likes: ['saute', 'roast', 'assemble'],
    rich: true,
    plant: false
  },
  {
    id: 'basil',
    name: 'Basil',
    role: 'finish',
    note: 'Fresh aroma. Most expressive when added after cooking.',
    likes: ['assemble'],
    aromatic: true,
    plant: true
  },
  {
    id: 'chili',
    name: 'Chili',
    role: 'finish',
    note: 'Adds heat and personality. Read the customer’s preference.',
    likes: ['saute', 'roast', 'assemble'],
    plant: true
  }
];
export const methods: {
  id: Cook;
  name: string;
  verb: string;
  note: string;
  ideal: number;
  prep: number;
}[] = [
  {
    id: 'saute',
    name: 'Sauté',
    verb: 'Sautéed',
    note: 'Fast, direct heat. Best for tender ingredients and aromatics.',
    ideal: 6,
    prep: 2
  },
  {
    id: 'roast',
    name: 'Roast',
    verb: 'Roasted',
    note: 'Dry heat builds browning. Give sturdy ingredients time.',
    ideal: 16,
    prep: 3
  },
  {
    id: 'steam',
    name: 'Steam',
    verb: 'Steamed',
    note: 'Gentle heat preserves tenderness, with little browning.',
    ideal: 8,
    prep: 1
  },
  {
    id: 'assemble',
    name: 'Assemble',
    verb: 'Fresh',
    note: 'Layer prepared ingredients. Keep fresh textures and finish last.',
    ideal: 2,
    prep: 1
  }
];
export const styles: { id: Style; name: string; note: string }[] = [
  {
    id: 'bowl',
    name: 'Bowl',
    note: 'A base, a centerpiece, and toppings in every bite.'
  },
  {
    id: 'toast',
    name: 'On toast',
    note: 'Bread underneath. Add juicy toppings just before serving.'
  },
  {
    id: 'plate',
    name: 'Composed plate',
    note: 'Give each component its own place.'
  }
];
export type Garnish = 'none' | 'lemon' | 'parmesan' | 'basil' | 'chili';
export type Finish = 'last' | 'early';
export type Customer = {
  id: string;
  name: string;
  initials: string;
  color: string;
  brief: string;
  wants: 'bright' | 'cozy' | 'savory';
  plantOnly: boolean;
  noChili: boolean;
  crunch: boolean;
  patience: number;
  preferred: Style;
  order: string;
};
export const customers: Customer[] = [
  {
    id: 'maya',
    name: 'Maya',
    initials: 'M',
    color: '#d86d42',
    brief: '“Something bright with a little crunch. I have a short lunch break!”',
    wants: 'bright',
    plantOnly: false,
    noChili: true,
    crunch: true,
    patience: 18,
    preferred: 'toast',
    order: 'A bright lunch'
  },
  {
    id: 'theo',
    name: 'Theo',
    initials: 'T',
    color: '#547865',
    brief: '“A cozy plant-based bowl, please. I love something hearty and I’m happy to wait.”',
    wants: 'cozy',
    plantOnly: true,
    noChili: false,
    crunch: false,
    patience: 34,
    preferred: 'bowl',
    order: 'Plant-based comfort'
  },
  {
    id: 'jules',
    name: 'Jules',
    initials: 'J',
    color: '#8370a1',
    brief: '“Give me savory flavor and a little richness. A composed plate would be lovely.”',
    wants: 'savory',
    plantOnly: false,
    noChili: false,
    crunch: false,
    patience: 28,
    preferred: 'plate',
    order: 'A savory supper'
  },
  {
    id: 'robin',
    name: 'Robin',
    initials: 'R',
    color: '#b4823a',
    brief: '“Fresh, bright, and plant-based. I enjoy a bowl, but please keep it mild.”',
    wants: 'bright',
    plantOnly: true,
    noChili: true,
    crunch: false,
    patience: 20,
    preferred: 'bowl',
    order: 'A fresh plant-based bowl'
  },
  {
    id: 'alex',
    name: 'Alex',
    initials: 'A',
    color: '#597f9e',
    brief: '“I’d love something cozy on toast. A little crunch is the best part.”',
    wants: 'cozy',
    plantOnly: false,
    noChili: false,
    crunch: true,
    patience: 25,
    preferred: 'toast',
    order: 'Comfort on toast'
  }
];
export type Dish = {
  ingredients: string[];
  cook: Cook;
  time: number;
  style: Style;
  garnish: Garnish;
  finish: Finish;
};
export const emptyDish = (): Dish => ({
  ingredients: [],
  cook: 'saute',
  time: 6,
  style: 'bowl',
  garnish: 'none',
  finish: 'last'
});
export function prepTime(d: Dish) {
  return (
    d.ingredients.length * 2 +
    methods.find((m) => m.id === d.cook)!.prep +
    d.time +
    (d.garnish === 'none' ? 0 : 1)
  );
}
export function validateDish(d: Dish): string | null {
  if (d.ingredients.length < 3 || d.ingredients.length > 6)
    return 'Choose 3–6 ingredients for your dish.';
  if (
    new Set(d.ingredients).size !== d.ingredients.length ||
    d.ingredients.some((id) => !pantry.some((i) => i.id === id))
  )
    return 'Choose each pantry ingredient only once.';
  if (
    !methods.some((m) => m.id === d.cook) ||
    !styles.some((s) => s.id === d.style) ||
    !['none', 'lemon', 'parmesan', 'basil', 'chili'].includes(d.garnish) ||
    !['last', 'early'].includes(d.finish)
  )
    return 'Choose a cooking method, serving style and finish.';
  if (!Number.isInteger(d.time) || d.time < 2 || d.time > 20)
    return 'Choose a cooking time between 2 and 20 kitchen minutes.';
  if (
    !d.ingredients.some((id) =>
      ['base', 'protein', 'vegetable'].includes(pantry.find((i) => i.id === id)!.role)
    )
  )
    return 'Your dish needs a centerpiece: a vegetable, protein or base.';
  return null;
}
export type Critique = {
  kind: 'good' | 'improve';
  title: string;
  text: string;
};
export type Review = {
  dish: Dish;
  name: string;
  customer: Customer;
  score: number;
  quality: number;
  stars: number;
  components: { name: string; score: number; max: number }[];
  notes: Critique[];
  quote: string;
  minutes: number;
  complexity: number;
  discovery: string;
};
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
export function evaluate(d: Dish, c: Customer): Review {
  const error = validateDish(d);
  if (error) throw new Error(error);
  const foods = d.ingredients.map((id) => pantry.find((i) => i.id === id)!);
  const garnish = pantry.find((i) => i.id === d.garnish);
  const all = garnish ? [...foods, garnish] : foods;
  const has = (id: string) => all.some((i) => i.id === id);
  const roles = new Set(foods.map((i) => i.role));
  const bright = all.some((i) => i.bright),
    rich = all.some((i) => i.rich),
    savory = has('mushroom') || has('garlic') || has('parmesan');
  const crunchy =
    (d.cook === 'assemble' && foods.some((i) => i.crunch)) ||
    (d.cook === 'roast' &&
      d.time >= 12 &&
      foods.some((i) => i.crunch || i.id === 'potato' || i.id === 'chickpeas'));
  const notes: Critique[] = [];
  const say = (good: boolean, title: string, text: string) =>
    notes.push({ kind: good ? 'good' : 'improve', title, text });
  let brief = 30,
    execution = 35,
    balance = 20,
    plating = 15;
  if (c.plantOnly && all.some((i) => !i.plant)) {
    brief -= 30;
    say(
      false,
      'Read the request',
      'This customer asked for plant-based food. Egg, chicken, salmon and Parmesan do not fit that request.'
    );
  }
  if (c.noChili && has('chili')) {
    brief -= 10;
    say(
      false,
      'Keep it mild',
      'The customer asked for mild food; chili worked against their preference.'
    );
  }
  const wanted =
    c.wants === 'bright' ? bright : c.wants === 'cozy' ? roles.has('base') || rich : savory && rich;
  if (wanted)
    say(
      true,
      'You heard the customer',
      `Your ${c.wants === 'bright' ? 'bright finish' : c.wants === 'cozy' ? 'hearty foundation' : 'savory richness'} fit the request.`
    );
  else {
    brief -= 8;
    say(
      false,
      'Follow the flavor brief',
      c.wants === 'bright'
        ? 'Lemon or tomato could bring the brightness this customer wanted.'
        : c.wants === 'cozy'
          ? 'A satisfying base or a rich component would make this feel cozier.'
          : 'A savory ingredient with a little richness would fit this request better.'
    );
  }
  if (c.crunch && !crunchy) {
    brief -= 5;
    say(
      false,
      'Texture matters',
      'The customer wanted crunch. Fresh carrot, crisp toast, or well-roasted sturdy ingredients can provide it.'
    );
  }
  const minutes = prepTime(d);
  if (minutes > c.patience) {
    brief -= Math.min(12, Math.ceil((minutes - c.patience) / 2));
    say(
      false,
      'Service ran long',
      `Your ${minutes}-minute dish exceeded their ${c.patience}-minute window. Every extra ingredient adds prep time.`
    );
  } else
    say(
      true,
      'Good service',
      `${minutes} kitchen minutes kept the dish within the customer’s ${c.patience}-minute window.`
    );
  const mismatch = foods.filter((i) => !i.likes.includes(d.cook));
  execution -= mismatch.length * 5;
  if (mismatch.length)
    say(
      false,
      'Match the method',
      `${mismatch.map((i) => i.name).join(', ')} would shine more with a different method. Inspect ingredient cards for clues.`
    );
  const ideal = methods.find((m) => m.id === d.cook)!.ideal;
  if (d.time < ideal - 2) {
    execution -= 12;
    say(
      false,
      'Give the method time',
      d.cook === 'roast'
        ? 'This quick roast had little chance to develop browning. A faster method would suit the schedule.'
        : 'The cooking window was short for this method; the dish missed some texture and flavor development.'
    );
  } else if (d.time > ideal + 5) {
    execution -= 12;
    say(
      false,
      'Know when to stop',
      'The long cooking window cost freshness and texture. More time does not always mean more flavor.'
    );
  } else
    say(
      true,
      'A well-judged cook',
      `${methods.find((m) => m.id === d.cook)!.name} had a suitable cooking window for this game’s prepared ingredients.`
    );
  if (d.cook === 'saute' && !has('oil')) {
    execution -= 5;
    say(
      false,
      'Give the pan a little help',
      'Olive oil helps carry flavor and supports this sauté.'
    );
  }
  if (has('garlic') && d.cook === 'saute' && d.time > 10) {
    execution -= 5;
    say(
      false,
      'Protect the garlic',
      'Garlic loses its gentle aroma with prolonged direct heat. Cook it more briefly next time.'
    );
  }
  if (!roles.has('protein') && !roles.has('base')) {
    balance -= 5;
    say(
      false,
      'Give it a center',
      'These vegetables can make a good side. A base or protein would help it feel like a full meal.'
    );
  }
  if (rich && !bright) {
    balance -= 5;
    say(
      false,
      'Balance the richness',
      'A lemon finish or juicy tomato could provide contrast to the rich ingredients.'
    );
  } else if (rich && bright)
    say(
      true,
      'Richness meets brightness',
      'Acidity provides contrast, so the rich ingredients feel more balanced.'
    );
  if (foods.filter((i) => i.role === 'finish' || i.role === 'aromatic').length > 2) {
    balance -= 6;
    say(
      false,
      'Too many supporting voices',
      'Seasonings and finishes crowded the centerpiece. Choose fewer supporting ingredients.'
    );
  }
  if (roles.size >= 3)
    say(
      true,
      'A dish with structure',
      'Your ingredients play different roles: a foundation, supporting flavors and contrast.'
    );
  else balance -= 3;
  if (d.style === 'toast' && !has('bread')) {
    plating -= 10;
    say(false, 'Toast needs a foundation', 'Choose sourdough when serving on toast.');
  }
  if (d.style === 'bowl' && !roles.has('base')) {
    plating -= 4;
    say(
      false,
      'Build the bowl',
      'A base helps gather the other components into a satisfying bowl.'
    );
  }
  if (d.style !== c.preferred) {
    plating -= 3;
    say(
      false,
      'Plate for your guest',
      `This customer pictured ${styles.find((s) => s.id === c.preferred)!.name.toLowerCase()}. Your serving style missed that small preference.`
    );
  }
  if (d.garnish !== 'none') {
    if (d.finish === 'early' && (d.garnish === 'basil' || d.garnish === 'lemon')) {
      plating -= 5;
      say(
        false,
        'Finish fresh',
        'Add basil and lemon at the end to keep their fresh aroma and brightness.'
      );
    } else
      say(
        true,
        'A purposeful finish',
        `${garnish!.name} added ${garnish!.bright ? 'brightness' : garnish!.aromatic ? 'fresh aroma' : garnish!.rich ? 'savory richness' : 'a little heat'} to the finished dish.`
      );
  }
  if (d.style === 'toast' && has('tomato') && d.finish === 'early') {
    plating -= 4;
    say(
      false,
      'Keep the toast crisp',
      'Adding juicy toppings early softened the bread. Assemble just before serving.'
    );
  }
  const components = [
    { name: 'Customer brief', score: clamp(brief, 30), max: 30 },
    { name: 'Cooking', score: clamp(execution, 35), max: 35 },
    { name: 'Balance', score: clamp(balance, 20), max: 20 },
    { name: 'Presentation', score: clamp(plating, 15), max: 15 }
  ];
  const quality = components.reduce((n, x) => n + x.score, 0);
  // Complexity earns a bonus only when the whole dish is well received.
  const complexity =
    (d.ingredients.length - 3) * 80 +
    Math.max(0, roles.size - 2) * 40 +
    (d.garnish !== 'none' ? 40 : 0);
  const score = Math.round(quality * 8 + (quality >= 75 ? (complexity * quality) / 100 : 0));
  const main =
    foods.find((i) => i.role === 'protein') ||
    foods.find((i) => i.role === 'vegetable') ||
    foods[0];
  const name = `${methods.find((m) => m.id === d.cook)!.verb} ${main.name.replace(/^Cooked /, '').toLowerCase()} ${d.style === 'toast' ? 'toast' : d.style}`;
  const issue = notes.find((n) => n.kind === 'improve');
  return {
    dish: { ...d, ingredients: [...d.ingredients] },
    name,
    customer: c,
    score,
    quality,
    stars: quality >= 90 ? 5 : quality >= 75 ? 4 : quality >= 60 ? 3 : quality >= 40 ? 2 : 1,
    components,
    notes,
    minutes,
    complexity,
    quote:
      quality >= 90
        ? '“That was exactly the kind of meal I was hoping for.”'
        : quality >= 75
          ? '“I enjoyed that. A few small details could make it really sing.”'
          : quality >= 60
            ? '“There’s a good idea here, but it didn’t quite come together.”'
            : '“I can see what you were trying, but this missed my request.”',
    discovery:
      issue?.text ||
      'A clear idea, a suitable method and a thoughtful finish can make simple ingredients feel special.'
  };
}
export type Service = {
  mode: 'service' | 'daily';
  date: string;
  roster: Customer[];
  reviews: Review[];
  status: 'building' | 'review' | 'complete';
};
export function startService(
  mode: 'service' | 'daily' = 'service',
  date = new Date().toISOString().slice(0, 10)
): Service {
  const offset =
    mode === 'daily'
      ? date.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % customers.length
      : 0;
  return {
    mode,
    date,
    roster: [0, 1, 2].map((i) => customers[(offset + i) % customers.length]),
    reviews: [],
    status: 'building'
  };
}
export function serve(s: Service, d: Dish): Service {
  if (s.status !== 'building') return s;
  return {
    ...s,
    reviews: [...s.reviews, evaluate(d, s.roster[s.reviews.length])],
    status: 'review'
  };
}
export function nextCustomer(s: Service): Service {
  if (s.status !== 'review') return s;
  return { ...s, status: s.reviews.length === 3 ? 'complete' : 'building' };
}
export type RecordBook = {
  version: 2;
  best: number;
  services: number;
  lessons: string[];
  daily: Record<string, number>;
};
export const emptyBook = (): RecordBook => ({
  version: 2,
  best: 0,
  services: 0,
  lessons: [],
  daily: {}
});
export function readBook(): RecordBook {
  try {
    const v = JSON.parse(localStorage.getItem('cheffy-table-v2') || 'null');
    if (v?.version !== 2) return emptyBook();
    return {
      version: 2,
      best: Number.isFinite(v.best) ? Math.max(0, v.best) : 0,
      services: Number.isInteger(v.services) ? Math.max(0, v.services) : 0,
      lessons: Array.isArray(v.lessons)
        ? v.lessons.filter((x: unknown) => typeof x === 'string').slice(-20)
        : [],
      daily: Object.fromEntries(
        Object.entries(v.daily || {})
          .filter(
            ([k, n]) =>
              /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0
          )
          .slice(-60)
      ) as Record<string, number>
    };
  } catch {
    return emptyBook();
  }
}
export function saveService(book: RecordBook, s: Service): RecordBook {
  if (s.status !== 'complete') return book;
  const score = s.reviews.reduce((n, r) => n + r.score, 0);
  return {
    ...book,
    best: Math.max(book.best, score),
    services: book.services + 1,
    lessons: [...new Set([...book.lessons, ...s.reviews.map((r) => r.discovery)])].slice(-20),
    daily:
      s.mode === 'daily'
        ? Object.fromEntries(
            Object.entries({
              ...book.daily,
              [s.date]: Math.max(book.daily[s.date] || 0, score)
            })
              .sort(([a], [b]) => a.localeCompare(b))
              .slice(-60)
          )
        : book.daily
  };
}
