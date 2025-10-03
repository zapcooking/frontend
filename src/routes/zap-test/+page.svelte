<script lang="ts">
  import ZapTest from '../../components/ZapTest.svelte';
</script>

<svelte:head>
  <title>Zap Test - zap.cooking</title>
  <meta name="description" content="Test NIP-57 Lightning Zaps functionality" />
</svelte:head>

<div class="container mx-auto px-4 py-8">
  <h1 class="text-3xl font-bold mb-8">NIP-57 Lightning Zaps Test</h1>
  
  <div class="mb-8 p-4 bg-blue-50 rounded-lg">
    <h2 class="text-lg font-semibold mb-2">About NIP-57 Lightning Zaps</h2>
    <p class="text-gray-700">
      This page tests the implementation of NIP-57 Lightning Zaps functionality. 
      Zaps allow users to send Lightning payments to both individual notes/recipes and user profiles.
    </p>
    <ul class="list-disc list-inside mt-2 text-sm text-gray-600">
      <li>Support for both note zaps (with eventId) and profile zaps</li>
      <li>Lightning address detection from user profiles (lud06/lud16 fields)</li>
      <li>WebLN integration for seamless payments</li>
      <li>QR code fallback for manual wallet payments</li>
      <li>Real-time zap receipt display and validation</li>
    </ul>
  </div>

  <ZapTest />
</div>

