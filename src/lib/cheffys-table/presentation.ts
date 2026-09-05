import {
  emptyDish,
  startService,
  serve,
  nextCustomer,
  validateDish,
  pantry,
  type Dish,
  type Service
} from './service';
export type Phase =
  | 'welcome'
  | 'arrival'
  | 'pantry'
  | 'cook'
  | 'plate'
  | 'serving'
  | 'review'
  | 'complete';
export type Overlay = 'settings' | 'book' | 'help' | 'ingredient' | 'leave' | 'restart' | null;
export type KitchenState = {
  service: Service;
  dish: Dish;
  phase: Phase;
  overlay: Overlay;
  inspected: string;
  submitted: Dish | null;
};
export type KitchenAction =
  | { type: 'start'; mode: Service['mode']; date?: string }
  | { type: 'begin' }
  | { type: 'station'; phase: 'pantry' | 'cook' | 'plate' }
  | { type: 'toggle'; id: string }
  | { type: 'dish'; change: Partial<Omit<Dish, 'ingredients'>> }
  | { type: 'overlay'; overlay: Overlay; id?: string }
  | { type: 'send' }
  | { type: 'served' }
  | { type: 'next' };
export function kitchenState(): KitchenState {
  return {
    service: startService('service', ''),
    dish: emptyDish(),
    phase: 'welcome',
    overlay: null,
    inspected: 'tomato',
    submitted: null
  };
}
export const editable = (s: KitchenState) =>
  ['pantry', 'cook', 'plate'].includes(s.phase) && !s.overlay;
/** Presentation transitions only. Evaluation and persisted choices stay in the existing model. */
export function kitchenReducer(s: KitchenState, a: KitchenAction): KitchenState {
  if (a.type === 'start')
    return { ...kitchenState(), service: startService(a.mode, a.date), phase: 'arrival' };
  if (a.type === 'overlay')
    return s.phase === 'serving'
      ? s
      : {
          ...s,
          overlay: a.overlay,
          inspected: a.id && pantry.some((i) => i.id === a.id) ? a.id : s.inspected
        };
  if (s.overlay) return s;
  if (a.type === 'begin') return s.phase === 'arrival' ? { ...s, phase: 'pantry' } : s;
  if (a.type === 'toggle' && editable(s) && pantry.some((i) => i.id === a.id)) {
    const chosen = s.dish.ingredients.includes(a.id);
    if (!chosen && s.dish.ingredients.length >= 6) return s;
    return {
      ...s,
      inspected: a.id,
      dish: {
        ...s.dish,
        ingredients: chosen
          ? s.dish.ingredients.filter((i) => i !== a.id)
          : [...s.dish.ingredients, a.id]
      }
    };
  }
  if (a.type === 'dish' && editable(s)) return { ...s, dish: { ...s.dish, ...a.change } };
  if (a.type === 'station' && editable(s)) {
    if (a.phase !== 'pantry' && validateDish(s.dish)) return s;
    return { ...s, phase: a.phase };
  }
  if (a.type === 'send' && s.phase === 'plate' && !validateDish(s.dish))
    return {
      ...s,
      phase: 'serving',
      submitted: { ...s.dish, ingredients: [...s.dish.ingredients] }
    };
  if (a.type === 'served' && s.phase === 'serving' && s.submitted)
    return {
      ...s,
      service: serve(s.service, s.submitted),
      phase: 'review',
      submitted: null
    };
  if (a.type === 'next' && s.phase === 'review') {
    const service = nextCustomer(s.service);
    return {
      ...s,
      service,
      dish: emptyDish(),
      phase: service.status === 'complete' ? 'complete' : 'arrival'
    };
  }
  return s;
}
export function serviceCard(service: Service, origin: string) {
  const score = service.reviews.reduce((n, r) => n + r.score, 0);
  const favorite = [...service.reviews].sort((a, b) => b.score - a.score)[0];
  return {
    title: 'Cheffy’s Table',
    score,
    favorite: favorite?.name || '',
    text: `CHEFFY’S TABLE${service.mode === 'daily' ? ` · ${service.date} UTC` : ''}\n${score.toLocaleString('en-US')} points · Three guests fed.\n\n${service.reviews.map((r) => `${r.customer.name} ${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}`).join('\n')}\n\nDish of the service: ${favorite?.name || ''}\nOne thing I learned: ${favorite?.discovery || ''}\n\nSame pantry. What would you serve?\n${origin}/cheffys-table`
  };
}
