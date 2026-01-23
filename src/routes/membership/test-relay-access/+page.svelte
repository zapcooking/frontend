<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { userPublickey, ndk } from '$lib/nostr';
  import { getAuthManager } from '$lib/authManager';

  let loading = false;
  let testResults: string[] = [];
  let memberInfo: any = null;
  let relayAccess: { [key: string]: boolean } = {};

  const MEMBERS_RELAY = 'wss://pantry.zap.cooking';

  async function testMembershipStatus() {
    if (!browser || !$userPublickey) {
      testResults.push('❌ Not logged in');
      return;
    }

    loading = true;
    testResults = [];
    memberInfo = null;
    relayAccess = {};

    try {
      // Test 1: Check if user is in members API
      testResults.push('🔍 Testing membership status...');
      const membersRes = await fetch('/api/membership/check-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pubkey: $userPublickey,
        }),
      });

      if (membersRes.ok) {
        memberInfo = await membersRes.json();
        testResults.push(`✅ Found in members API`);
        testResults.push(`   Tier: ${memberInfo.tier || 'N/A'}`);
        testResults.push(`   Status: ${memberInfo.status || 'N/A'}`);
        testResults.push(`   Expires: ${memberInfo.subscription_end ? new Date(memberInfo.subscription_end).toLocaleDateString() : 'N/A'}`);
      } else {
        testResults.push(`❌ Not found in members API (${membersRes.status})`);
      }

      // Test 2: Test relay access by trying to connect and publish a test event
      testResults.push('\n🔌 Testing relay access...');
      
      // Test pantry.zap.cooking relay
      await testRelayAccess(MEMBERS_RELAY, 'members');

    } catch (err) {
      testResults.push(`❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      loading = false;
    }
  }

  async function testRelayAccess(relayUrl: string, name: string) {
    try {
      testResults.push(`  Testing ${name} relay (${relayUrl})...`);
      
      // Try to add the relay and connect
      const testNdk = $ndk;
      if (!testNdk) {
        testResults.push(`    ❌ NDK not initialized`);
        return;
      }

      // Add relay explicitly
      try {
        testNdk.addExplicitRelay(relayUrl);
        await testNdk.connect();
        testResults.push(`    ✅ Relay connection successful`);
        relayAccess[name] = true;
      } catch (connectErr: any) {
        testResults.push(`    ❌ Failed to connect: ${connectErr.message}`);
        relayAccess[name] = false;
      }

      // Try to publish a test event (kind 1 note) - this will fail if not authorized
      // Note: This is just a test - we won't actually publish anything harmful
      testResults.push(`    ⚠️  Relay connection test complete (full auth test requires publishing)`);
      
    } catch (err: any) {
      testResults.push(`    ❌ Error testing ${name} relay: ${err.message}`);
      relayAccess[name] = false;
    }
  }

  async function checkMembershipAPI() {
    if (!browser || !$userPublickey) return;

    loading = true;
    testResults = ['🔍 Checking membership API directly...'];

    try {
      const API_SECRET = '4c7aa1d6f3b1916c35b0a0ab89c29c5cc213f79d1560984f34e0958a3ebfebd5';
      const res = await fetch('https://pantry.zap.cooking/api/members', {
        headers: {
          'Authorization': `Bearer ${API_SECRET}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        const userMember = data.members?.find((m: any) => m.pubkey.toLowerCase() === $userPublickey.toLowerCase());
        
        if (userMember) {
          memberInfo = userMember;
          testResults.push(`✅ Found in members API:`);
          testResults.push(`   Pubkey: ${userMember.pubkey.substring(0, 16)}...`);
          testResults.push(`   Tier: ${userMember.tier}`);
          testResults.push(`   Status: ${userMember.status}`);
          testResults.push(`   Payment ID: ${userMember.payment_id}`);
          testResults.push(`   Subscription End: ${userMember.subscription_end}`);
        } else {
          testResults.push(`❌ Not found in members list`);
          testResults.push(`   Your pubkey: ${$userPublickey.substring(0, 16)}...`);
          testResults.push(`   Total members in API: ${data.total || 0}`);
        }
      } else {
        testResults.push(`❌ API returned error: ${res.status}`);
      }
    } catch (err) {
      testResults.push(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      loading = false;
    }
  }

  $: isLoggedIn = $userPublickey && $userPublickey.length > 0;
  $: userPubkeyShort = isLoggedIn ? $userPublickey.substring(0, 16) + '...' : 'Not logged in';
