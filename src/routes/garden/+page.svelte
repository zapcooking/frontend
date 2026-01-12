<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import InviteTree from '../../components/InviteTree.svelte';
  import type { PageData } from './$types';
  import { fallbackTreeData } from '$lib/gardenData';
  import type { TreeNodeData } from '$lib/gardenData';
  import { nip19 } from 'nostr-tools';
  import { ndk, ndkReady, userPublickey } from '$lib/nostr';
  import { get } from 'svelte/store';
  import { NDKRelaySet, NDKEvent } from '@nostr-dev-kit/ndk';

  export let data: any; // SvelteKit page data

  let treeData: TreeNodeData[] = ((data?.data?.treeData ?? data?.treeData) || fallbackTreeData) as TreeNodeData[];
  let loading = false;
  let memberCount = 0;
  
  const GARDEN_RELAY = 'wss://garden.zap.cooking';

  // Count total members in tree
  function countMembers(nodes: TreeNodeData[]): number {
    let count = 0;
    function traverse(node: TreeNodeData) {
      count++;
      node.children.forEach(traverse);
    }
    nodes.forEach(traverse);
    return count;
  }

  // Attempt to fetch tree data from relay on mount
  onMount(async () => {
    if (!browser) return;
    
    try {
      loading = true;
      console.log('[Garden] Starting to fetch tree data...');
      
      // Wait for NDK to be ready
      await ndkReady;
      
      // Use HTML parsing as primary method since it has the correct hierarchical structure
      // The relay query returns flat data without hierarchy
      console.log('[Garden] Fetching tree data from HTML (has correct hierarchy)...');
      const htmlData = await fetchTreeFromHTML();
      if (htmlData && htmlData.length > 0) {
        console.log('[Garden] Got data from HTML:', htmlData.length, 'root nodes');
        console.log('[Garden] Tree data before assignment:', JSON.stringify(htmlData, null, 2));
        // Force reactive update by creating new array
        treeData = [...htmlData];
        console.log('[Garden] Tree data after assignment:', JSON.stringify(treeData, null, 2));
        console.log('[Garden] Checking root nodes:', treeData.map(n => ({ pubkey: n.pubkey.substring(0, 16), isRoot: n.isRoot })));
      } else {
        console.warn('[Garden] HTML parsing failed, trying relay as fallback...');
        // Fallback to relay if HTML parsing fails
        const relayData = await fetchTreeFromRelay();
        if (relayData && relayData.length > 0) {
          console.log('[Garden] Got data from relay:', relayData.length, 'root nodes');
          treeData = relayData;
        } else {
          console.warn('[Garden] Both HTML and relay fetch failed');
        }
      }
    } catch (error) {
      console.error('[Garden] Failed to fetch tree data:', error);
      // Keep existing treeData (fallback)
    } finally {
      loading = false;
      memberCount = countMembers(treeData);
      console.log('[Garden] Final tree data:', treeData);
      console.log('[Garden] Member count:', memberCount);
    }
  });

  // Fetch tree data directly from the garden relay
  async function fetchTreeFromRelay(): Promise<TreeNodeData[] | null> {
    try {
      const ndkInstance = get(ndk);
      if (!ndkInstance) return null;

      // Create a relay set targeting only the garden relay
      const relaySet = NDKRelaySet.fromRelayUrls([GARDEN_RELAY], $ndk, true);

      // Try multiple approaches to find invite tree data:

      // Approach 1: Query for NIP-43 membership list (kind 13534)
      // This is the standard way relays publish member lists
      const membershipEvents = await ndkInstance.fetchEvents(
        {
          kinds: [13534] as any, // NIP-43 membership list (cast to any since NDK types may not include all kinds)
        },
        {},
        relaySet
      );

      if (membershipEvents && membershipEvents.size > 0) {
        const tree = parseMembershipEvents(Array.from(membershipEvents));
        if (tree && tree.length > 0) {
          return tree;
        }
      }

      // Approach 2: Query for custom invite events (kind 30000+ range for custom apps)
      // The garden relay might use a custom event kind to store invite relationships
      // Common ranges: 30000-39999 (replaceable), 40000-49999 (ephemeral)
      const inviteEvents = await ndkInstance.fetchEvents(
        {
          kinds: [30000, 30001, 30002], // Try common custom kinds
        },
        {},
        relaySet
      );

      if (inviteEvents && inviteEvents.size > 0) {
        const tree = parseInviteEvents(Array.from(inviteEvents));
        if (tree && tree.length > 0) {
          return tree;
        }
      }

      // Approach 3: Query for events with invite-related tags
      // Look for events that might contain invite relationships in tags
      const taggedEvents = await ndkInstance.fetchEvents(
        {
          kinds: [1], // Notes
          '#invite': [], // Tag indicating invite relationships
          limit: 100
        },
        {},
        relaySet
      );

      if (taggedEvents && taggedEvents.size > 0) {
        const tree = parseTaggedInviteEvents(Array.from(taggedEvents));
        if (tree && tree.length > 0) {
          return tree;
        }
      }

      // Approach 4: Query relay info (NIP-11) to see if it exposes member list
      // Some relays expose member lists via their NIP-11 info endpoint
      try {
        const relayInfo = await fetch(`https://garden.zap.cooking/.well-known/nostr.json?relay=${encodeURIComponent(GARDEN_RELAY)}`);
        if (relayInfo.ok) {
          const info = await relayInfo.json();
          // Some relays include member lists in their info
          if (info.members && Array.isArray(info.members)) {
            // This would need parsing based on the relay's specific format
            console.log('Relay info contains members:', info.members);
          }
        }
      } catch (e) {
        // NIP-11 query failed, continue
      }

      return null;
    } catch (error) {
      console.warn('Error fetching from relay:', error);
      return null;
    }
  }

  // Parse NIP-43 membership events (kind 13534)
  function parseMembershipEvents(events: NDKEvent[]): TreeNodeData[] | null {
    // NIP-43 membership events have 'member' tags with pubkeys
    // This returns a flat list without hierarchy - not useful for tree display
    // Return null to force HTML parsing which has the correct structure
    console.log('[Garden] Relay returned membership events, but they lack hierarchy. Using HTML parsing instead.');
    return null;
  }

  // Parse custom invite events
  function parseInviteEvents(events: NDKEvent[]): TreeNodeData[] | null {
    // Custom invite events might have 'p' tags indicating parent-child relationships
    const nodeMap = new Map<string, TreeNodeData>();
    const rootNodes: TreeNodeData[] = [];

    for (const event of events) {
      const inviterPubkey = event.pubkey;
      const inviteeTags = event.tags.filter(tag => tag[0] === 'p' && tag[1]);

      // Create or get inviter node
      if (!nodeMap.has(inviterPubkey)) {
        const isRoot = !event.tags.some(tag => tag[0] === 'p' && tag[1]); // No parent = root
        const node: TreeNodeData = {
          pubkey: inviterPubkey,
          children: [],
          isRoot
        };
        nodeMap.set(inviterPubkey, node);
        if (isRoot) {
          rootNodes.push(node);
        }
      }

      const inviterNode = nodeMap.get(inviterPubkey)!;

      // Add invitees as children
      for (const tag of inviteeTags) {
        const inviteePubkey = tag[1];
        if (!nodeMap.has(inviteePubkey)) {
          const childNode: TreeNodeData = {
            pubkey: inviteePubkey,
            children: [],
            isRoot: false
          };
          nodeMap.set(inviteePubkey, childNode);
          inviterNode.children.push(childNode);
        }
      }
    }

    return rootNodes.length > 0 ? rootNodes : null;
  }

  // Parse events with invite tags
  function parseTaggedInviteEvents(events: NDKEvent[]): TreeNodeData[] | null {
    // Events might have invite relationships in tags
    // This is a placeholder - actual implementation depends on the relay's tag structure
    return null;
  }

  // Fallback: Fetch from HTML (original approach)
  async function fetchTreeFromHTML(): Promise<TreeNodeData[] | null> {
    try {
      const response = await fetch('https://garden.zap.cooking', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; zap.cooking/1.0)',
        },
      });

      if (response.ok) {
        const html = await response.text();
        return parseTreeFromHTML(html);
      }
    } catch (error) {
      console.warn('Failed to fetch from HTML:', error);
    }
    return null;
  }

  // Parse HTML to extract tree structure (client-side version)
  function parseTreeFromHTML(html: string): TreeNodeData[] | null {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Find the main tree container - look for ul inside the main content area
      const mainContent = doc.querySelector('main') || doc.body;
      const treeContainer = mainContent.querySelector('ul');
      
      if (!treeContainer) {
        console.warn('No tree container found in HTML');
        return null;
      }

      function parseListNode(listElement: Element | null): TreeNodeData[] {
        if (!listElement) return [];

        const nodes: TreeNodeData[] = [];
        // Get direct child li elements only (not nested ones)
        const listItems = Array.from(listElement.children).filter(el => el.tagName === 'LI');

        listItems.forEach((li) => {
          // Find the link with npub
          const link = li.querySelector('a[href*="/u/npub"]');
          
          if (link) {
            const href = link.getAttribute('href');
            if (href) {
              const npubMatch = href.match(/\/u\/(npub[a-z0-9]+)/);
              if (npubMatch) {
                const npub = npubMatch[1];
                
                try {
                  const decoded = nip19.decode(npub);
                  if (decoded.type === 'npub') {
                    const pubkey = decoded.data as string;
                    
                    // Check for root indicator - look for span containing "root" text
                    // The HTML has: <span class="...">root</span>
                    const allSpans = li.querySelectorAll('span');
                    const rootSpan = Array.from(allSpans).find(
                      span => span.textContent?.trim().toLowerCase() === 'root'
                    );
                    
                    // Root is ONLY the logged-in user (Seth) - we'll handle root marking in post-processing
                    // During parsing, don't mark anyone as root based on HTML "root" span
                    // We'll mark the logged-in user as root after parsing is complete
                    const currentUserPubkey = get(userPublickey);
                    const isCurrentUser = currentUserPubkey ? pubkey.toLowerCase() === currentUserPubkey.toLowerCase() : false;
                    // Only mark as root during parsing if it's the current user
                    // Otherwise, we'll handle root marking in post-processing
                    const isRoot = isCurrentUser;
                    
                    // Find nested ul - must be a direct child of this li
                    // The HTML structure is: <li><div>...</div><ul>...</ul></li>
                    const nestedUl = Array.from(li.children).find(el => el.tagName === 'UL');
                    const children = nestedUl ? parseListNode(nestedUl) : [];
                    
                    // Debug logging
                    if (isCurrentUser || isRoot || children.length > 0) {
                      console.log(`Parsed node: ${pubkey.substring(0, 8)}... isRoot: ${isRoot}, isCurrentUser: ${isCurrentUser}, children: ${children.length}`);
                    }

                    nodes.push({
                      pubkey,
                      children,
                      isRoot
                    });
                  }
                } catch (e) {
                  console.warn('Failed to decode npub:', npub, e);
                }
              }
            }
          }
        });

        return nodes;
      }

      let treeData = parseListNode(treeContainer);
      console.log('[Garden] Parsed tree data (before post-processing):', JSON.stringify(treeData, null, 2));
      
      // Post-process: Ensure the logged-in user is marked as root if they exist in the tree
      const currentUserPubkey = get(userPublickey);
      console.log('[Garden] Current user pubkey:', currentUserPubkey);
      
      if (currentUserPubkey && treeData.length > 0) {
        // Find the user's node in the tree (could be at any level)
        function findAndMarkRoot(nodes: TreeNodeData[]): boolean {
          for (const node of nodes) {
            const nodePubkeyLower = node.pubkey.toLowerCase();
            const userPubkeyLower = currentUserPubkey.toLowerCase();
            
            if (nodePubkeyLower === userPubkeyLower) {
              console.log('[Garden] ✅ Found user in tree! Marking as root:', nodePubkeyLower.substring(0, 16));
              node.isRoot = true;
              
              // Unmark any other root nodes
              function unmarkOtherRoots(nodes: TreeNodeData[]) {
                for (const n of nodes) {
                  if (n.pubkey.toLowerCase() !== userPubkeyLower) {
                    if (n.isRoot) {
                      console.log('[Garden] Unmarking root from:', n.pubkey.substring(0, 16));
                    }
                    n.isRoot = false;
                  }
                  if (n.children.length > 0) {
                    unmarkOtherRoots(n.children);
                  }
                }
              }
              unmarkOtherRoots(treeData);
              return true;
            }
            if (node.children.length > 0) {
              if (findAndMarkRoot(node.children)) {
                return true;
              }
            }
          }
          return false;
        }
        
        const userFound = findAndMarkRoot(treeData);
        if (!userFound) {
          console.warn('[Garden] ⚠️ Logged-in user not found in tree!');
          console.log('[Garden] Available pubkeys in tree:', treeData.map(n => n.pubkey.substring(0, 16)));
        } else {
          console.log('[Garden] ✅ Successfully marked user as root');
        }
      } else {
        if (!currentUserPubkey) {
          console.log('[Garden] No user logged in');
        } else {
          console.log('[Garden] No tree data to process');
        }
      }
      
      console.log('[Garden] Final parsed tree data:', JSON.stringify(treeData, null, 2));
      
      // Force a deep copy to ensure reactivity
      const result = JSON.parse(JSON.stringify(treeData));
      return result.length > 0 ? result : null;
    } catch (error) {
      console.error('Error parsing HTML tree:', error);
      return null;
    }
  }

  // Initialize member count
  $: if (treeData.length > 0) {
    memberCount = countMembers(treeData);
  }
