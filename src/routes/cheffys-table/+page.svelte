<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import CheffyAvatar from '../../components/CheffyAvatar.svelte';
  import FoodArt from '$lib/cheffys-table/FoodArt.svelte';
  import DishVisual from '$lib/cheffys-table/DishVisual.svelte';
  import {
    pantry,
    methods,
    styles,
    emptyDish,
    prepTime,
    validateDish,
    startService,
    serve,
    nextCustomer,
    emptyBook,
    type Dish,
    type Role,
    type Garnish
  } from '$lib/cheffys-table/service';
  import { KitchenFeedback, type RunResult } from '$lib/cheffys-table/companion';
  import { zapKitchen } from '$lib/cheffys-table/zap';
  import '$lib/cheffys-table/service.css';
  import { userPublickey } from '$lib/nostr';
  import {
    readHistory,
    writeHistory,
    mergeHistory,
    historyBook,
    makeRun,
    restoreService,
    syncHistory,
    type HistoryEntry
  } from '$lib/cheffys-table/history';
  import { nostrHistory } from '$lib/cheffys-table/nostrHistory';
  let owner = '',
    history: HistoryEntry[] = [],
    syncing = false,
    syncNotice = '',
    historyOpen = false;
  let localSaved = true;
  let unsubscribe: (() => void) | undefined,
    identityGeneration = 0;
  $: pending = history.filter((e) => !e.synced).length;
  function persist(entries: HistoryEntry[]) {
    history = mergeHistory(entries);
    localSaved = writeHistory(owner, history);
    if (!localSaved)
      syncNotice = 'Browser storage is unavailable. Keep this page open until Nostr sync succeeds.';
  }
  async function sync(restore = true) {
    if (!owner || syncing) return;
    const generation = identityGeneration,
      account = owner;
    syncing = true;
    syncNotice = restore
      ? 'Restoring history and syncing pending services…'
      : 'Saving this service to Nostr…';
    try {
      await syncHistory(
        account,
        history,
        nostrHistory,
        (entries) => {
          if (alive && generation === identityGeneration) persist(mergeHistory(history, entries));
        },
        restore
      );
      if (alive && generation === identityGeneration)
        syncNotice = 'Nostr sync finished. Acknowledged services are backed up to your relays.';
    } catch {
      if (alive && generation === identityGeneration)
        syncNotice = localSaved
          ? 'Nostr sync could not finish. Your device keeps saved services; retry when connected and your signer is ready.'
          : 'Nostr sync and browser storage are unavailable. Keep this page open and retry to save your services.';
    } finally {
      if (alive && generation === identityGeneration) syncing = false;
    }
  }
  let service = startService('service', ''),
    dish: Dish = emptyDish(),
    step = 'pantry',
    filter: Role | 'all' = 'all',
    inspect = 'tomato',
    notebook = false,
    paused = false,
    sound = false,
    book = emptyBook(),
    notice = '',
    plating = false;
  let audio: KitchenFeedback,
    delay: ReturnType<typeof setTimeout> | undefined,
    alive = true;
  let found: { title: string; url: string; image?: string }[] = [],
    finding = false,
    request: AbortController | undefined;
  $: book = historyBook(history);
  $: customer = service.roster[Math.min(service.reviews.length, 2)];
  $: review = service.reviews[service.reviews.length - 1];
  $: total = service.reviews.reduce((n, r) => n + r.score, 0);
  $: minutes = prepTime(dish);
  $: selected = pantry.find((f) => f.id === inspect)!;
  $: error = validateDish(dish);
  function setFilter(value: string) {
    filter = value as Role | 'all';
  }
  function setGarnish(value: string) {
    dish = { ...dish, garnish: value as Garnish };
  }
  function toggle(id: string) {
    inspect = id;
    notice = '';
    if (dish.ingredients.includes(id))
      dish = { ...dish, ingredients: dish.ingredients.filter((x) => x !== id) };
    else if (dish.ingredients.length < 6)
      dish = { ...dish, ingredients: [...dish.ingredients, id] };
    audio?.play('select', sound, false);
  }
  function submit() {
    if (error || plating || paused) return;
    plating = true;
    const submittedDish: Dish = { ...dish, ingredients: [...dish.ingredients] };
    audio?.play('dish', sound, false);
    delay = setTimeout(() => {
      if (alive) {
        service = serve(service, submittedDish);
        plating = false;
        notice = '';
      }
    }, 650);
  }
  function advance() {
    if (service.status !== 'review') return;
    service = nextCustomer(service);
    dish = emptyDish();
    step = 'pantry';
    notice = '';
    if (service.status === 'complete') {
      persist([{ run: makeRun(service), synced: false }, ...history]);
      if (owner) void sync(false);
    }
  }
  function restart(mode: 'service' | 'daily' = service.mode) {
    request?.abort();
    if (delay) clearTimeout(delay);
    plating = false;
    found = [];
    finding = false;
    service = startService(mode);
    dish = emptyDish();
    step = 'pantry';
    paused = false;
    notice = '';
  }
  function run(): RunResult {
    return {
      version: 1,
      mode: service.mode,
      date: service.date,
      seed: 0,
      score: total,
      dishes: service.reviews.length,
      bestChain: 0,
      ingredients: [
        ...new Set(
          service.reviews.flatMap((r) => [
            ...r.dish.ingredients,
            ...(r.dish.garnish === 'none' ? [] : [r.dish.garnish])
          ])
        )
      ].map((id) => pantry.find((f) => f.id === id)!.name),
      discoveries: service.reviews.map((r) => r.discovery)
    };
  }
  async function discover() {
    request?.abort();
    const r = new AbortController();
    request = r;
    finding = true;
    notice = 'Looking through recipes from Zap cooks…';
    try {
      const results = await zapKitchen.findRecipes(run(), r.signal);
      if (alive && !r.signal.aborted) {
        found = results;
        notice = found.length
          ? 'Your service could become dinner.'
          : 'No close match this time. Try Explore or ask Cheffy for a dinner idea.';
      }
    } catch {
      if (!r.signal.aborted)
        notice = 'Recipe discovery is unavailable. Your service is still saved locally.';
    } finally {
      if (!r.signal.aborted) finding = false;
    }
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(
        `Cheffy’s Table · ${total} points\n${service.reviews.map((r) => `${r.stars}/5 · ${r.name}`).join('\n')}\n${service.mode === 'daily' ? `Daily service ${service.date} UTC\n` : ''}What would you serve?\n${location.origin}/cheffys-table`
      );
      notice = 'Service card copied. Nothing was posted automatically.';
    } catch {
      notice = `Cheffy’s Table · ${total} points · ${service.reviews.map((r) => r.name).join(' · ')}`;
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
  onMount(() => {
    unsubscribe = userPublickey.subscribe((pubkey) => {
      const changed = owner !== (pubkey || '');
      owner = pubkey || '';
      identityGeneration++;
      syncing = false;
      history = readHistory(owner);
      restart();
      syncNotice = changed
        ? 'Identity changed: a new service has started. History belongs to the account shown here.'
        : '';
    });
    audio = new KitchenFeedback();
    try {
      sound = localStorage.getItem('cheffy-table-sound') === 'on';
    } catch {
      /* Optional browser preferences/effects must not interrupt play. */
    }
  });
  onDestroy(() => {
    alive = false;
    identityGeneration++;
    unsubscribe?.();
    if (delay) clearTimeout(delay);
    audio?.close();
    request?.abort();
  });
</script>

<svelte:head
  ><title>Cheffy’s Table · Zap Cooking</title><meta
    name="description"
    content="Be Cheffy. Build dishes, serve three guests, and learn from every plate."
  /></svelte:head
>
<main class="table-game native-table">
  <section class="table-history" aria-label="Saved services">
    <div class="history-summary">
      <div>
        <strong
          >{owner
            ? `Nostr chef · ${owner.slice(0, 8)}…${owner.slice(-4)}`
            : 'Guest chef · this device'}</strong
        >
        <p>
          {owner
            ? 'Completed services save locally and sync as encrypted Nostr app data.'
            : 'Guest history stays in this browser. Sign in through Zap to start tracking with your Nostr identity.'}
        </p>
        <small
          >{history.length} saved services · personal best {book.best.toLocaleString()}{owner &&
          pending
            ? ` · ${pending} pending sync`
            : ''}</small
        >
      </div>
      <div class="history-actions">
        <button on:click={() => (historyOpen = !historyOpen)} aria-expanded={historyOpen}
          >Service history</button
        >
        {#if owner}<button disabled={syncing} on:click={() => sync()}
            >{syncing ? 'Syncing…' : 'Sync / restore history'}</button
          >{/if}
      </div>
    </div>
    {#if syncNotice}<p role="status">{syncNotice}</p>{/if}
    {#if historyOpen}<div class="history-list">
        <p>
          Your most recent 100 services. Personal game scores; not a competitive leaderboard.
          Restoring may ask your signer to decrypt saved services.
        </p>
        {#if !history.length}<p>Serve all three guests to save your first service.</p>{/if}
        {#each history as entry (entry.run.id)}
          {@const saved = restoreService(entry.run)}
          <article>
            <strong>{saved.reviews.reduce((n, r) => n + r.score, 0).toLocaleString()} points</strong
            >
            <span
              >{new Date(entry.run.completedAt).toLocaleString()} · {entry.run.mode === 'daily'
                ? 'Daily service'
                : 'Open kitchen'} · {owner
                ? entry.synced
                  ? 'Synced'
                  : 'Pending sync'
                : 'On this device'}</span
            >
            <ul>
              {#each saved.reviews as result}<li>
                  {result.customer.name}: {result.name} · {result.stars}/5 · {result.score} points
                </li>{/each}
            </ul>
          </article>
        {/each}
      </div>{/if}
  </section>
  <div class="table-heading">
    <div>
      <span class="table-eyebrow">YOU’RE THE CHEF. MAKE IT YOURS.</span>
      <h1>Cheffy’s <em>Table</em></h1>
      <p>A small kitchen. Three guests. Your good taste.</p>
    </div>
    <div class="service-controls">
      <div class="service-total"><small>SERVICE SCORE</small><b>{total.toLocaleString()}</b></div>
      <button aria-label="Chef’s notebook" on:click={() => (notebook = true)}>?</button><button
        aria-label="Sound"
        aria-pressed={sound}
        on:click={() => {
          sound = !sound;
          try {
            localStorage.setItem('cheffy-table-sound', sound ? 'on' : 'off');
          } catch {
            /* Optional browser preferences/effects must not interrupt play. */
          }
        }}>{sound ? '♫' : '♪'}</button
      ><button aria-label="Service options" disabled={plating} on:click={() => (paused = true)}
        >Ⅱ</button
      >
    </div>
  </div>
  <div class="service-progress">
    {#each service.roster as c, i}<div
        class:served={i < service.reviews.length}
        class:current={i === service.reviews.length}
      >
        <span>{i < service.reviews.length ? '✓' : i + 1}</span><b>{c.name}</b><small
          >{i < service.reviews.length
            ? `${service.reviews[i].stars} stars`
            : i === service.reviews.length
              ? 'At the table'
              : 'Up next'}</small
        >
      </div>{/each}<span class="service-mode"
      >{service.mode === 'daily' ? `Daily service · ${service.date} UTC` : 'Lunch service'}</span
    >
  </div>
  {#if notebook || paused}<section class="native-options">
      <h2>{notebook ? 'Chef’s notebook' : 'Take a breath, chef.'}</h2>
      {#if notebook}<p>
          Give your dish a center: a vegetable, protein or base. Let the other ingredients support
          it.
        </p>
        <p>Balance richness with brightness. Lemon and tomato contrast with oil, egg and cheese.</p>
        <p>
          Roasting builds browned edges. Steaming keeps things tender. Sautéing is quick; assembling
          preserves fresh textures.
        </p>
        <p>Add fresh basil and lemon at the end. Put wet toppings on toast just before serving.</p>
        <p>
          Listen to your guest. Plant-based, mild, crunchy and quick are real requests. Complexity
          only earns a bonus above 75/100.
        </p>
        {#if book.lessons.length}<details>
            <summary>Your learned lessons</summary>{#each book.lessons as lesson}<p>
                {lesson}
              </p>{/each}
          </details>{/if}{:else}<button class="table-secondary" on:click={() => restart()}
          >Restart service</button
        ><button
          class="table-secondary"
          on:click={() => restart(service.mode === 'daily' ? 'service' : 'daily')}
          >{service.mode === 'daily' ? 'Lunch service' : 'Today’s Daily Service'}</button
        >{/if}<button
        class="table-primary"
        on:click={() => {
          notebook = false;
          paused = false;
        }}>Back to my kitchen</button
      >
    </section>
  {:else if service.status === 'complete'}<section class="service-finale">
      <CheffyAvatar size={75} expression="excited" />
      <h2>You made more than lunch.</h2>
      <strong>{total.toLocaleString()}<small>SERVICE POINTS</small></strong>
      <div class="finale-dishes">
        {#each service.reviews as r}<article>
            <DishVisual dish={r.dish} /><b>{r.name}</b><span
              >{r.customer.name} · {r.stars}/5 · {r.score} pts</span
            >
            <p>{r.discovery}</p>
          </article>{/each}
      </div>
      <div class="finale-actions">
        <button class="table-primary" on:click={() => restart()}>Cook another service →</button
        ><button on:click={share}>Copy service card</button><button on:click={download}
          >Save ingredients</button
        ><button disabled={finding} on:click={discover}>Find recipes from this service</button
        ><button on:click={() => zapKitchen.askCheffy?.(run())}>Make dinner with Cheffy</button>
      </div>
      <p role="status">{notice}</p>
      {#each found as recipe}<a class="native-found" href={recipe.url}>{recipe.title} →</a
        >{/each}<small>Personal best: {book.best} · {book.services} services</small>
    </section>
  {:else if service.status === 'review'}<section class="customer-review">
      <div class="review-plate">
        <span class="table-eyebrow">ORDER UP · {review.customer.name}</span><DishVisual
          dish={review.dish}
        />
        <h2>{review.name}</h2>
        <div class="review-stars" aria-label={`${review.stars} out of 5 stars`}>
          {'★'.repeat(review.stars)}{'☆'.repeat(5 - review.stars)}
        </div>
        <blockquote>{review.quote}</blockquote>
        <strong class="review-points">+{review.score}<small>POINTS</small></strong><span
          class="complexity-result"
          >{review.quality >= 75
            ? `Complexity bonus earned · ${Math.round((review.complexity * review.quality) / 100)} pts`
            : 'Complexity bonus not earned · reach 75/100'}</span
        >
      </div>
      <div class="review-feedback">
        <span class="table-eyebrow">WHAT YOUR GUEST TASTED</span>
        <h2>{review.quality >= 75 ? 'Good instincts, chef.' : 'A lesson in every plate.'}</h2>
        <div class="review-breakdown">
          {#each review.components as c}<div>
              <span>{c.name}</span><meter
                min="0"
                max={c.max}
                value={c.score}
                aria-label={c.name}
              /><b>{c.score}/{c.max}</b>
            </div>{/each}
        </div>
        <div class="review-notes">
          {#each review.notes as n}<article class={n.kind}>
              <span>{n.kind === 'good' ? '✓' : '↗'}</span>
              <div>
                <h3>{n.title}</h3>
                <p>{n.text}</p>
              </div>
            </article>{/each}
        </div>
        <button class="table-primary" on:click={advance}
          >{service.reviews.length === 3 ? 'Close the kitchen' : 'Welcome the next guest'} →</button
        >
      </div>
    </section>
  {:else}<div class="service-layout">
      <aside class="guest-rail">
        <section class="guest-card">
          <div class="guest-top">
            <span class="table-eyebrow">YOUR GUEST · {service.reviews.length + 1}/3</span><span
              class="guest-avatar"
              style={`background:${customer.color}`}>{customer.initials}</span
            >
          </div>
          <h2>{customer.name}</h2>
          <blockquote>{customer.brief}</blockquote>
          <div class="guest-tags">
            <span>{customer.patience} min</span>{#if customer.plantOnly}<span>Plant-based</span
              >{/if}{#if customer.noChili}<span>Mild</span>{/if}{#if customer.crunch}<span
                >A little crunch</span
              >{/if}
          </div>
          <div class="guest-preference">
            <small>PICTURING</small><b>{styles.find((s) => s.id === customer.preferred)?.name}</b>
          </div>
        </section>
        <section class="chef-advice">
          <CheffyAvatar size={48} expression="cooking" />
          <h3>You’re wearing the hat.</h3>
          <p>Build a dish for {customer.name}. A clear idea beats a crowded plate.</p>
          <button on:click={() => (notebook = true)}>A few cooking principles →</button>
        </section>
      </aside>
      <section class="kitchen-station">
        <nav class="station-tabs native-steps" aria-label="Dish building steps">
          {#each ['pantry', 'cook', 'plate'] as s, i}<button
              aria-current={step === s ? 'step' : undefined}
              disabled={i > 0 && dish.ingredients.length < 3}
              on:click={() => (step = s)}
              >{i + 1} · {['Ingredients', 'Cook', 'Plate & serve'][i]}</button
            >{/each}
        </nav>
        <div class="native-station-content">
          {#if step === 'pantry'}<div class="station-heading">
              <div>
                <h2>Start with a good idea.</h2>
                <p>Choose 3–6 ingredients for {customer.name}.</p>
              </div>
              <span class="ingredient-counter">{dish.ingredients.length}/6</span>
            </div>
            <div class="pantry-filters">
              {#each ['all', 'vegetable', 'protein', 'base', 'aromatic', 'finish'] as f}<button
                  aria-pressed={filter === f}
                  on:click={() => setFilter(f)}>{f === 'all' ? 'All ingredients' : f}</button
                >{/each}
            </div>
            <div class="pantry-grid">
              {#each pantry.filter((f) => filter === 'all' || f.role === filter) as f}<article
                  class:chosen={dish.ingredients.includes(f.id)}
                >
                  <button
                    class="ingredient-choice"
                    aria-pressed={dish.ingredients.includes(f.id)}
                    aria-label={`${dish.ingredients.includes(f.id) ? 'Remove' : 'Add'} ${f.name}`}
                    disabled={dish.ingredients.length >= 6 && !dish.ingredients.includes(f.id)}
                    on:click={() => toggle(f.id)}
                    ><FoodArt id={f.id} /><strong>{f.name}</strong><small>{f.role}</small><span
                      class="ingredient-add">{dish.ingredients.includes(f.id) ? '✓' : '+'}</span
                    ></button
                  ><button
                    class="ingredient-info"
                    aria-label={`Learn about ${f.name}`}
                    on:click={() => (inspect = f.id)}>ⓘ</button
                  >
                </article>{/each}
            </div>
            <div class="ingredient-insight">
              <p>
                <b>{selected.name}</b>
                {selected.note}<small
                  >Works well: {selected.likes
                    .map((x) => methods.find((m) => m.id === x)?.name)
                    .join(' · ')}</small
                >
              </p>
            </div>
            <div class="station-next">
              <span
                >{dish.ingredients.length < 3
                  ? `Choose ${3 - dish.ingredients.length} more.`
                  : 'Give each ingredient a purpose.'}</span
              ><button
                class="table-primary"
                disabled={dish.ingredients.length < 3}
                on:click={() => (step = 'cook')}>To the stove →</button
              >
            </div>
          {:else if step === 'cook'}<div class="station-heading">
              <div>
                <h2>Bring out their best.</h2>
                <p>Choose one method for your main ingredients.</p>
              </div>
            </div>
            <div class="method-grid">
              {#each methods as m}<button
                  aria-pressed={dish.cook === m.id}
                  on:click={() => (dish = { ...dish, cook: m.id })}
                  ><b>{m.name}</b>
                  <p>{m.note}</p></button
                >{/each}
            </div>
            <section class="cook-time">
              <div>
                <h3>How long on the station?</h3>
                <b>{dish.time}<small> kitchen min</small></b>
              </div>
              <input
                type="range"
                min="2"
                max="20"
                step="1"
                aria-label="Cooking time in kitchen minutes"
                bind:value={dish.time}
              />
              <div class="time-labels">
                <span>2 · Quick touch</span><span>20 · Take it slow</span>
              </div>
              <p>
                Your ingredients are prepped for service. This simulation’s kitchen minutes are not
                real cooking or food-safety instructions.
              </p>
            </section>
            <div class="station-next">
              <button on:click={() => (step = 'pantry')}>Edit ingredients</button><button
                class="table-primary"
                on:click={() => (step = 'plate')}>Make it a meal →</button
              >
            </div>
          {:else}<div class="station-heading">
              <div>
                <h2>The finishing touch.</h2>
                <p>How it arrives matters as much as what’s inside.</p>
              </div>
            </div>
            <h3 class="control-title">Serving style</h3>
            <div class="style-options">
              {#each styles as s}<button
                  aria-pressed={dish.style === s.id}
                  on:click={() => (dish = { ...dish, style: s.id })}
                  ><b>{s.name}</b><small>{s.note}</small></button
                >{/each}
            </div>
            <h3 class="control-title">A final accent</h3>
            <div class="garnish-options">
              {#each ['none', 'lemon', 'parmesan', 'basil', 'chili'] as g}<button
                  aria-pressed={dish.garnish === g}
                  on:click={() => setGarnish(g)}
                  >{#if g === 'none'}<span class="no-garnish">—</span>{:else}<FoodArt
                      id={g}
                    />{/if}<b
                    >{g === 'none' ? 'Keep it simple' : pantry.find((f) => f.id === g)?.name}</b
                  ></button
                >{/each}
            </div>
            <h3 class="control-title">When do you add toppings and garnish?</h3>
            <div class="finish-options">
              <button
                aria-pressed={dish.finish === 'last'}
                on:click={() => (dish = { ...dish, finish: 'last' })}
                >Just before serving<small>Fresh finish, distinct textures</small></button
              ><button
                aria-pressed={dish.finish === 'early'}
                on:click={() => (dish = { ...dish, finish: 'early' })}
                >With the main ingredients<small>Let the flavors cook together</small></button
              >
            </div>
            <div class="station-next">
              <button on:click={() => (step = 'cook')}>Back to the stove</button><button
                class="table-primary"
                disabled={!!error || plating}
                on:click={submit}
                >{plating ? 'Taking it to the table…' : `Serve ${customer.name}`} →</button
              >
            </div>{/if}
        </div>
      </section>
      <aside class="dish-rail">
        <section class="your-dish">
          <span class="table-eyebrow">ON YOUR PASS</span><DishVisual {dish} />
          <h2>
            {dish.ingredients.length ? 'Your signature in progress' : 'A plate of possibility'}
          </h2>
          <p>
            {methods.find((m) => m.id === dish.cook)?.name} · {styles.find(
              (s) => s.id === dish.style
            )?.name}
          </p>
          <div class="chosen-ingredients">
            {#each dish.ingredients as id}<button
                on:click={() => toggle(id)}
                aria-label={`Remove ${pantry.find((f) => f.id === id)?.name}`}
                >{pantry.find((f) => f.id === id)?.name} ×</button
              >{/each}
          </div>
        </section>
        <section class="prep-card" class:over-budget={minutes > customer.patience}>
          <div><b>{minutes}<small> / {customer.patience} kitchen min</small></b></div>
          <meter
            min="0"
            max={customer.patience}
            value={Math.min(minutes, customer.patience)}
            aria-label="Customer time budget"
          />
          <p>
            {minutes > customer.patience
              ? 'Your guest will be waiting. Can you simplify?'
              : `${dish.ingredients.length * 2} prep + ${(methods.find((m) => m.id === dish.cook)?.prep ?? 0) + dish.time} station${dish.garnish === 'none' ? '' : ' + 1 finish'}`}
          </p>
        </section>
        <section class="creative-stakes">
          <span>ROOM TO IMPRESS</span>
          <h3>
            {dish.ingredients.length >= 5 ? 'An ambitious plate' : 'Simple can be spectacular'}
          </h3>
          <p>
            Complexity earns extra points only when your guest rates the dish at least 75/100.
            Flavor comes first.
          </p>
        </section>
      </aside>
    </div>{/if}
  <footer class="table-footer">
    <span>Good food is a skill. Good taste is yours to discover.</span><span
      >Made with Zap Cooking</span
    >
  </footer>
</main>

<style>
  .native-table {
    padding-bottom: calc(var(--bottom-nav-height, 70px) + 20px);
  }
  .native-steps {
    display: flex;
    justify-content: space-around;
  }
  .native-steps button {
    height: 50px;
    font-size: 13px;
    padding: 8px;
    color: var(--color-text-secondary);
    border-bottom: 2px solid transparent;
  }
  .native-steps button[aria-current='step'] {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .native-station-content {
    padding: 18px;
  }
  .native-options {
    max-width: 600px;
    margin: auto;
    display: grid;
    gap: 15px;
    padding: 25px;
    background: var(--color-bg-primary);
    border-radius: 15px;
  }
  .native-options h2 {
    font-size: 27px;
    font-weight: 700;
  }
  .native-found {
    display: block;
    padding: 12px;
    color: var(--color-primary);
  }
  .cook-time input {
    width: 100%;
    accent-color: var(--color-primary);
  }
  .review-stars {
    font-size: 28px;
    color: #d99731;
  }
</style>
