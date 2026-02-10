/* ==========================================================================
   Garden Profiles — Enhance invite tree with avatars, names & NIP-05
   Injected via nginx sub_filter into Pyramid relay pages
   ========================================================================== */
(function () {
  'use strict';

  // --- Config ---
  const RELAYS = [
    'wss://purplepag.es',
    'wss://relay.damus.io',
  ];
  const FALLBACK_AVATAR =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
        '<rect width="80" height="80" rx="40" fill="%23f3f4f6"/>' +
        '<text x="40" y="52" text-anchor="middle" font-size="32" fill="%239ca3af">?</text>' +
        '</svg>'
    );

  // --- Wait for DOM ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Only run on pages with an invite tree (main content with <nostr-name> elements)
    const nameEls = document.querySelectorAll('main nostr-name[pubkey]');
    if (!nameEls.length) return;

    // Collect unique pubkeys
    const pubkeySet = new Set();
    nameEls.forEach(function (el) {
      var pk = el.getAttribute('pubkey');
      if (pk && pk.length === 64) pubkeySet.add(pk);
    });
    var pubkeys = Array.from(pubkeySet);
    if (!pubkeys.length) return;

    // Inject placeholder UI immediately (shows avatar skeleton + existing name)
    nameEls.forEach(function (el) {
      enhanceNode(el);
    });

    // Fetch profiles from relays
    fetchProfiles(pubkeys, function (profiles) {
      nameEls.forEach(function (el) {
        var pk = el.getAttribute('pubkey');
        if (pk && profiles[pk]) {
          applyProfile(el, profiles[pk]);
        }
      });
    });
  }

  // --- Enhance a nostr-name node with avatar placeholder and wrapper ---
  function enhanceNode(nameEl) {
    // Find the parent <a> link that wraps this nostr-name
    var link = nameEl.closest('a');
    if (!link) return;
    // Find the container div (the .flex.items-center.gap-2 row)
    var row = link.closest('.flex');
    if (!row) return;

    // Don't enhance twice
    if (row.querySelector('.garden-profile')) return;

    // Create the enhanced profile wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'garden-profile';
    wrapper.style.cssText =
      'display:inline-flex;align-items:center;gap:0.5rem;min-width:0;';

    // Avatar (skeleton placeholder)
    var avatar = document.createElement('img');
    avatar.className = 'garden-avatar';
    avatar.src = FALLBACK_AVATAR;
    avatar.alt = '';
    avatar.style.cssText =
      'width:32px;height:32px;border-radius:50%;object-fit:cover;' +
      'flex-shrink:0;background:#f3f4f6;transition:opacity 0.2s;';
    avatar.loading = 'lazy';

    // Name + meta container
    var meta = document.createElement('div');
    meta.className = 'garden-meta';
    meta.style.cssText =
      'display:flex;flex-direction:column;min-width:0;line-height:1.3;';

    // Move the existing link into the meta container (preserves the nostr-name)
    var linkClone = link.cloneNode(true);
    linkClone.style.cssText =
      'font-weight:600;font-size:0.9375rem;color:#111827;' +
      'text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    // NIP-05 placeholder (hidden until populated)
    var nip05El = document.createElement('span');
    nip05El.className = 'garden-nip05';
    nip05El.style.cssText =
      'display:none;font-size:0.75rem;color:#9ca3af;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    meta.appendChild(linkClone);
    meta.appendChild(nip05El);

    wrapper.appendChild(avatar);
    wrapper.appendChild(meta);

    // Replace the original inline-block div containing the link
    var inlineBlock = link.closest('.relative.inline-block');
    if (inlineBlock) {
      inlineBlock.parentNode.insertBefore(wrapper, inlineBlock);
      inlineBlock.style.display = 'none';
    }
  }

  // --- Apply fetched profile data to enhanced nodes ---
  function applyProfile(nameEl, profile) {
    var link = nameEl.closest('a');
    if (!link) return;
    var row = link.closest('.flex');
    if (!row) return;

    var wrapper = row.querySelector('.garden-profile');
    if (!wrapper) return;

    // Update avatar
    if (profile.picture) {
      var avatar = wrapper.querySelector('.garden-avatar');
      if (avatar) {
        var img = new Image();
        img.onload = function () {
          avatar.src = profile.picture;
        };
        img.src = profile.picture;
      }
    }

    // Update display name in the cloned link
    var clonedLink = wrapper.querySelector('a');
    if (clonedLink && profile.display_name || profile.name) {
      var displayName = profile.display_name || profile.name;
      // Find the nostr-name in the cloned link and override its text
      var clonedNostrName = clonedLink.querySelector('nostr-name');
      if (clonedNostrName) {
        clonedNostrName.textContent = displayName;
      } else {
        clonedLink.textContent = displayName;
      }
    }

    // Show NIP-05
    if (profile.nip05) {
      var nip05El = wrapper.querySelector('.garden-nip05');
      if (nip05El) {
        // Clean up NIP-05 for display: remove leading _ if it's _@domain
        var nip05Display = profile.nip05;
        if (nip05Display.startsWith('_@')) {
          nip05Display = nip05Display.substring(1); // show @domain
        }
        nip05El.textContent = nip05Display;
        nip05El.style.display = 'block';
      }
    }
  }

  // --- Fetch kind 0 profiles from Nostr relays ---
  function fetchProfiles(pubkeys, callback) {
    var profiles = {};
    var pending = RELAYS.length;
    var settled = false;

    // Set a timeout — don't wait forever
    var timeout = setTimeout(function () {
      if (!settled) {
        settled = true;
        callback(profiles);
      }
    }, 8000);

    RELAYS.forEach(function (relayUrl) {
      try {
        var ws = new WebSocket(relayUrl);
        var subId = 'gp_' + Math.random().toString(36).substring(2, 8);

        ws.onopen = function () {
          // Request kind 0 (metadata) for all pubkeys
          // Split into batches of 50 to avoid oversized filters
          for (var i = 0; i < pubkeys.length; i += 50) {
            var batch = pubkeys.slice(i, i + 50);
            var batchSubId = subId + '_' + i;
            ws.send(
              JSON.stringify([
                'REQ',
                batchSubId,
                { kinds: [0], authors: batch },
              ])
            );
          }
        };

        ws.onmessage = function (msg) {
          try {
            var data = JSON.parse(msg.data);
            if (data[0] === 'EVENT' && data[2] && data[2].kind === 0) {
              var event = data[2];
              var content = JSON.parse(event.content);
              var pk = event.pubkey;

              // Only use if we don't already have this profile,
              // or if this event is newer
              if (
                !profiles[pk] ||
                (profiles[pk]._created_at || 0) < event.created_at
              ) {
                content._created_at = event.created_at;
                profiles[pk] = content;
              }
            } else if (data[0] === 'EOSE') {
              // End of stored events — close this subscription
              try {
                ws.send(JSON.stringify(['CLOSE', data[1]]));
              } catch (e) {}
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        ws.onerror = function () {
          finish();
        };

        ws.onclose = function () {
          finish();
        };

        // Close after 6 seconds regardless
        setTimeout(function () {
          try {
            ws.close();
          } catch (e) {}
        }, 6000);

        function finish() {
          pending--;
          if (pending <= 0 && !settled) {
            settled = true;
            clearTimeout(timeout);
            callback(profiles);
          }
        }
      } catch (e) {
        pending--;
        if (pending <= 0 && !settled) {
          settled = true;
          clearTimeout(timeout);
          callback(profiles);
        }
      }
    });
  }
})();