</script>

<svelte:head>
  <title>The Garden 🌱 - zap.cooking</title>
  <meta name="description" content="The Garden is an invite-only community relay for food lovers on Nostr. Plant a seed and let it grow." />
  <meta property="og:url" content="https://zap.cooking/garden" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="The Garden 🌱 - zap.cooking" />
  <meta property="og:description" content="The Garden is an invite-only community relay for food lovers on Nostr. Plant a seed and let it grow." />
  <meta property="og:image" content="https://zap.cooking/logo_with_text.png" />

  <meta name="twitter:card" content="summary" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/garden" />
  <meta name="twitter:title" content="The Garden 🌱 - zap.cooking" />
  <meta name="twitter:description" content="The Garden is an invite-only community relay for food lovers on Nostr. Plant a seed and let it grow." />
  <meta property="twitter:image" content="https://zap.cooking/logo_with_text.png" />
</svelte:head>

<div class="flex flex-col gap-8">
  <!-- Hero Section -->
  <section class="flex flex-col gap-4">
    <div class="text-center py-8">
      <h1 class="text-4xl md:text-5xl font-bold mb-3" style="color: var(--color-text-primary)">
        The Garden 🌱
      </h1>
      <p class="text-xl md:text-2xl font-medium mb-2" style="color: var(--color-text-secondary)">
        Plant a seed and let it grow
      </p>
      <p class="text-base md:text-lg max-w-2xl mx-auto" style="color: var(--color-text-secondary)">
        An invite-only community relay for food lovers on Nostr. Join a growing community of passionate cooks, bakers, and food enthusiasts sharing recipes, techniques, and culinary adventures.
      </p>
    </div>
  </section>

  <!-- Relay Info Card -->
  <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
    <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
      <span>🔌</span>
      <span>Relay Information</span>
    </h2>
    <div class="flex flex-col gap-3">
      <div class="flex flex-col sm:flex-row sm:items-center gap-2">
        <span class="font-medium text-sm" style="color: var(--color-text-secondary)">WebSocket URL:</span>
        <code class="text-sm px-3 py-1.5 rounded bg-input-bg font-mono" style="color: var(--color-text-primary); border: 1px solid var(--color-input-border)">
          wss://garden.zap.cooking
        </code>
      </div>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2">
        <span class="font-medium text-sm" style="color: var(--color-text-secondary)">Admin Panel:</span>
        <a 
          href="https://garden.zap.cooking" 
          target="_blank" 
          rel="noopener noreferrer"
          class="text-sm text-primary hover:underline"
        >
          https://garden.zap.cooking
        </a>
      </div>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2">
        <span class="font-medium text-sm" style="color: var(--color-text-secondary)">Members:</span>
        <span class="text-sm font-semibold" style="color: var(--color-text-primary)">
          {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
    </div>
  </section>

  <!-- How to Join Section -->
  <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
    <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
      <span>🤝</span>
      <span>How to Join</span>
    </h2>
    <div class="flex flex-col gap-4" style="color: var(--color-text-secondary)">
      <p>
        The Garden is an <strong style="color: var(--color-text-primary)">invite-only</strong> relay. To join, you need to receive an invitation from an existing member.
      </p>
      <div class="flex flex-col gap-2">
        <h3 class="font-semibold text-base" style="color: var(--color-text-primary)">Steps to join:</h3>
        <ol class="list-decimal list-inside space-y-2 ml-2">
          <li>Connect with an existing Garden member on Nostr</li>
          <li>Request an invitation to The Garden relay</li>
          <li>Once invited, add <code class="px-1.5 py-0.5 rounded bg-input-bg text-xs font-mono" style="border: 1px solid var(--color-input-border)">wss://garden.zap.cooking</code> to your relay list</li>
          <li>Start sharing your culinary adventures with the community!</li>
        </ol>
      </div>
      <p class="text-sm italic">
        Each member can invite others, helping The Garden grow organically. This ensures a community of engaged food enthusiasts who share a passion for cooking and culinary exploration.
      </p>
    </div>
  </section>

  <!-- Invite Tree Section -->
  <section class="flex flex-col gap-4">
    <h2 class="text-2xl font-bold flex items-center gap-2" style="color: var(--color-text-primary)">
      <span>🌳</span>
      <span>Invite Tree</span>
    </h2>
    <div class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300 overflow-x-auto" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <InviteTree {treeData} {loading} />
    </div>
  </section>

  <!-- Browse Content Section -->
  <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
    <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
      <span>🔍</span>
      <span>Browse Garden Content</span>
    </h2>
    <p class="mb-4" style="color: var(--color-text-secondary)">
      Explore recipes and posts from Garden members through our relay browser:
    </p>
    <a 
      href="https://fevela.me/?r=wss%3A%2F%2Fgarden.zap.cooking" 
      target="_blank" 
      rel="noopener noreferrer"
      class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-[#d64000] transition-colors"
    >
      <span>Browse on fevela.me</span>
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  </section>
</div>
