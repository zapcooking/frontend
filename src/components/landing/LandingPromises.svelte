<section class="promises" aria-label="Make yourself at home">
  <ul class="promise-list" role="list">
    <li>
      <h3>Find something good.</h3>
      <p>Discover recipes you can read and cook without a subscription.</p>
    </li>
    <li>
      <h3>Keep the good ones.</h3>
      <p>Copy or print a favorite to keep in your kitchen and cook again.</p>
    </li>
    <li>
      <h3>Send a little thanks.</h3>
      <p>Loved a dish? You can tip the cook directly. Always optional.</p>
    </li>
  </ul>
</section>

<style>
  .promises {
    padding: 24px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .promise-list {
    display: grid;
    gap: 20px;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .promise-list li {
    min-width: 0;
  }
  h3 {
    margin: 0 0 8px;
    font-family: var(--font-editorial, Georgia, serif);
    font-size: var(--explore-title, 24px);
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.025em;
    text-wrap: pretty;
  }
  p {
    max-width: 40ch;
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--explore-meta, 13px);
    line-height: 1.5;
  }
  @media (min-width: 768px) {
    .promise-list {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }
  }
</style>
