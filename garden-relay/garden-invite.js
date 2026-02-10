/* ==========================================================================
   Garden Invite — Autocomplete search for the Pyramid relay invite form
   Injected via nginx sub_filter into Pyramid relay pages
   ========================================================================== */
(function () {
  'use strict';

  // --- Config ---
  var PROFILE_RELAYS = ['wss://purplepag.es', 'wss://relay.damus.io'];
  var SEARCH_RELAY = 'wss://relay.nostr.band';
  var DEBOUNCE_MS = 200;
  var SEARCH_DEBOUNCE_MS = 300;
  var SEARCH_TIMEOUT_MS = 4000;
  var BATCH_SIZE = 50;

  var FALLBACK_AVATAR =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
        '<rect width="80" height="80" rx="40" fill="%23f3f4f6"/>' +
        '<text x="40" y="52" text-anchor="middle" font-size="32" fill="%239ca3af">?</text>' +
        '</svg>'
    );

  // --- State ---
  var contacts = []; // [{pubkey, name, displayName, picture, nip05}]
  var contactsLoaded = false;
  var searchResults = []; // same shape
  var searchPending = false;
  var activeIndex = -1;
  var dropdownVisible = false;
  var inputEl = null;
  var dropdownEl = null;
  var containerEl = null;
  var searchWs = null;
  var searchSubId = null;
  var debounceTimer = null;
  var searchDebounceTimer = null;

  // --- Init ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Find the invite text input specifically (not hidden management inputs)
    inputEl = document.querySelector(
      'form[action="/action"] input[type="text"][name="target"]'
    );
    if (!inputEl) return;

    setupUI();

    // Load contacts in background if logged in (optional — search works without)
    var userPubkey = getUserPubkey();
    if (userPubkey) {
      loadContacts(userPubkey);
    } else {
      contactsLoaded = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Cookie / user helpers
  // ---------------------------------------------------------------------------
  function getCookie(name) {
    var v = '; ' + document.cookie;
    var p = v.split('; ' + name + '=');
    if (p.length === 2) return p.pop().split(';').shift();
  }

  function getUserPubkey() {
    var cookie = getCookie('nip98');
    if (!cookie) return null;
    try {
      var decoded = JSON.parse(atob(cookie));
      return decoded.pubkey || null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // nostr-tools loader (shared with garden-login.js)
  // ---------------------------------------------------------------------------
  var _nostrToolsP;

  function loadNostrTools() {
    if (window.NostrTools) return Promise.resolve(window.NostrTools);
    if (_nostrToolsP) return _nostrToolsP;

    _nostrToolsP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src =
        'https://cdn.jsdelivr.net/npm/nostr-tools@1.17.0/lib/nostr.bundle.js';
      s.onload = function () {
        window.NostrTools
          ? resolve(window.NostrTools)
          : reject(new Error('nostr-tools loaded but not available'));
      };
      s.onerror = function () {
        _nostrToolsP = null;
        reject(new Error('Failed to load nostr-tools'));
      };
      document.head.appendChild(s);
    });

    return _nostrToolsP;
  }

  function hexToNpub(hex) {
    if (window.NostrTools) {
      try {
        return window.NostrTools.nip19.npubEncode(hex);
      } catch (e) {}
    }
    return hex;
  }

  function truncateNpub(npub) {
    if (npub.length > 20) {
      return npub.slice(0, 8) + '\u2026' + npub.slice(-4);
    }
    return npub;
  }

  // ---------------------------------------------------------------------------
  // UI Setup
  // ---------------------------------------------------------------------------
  function setupUI() {
    // Load nostr-tools early for npub encoding
    loadNostrTools().catch(function () {});

    // Wrap input in a relative container for dropdown positioning
    containerEl = document.createElement('div');
    containerEl.className = 'garden-search-container';
    inputEl.parentNode.insertBefore(containerEl, inputEl);
    containerEl.appendChild(inputEl);

    // Ensure input fills the container (its flex-1 class no longer applies)
    inputEl.style.width = '100%';

    // Create dropdown
    dropdownEl = document.createElement('div');
    dropdownEl.className = 'garden-search-dropdown';
    dropdownEl.style.display = 'none';
    containerEl.appendChild(dropdownEl);

    // Update input placeholder
    inputEl.placeholder = 'Search by name or paste npub\u2026';
    inputEl.setAttribute('autocomplete', 'off');

    // --- Event listeners ---
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('focus', onFocus);
    inputEl.addEventListener('blur', onBlur);
    inputEl.addEventListener('keydown', onKeydown);

    // Prevent dropdown clicks from blurring
    dropdownEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------
  function onInput() {
    var query = inputEl.value.trim();

    // If input looks like an npub or hex, don't search
    if (isDirectIdentifier(query)) {
      hideDropdown();
      return;
    }

    // Debounce local filtering
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var localResults = filterContacts(query);
      renderDropdown(localResults, searchResults, query);
      if (query.length >= 2 || localResults.length > 0) {
        showDropdown();
      }
    }, DEBOUNCE_MS);

    // Debounce external search (slightly longer)
    if (query.length >= 2) {
      searchPending = true;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        externalSearch(query);
      }, SEARCH_DEBOUNCE_MS);
    } else {
      searchPending = false;
      searchResults = [];
    }
  }

  function onFocus() {
    var query = inputEl.value.trim();
    if (isDirectIdentifier(query)) return;

    if (query.length === 0 && contactsLoaded && contacts.length > 0) {
      renderDropdown(contacts.slice(0, 10), [], '');
      showDropdown();
    } else if (query.length > 0) {
      var localResults = filterContacts(query);
      renderDropdown(localResults, searchResults, query);
      if (localResults.length > 0 || searchResults.length > 0 || query.length >= 2) {
        showDropdown();
      }
    }
  }

  function onBlur() {
    setTimeout(function () {
      hideDropdown();
    }, 150);
  }

  function onKeydown(e) {
    if (!dropdownVisible) return;

    var items = dropdownEl.querySelectorAll('.garden-search-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActiveItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveItem(items);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      var item = items[activeIndex];
      if (item) selectItem(item);
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  }

  function updateActiveItem(items) {
    items.forEach(function (item, i) {
      if (i === activeIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Dropdown rendering
  // ---------------------------------------------------------------------------
  function renderDropdown(local, external, query) {
    dropdownEl.innerHTML = '';
    activeIndex = -1;

    // Deduplicate external results against local
    var localPubkeys = {};
    local.forEach(function (c) {
      localPubkeys[c.pubkey] = true;
    });
    var dedupedExternal = external.filter(function (r) {
      return !localPubkeys[r.pubkey];
    });

    var hasLocal = local.length > 0;
    var hasExternal = dedupedExternal.length > 0;

    if (!hasLocal && !hasExternal) {
      if (query.length >= 2) {
        var empty = document.createElement('div');
        empty.className = 'garden-search-empty';
        if (searchPending) {
          empty.textContent = 'Searching\u2026';
        } else if (!contactsLoaded) {
          empty.textContent = 'Loading contacts\u2026';
        } else {
          empty.textContent = 'No results found';
        }
        dropdownEl.appendChild(empty);
      }
      return;
    }

    // Contacts section
    if (hasLocal) {
      if (hasExternal) {
        dropdownEl.appendChild(createSectionHeader('Contacts'));
      }
      local.forEach(function (profile) {
        dropdownEl.appendChild(createResultItem(profile));
      });
    }

    // External search section
    if (hasExternal) {
      if (hasLocal) {
        dropdownEl.appendChild(createSectionHeader('Search Results'));
      }
      dedupedExternal.forEach(function (profile) {
        dropdownEl.appendChild(createResultItem(profile));
      });
    }
  }

  function createSectionHeader(text) {
    var header = document.createElement('div');
    header.className = 'garden-search-section';
    header.textContent = text;
    return header;
  }

  function createResultItem(profile) {
    var item = document.createElement('div');
    item.className = 'garden-search-item';
    item.setAttribute('data-pubkey', profile.pubkey);

    var avatar = document.createElement('img');
    avatar.className = 'garden-search-avatar';
    avatar.src = profile.picture || FALLBACK_AVATAR;
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.onerror = function () {
      this.src = FALLBACK_AVATAR;
    };

    var meta = document.createElement('div');
    meta.className = 'garden-search-meta';

    var name = document.createElement('span');
    name.className = 'garden-search-name';
    name.textContent = profile.displayName || profile.name || 'Unknown';

    var npub = document.createElement('span');
    npub.className = 'garden-search-npub';
    npub.textContent = truncateNpub(hexToNpub(profile.pubkey));

    meta.appendChild(name);
    meta.appendChild(npub);

    item.appendChild(avatar);
    item.appendChild(meta);

    item.addEventListener('click', function () {
      selectItem(item);
    });

    return item;
  }

  function selectItem(item) {
    var pubkey = item.getAttribute('data-pubkey');
    if (!pubkey) return;

    var npub = hexToNpub(pubkey);
    inputEl.value = npub;
    hideDropdown();

    // Trigger input event so any form validation picks it up
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function showDropdown() {
    dropdownEl.style.display = 'block';
    dropdownVisible = true;
  }

  function hideDropdown() {
    dropdownEl.style.display = 'none';
    dropdownVisible = false;
    activeIndex = -1;
  }

  // ---------------------------------------------------------------------------
  // Contact filtering
  // ---------------------------------------------------------------------------
  function isDirectIdentifier(str) {
    if (!str) return false;
    return str.startsWith('npub1') || /^[0-9a-f]{64}$/i.test(str);
  }

  function filterContacts(query) {
    if (!query) return contacts.slice(0, 10);
    var q = query.toLowerCase();
    return contacts.filter(function (c) {
      return (
        (c.name && c.name.toLowerCase().indexOf(q) !== -1) ||
        (c.displayName && c.displayName.toLowerCase().indexOf(q) !== -1) ||
        (c.nip05 && c.nip05.toLowerCase().indexOf(q) !== -1)
      );
    }).slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Contact loading (background, on init)
  // ---------------------------------------------------------------------------
  function loadContacts(userPubkey) {
    // Fetch kind 3 (contact list) to get followed pubkeys
    var contactPubkeys = [];
    var pending = PROFILE_RELAYS.length;
    var gotContacts = false;
    var settled = false;

    PROFILE_RELAYS.forEach(function (relayUrl) {
      var finished = false;
      try {
        var ws = new WebSocket(relayUrl);
        var subId = 'gi_k3_' + Math.random().toString(36).substring(2, 8);

        ws.onopen = function () {
          ws.send(
            JSON.stringify([
              'REQ',
              subId,
              { kinds: [3], authors: [userPubkey], limit: 1 },
            ])
          );
        };

        ws.onmessage = function (msg) {
          try {
            var data = JSON.parse(msg.data);
            if (data[0] === 'EVENT' && data[2] && data[2].kind === 3) {
              if (!gotContacts) {
                gotContacts = true;
                var tags = data[2].tags || [];
                tags.forEach(function (tag) {
                  if (
                    tag[0] === 'p' &&
                    tag[1] &&
                    tag[1].length === 64 &&
                    contactPubkeys.indexOf(tag[1]) === -1
                  ) {
                    contactPubkeys.push(tag[1]);
                  }
                });
              }
            } else if (data[0] === 'EOSE') {
              try {
                ws.send(JSON.stringify(['CLOSE', subId]));
                ws.close();
              } catch (e) {}
            }
          } catch (e) {}
        };

        ws.onerror = function () {};
        ws.onclose = function () {
          finish();
        };

        setTimeout(function () {
          try {
            ws.close();
          } catch (e) {}
        }, 6000);
      } catch (e) {
        finish();
      }

      function finish() {
        if (finished) return;
        finished = true;
        pending--;
        if (pending <= 0 && !settled) {
          settled = true;
          if (contactPubkeys.length > 0) {
            fetchContactProfiles(contactPubkeys);
          } else {
            contactsLoaded = true;
          }
        }
      }
    });
  }

  function fetchContactProfiles(pubkeys) {
    var profiles = {};
    var pending = PROFILE_RELAYS.length;
    var settled = false;

    var timeout = setTimeout(function () {
      if (!settled) {
        settled = true;
        finalize(profiles);
      }
    }, 8000);

    PROFILE_RELAYS.forEach(function (relayUrl) {
      var finished = false;
      try {
        var ws = new WebSocket(relayUrl);
        var subId = 'gi_k0_' + Math.random().toString(36).substring(2, 8);
        var eoseCount = 0;
        var expectedEose = Math.ceil(pubkeys.length / BATCH_SIZE);

        ws.onopen = function () {
          for (var i = 0; i < pubkeys.length; i += BATCH_SIZE) {
            var batch = pubkeys.slice(i, i + BATCH_SIZE);
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
              if (
                !profiles[pk] ||
                (profiles[pk]._created_at || 0) < event.created_at
              ) {
                content._created_at = event.created_at;
                profiles[pk] = content;
              }
            } else if (data[0] === 'EOSE') {
              eoseCount++;
              try {
                ws.send(JSON.stringify(['CLOSE', data[1]]));
              } catch (e) {}
              if (eoseCount >= expectedEose) {
                try {
                  ws.close();
                } catch (e) {}
              }
            }
          } catch (e) {}
        };

        ws.onerror = function () {};
        ws.onclose = function () {
          done();
        };

        setTimeout(function () {
          try {
            ws.close();
          } catch (e) {}
        }, 6000);

        function done() {
          if (finished) return;
          finished = true;
          pending--;
          if (pending <= 0 && !settled) {
            settled = true;
            clearTimeout(timeout);
            finalize(profiles);
          }
        }
      } catch (e) {
        if (!finished) {
          finished = true;
          pending--;
          if (pending <= 0 && !settled) {
            settled = true;
            clearTimeout(timeout);
            finalize(profiles);
          }
        }
      }
    });

    function finalize(profiles) {
      contacts = Object.keys(profiles).map(function (pk) {
        var p = profiles[pk];
        return {
          pubkey: pk,
          name: p.name || '',
          displayName: p.display_name || '',
          picture: p.picture || '',
          nip05: p.nip05 || '',
        };
      });

      // Sort: profiles with names first, then alphabetical
      contacts.sort(function (a, b) {
        var nameA = (a.displayName || a.name || '').toLowerCase();
        var nameB = (b.displayName || b.name || '').toLowerCase();
        if (!nameA && nameB) return 1;
        if (nameA && !nameB) return -1;
        return nameA.localeCompare(nameB);
      });

      contactsLoaded = true;
    }
  }

  // ---------------------------------------------------------------------------
  // External NIP-50 search
  // ---------------------------------------------------------------------------
  function externalSearch(query) {
    // Close any existing search connection
    if (searchWs) {
      try {
        if (searchSubId) {
          searchWs.send(JSON.stringify(['CLOSE', searchSubId]));
        }
        searchWs.close();
      } catch (e) {}
      searchWs = null;
      searchSubId = null;
    }

    searchResults = [];
    searchPending = true;
    searchSubId = 'gi_s_' + Math.random().toString(36).substring(2, 8);
    var currentSubId = searchSubId;
    var results = [];

    // Show "Searching..." immediately
    var currentQuery = inputEl.value.trim();
    if (currentQuery && !isDirectIdentifier(currentQuery)) {
      var localResults = filterContacts(currentQuery);
      renderDropdown(localResults, [], currentQuery);
      showDropdown();
    }

    try {
      searchWs = new WebSocket(SEARCH_RELAY);

      searchWs.onopen = function () {
        searchWs.send(
          JSON.stringify([
            'REQ',
            currentSubId,
            { kinds: [0], search: query, limit: 10 },
          ])
        );
      };

      searchWs.onmessage = function (msg) {
        try {
          var data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[1] === currentSubId && data[2]) {
            var event = data[2];
            var content = JSON.parse(event.content);
            results.push({
              pubkey: event.pubkey,
              name: content.name || '',
              displayName: content.display_name || '',
              picture: content.picture || '',
              nip05: content.nip05 || '',
            });
            // Update dropdown with new results as they arrive
            searchResults = results;
            var q = inputEl.value.trim();
            if (q && !isDirectIdentifier(q)) {
              var local = filterContacts(q);
              renderDropdown(local, searchResults, q);
              showDropdown();
            }
          } else if (data[0] === 'EOSE') {
            searchPending = false;
            // Final re-render to clear "Searching..." if no results came
            searchResults = results;
            var q2 = inputEl.value.trim();
            if (q2 && !isDirectIdentifier(q2)) {
              var local2 = filterContacts(q2);
              renderDropdown(local2, searchResults, q2);
            }
            try {
              searchWs.send(JSON.stringify(['CLOSE', currentSubId]));
              searchWs.close();
            } catch (e) {}
            searchWs = null;
          }
        } catch (e) {}
      };

      searchWs.onerror = function () {
        searchPending = false;
        searchWs = null;
      };

      // Timeout
      setTimeout(function () {
        if (searchWs && searchSubId === currentSubId) {
          searchPending = false;
          try {
            searchWs.close();
          } catch (e) {}
          searchWs = null;
          // Re-render to clear loading state
          var q3 = inputEl.value.trim();
          if (q3 && !isDirectIdentifier(q3)) {
            var local3 = filterContacts(q3);
            renderDropdown(local3, searchResults, q3);
          }
        }
      }, SEARCH_TIMEOUT_MS);
    } catch (e) {
      searchPending = false;
      searchWs = null;
    }
  }
})();
