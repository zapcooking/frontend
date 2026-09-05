<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { userPublickey } from '$lib/nostr';
  import { pantry, validateDish, type Dish } from '$lib/cheffys-table/service';
  import {
    kitchenState,
    kitchenReducer,
    serviceCard,
    type KitchenAction,
    type Overlay
  } from '$lib/cheffys-table/presentation';
  import { createServiceBook } from '$lib/cheffys-table/serviceBook';
  import { historyBook } from '$lib/cheffys-table/history';
  import { nostrHistory } from '$lib/cheffys-table/nostrHistory';
  import { KitchenFeedback, type RunResult } from '$lib/cheffys-table/companion';
  import { zapKitchen } from '$lib/cheffys-table/zap';
  import KitchenHUD from '$lib/cheffys-table/components/KitchenHUD.svelte';
  import KitchenDialogs from '$lib/cheffys-table/components/KitchenDialogs.svelte';
  import Opening from '$lib/cheffys-table/components/Opening.svelte';
  import GuestTicket from '$lib/cheffys-table/components/GuestTicket.svelte';
  import Pantry from '$lib/cheffys-table/components/Pantry.svelte';
  import CookStation from '$lib/cheffys-table/components/CookStation.svelte';
  import PlateStation from '$lib/cheffys-table/components/PlateStation.svelte';
  import PassTray from '$lib/cheffys-table/components/PassTray.svelte';
  import GuestReaction from '$lib/cheffys-table/components/GuestReaction.svelte';
  import ServiceFinale from '$lib/cheffys-table/components/ServiceFinale.svelte';
  import CheffyCoach from '$lib/cheffys-table/components/CheffyCoach.svelte';
  import DishVisual from '$lib/cheffys-table/DishVisual.svelte';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import '$lib/cheffys-table/service.css';

  const stations = [
    { id: 'pantry', label: 'Pantry' },
    { id: 'cook', label: 'Stove' },
    { id: 'plate', label: 'The pass' }
  ] as const;
  let state = kitchenState(),
    ready = false,
    isOffline = false,
    sound = false,
    haptics = false,
    systemReduced = false,
    reduceMotion = false;
  let notice = '',
    announcement = '',
    finding = false,
    recipeStatus = '',
    shareFallback = '',
    bestBefore = 0,
    dailyBefore = 0;
  let found: { title: string; url: string; image?: string; creator?: string }[] = [];
  let alive = true,
    generation = 0,
    owner: string | null = null,
    leaving = false,
    leaveTo = '/explore';
  let serveTimer: ReturnType<typeof setTimeout> | undefined,
    noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined,
    unsubscribe: (() => void) | undefined,
    media: MediaQueryList | undefined;
  const serviceBook = createServiceBook(nostrHistory),
    audio = new KitchenFeedback();
  $: book = historyBook($serviceBook.entries);
  $: reduced = systemReduced || reduceMotion;
  $: current = state.service.roster[Math.min(state.service.reviews.length, 2)];
  $: review = state.service.reviews.at(-1);
  $: building = ['pantry', 'cook', 'plate'].includes(state.phase);
  $: inProgress =
    state.phase !== 'complete' &&
    state.phase !== 'welcome' &&
    (state.dish.ingredients.length > 0 || state.service.reviews.length > 0);
  $: today = ready ? new Date().toISOString().slice(0, 10) : '';
  function flash(text: string) {
    notice = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 5000);
  }
  async function focusStage() {
    await tick();
    if (!alive) return;
    document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'instant' });
    document
      .querySelector<HTMLElement>('.table-world .stage-title')
      ?.focus({ preventScroll: true });
  }
  function dispatch(action: KitchenAction) {
    const phase = state.phase;
    state = kitchenReducer(state, action);
    if (phase !== state.phase) {
      notice = '';
      if (noticeTimer) clearTimeout(noticeTimer);
      void focusStage();
    }
  }
  function overlay(value: Overlay, id?: string) {
    dispatch({ type: 'overlay', overlay: value, id });
  }
  function start(mode: 'service' | 'daily' = 'service') {
    generation++;
    if (serveTimer) clearTimeout(serveTimer);
    request?.abort();
    found = [];
    finding = false;
    recipeStatus = '';
    shareFallback = '';
    notice = '';
    dispatch({ type: 'start', mode });
    try {
      localStorage.setItem('cheffys-table-entered', 'yes');
    } catch {
      /* Entry preference is optional. */
    }
  }
  function toggle(id: string) {
    if (!state.dish.ingredients.includes(id) && state.dish.ingredients.length >= 6) {
      flash('Six ingredients on your board. Remove one to make room.');
      return;
    }
    dispatch({ type: 'toggle', id });
    audio.play('select', sound, false);
  }
  function change(change: Partial<Omit<Dish, 'ingredients'>>) {
    dispatch({ type: 'dish', change });
    if (change.cook || change.style) audio.play('match', sound, false);
  }
  function nextStation() {
    if (state.phase === 'pantry') dispatch({ type: 'station', phase: 'cook' });
    else if (state.phase === 'cook') dispatch({ type: 'station', phase: 'plate' });
    else if (state.phase === 'plate') {
      dispatch({ type: 'send' });
      if ((state.phase as string) !== 'serving') return;
      const token = generation;
      audio.play('dish', sound, haptics);
      serveTimer = setTimeout(
        () => {
          if (!alive || token !== generation) return;
          dispatch({ type: 'served' });
          const r = state.service.reviews.at(-1)!;
          announcement = `${r.customer.name} rated your dish ${r.stars} out of 5. ${r.score} points.`;
        },
        reduced ? 40 : 950
      );
    }
  }
  function advance() {
    if (state.phase !== 'review') return;
    bestBefore = book.best;
    dailyBefore = book.daily[state.service.date] || 0;
    dispatch({ type: 'next' });
    if ((state.phase as string) === 'complete') {
      serviceBook.complete(state.service);
      audio.play('finish', sound, haptics);
      announcement = `Service complete. ${state.service.reviews.reduce((n, r) => n + r.score, 0)} points. Your Service Book has the plates and lessons.`;
    }
  }
  function run(): RunResult {
    return {
      version: 1,
      mode: state.service.mode,
      date: state.service.date,
      seed: 0,
      score: state.service.reviews.reduce((n, r) => n + r.score, 0),
      dishes: state.service.reviews.length,
      bestChain: 0,
      ingredients: [
        ...new Set(
          state.service.reviews.flatMap((r) => [
            ...r.dish.ingredients,
            ...(r.dish.garnish === 'none' ? [] : [r.dish.garnish])
          ])
        )
      ].map((id) => pantry.find((f) => f.id === id)!.name),
      discoveries: state.service.reviews.map((r) => r.discovery)
    };
  }
  async function discover() {
    request?.abort();
    const r = new AbortController();
    request = r;
    finding = true;
    recipeStatus = 'Looking through recipes from Zap cooks…';
    try {
      const recipes = await zapKitchen.findRecipes(run(), r.signal);
      if (alive && !r.signal.aborted) {
        found = recipes;
        recipeStatus = found.length
          ? 'Your next real dish might be here.'
          : 'No close match today. Explore the recipes or let Cheffy turn your ingredients into dinner.';
      }
    } catch {
      if (alive && !r.signal.aborted)
        recipeStatus =
          'Couldn’t reach Zap recipes. Your service is still in your book. Try again when connected.';
    } finally {
      if (alive && !r.signal.aborted) finding = false;
    }
  }
  async function share() {
    const card = serviceCard(state.service, location.origin);
    try {
      await navigator.clipboard.writeText(card.text);
      flash('Service card copied. Ready to share when you are.');
    } catch {
      shareFallback = card.text;
      flash('Your service card is ready below. Select the text to copy it.');
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([run().ingredients.join('\n')], { type: 'text/plain' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cheffys-table-ingredients.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
  function preference(key: string, value: boolean) {
    try {
      localStorage.setItem(key, value ? 'on' : 'off');
    } catch {
      flash('This setting will last while the kitchen stays open.');
    }
  }
  function setSound(value: boolean) {
    sound = value;
    preference('cheffy-table-sound', value);
    if (value) audio.play('dish', true, false);
  }
  function motionChange() {
    systemReduced = media?.matches || false;
  }
  function offline() {
    isOffline = true;
    flash('Offline. You can keep cooking; completed services save on this device.');
  }
  function online() {
    isOffline = false;
    serviceBook.online();
  }
  async function leave() {
    leaving = true;
    await goto(leaveTo);
  }
  beforeNavigate(({ cancel, to, willUnload }) => {
    if (inProgress && !leaving) {
      cancel();
      if (!willUnload) {
        leaveTo = to?.url.href || '/explore';
        overlay('leave');
      }
    }
  });
  onMount(() => {
    try {
      sound = localStorage.getItem('cheffy-table-sound') === 'on';
      haptics = localStorage.getItem('cheffys-table-haptics') === 'on';
      reduceMotion = localStorage.getItem('cheffys-table-motion') === 'on';
    } catch {
      /* Safe browser defaults. */
    }
    media = matchMedia('(prefers-reduced-motion: reduce)');
    motionChange();
    media.addEventListener('change', motionChange);
    unsubscribe = userPublickey.subscribe((pubkey) => {
      const next = pubkey || '',
        changed = owner !== null && owner !== next;
      owner = next;
      serviceBook.identity(next);
      if (changed) {
        start();
        flash('New identity, fresh service. Your Service Book now belongs to this account.');
      }
    });
    try {
      if (localStorage.getItem('cheffys-table-entered') === 'yes') start();
    } catch {
      /* Show the opening when storage is blocked. */
    }
    isOffline = !navigator.onLine;
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    ready = true;
  });
  onDestroy(() => {
    alive = false;
    generation++;
    unsubscribe?.();
    serviceBook.destroy();
    audio.close();
    request?.abort();
    if (serveTimer) clearTimeout(serveTimer);
    if (noticeTimer) clearTimeout(noticeTimer);
    media?.removeEventListener('change', motionChange);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    }
  });
</script>

<svelte:head
  ><title>Cheffy’s Table · Zap Cooking</title><meta
    name="description"
    content="Three guests. One pantry. No perfect recipe. Step into Cheffy’s Table and cook with your instincts."
  /></svelte:head
>
<main class="table-world" data-reduced={reduced}>
  <KitchenHUD
    service={state.service}
    offline={isOffline}
    active={state.phase !== 'welcome'}
    saving={$serviceBook.saving}
    saved={$serviceBook.entries.length > 0 && $serviceBook.localSaved}
    onBook={() => overlay('book')}
    onSettings={() => overlay('settings')}
    onLeave={() => {
      /* The shared navigation guard handles unfinished plates. */
    }}
  />
  <p class="screen-reader" role="status" aria-atomic="true">{announcement}</p>
  {#if state.phase === 'welcome'}<Opening
      onStart={start}
      {ready}
      date={today}
      dailyBest={book.daily[today] || 0}
    />
  {:else}<div class="kitchen-content" class:is-building={building}>
      {#if state.phase === 'arrival'}<section class="arrival-stage">
          <span class="eyebrow"
            >{state.service.reviews.length
              ? 'Next ticket. Fresh possibilities.'
              : 'The kitchen is open.'}</span
          >
          <h1 class="stage-title" tabindex="-1">
            {state.service.reviews.length ? 'A new seat at your table.' : 'Meet your first guest.'}
          </h1>
          <GuestTicket customer={current} arrival /><CheffyCoach
            text={state.service.reviews.length
              ? 'New guest. New idea. Bring what you learned.'
              : 'Read the room. Pick a few good ingredients. Make a dish you believe in.'}
          />
          <div class="table-next-action">
            <button class="table-primary" on:click={() => dispatch({ type: 'begin' })}
              >Cook for {current.name}<ArrowRight size={19} /></button
            >
          </div>
        </section>
      {:else if building}<div class="kitchen-grid">
          <div class="guest-place"><GuestTicket customer={current} /></div>
          <section class="station">
            <nav class="station-wayfinding" aria-label="Kitchen stations">
              {#each stations as station}<button
                  aria-current={state.phase === station.id ? 'step' : undefined}
                  disabled={station.id !== 'pantry' && !!validateDish(state.dish)}
                  on:click={() => dispatch({ type: 'station', phase: station.id })}
                  >{station.label}</button
                >{/each}
            </nav>
            {#if state.phase === 'pantry'}<Pantry
                dish={state.dish}
                onToggle={toggle}
                onInspect={(id) => overlay('ingredient', id)}
              />{:else if state.phase === 'cook'}<CookStation
                dish={state.dish}
                customer={current}
                onChange={change}
                onHelp={() => overlay('help')}
              />{:else}<PlateStation dish={state.dish} onChange={change} />{/if}
          </section>
          <PassTray
            dish={state.dish}
            customer={current}
            phase={state.phase}
            disabled={!!validateDish(state.dish)}
            onToggle={toggle}
            onInspect={(id) => overlay('ingredient', id)}
            onNext={nextStation}
            onBack={() =>
              dispatch({ type: 'station', phase: state.phase === 'plate' ? 'cook' : 'pantry' })}
          />
        </div>
      {:else if state.phase === 'serving'}<section class="serve-stage">
          <span class="eyebrow">Coming through, chef.</span>
          <h1 class="stage-title" tabindex="-1">Order up, {current.name}.</h1>
          <div><DishVisual dish={state.submitted || state.dish} sending={!reduced} /></div>
          <p>A little anticipation. A lot of good taste.</p>
        </section>
      {:else if state.phase === 'review' && review}<GuestReaction
          {review}
          {reduced}
          finalGuest={state.service.reviews.length === 3}
          onNext={advance}
        />
      {:else if state.phase === 'complete'}<ServiceFinale
          service={state.service}
          {reduced}
          {bestBefore}
          {dailyBefore}
          saved={$serviceBook.localSaved || $serviceBook.entries.every((e) => e.synced)}
          {finding}
          {found}
          {recipeStatus}
          {shareFallback}
          onReplay={() => start(state.service.mode)}
          onDaily={() => start('daily')}
          onDiscover={discover}
          onCheffy={() => zapKitchen.askCheffy?.(run())}
          onShare={share}
          onBook={() => overlay('book')}
          onDownload={download}
        />{/if}
    </div>{/if}
  {#if notice}<div class="toast-message" role="status">{notice}</div>{/if}
  <KitchenDialogs
    {state}
    bookData={$serviceBook}
    {sound}
    bind:haptics
    {reduced}
    {systemReduced}
    bind:reduceMotion
    {inProgress}
    onSync={() => serviceBook.sync()}
    {overlay}
    {start}
    {leave}
    {setSound}
    {preference}
  />
</main>

<style>
  .arrival-stage {
    text-align: center;
    max-width: 500px;
    margin: 20px auto 35px;
  }
  .arrival-stage > h1 {
    margin: 10px 0 32px;
    font-size: 34px;
  }
  .arrival-stage .table-primary {
    margin: 24px auto 0;
    min-width: 250px;
  }
  .serve-stage {
    max-width: 460px;
    margin: 50px auto;
    text-align: center;
  }
  .serve-stage h1 {
    margin: 10px 0 20px;
    font-size: 42px;
  }
  .serve-stage > div {
    max-width: 350px;
    margin: 35px auto;
  }
  .serve-stage p {
    color: var(--table-muted);
    font-size: 14px;
  }
  @media (max-width: 699px) {
    .arrival-stage {
      padding-bottom: 80px;
      margin: 12px auto 25px;
    }
    .arrival-stage > h1 {
      font-size: 27px;
      margin-bottom: 26px;
    }
    .arrival-stage .table-primary {
      width: 100%;
      margin: 0;
    }
    .serve-stage {
      margin-top: 32px;
    }
    .serve-stage h1 {
      font-size: 31px;
    }
  }
</style>
