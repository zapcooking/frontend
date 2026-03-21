<svelte:head>
  <title>Nourish — Recipe Intelligence - zap.cooking</title>
  <meta
    name="description"
    content="Nourish looks at recipe ingredients and gives you three simple signals to help you make informed choices."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-1" style="color: var(--color-text-primary)">
    Nourish
  </h1>
  <p class="text-sm font-medium mb-6" style="color: var(--color-text-secondary)">
    Recipe Intelligence
  </p>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">

    <!-- 1. Intro -->
    <p class="text-lg">
      Understand what your food is doing for you.
    </p>
    <p>
      Nourish looks at recipe ingredients and gives you three simple signals to help you make
      informed choices — not perfect ones.
    </p>

    <!-- 2. Philosophy -->
    <p class="text-sm italic" style="color: var(--color-text-secondary)">
      Nourish helps you understand what a recipe leans toward — so you can adjust, not judge.
    </p>

    <!-- 3. How to Read Scores -->
    <h2 class="section-heading">How to Read Scores</h2>

    <p>Nourish scores are not grades. They help you understand what a recipe leans toward.</p>

    <ul class="insight-list">
      <li>A high Gut Score may mean strong fiber and plant diversity</li>
      <li>A high Protein Score may mean better support for a full meal</li>
      <li>A high Real Food Score may mean simpler, less processed ingredients</li>
    </ul>

    <p>Most recipes won't score high in everything — and that's normal.</p>

    <!-- 4. Example -->
    <h2 class="section-heading">Example</h2>

    <div class="example-card">
      <div class="example-scores">
        <span class="example-score" style="color: #22c55e;">Gut: 8</span>
        <span class="example-score" style="color: #3b82f6;">Protein: 3</span>
        <span class="example-score" style="color: #f97316;">Real Food: 9</span>
      </div>

      <div class="mt-3">
        <p class="text-sm font-semibold" style="color: var(--color-text-primary)">Quick Take</p>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Light, gut-friendly, whole-food focused. Best as a side, not a full protein meal.
        </p>
      </div>

      <div class="mt-3">
        <p class="text-sm font-semibold" style="color: var(--color-text-primary)">Why</p>
        <ul class="example-list">
          <li>Fermented ingredients support gut health</li>
          <li>Simple, minimally processed ingredients</li>
          <li>Low protein density</li>
        </ul>
      </div>

      <div class="mt-3">
        <p class="text-sm font-semibold" style="color: var(--color-text-primary)">Upgrade It</p>
        <ul class="example-list">
          <li>Add chicken, eggs, or chickpeas for protein</li>
        </ul>
      </div>
    </div>

    <!-- 5. The Three Scores -->
    <h2 class="section-heading">The Three Scores</h2>

    <div class="flex flex-col gap-5">
      <!-- Gut Score -->
      <div class="score-explainer" style="border-left-color: #22c55e;">
        <h3 class="text-lg font-bold" style="color: var(--color-text-primary)">Gut Score</h3>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
          Estimates how supportive a recipe may be for digestion and overall gut health.
        </p>
        <p class="text-sm font-medium mt-2" style="color: var(--color-text-primary)">Looks at:</p>
        <ul class="detail-list">
          <li>fiber-rich plants</li>
          <li>plant diversity</li>
          <li>fermented foods</li>
          <li>prebiotic ingredients</li>
        </ul>
        <p class="text-xs mt-2" style="color: var(--color-text-secondary)">
          Higher scores suggest more gut-supportive ingredients.
        </p>
      </div>

      <!-- Protein Score -->
      <div class="score-explainer" style="border-left-color: #3b82f6;">
        <h3 class="text-lg font-bold" style="color: var(--color-text-primary)">Protein Score</h3>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
          Estimates how well a recipe contributes to your protein needs.
        </p>
        <p class="text-sm font-medium mt-2" style="color: var(--color-text-primary)">Looks at:</p>
        <ul class="detail-list">
          <li>protein-rich ingredients</li>
          <li>overall protein presence</li>
          <li>whether the recipe works as a main or a side</li>
        </ul>
        <p class="text-xs mt-2" style="color: var(--color-text-secondary)">
          Some recipes are naturally lower in protein — that's okay.
        </p>
      </div>

      <!-- Real Food Score -->
      <div class="score-explainer" style="border-left-color: #f97316;">
        <h3 class="text-lg font-bold" style="color: var(--color-text-primary)">Real Food Score</h3>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
          Estimates how close ingredients are to whole, minimally processed foods.
        </p>
        <p class="text-sm font-medium mt-2" style="color: var(--color-text-primary)">Looks at:</p>
        <ul class="detail-list">
          <li>whole ingredients</li>
          <li>level of processing</li>
          <li>refined or ultra-processed components</li>
        </ul>
        <p class="text-xs mt-2" style="color: var(--color-text-secondary)">
          Higher scores suggest simpler, more recognizable ingredients.
        </p>
      </div>
    </div>

    <!-- How it Works -->
    <h2 class="section-heading">How it Works</h2>

    <p>
      Nourish reads the ingredient list of a recipe and uses AI to estimate three scores on a 0–10 scale.
    </p>
    <p>Each score includes a short explanation so you can see:</p>
    <ul class="insight-list">
      <li>what helped</li>
      <li>what held it back</li>
      <li>how to adjust if you want to</li>
    </ul>
    <p>
      These are rough estimates designed to help you compare recipes and spot patterns over time.
    </p>

    <!-- Score Scale -->
    <h2 class="section-heading">Score Scale</h2>

    <div class="scale-card">
      <div class="grid grid-cols-5 gap-2 text-center text-xs" style="color: var(--color-text-secondary);">
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">0–2</div>
          Low
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">3–4</div>
          Fair
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">5–6</div>
          Moderate
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">7–8</div>
          Strong
        </div>
        <div>
          <div class="font-bold text-sm" style="color: var(--color-text-primary);">9–10</div>
          Excellent
        </div>
      </div>
    </div>

    <!-- Availability -->
    <h2 class="section-heading">Availability</h2>

    <p>Nourish is available to Zap Cooking members.</p>
    <p>Open any recipe and tap <strong>Nourish</strong> to see what it's doing for you.</p>
    <p>
      <a href="/membership" class="font-semibold underline hover:no-underline" style="color: var(--color-accent, #f97316);">
        View membership options
      </a>
    </p>

    <!-- Notes -->
    <div class="notes-card">
      <h3 class="text-xs font-semibold mb-2" style="color: var(--color-text-primary)">Notes</h3>
      <ul class="notes-list">
        <li>Scores are estimates based on ingredients and recipe structure</li>
        <li>Ingredient quality and preparation methods can change outcomes</li>
        <li>Some benefits depend on specific product types (for example, whether fermented foods contain live cultures)</li>
        <li>Nourish is for awareness, not diagnosis or treatment</li>
      </ul>
    </div>
  </div>