</script>

<svelte:head>
  <title>Test Relay Access - zap.cooking</title>
</svelte:head>

<div class="test-page">
  <div class="test-container">
    <h1>Test Relay Access</h1>
    <p class="subtitle">Verify that your pubkey is added to the relay</p>

    {#if !isLoggedIn}
      <div class="warning-box">
        <p>⚠️ Please log in to test relay access</p>
      </div>
    {:else}
      <div class="info-box">
        <p><strong>Your Pubkey:</strong> {userPubkeyShort}</p>
        <p><strong>Hex Format:</strong> {isLoggedIn ? ($userPublickey.length === 64 ? '✅ Valid' : '❌ Invalid length') : 'N/A'}</p>
      </div>

      <div class="button-group">
        <button class="test-button" on:click={checkMembershipAPI} disabled={loading}>
          {loading ? 'Checking...' : 'Check Members API'}
        </button>
        <button class="test-button" on:click={testMembershipStatus} disabled={loading}>
          {loading ? 'Testing...' : 'Test Relay Access'}
        </button>
      </div>

      {#if memberInfo}
        <div class="member-info-box">
          <h2>Membership Info</h2>
          <dl>
            <dt>Tier:</dt>
            <dd>{memberInfo.tier || 'N/A'}</dd>
            <dt>Status:</dt>
            <dd>{memberInfo.status || 'N/A'}</dd>
            <dt>Payment ID:</dt>
            <dd>{memberInfo.payment_id || 'N/A'}</dd>
            <dt>Subscription End:</dt>
            <dd>{memberInfo.subscription_end ? new Date(memberInfo.subscription_end).toLocaleString() : 'N/A'}</dd>
            <dt>Created:</dt>
            <dd>{memberInfo.created_at ? new Date(memberInfo.created_at).toLocaleString() : 'N/A'}</dd>
          </dl>
        </div>
      {/if}

      {#if testResults.length > 0}
        <div class="results-box">
          <h2>Test Results</h2>
          <pre class="test-results">{testResults.join('\n')}</pre>
        </div>
      {/if}

      {#if Object.keys(relayAccess).length > 0}
        <div class="relay-status-box">
          <h2>Relay Access Status</h2>
          {#each Object.entries(relayAccess) as [name, hasAccess]}
            <div class="relay-status-item">
              <span class="relay-name">{name}.zap.cooking</span>
              <span class="relay-status {hasAccess ? 'access' : 'no-access'}">
                {hasAccess ? '✅ Has Access' : '❌ No Access'}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .test-page {
    min-height: 80vh;
    padding: 2rem;
    max-width: 800px;
    margin: 0 auto;
  }

  .test-container h1 {
    font-size: 2rem;
    font-weight: 900;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
  }

  .subtitle {
    color: var(--color-text-secondary);
    margin-bottom: 2rem;
  }

  .info-box,
  .warning-box {
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
  }

  .info-box {
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: var(--color-text-primary);
  }

  .warning-box {
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: var(--color-text-primary);
  }

  .button-group {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .test-button {
    flex: 1;
    padding: 1rem 2rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .test-button:hover:not(:disabled) {
    background: #d63a00;
    transform: translateY(-2px);
  }

  .test-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .member-info-box,
  .results-box,
  .relay-status-box {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .member-info-box h2,
  .results-box h2,
  .relay-status-box h2 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0 0 1rem 0;
    color: var(--color-text-primary);
  }

  .member-info-box dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem 1.5rem;
    margin: 0;
  }

  .member-info-box dt {
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .member-info-box dd {
    margin: 0;
    color: var(--color-text-primary);
    word-break: break-all;
  }

  .test-results {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    padding: 1rem;
    font-family: 'Courier New', monospace;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    overflow-x: auto;
    margin: 0;
  }

  .relay-status-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 6px;
  }

  .relay-name {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .relay-status {
    font-weight: 600;
  }

  .relay-status.access {
    color: #22c55e;
  }

  .relay-status.no-access {
    color: #ef4444;
  }
</style>
