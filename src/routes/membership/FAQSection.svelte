<script lang="ts">
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  export let activeIndex: number | null;
  export let onToggle: (index: number) => void;

  const faqs = [
    {
      question: 'What happens after the founding period?',
      answer: 'After the first 50 founding spots are filled, membership will continue to be available at regular pricing. Founding members will retain their special benefits and recognition permanently. The Lightning-gated recipes feature will launch in Q1 2026 for all Pro Kitchen members.'
    },
    {
      question: 'Can I upgrade my membership later?',
      answer: 'Yes! You can upgrade from Open Table to Cook+ or Pro Kitchen at any time. When upgrading, you\'ll pay the prorated difference based on the time remaining in your current membership period. Contact us if you need assistance with an upgrade.'
    },
    {
      question: 'What payment options are available?',
      answer: 'We accept both Bitcoin payments via Lightning Network (priced in sats) and Credit Card payments via Stripe (priced in USD). Bitcoin payments typically offer savings compared to card payments. You can choose your preferred payment method during checkout.'
    },
    {
      question: 'What is your refund policy?',
      answer: 'We offer a 30-day money-back guarantee on all paid memberships. If you\'re not satisfied with your membership, contact us within 30 days of your purchase for a full refund. No questions asked.'
    },
    {
      question: 'When do Lightning-gated recipes launch?',
      answer: 'Lightning-gated recipes are scheduled to launch in Q1 2026. This feature will allow Pro Kitchen members to create recipes that require a small Lightning payment to view, enabling new monetization opportunities for creators. All Pro Kitchen members (including founding members) will have access to this feature when it launches.'
    },
    {
      question: 'What are the physical perks for the Founders Club?',
      answer: 'Founders Club members receive a physical package including a custom Zap Cooking T-shirt, a personalized desk plate recognizing them as a Founder, and all shipping costs covered. These are exclusive to Founders Club members.'
    },
    {
      question: 'How does the 2-year pricing save me money?',
      answer: 'The 2-year option offers significant savings compared to paying annually twice. For Cook+, you pay 77,000 sats (instead of 90,000 sats over 2 years) - saving 13,000 sats. For Pro Kitchen, you pay 235,000 sats (instead of 280,000 sats over 2 years) - saving 45,000 sats. Card payments also offer similar percentage discounts.'
    },
    {
      question: 'Will my membership auto-renew?',
      answer: 'Memberships are set to auto-renew by default, but you can manage this in your account settings. You\'ll receive email reminders before renewal, and you can cancel or change your plan at any time. Cancellation takes effect at the end of your current billing period.'
    }
  ];
</script>

<div class="max-w-3xl mx-auto px-1 sm:px-0">
  <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-center mb-6 sm:mb-8 lg:mb-12 text-gray-900 dark:text-white">
    Frequently Asked Questions
  </h2>

  <div class="space-y-2 sm:space-y-3 lg:space-y-4">
    {#each faqs as faq, index}
      <div 
        class="border border-gray-200 dark:border-gray-700 rounded-lg sm:rounded-xl overflow-hidden transition-all duration-300 {activeIndex === index ? 'shadow-md sm:shadow-lg' : ''}"
      >
        <button
          on:click={() => onToggle(index)}
          type="button"
          class="w-full px-4 sm:px-6 py-3 sm:py-4 text-left flex items-start sm:items-center justify-between gap-3 sm:gap-4 
                 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors
                 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
          aria-expanded={activeIndex === index}
        >
          <span class="font-medium sm:font-semibold text-sm sm:text-base text-gray-900 dark:text-gray-100 pr-2">
            {faq.question}
          </span>
          <CaretDownIcon 
            size={20} 
            class="flex-shrink-0 text-gray-500 dark:text-gray-400 transition-transform duration-300 {activeIndex === index ? 'rotate-180' : ''} mt-0.5 sm:mt-0" 
          />
        </button>
        
        {#if activeIndex === index}
          <div 
            class="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700"
            role="region"
            aria-labelledby="faq-question-{index}"
          >
            <p class="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed">
              {faq.answer}
            </p>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