</article>

<style lang="postcss">
  @reference "../../app.css";

  .section-heading {
    @apply text-2xl font-bold mt-8;
    color: var(--color-text-primary);
  }

  .score-explainer {
    @apply pl-4 py-2;
    border-left-width: 3px;
    border-left-style: solid;
  }

  .detail-list {
    @apply text-sm mt-1 pl-4 list-disc;
    color: var(--color-text-secondary);
  }

  .detail-list li {
    @apply py-0.5;
  }

  .insight-list {
    @apply pl-4 list-disc;
    color: var(--color-text-primary);
  }

  .insight-list li {
    @apply py-0.5;
  }

  .example-card {
    @apply p-4 rounded-xl;
    background-color: var(--color-bg-secondary);
  }

  .example-scores {
    @apply flex gap-4 flex-wrap text-sm font-bold;
  }

  .example-list {
    @apply text-sm mt-1 pl-4 list-disc;
    color: var(--color-text-secondary);
  }

  .example-list li {
    @apply py-0.5;
  }

  .scale-card {
    @apply p-4 rounded-xl;
    background-color: var(--color-bg-secondary);
  }

  .notes-card {
    @apply mt-4 p-4 rounded-xl text-xs leading-relaxed;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-secondary);
  }

  .notes-list {
    @apply pl-4 list-disc flex flex-col gap-1;
  }
</style>
