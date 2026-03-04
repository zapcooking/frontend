<script lang="ts">
  export let title: string;
  export let description: string;
  export let imageUrl: string;
  export let linkUrl: string;
</script>

<article class="sponsor-feed-card border-b py-4 sm:py-6 w-full" style="border-color: var(--color-input-border);">
  <a
    href={linkUrl}
    target="_blank"
    rel="noopener noreferrer sponsored"
    class="sponsor-feed-link"
  >
    <!-- Sponsor label header -->
    <div class="sponsor-feed-header px-2 sm:px-0">
      <span class="sponsor-label">Sponsored</span>
    </div>

    <!-- Image -->
    {#if imageUrl}
      <div class="sponsor-feed-image">
        <img src={imageUrl} alt={title} loading="lazy" />
      </div>
    {/if}

    <!-- Text content -->
    <div class="sponsor-feed-body px-2 sm:px-0">
      <h3 class="sponsor-feed-title">{title}</h3>
      {#if description}
        <p class="sponsor-feed-desc">{description}</p>
      {/if}
    </div>
  </a>
</article>

<style>
  .sponsor-feed-card {
    background-color: var(--color-bg-secondary);
    border-radius: 0.5rem;
    padding-left: 0;
    padding-right: 0;
    margin-bottom: 0.25rem;
  }

  .sponsor-feed-link {
    display: block;
    text-decoration: none;
    color: inherit;
  }

  .sponsor-feed-link:hover .sponsor-feed-title {
    color: var(--color-primary);
  }

  .sponsor-feed-header {
    margin-bottom: 0.5rem;
  }

  .sponsor-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-caption);
  }

  .sponsor-feed-image {
    width: 100%;
    max-height: 300px;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .sponsor-feed-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .sponsor-feed-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-primary);
    line-height: 1.3;
    margin: 0;
    transition: color 0.15s;
  }

  .sponsor-feed-desc {
    font-size: 0.8125rem;
    color: var(--color-caption);
    line-height: 1.4;
    margin: 0.375rem 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
