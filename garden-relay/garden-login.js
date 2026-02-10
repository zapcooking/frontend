/* ==========================================================================
   Garden Login — Multi-method auth modal for Pyramid relay
   Injected via nginx sub_filter into Pyramid relay pages
   Methods: NIP-07 extension, Bunker/NostrConnect, nsec private key
   ========================================================================== */
(function () {
  'use strict';

  // --- Init ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    injectModal();
    interceptLoginButton();
  }

  // ---------------------------------------------------------------------------
  // Cookie helpers
  // ---------------------------------------------------------------------------
  function getCookie(name) {
    var v = '; ' + document.cookie;
    var p = v.split('; ' + name + '=');
    if (p.length === 2) {
      var raw = p.pop().split(';').shift();
      try {
        return decodeURIComponent(raw);
  function setCookie(name, value) {
    var encodedValue = encodeURIComponent(value);
    var cookie = name + '=' + encodedValue + '; path=/; SameSite=Lax';
    if (typeof location !== 'undefined' && location && location.protocol === 'https:') {
      cookie += '; Secure';
    }
    document.cookie = cookie;
  }

  // ---------------------------------------------------------------------------
  // Modal management
  // ---------------------------------------------------------------------------
  function showModal() {
    var m = document.getElementById('garden-login-modal');
    if (m) {
      m.style.display = 'flex';
      clearStatus();
      updateNip07Status();
    }
  }

  function hideModal() {
    var m = document.getElementById('garden-login-modal');
    if (m) m.style.display = 'none';
    clearStatus();
  }

  function showStatus(msg, isError) {
    var el = document.getElementById('garden-login-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'garden-login-status ' + (isError ? 'error' : 'info');
    el.style.display = 'block';
  }

  function clearStatus() {
    var el = document.getElementById('garden-login-status');
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------------------
  // NIP-07 extension detection
  // ---------------------------------------------------------------------------
  // window.nostr.js (loaded with startHidden:true) only sets window.nostr
  // after a bunker connection is established. At page load, window.nostr
  // existing means a native extension (nos2x, Alby, etc.) is installed.
  function hasNip07Extension() {
    return !!(window.nostr && typeof window.nostr.getPublicKey === 'function');
  }

  function updateNip07Status() {
    var hint = document.getElementById('garden-nip07-hint');
    var btn = document.getElementById('garden-nip07-btn');
    if (!hint || !btn) return;

    if (hasNip07Extension()) {
      hint.textContent = 'Recommended \u2014 sign in with your browser extension';
      hint.className = 'garden-login-hint';
    } else {
      hint.textContent = 'No extension detected \u2014 install nos2x, Alby, or similar';
      hint.className = 'garden-login-hint muted';
    }
  }

  // ---------------------------------------------------------------------------
  // Auth event helpers
  // ---------------------------------------------------------------------------
  function createAuthTemplate() {
    return {
      created_at: Math.floor(Date.now() / 1000),
      kind: 27235,
      tags: [['domain', location.host]],
      content: '',
    };
  }

  function loginWithSignedEvent(evt) {
    setCookie('nip98', btoa(JSON.stringify(evt)));
    location.reload();
  }

  // ---------------------------------------------------------------------------
  // Method 1 — NIP-07 Extension
  // ---------------------------------------------------------------------------
  async function handleNip07() {
    clearStatus();

    if (!hasNip07Extension()) {
      showStatus(
        'No Nostr extension detected. Install nos2x, Alby, or a similar browser extension first.',
        true
      );
      return;
    }

    showStatus('Requesting signature from extension\u2026', false);

    try {
      await window.nostr.getPublicKey();
      var signed = await window.nostr.signEvent(createAuthTemplate());
      loginWithSignedEvent(signed);
    } catch (e) {
      showStatus(
        'Extension sign-in failed: ' + (e.message || 'request cancelled'),
        true
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Method 2 — Bunker / NostrConnect
  // ---------------------------------------------------------------------------
  // Delegates to window.nostr.js which handles the full NIP-46 flow.
  // Calling window.nostr.signEvent() when no extension is present triggers
  // the wnj widget to appear so the user can connect via bunker:// or QR.
  async function handleBunker() {
    clearStatus();
    showStatus('Opening Nostr Connect\u2026', false);
    hideModal();

    try {
      // window.nostr here comes from the wnj widget — it will show its UI
      // for the user to pair via bunker:// or QR code, then sign.
      var signed = await window.nostr.signEvent(createAuthTemplate());
      loginWithSignedEvent(signed);
    } catch (e) {
      showModal();
      showStatus(
        'Bunker connection failed or was cancelled. Try again or use another method.',
        true
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Method 3 — nsec private key
  // ---------------------------------------------------------------------------
  var _nostrToolsP;

  function loadNostrTools() {
    if (window.NostrTools) return Promise.resolve(window.NostrTools);
    if (_nostrToolsP) return _nostrToolsP;

    _nostrToolsP = new Promise(function (resolve, reject) {
      // Security: Using SRI (Subresource Integrity) to ensure CDN serves unmodified code
      // If upgrading nostr-tools, update this hash by running: ./generate-sri-hash.sh
      var NOSTR_TOOLS_CDN_SRC =
        'https://cdn.jsdelivr.net/npm/nostr-tools@1.17.0/lib/nostr.bundle.js';
      var NOSTR_TOOLS_INTEGRITY =
        'sha384-GwmNxV/GnZt+zRBR/Hhtu5D4MKfbxeJSApW44ARryGYtj3MFheHMFgiEZ7tVnrln';

      var s = document.createElement('script');
      s.src = NOSTR_TOOLS_CDN_SRC;
      s.integrity = NOSTR_TOOLS_INTEGRITY;
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        window.NostrTools
          ? resolve(window.NostrTools)
          : reject(new Error('nostr-tools loaded but not available'));
      };
      s.onerror = function () {
        _nostrToolsP = null;
        reject(new Error('Failed to load signing library'));
      };
      document.head.appendChild(s);
    });

    return _nostrToolsP;
  }

  async function handleNsec() {
    clearStatus();

    var input = document.getElementById('garden-nsec-input');
    var nsec = input ? input.value.trim() : '';

    if (!nsec) {
      showStatus('Please enter your nsec private key.', true);
      return;
    }
    if (!nsec.startsWith('nsec1')) {
      showStatus('Invalid key format \u2014 must start with nsec1', true);
      return;
    }

    showStatus('Signing\u2026', false);

    try {
      var tools = await loadNostrTools();
      var decoded = tools.nip19.decode(nsec);

      if (decoded.type !== 'nsec') {
        showStatus('Invalid nsec key.', true);
        return;
      }

      var sk = decoded.data;
      var signed = tools.finishEvent(createAuthTemplate(), sk);
      loginWithSignedEvent(signed);
    } catch (e) {
      showStatus('nsec login failed: ' + (e.message || e), true);
    }
  }

  // ---------------------------------------------------------------------------
  // Intercept the Pyramid login button (capture phase, before Alpine)
  // ---------------------------------------------------------------------------
  function interceptLoginButton() {
    document.addEventListener(
      'click',
      function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;

        // Don't intercept clicks on our own modal buttons
        if (btn.closest('#garden-login-modal')) return;

        var text = btn.textContent.trim().toLowerCase();
        // Only intercept the login button inside Alpine's authButton component
        if (text === 'login' && btn.closest('[x-data]')) {
          e.stopImmediatePropagation();
          e.preventDefault();
          showModal();
        }
        // "logout" clicks pass through to Alpine's original handler
      },
      true // capture phase — fires before Alpine's bubble-phase handler
    );

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideModal();
    });
  }

  // ---------------------------------------------------------------------------
  // Inject modal HTML
  // ---------------------------------------------------------------------------
  function injectModal() {
    var overlay = document.createElement('div');
    overlay.id = 'garden-login-modal';
    overlay.className = 'garden-login-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = [
      '<div class="garden-login-card">',

      // ---- Header ----
      '<div class="garden-login-header">',
      '<h2>Login to The Garden</h2>',
      '<button id="garden-login-close" class="garden-login-close" aria-label="Close">&times;</button>',
      '</div>',

      // ---- NIP-07 Extension (top, preferred) ----
      '<div class="garden-login-section">',
      '<button id="garden-nip07-btn" class="garden-btn garden-btn-primary">',
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
      '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>',
      '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      '</svg>',
      ' Sign in with Extension',
      '</button>',
      '<p id="garden-nip07-hint" class="garden-login-hint">Recommended \u2014 sign in with your browser extension</p>',
      '</div>',

      // ---- Divider ----
      '<div class="garden-login-divider"><span>or</span></div>',

      // ---- Bunker / NostrConnect ----
      '<div class="garden-login-section">',
      '<label class="garden-login-label">Bunker / NostrConnect</label>',
      '<button id="garden-bunker-btn" class="garden-btn garden-btn-outline" style="width:100%">',
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>',
      '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
      '</svg>',
      ' Connect via Nostr Connect',
      '</button>',
      '<p class="garden-login-hint">Opens the pairing widget \u2014 scan QR or paste a bunker:// URI</p>',
      '</div>',

      // ---- Divider ----
      '<div class="garden-login-divider"><span>or</span></div>',

      // ---- nsec private key ----
      '<div class="garden-login-section">',
      '<div class="garden-login-warning">',
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
      '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
      '<line x1="12" y1="9" x2="12" y2="13"/>',
      '<line x1="12" y1="17" x2="12.01" y2="17"/>',
      '</svg>',
      ' Not recommended \u2014 your key is exposed to this site. Use an extension or bunker instead.',
      '</div>',
      '<label class="garden-login-label">Private Key</label>',
      '<div class="garden-login-row">',
      '<input type="password" id="garden-nsec-input" class="garden-login-input" placeholder="nsec1\u2026" autocomplete="off" spellcheck="false">',
      '<button id="garden-nsec-btn" class="garden-btn garden-btn-secondary">Login</button>',
      '</div>',
      '</div>',

      // ---- Status ----
      '<div id="garden-login-status" class="garden-login-status" style="display:none"></div>',

      '</div>',
    ].join('\n');

    document.body.appendChild(overlay);

    // --- Wire events ---
    document.getElementById('garden-login-close').addEventListener('click', hideModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) hideModal();
    });
    document.getElementById('garden-nip07-btn').addEventListener('click', handleNip07);
    document.getElementById('garden-bunker-btn').addEventListener('click', handleBunker);
    document.getElementById('garden-nsec-btn').addEventListener('click', handleNsec);
    document.getElementById('garden-nsec-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleNsec();
    });
  }
})();
