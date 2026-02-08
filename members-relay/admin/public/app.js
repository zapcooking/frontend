// =============================================================================
// Pantry Admin — Alpine.js Application
// =============================================================================

const API_BASE = '/api';

// =============================================================================
// Bech32 decoder (for npub → hex conversion)
// =============================================================================
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Decode(str) {
    str = str.toLowerCase();
    const sepIdx = str.lastIndexOf('1');
    if (sepIdx < 1) return null;
    const hrp = str.slice(0, sepIdx);
    const dataStr = str.slice(sepIdx + 1);
    const data = [];
    for (const c of dataStr) {
        const v = BECH32_CHARSET.indexOf(c);
        if (v === -1) return null;
        data.push(v);
    }
    // Remove 6-char checksum
    const values = data.slice(0, -6);
    // Convert 5-bit groups to 8-bit bytes
    let acc = 0, bits = 0;
    const bytes = [];
    for (const v of values) {
        acc = (acc << 5) | v;
        bits += 5;
        while (bits >= 8) {
            bits -= 8;
            bytes.push((acc >> bits) & 0xff);
        }
    }
    return { hrp, bytes: new Uint8Array(bytes) };
}

function npubToHex(input) {
    input = input.trim();
    if (/^[a-f0-9]{64}$/i.test(input)) return input;
    if (input.startsWith('npub1')) {
        const decoded = bech32Decode(input);
        if (decoded && decoded.hrp === 'npub' && decoded.bytes.length === 32) {
            return Array.from(decoded.bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        }
    }
    return null;
}

function bech32Checksum(hrp, values) {
    function polymod(values) {
        const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        let chk = 1;
        for (const v of values) {
            const b = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
        }
        return chk;
    }
    function hrpExpand(hrp) {
        const ret = [];
        for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
        ret.push(0);
        for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
        return ret;
    }
    const enc = hrpExpand(hrp).concat(values).concat([0, 0, 0, 0, 0, 0]);
    const mod = polymod(enc) ^ 1;
    const ret = [];
    for (let i = 0; i < 6; i++) ret.push((mod >> (5 * (5 - i))) & 31);
    return ret;
}

function hexToNpub(hex) {
    if (!hex || !/^[a-f0-9]{64}$/i.test(hex)) return hex;
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    // Convert 8-bit bytes to 5-bit groups
    let acc = 0, bits = 0;
    const values = [];
    for (const b of bytes) {
        acc = (acc << 8) | b;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            values.push((acc >> bits) & 31);
        }
    }
    if (bits > 0) values.push((acc << (5 - bits)) & 31);
    const checksum = bech32Checksum('npub', values);
    return 'npub1' + values.concat(checksum).map(v => BECH32_CHARSET[v]).join('');
}

// Cache for npub conversions
const npubCache = {};
function toNpub(hex) {
    if (!hex) return '';
    if (!npubCache[hex]) npubCache[hex] = hexToNpub(hex);
    return npubCache[hex];
}

