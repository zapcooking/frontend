<script lang="ts">
  import { theme } from '$lib/themeStore';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import { pantry, methods } from '../service';
  import type { KitchenState, Overlay } from '../presentation';
  import type { BookState } from '../serviceBook';
  import TableSheet from './TableSheet.svelte';
  import ServiceBook from './ServiceBook.svelte';
  import CheffyCoach from './CheffyCoach.svelte';
  import FoodArt from '../FoodArt.svelte';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import SpeakerHigh from 'phosphor-svelte/lib/SpeakerHigh';
  export let state: KitchenState;
  export let bookData: BookState;
  export let sound: boolean;
  export let haptics: boolean;
  export let reduced: boolean;
  export let systemReduced: boolean;
  export let reduceMotion: boolean;
  export let inProgress: boolean;
  export let onSync: () => void;
  export let overlay: (value: Overlay) => void;
  export let start: (mode?: 'service' | 'daily') => void;
  export let leave: () => void;
  export let setSound: (value: boolean) => void;
  export let preference: (key: string, value: boolean) => void;
  $: inspected = pantry.find((i) => i.id === state.inspected)!;
  function lighting(value: string) {
    theme.setTheme(value as 'light' | 'dark' | 'system');
  }
</script>

{#if state.overlay}<TableSheet
    title={state.overlay === 'book'
      ? 'Your Service Book'
      : state.overlay === 'settings'
        ? 'Take a breath, chef.'
        : state.overlay === 'ingredient'
          ? inspected.name
          : state.overlay === 'leave'
            ? 'Leave this kitchen?'
            : state.overlay === 'restart'
              ? 'Start a fresh service?'
              : 'A little kitchen wisdom'}
    onClose={() => overlay(null)}
  >
    {#if state.overlay === 'book'}<ServiceBook
        book={bookData}
        onSync={() => onSync()}
        onLogin={() => {
          overlay(null);
          loginOverlayOpen.set(true);
        }}
      />
    {:else if state.overlay === 'settings'}<div class="settings">
        <button class="table-primary" on:click={() => overlay(null)}
          >Back to my kitchen<ArrowRight size={18} /></button
        ><label
          ><span><SpeakerHigh size={19} />Kitchen sounds</span><input
            type="checkbox"
            checked={sound}
            on:change={(e) => setSound(e.currentTarget.checked)}
          /></label
        ><label
          ><span>Haptics on supported devices</span><input
            type="checkbox"
            checked={haptics}
            on:change={(e) => {
              haptics = e.currentTarget.checked;
              preference('cheffys-table-haptics', haptics);
            }}
          /></label
        ><label
          ><span>Reduce motion{systemReduced ? ' (system preference)' : ''}</span><input
            type="checkbox"
            checked={reduced}
            disabled={systemReduced}
            on:change={(e) => {
              reduceMotion = e.currentTarget.checked;
              preference('cheffys-table-motion', reduceMotion);
            }}
          /></label
        ><label
          ><span>Kitchen lighting</span><select
            aria-label="Kitchen lighting"
            value={$theme}
            on:change={(e) => lighting(e.currentTarget.value)}
            ><option value="system">Match device</option><option value="light">Daylight</option
            ><option value="dark">After hours</option></select
          ></label
        >
        <div class="settings-links">
          <button class="table-text" on:click={() => overlay('book')}>Service Book</button><button
            class="table-text"
            on:click={() => overlay('help')}>How to play</button
          ><button
            class="table-text"
            on:click={() => (inProgress ? overlay('restart') : start('daily'))}
            >Today’s Table</button
          ><button class="table-text" on:click={() => (inProgress ? overlay('restart') : start())}
            >New service</button
          >
        </div>
      </div>
    {:else if state.overlay === 'ingredient'}<div class="ingredient-note">
        <FoodArt id={inspected.id} />
        <div>
          <span class="eyebrow">Cheffy’s pantry note</span>
          <p>{inspected.note}</p>
          <h3>Works well with</h3>
          <span
            >{inspected.likes.map((c) => methods.find((m) => m.id === c)?.name).join(' · ')}</span
          >
        </div>
      </div>
      <CheffyCoach
        text="A method changes an ingredient’s character. Try it, taste the result, remember what happened."
      /><button class="table-primary sheet-return" on:click={() => overlay(null)}
        >Back to my dish</button
      >
    {:else if state.overlay === 'leave' || state.overlay === 'restart'}<p class="sheet-copy">
        Your completed services are safe in your book. This unfinished service will be left behind.
      </p>
      <div class="confirm-actions">
        {#if state.overlay === 'leave'}<button class="table-primary" on:click={leave}
            >Back to Zap</button
          >{:else}<button class="table-primary" on:click={() => start()}>Open Kitchen</button
          ><button class="table-secondary" on:click={() => start('daily')}>Today’s Table</button
          >{/if}<button class="table-text" on:click={() => overlay(null)}>Keep cooking</button>
      </div>
    {:else}<div class="help">
        <h3>Three guests. Three plates.</h3>
        <p>
          Read the guest’s request. Pick 3–6 ingredients, choose how to cook them, then give your
          dish a thoughtful finish.
        </p>
        <h3>Trust your instincts.</h3>
        <p>
          More ingredients mean more potential points, and more chances to miss. Complexity pays off
          when your guest enjoys the dish. A simple meal can be spectacular.
        </p>
        <h3>Learn by cooking.</h3>
        <p>
          Hold an ingredient or focus it and press I for a pantry note. Serve to find out what
          worked; the next ticket is a fresh start.
        </p>
        <h3>Game time is not cooking guidance.</h3>
        <p>
          The pantry includes prepared proteins and bases. Kitchen minutes are simulated, not real
          cooking times or food-safety instructions. Use a real recipe and safe temperatures when
          making dinner.
        </p>
      </div>
      <button class="table-primary sheet-return" on:click={() => overlay(null)}>Let’s cook</button
      >{/if}
  </TableSheet>{/if}

<style>
  .settings > .table-primary {
    width: 100%;
    margin-bottom: 15px;
  }
  .settings label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
    min-height: 62px;
    font-size: 14px;
    border-bottom: 1px solid var(--table-line);
  }
  .settings label > span {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .settings input {
    width: 22px;
    height: 22px;
    accent-color: var(--table-orange);
  }
  .settings select {
    background: var(--table-pantry);
    color: var(--table-ink);
    border: 0;
    border-radius: 10px;
    padding: 10px;
    min-height: 44px;
  }
  .settings-links {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-top: 18px;
  }
  .settings-links button {
    font-size: 14px;
  }
  .ingredient-note {
    display: flex;
    align-items: center;
    gap: 23px;
    --food-size: 125px;
  }
  .ingredient-note p {
    font-size: 18px;
    margin: 10px 0 18px;
  }
  .ingredient-note h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 5px;
  }
  .ingredient-note div > span:last-child {
    font-size: 14px;
    color: var(--table-muted);
  }
  .sheet-return {
    width: 100%;
    margin-top: 25px;
  }
  .sheet-copy {
    font-size: 16px;
    color: var(--table-muted);
    line-height: 1.6;
  }
  .confirm-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 22px;
  }
  .help h3 {
    font-size: 18px;
    font-weight: 700;
    margin: 18px 0 7px;
  }
  .help h3:first-child {
    margin-top: 0;
  }
  .help p {
    color: var(--table-muted);
    font-size: 14px;
    line-height: 1.6;
  }

  @media (max-width: 699px) {
    .ingredient-note {
      --food-size: 85px;
      gap: 16px;
    }
    .ingredient-note p {
      font-size: 16px;
    }
    .settings label {
      font-size: 13px;
    }
  }
</style>
