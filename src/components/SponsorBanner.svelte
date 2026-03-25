<script lang="ts">
  export let title: string;
  export let description: string;
  export let imageUrl: string;
  export let linkUrl: string;
</script>

<a
  href={linkUrl}
  target="_blank"
  rel="noopener noreferrer sponsored"
  class="sponsor-banner"
>
  <div class="sponsor-banner-image">
    <img src={imageUrl} alt={title} loading="lazy" />
  </div>
  <div class="sponsor-banner-content">
    <h3 class="sponsor-banner-title">{title}</h3>
    {#if description}
      <p class="sponsor-banner-desc">{description}</p>
    {/if}
  </div>
</a>

<style>
  .sponsor-banner {
    display: flex;
    gap: 1rem;
    padding: 0.875rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
    overflow: hidden;
  }

  .sponsor-banner:hover {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .sponsor-banner-image {
    flex-shrink: 0;
    width: 120px;
    height: 80px;
    border-radius: 0.5rem;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
  }

  .sponsor-banner-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .sponsor-banner-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    flex: 1;
  }

  .sponsor-banner-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-primary);
    line-height: 1.3;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sponsor-banner-desc {
    font-size: 0.8125rem;
    color: var(--color-caption);
    line-height: 1.4;
    margin: 0.25rem 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* Stack on mobile */
  @media (max-width: 480px) {
    .sponsor-banner {
      flex-direction: column;
      gap: 0.75rem;
    }

    .sponsor-banner-image {
      width: 100%;
      height: 140px;
    }

    .sponsor-banner-title {
      white-space: normal;
    }
  }
</style>