function app() {
    return {
        // Auth state
        authenticated: false,
        nostrAvailable: false,
        loggingIn: false,
        loginError: '',
        pubkey: null,
        token: null,

        // UI state
        tab: 'dashboard',
        tabs: [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'members', label: 'Members' },
            { id: 'nip05', label: 'NIP-05' },
            { id: 'events', label: 'Events' },
        ],

        // Dashboard
        dashboardCards: [],
        eventCards: [],

        // Profiles cache: { [pubkey]: { name, display_name, picture, nip05 } }
        profiles: {},

        // Members
        members: [],
        membersTotal: 0,
        memberPage: 0,
        memberSearch: '',
        memberStatusFilter: '',
        showAddMemberModal: false,
        newMember: { pubkey: '', subscription_months: 12, tier: 'standard', payment_method: 'lightning' },
        showRenewModal: false,
        renewTarget: null,
        renewMonths: 12,
        showHistoryModal: false,
        historyTarget: null,
        historyEntries: [],

        // NIP-05
        nip05Identities: [],
        nip05Total: 0,
        nip05Page: 0,

        // Events
        events: [],
        eventPage: 0,
        eventKindFilter: '',
        eventPubkeyFilter: '',

        // =====================================================================
        // Init
        // =====================================================================
        async init() {
            this.nostrAvailable = typeof window.nostr !== 'undefined';

            // Check for existing session
            const savedToken = sessionStorage.getItem('pantry_admin_token');
            const savedPubkey = sessionStorage.getItem('pantry_admin_pubkey');
            if (savedToken && savedPubkey) {
                this.token = savedToken;
                this.pubkey = savedPubkey;
                try {
                    const res = await this.api('GET', '/admin/verify');
                    if (res.valid) {
                        this.authenticated = true;
                        this.loadDashboard();
                    } else {
                        this.clearSession();
                    }
                } catch {
                    this.clearSession();
                }
            }
        },

        // =====================================================================
        // Auth
        // =====================================================================
        async login() {
            this.loggingIn = true;
            this.loginError = '';

            try {
                // Get admin pubkey from server config
                const configRes = await fetch(`${API_BASE}/admin/config`);
                const config = await configRes.json();

                // Get user's pubkey via NIP-07
                const userPubkey = await window.nostr.getPublicKey();

                if (userPubkey !== config.adminPubkey) {
                    this.loginError = 'This pubkey is not the relay admin.';
                    this.loggingIn = false;
                    return;
                }

                // Create NIP-98 auth event (kind 27235)
                const event = {
                    kind: 27235,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['u', `${window.location.origin}${API_BASE}/admin/login`],
                        ['method', 'POST'],
                    ],
                    content: '',
                };

                const signedEvent = await window.nostr.signEvent(event);

                // Send to login endpoint
                const loginRes = await fetch(`${API_BASE}/admin/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event: signedEvent }),
                });

                if (!loginRes.ok) {
                    const err = await loginRes.json();
                    throw new Error(err.error || 'Login failed');
                }

                const { token } = await loginRes.json();

                this.token = token;
                this.pubkey = userPubkey;
                sessionStorage.setItem('pantry_admin_token', token);
                sessionStorage.setItem('pantry_admin_pubkey', userPubkey);
                this.authenticated = true;
                this.loadDashboard();
            } catch (err) {
                this.loginError = err.message || 'Login failed';
            } finally {
                this.loggingIn = false;
            }
        },

        logout() {
            this.clearSession();
            this.authenticated = false;
            this.tab = 'dashboard';
        },

        clearSession() {
            this.token = null;
            this.pubkey = null;
            sessionStorage.removeItem('pantry_admin_token');
            sessionStorage.removeItem('pantry_admin_pubkey');
        },

        // =====================================================================
        // API Helper
        // =====================================================================
        async api(method, path, body) {
            const opts = {
                method,
                headers: { 'Content-Type': 'application/json' },
            };
            if (this.token) {
                opts.headers['Authorization'] = `Bearer ${this.token}`;
            }
            if (body) {
                opts.body = JSON.stringify(body);
            }
            const res = await fetch(`${API_BASE}${path}`, opts);
            if (res.status === 401 || res.status === 403) {
                this.logout();
                throw new Error('Session expired');
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Request failed (${res.status})`);
            }
            return res.json();
        },

        // =====================================================================
        // Dashboard
        // =====================================================================
        async loadDashboard() {
            try {
                const data = await this.api('GET', '/stats');
                const m = data.members;
                this.dashboardCards = [
                    { label: 'Active Members', value: m.active_members || 0 },
                    { label: 'Expired', value: m.expired_members || 0 },
                    { label: 'Grace Period', value: m.grace_period || 0 },
                    { label: 'Cancelled', value: m.cancelled_members || 0 },
                    { label: 'New (30d)', value: m.new_last_30_days || 0 },
                    { label: 'Expiring (7d)', value: m.expiring_7_days || 0 },
                ];
                const e = data.events;
                this.eventCards = [
                    { label: 'Total Events', value: e.total_events || 0 },
                    { label: 'Recipes', value: e.recipes || 0 },
                    { label: 'Group Messages', value: e.group_messages || 0 },
                ];
            } catch (err) {
                console.error('Failed to load dashboard:', err);
            }
        },

        // =====================================================================
        // Members
        // =====================================================================
        async loadMembers() {
            try {
                const params = new URLSearchParams({
                    limit: '50',
                    offset: String(this.memberPage * 50),
                });
                if (this.memberStatusFilter) params.set('status', this.memberStatusFilter);
                if (this.memberSearch) {
                    const hex = npubToHex(this.memberSearch);
                    params.set('search', hex || this.memberSearch);
                }

                const data = await this.api('GET', `/members?${params}`);
                this.members = data.members;
                this.membersTotal = data.total;

                // Fetch profiles for members we don't have cached
                await this.fetchProfiles(data.members.map(m => m.pubkey));
            } catch (err) {
                console.error('Failed to load members:', err);
            }
        },

        async addMember() {
            try {
                const hex = npubToHex(this.newMember.pubkey);
                if (!hex) {
                    alert('Invalid pubkey. Enter a 64-char hex key or an npub.');
                    return;
                }
                await this.api('POST', '/members', { ...this.newMember, pubkey: hex });
                this.showAddMemberModal = false;
                this.newMember = { pubkey: '', subscription_months: 12, tier: 'standard', payment_method: 'lightning' };
                this.loadMembers();
                this.loadDashboard();
            } catch (err) {
                alert('Failed to add member: ' + err.message);
            }
        },

        openRenewModal(member) {
            this.renewTarget = member;
            this.renewMonths = 12;
            this.showRenewModal = true;
        },

        async renewMember() {
            try {
                await this.api('POST', `/members/${this.renewTarget.pubkey}/renew`, {
                    subscription_months: this.renewMonths,
                });
                this.showRenewModal = false;
                this.loadMembers();
                this.loadDashboard();
            } catch (err) {
                alert('Failed to renew member: ' + err.message);
            }
        },

        async cancelMember(pubkey) {
            if (!confirm('Cancel this member?')) return;
            try {
                await this.api('DELETE', `/members/${pubkey}`);
                this.loadMembers();
                this.loadDashboard();
            } catch (err) {
                alert('Failed to cancel member: ' + err.message);
            }
        },

        openHistoryModal(member) {
            this.historyTarget = member;
            this.historyEntries = [];
            this.showHistoryModal = true;
            this.loadHistory(member.pubkey);
        },

        async loadHistory(pubkey) {
            try {
                const data = await this.api('GET', `/members/${pubkey}/history`);
                this.historyEntries = data.history;
            } catch (err) {
                console.error('Failed to load history:', err);
            }
        },

        // =====================================================================
        // NIP-05
        // =====================================================================
        async loadNip05() {
            try {
                const params = new URLSearchParams({
                    limit: '50',
                    offset: String(this.nip05Page * 50),
                });
                const data = await this.api('GET', `/nip05/identities?${params}`);
                this.nip05Identities = data.identities;
                this.nip05Total = data.total;

                await this.fetchProfiles(data.identities.map(n => n.pubkey));
            } catch (err) {
                console.error('Failed to load NIP-05 identities:', err);
            }
        },

        async revokeNip05(username) {
            if (!confirm(`Revoke ${username}@zap.cooking?`)) return;
            try {
                await this.api('DELETE', `/nip05/${username}`);
                this.loadNip05();
            } catch (err) {
                alert('Failed to revoke: ' + err.message);
            }
        },

        // =====================================================================
        // Events
        // =====================================================================
        async loadEvents() {
            try {
                const params = new URLSearchParams({
                    limit: '50',
                    offset: String(this.eventPage * 50),
                });
                if (this.eventKindFilter) params.set('kind', this.eventKindFilter);
                // Convert npub to hex for API filtering
                if (this.eventPubkeyFilter) {
                    const hex = npubToHex(this.eventPubkeyFilter);
                    params.set('pubkey', hex || this.eventPubkeyFilter);
                }

                const data = await this.api('GET', `/events?${params}`);
                this.events = (data.events || []).map(e => ({ ...e, _expanded: false }));

                const uniquePubkeys = [...new Set(this.events.map(e => e.pubkey))];
                await this.fetchProfiles(uniquePubkeys);
            } catch (err) {
                console.error('Failed to load events:', err);
            }
        },

        // =====================================================================
        // Profiles
        // =====================================================================
        async fetchProfiles(pubkeys) {
            const uncached = pubkeys.filter(pk => pk && !this.profiles[pk]);
            if (uncached.length === 0) return;

            try {
                // Try local DB first
                const data = await this.api('GET', `/profiles?pubkeys=${uncached.join(',')}`);
                const found = data.profiles || {};
                // Reassign for Alpine reactivity
                this.profiles = { ...this.profiles, ...found };

                // For any still missing, fetch from public relays via WebSocket
                const stillMissing = uncached.filter(pk => !found[pk]);
                if (stillMissing.length > 0) {
                    this.fetchProfilesFromRelay(stillMissing);
                }
            } catch (err) {
                console.error('Failed to fetch profiles:', err);
            }
        },

        fetchProfilesFromRelay(pubkeys) {
            const relays = ['wss://purplepag.es', 'wss://relay.damus.io', 'wss://nos.lol'];
            const subId = 'profiles_' + Math.random().toString(36).slice(2, 8);
            const remaining = new Set(pubkeys);
            let completed = 0;

            for (const url of relays) {
                try {
                    const ws = new WebSocket(url);
                    const timeout = setTimeout(() => ws.close(), 8000);

                    ws.onopen = () => {
                        ws.send(JSON.stringify(['REQ', subId, { kinds: [0], authors: pubkeys }]));
                    };

                    ws.onmessage = (msg) => {
                        try {
                            const data = JSON.parse(msg.data);
                            if (data[0] === 'EVENT' && data[2]?.kind === 0) {
                                const evt = data[2];
                                if (remaining.has(evt.pubkey)) {
                                    const meta = JSON.parse(evt.content);
                                    const profile = {
                                        name: meta.name || meta.display_name || null,
                                        display_name: meta.display_name || meta.name || null,
                                        picture: meta.picture || null,
                                        nip05: meta.nip05 || null,
                                    };
                                    remaining.delete(evt.pubkey);
                                    // Reassign for Alpine reactivity
                                    this.profiles = { ...this.profiles, [evt.pubkey]: profile };
                                }
                            }
                            if (data[0] === 'EOSE') {
                                ws.send(JSON.stringify(['CLOSE', subId]));
                                ws.close();
                                clearTimeout(timeout);
                            }
                        } catch {}
                    };

                    ws.onerror = () => { clearTimeout(timeout); ws.close(); };
                } catch {}
            }
        },

        profileName(pubkey) {
            const p = this.profiles[pubkey];
            return p?.display_name || p?.name || null;
        },

        profilePicture(pubkey) {
            const p = this.profiles[pubkey];
            return p?.picture || null;
        },

        profileNip05(pubkey) {
            const p = this.profiles[pubkey];
            return p?.nip05 || null;
        },

        // =====================================================================
        // Helpers
        // =====================================================================
        formatDate(d) {
            if (!d) return '-';
            return new Date(d).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric',
            });
        },

        // =====================================================================
        // Tab switching
        // =====================================================================
        switchTab(id) {
            this.tab = id;
            switch (id) {
                case 'dashboard': this.loadDashboard(); break;
                case 'members': this.loadMembers(); break;
                case 'nip05': this.loadNip05(); break;
                case 'events': this.loadEvents(); break;
            }
        },
    };
}
