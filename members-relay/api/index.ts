import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { verifyEvent } from 'nostr-tools';

// =============================================================================
// Configuration
// =============================================================================

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const API_SECRET = process.env.API_SECRET;
const RELAY_ADMIN_PUBKEY = process.env.RELAY_ADMIN_PUBKEY;

if (!API_SECRET || !RELAY_ADMIN_PUBKEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// =============================================================================
// Types
// =============================================================================

interface Member {
  id: string;
  pubkey: string;
  status: 'active' | 'expired' | 'cancelled' | 'grace';
  tier: 'standard' | 'premium' | 'lifetime';
  subscription_start: Date;
  subscription_end: Date;
  payment_id?: string;
  payment_method?: string;
  created_at: Date;
  updated_at: Date;
}

interface AddMemberRequest {
  pubkey: string;
  subscription_months?: number;
  tier?: 'standard' | 'premium' | 'lifetime';
  payment_id?: string;
  payment_method?: string;
}

interface RenewMemberRequest {
  subscription_months: number;
  payment_id?: string;
}

// =============================================================================
// Session Store (in-memory, for admin UI auth)
// =============================================================================

interface Session {
  pubkey: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

function createSession(pubkey: string): string {
  cleanExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
  sessions.set(token, { pubkey, expiresAt });
  return token;
}

function validateSession(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

// =============================================================================
// Authentication Middleware
// =============================================================================

function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);

  // Check session store first, then fall back to API_SECRET
  const session = validateSession(token);
  if (session) {
    (req as any).adminPubkey = session.pubkey;
    return next();
  }

  if (token === API_SECRET) {
    return next();
  }

  return res.status(403).json({ error: 'Invalid API key' });
}

// =============================================================================
// Helper Functions
// =============================================================================

function validatePubkey(pubkey: string): boolean {
  return /^[a-f0-9]{64}$/i.test(pubkey);
}

function calculateEndDate(months: number): Date {
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end;
}

// =============================================================================
// Admin Auth Routes
// =============================================================================

app.get('/api/admin/config', (req: Request, res: Response) => {
  res.json({ adminPubkey: RELAY_ADMIN_PUBKEY });
});

app.post('/api/admin/login', async (req: Request, res: Response) => {
  try {
    const { event } = req.body;

    if (!event) {
      return res.status(400).json({ error: 'Missing event' });
    }

    // Verify kind 27235 (NIP-98)
    if (event.kind !== 27235) {
      return res.status(400).json({ error: 'Invalid event kind' });
    }

    // Verify pubkey is admin
    if (event.pubkey !== RELAY_ADMIN_PUBKEY) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Verify timestamp within 60 seconds
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > 60) {
      return res.status(400).json({ error: 'Event timestamp too old' });
    }

    // Verify signature using nostr-tools
    const isValid = verifyEvent(event);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Create session
    const token = createSession(event.pubkey);
    console.log(`[API] Admin login: ${event.pubkey.slice(0, 8)}...`);

    res.json({ token });
  } catch (error) {
    console.error('[API] Error in admin login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/verify', authenticate, (req: Request, res: Response) => {
  const pubkey = (req as any).adminPubkey || null;
  res.json({ valid: true, pubkey });
});

// =============================================================================
// Routes
// =============================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/members', authenticate, async (req: Request, res: Response) => {
  try {
    const {
      pubkey,
      subscription_months = 12,
      tier = 'standard',
      payment_id,
      payment_method = 'lightning',
    } = req.body as AddMemberRequest;

    if (!pubkey || !validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    const existing = await pool.query(
      'SELECT * FROM members WHERE pubkey = $1',
      [pubkey]
    );

    if (existing.rows.length > 0) {
      const currentEnd = new Date(existing.rows[0].subscription_end);
      const now = new Date();
      const startFrom = currentEnd > now ? currentEnd : now;
      const newEnd = new Date(startFrom);
      newEnd.setMonth(newEnd.getMonth() + subscription_months);

      const result = await pool.query(
        `UPDATE members SET
          status = 'active',
          tier = $1,
          subscription_end = $2,
          payment_id = COALESCE($3, payment_id),
          payment_method = COALESCE($4, payment_method),
          updated_at = NOW()
        WHERE pubkey = $5
        RETURNING *`,
        [tier, newEnd, payment_id, payment_method, pubkey]
      );

      console.log(`[API] Extended membership for ${pubkey} until ${newEnd}`);

      return res.json({
        success: true,
        action: 'extended',
        member: result.rows[0],
      });
    }

    const subscriptionEnd = calculateEndDate(subscription_months);

    const result = await pool.query(
      `INSERT INTO members (pubkey, status, tier, subscription_start, subscription_end, payment_id, payment_method)
       VALUES ($1, 'active', $2, NOW(), $3, $4, $5)
       RETURNING *`,
      [pubkey, tier, subscriptionEnd, payment_id, payment_method]
    );

    console.log(`[API] Created new membership for ${pubkey} until ${subscriptionEnd}`);

    res.status(201).json({
      success: true,
      action: 'created',
      member: result.rows[0],
    });
  } catch (error) {
    console.error('[API] Error adding member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/members/:pubkey', authenticate, async (req: Request, res: Response) => {
  try {
    const { pubkey } = req.params;

    if (!validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    const result = await pool.query(
      `SELECT
        pubkey,
        status,
        tier,
        subscription_start,
        subscription_end,
        EXTRACT(DAY FROM subscription_end - NOW()) as days_remaining,
        created_at
      FROM members WHERE pubkey = $1`,
      [pubkey]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found', is_member: false });
    }

    const member = result.rows[0];
    const isActive = ['active', 'grace'].includes(member.status) &&
      new Date(member.subscription_end) > new Date();

    res.json({
      is_member: isActive,
      ...member,
    });
  } catch (error) {
    console.error('[API] Error getting member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/members/:pubkey/check', authenticate, async (req: Request, res: Response) => {
  try {
    const { pubkey } = req.params;

    if (!validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    const result = await pool.query(
      `SELECT EXISTS (
        SELECT 1 FROM members
        WHERE pubkey = $1
        AND status IN ('active', 'grace')
        AND subscription_end > NOW()
      ) as is_member`,
      [pubkey]
    );

    res.json({ is_member: result.rows[0].is_member });
  } catch (error) {
    console.error('[API] Error checking member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/members/:pubkey/renew', authenticate, async (req: Request, res: Response) => {
  try {
    const { pubkey } = req.params;
    const { subscription_months, payment_id } = req.body as RenewMemberRequest;

    if (!validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    if (!subscription_months || subscription_months < 1) {
      return res.status(400).json({ error: 'subscription_months must be at least 1' });
    }

    const existing = await pool.query(
      'SELECT * FROM members WHERE pubkey = $1',
      [pubkey]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const currentEnd = new Date(existing.rows[0].subscription_end);
    const now = new Date();
    const startFrom = currentEnd > now ? currentEnd : now;
    const newEnd = new Date(startFrom);
    newEnd.setMonth(newEnd.getMonth() + subscription_months);

    const result = await pool.query(
      `UPDATE members SET
        status = 'active',
        subscription_end = $1,
        payment_id = COALESCE($2, payment_id),
        updated_at = NOW()
      WHERE pubkey = $3
      RETURNING *`,
      [newEnd, payment_id, pubkey]
    );

    console.log(`[API] Renewed membership for ${pubkey} until ${newEnd}`);

    res.json({
      success: true,
      action: 'renewed',
      member: result.rows[0],
    });
  } catch (error) {
    console.error('[API] Error renewing member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/members/:pubkey', authenticate, async (req: Request, res: Response) => {
  try {
    const { pubkey } = req.params;

    if (!validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    const result = await pool.query(
      `UPDATE members SET status = 'cancelled', updated_at = NOW()
       WHERE pubkey = $1
       RETURNING *`,
      [pubkey]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    console.log(`[API] Cancelled membership for ${pubkey}`);

    res.json({
      success: true,
      action: 'cancelled',
      member: result.rows[0],
    });
  } catch (error) {
    console.error('[API] Error cancelling member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/members', authenticate, async (req: Request, res: Response) => {
  try {
    const { status, search, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM members';
    const params: any[] = [];
    const conditions: string[] = [];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (search && typeof search === 'string' && search.length > 0) {
      conditions.push(`pubkey ILIKE $${params.length + 1}`);
      params.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) FROM members';
    const countParams: any[] = [];
    if (conditions.length > 0) {
      const countConditions: string[] = [];
      if (status) {
        countConditions.push(`status = $${countParams.length + 1}`);
        countParams.push(status);
      }
      if (search && typeof search === 'string' && search.length > 0) {
        countConditions.push(`pubkey ILIKE $${countParams.length + 1}`);
        countParams.push(`%${search}%`);
      }
      if (countConditions.length > 0) {
        countQuery += ' WHERE ' + countConditions.join(' AND ');
      }
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      members: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error) {
    console.error('[API] Error listing members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Member history
app.get('/api/members/:pubkey/history', authenticate, async (req: Request, res: Response) => {
  try {
    const { pubkey } = req.params;

    if (!validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }

    const result = await pool.query(
      `SELECT * FROM membership_history WHERE pubkey = $1 ORDER BY created_at DESC LIMIT 50`,
      [pubkey]
    );

    res.json({ history: result.rows });
  } catch (error) {
    console.error('[API] Error getting member history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/members/expiring', authenticate, async (req: Request, res: Response) => {
  try {
    const { days = 30 } = req.query;

    const result = await pool.query(
      `SELECT
        pubkey,
        subscription_end,
        EXTRACT(DAY FROM subscription_end - NOW()) as days_remaining
      FROM members
      WHERE status = 'active'
      AND subscription_end BETWEEN NOW() AND NOW() + INTERVAL '1 day' * $1
      ORDER BY subscription_end`,
      [days]
    );

    res.json({
      expiring: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error('[API] Error getting expiring members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active_members,
        COUNT(*) FILTER (WHERE status = 'expired') as expired_members,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_members,
        COUNT(*) FILTER (WHERE status = 'grace') as grace_period,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_last_30_days,
        COUNT(*) FILTER (WHERE subscription_end BETWEEN NOW() AND NOW() + INTERVAL '7 days') as expiring_7_days
      FROM members
    `);

    const eventStats = await pool.query(`
      SELECT
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE kind = 30023) as recipes,
        COUNT(*) FILTER (WHERE kind = 9) as group_messages
      FROM events
    `);

    res.json({
      members: stats.rows[0],
      events: eventStats.rows[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error getting stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// NIP-05 Routes
// =============================================================================

const RESERVED_USERNAMES = [
  'admin', 'administrator', 'root', 'system', 'support', 'help',
  'info', 'contact', 'security', 'abuse', 'postmaster', 'webmaster',
  'zap', 'zapcooking', 'cooking', 'recipe', 'recipes', 'api', 'www',
  'mail', 'email', 'noreply', 'no-reply', 'bot', 'official'
];

function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username) {
    return { valid: false, error: 'Username is required' };
  }
  const lower = username.toLowerCase();
  if (lower.length < 3 || lower.length > 20) {
    return { valid: false, error: 'Username must be 3-20 characters' };
  }
  if (!/^[a-z0-9_]+$/.test(lower)) {
    return { valid: false, error: 'Username can only contain lowercase letters, numbers, and underscores' };
  }
  if (RESERVED_USERNAMES.includes(lower)) {
    return { valid: false, error: 'This username is reserved' };
  }
  return { valid: true };
}

// List all NIP-05 identities (admin)
app.get('/api/nip05/identities', authenticate, async (req: Request, res: Response) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT username, pubkey, tier, claimed_at, expires_at
       FROM nip05_identities
       WHERE active = true
       ORDER BY claimed_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM nip05_identities WHERE active = true'
    );

    res.json({
      identities: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    console.error('[API] Error listing NIP-05 identities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/nip05/check/:username', authenticate, async (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    const lower = username.toLowerCase();
    const validation = validateUsername(lower);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const result = await pool.query(
      'SELECT username FROM nip05_identities WHERE username = $1 AND active = true',
      [lower]
    );
    if (result.rows.length > 0) {
      return res.json({ exists: true });
    }
    res.status(404).json({ exists: false });
  } catch (error) {
    console.error('[API] Error checking NIP-05 username:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/nip05/claim', authenticate, async (req: Request, res: Response) => {
  try {
    const { username, pubkey, tier } = req.body;
    if (!pubkey || !validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }
    const lower = username?.toLowerCase();
    const validation = validateUsername(lower);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const memberResult = await pool.query(
      `SELECT subscription_end FROM members WHERE pubkey = $1 AND status IN ('active', 'grace') AND subscription_end > NOW()`,
      [pubkey]
    );
    if (memberResult.rows.length === 0) {
      return res.status(403).json({ error: 'Active membership required' });
    }
    const subscriptionEnd = memberResult.rows[0].subscription_end;
    const existing = await pool.query(
      'SELECT username FROM nip05_identities WHERE username = $1 AND active = true',
      [lower]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username is not available' });
    }
    await pool.query('UPDATE nip05_identities SET active = false WHERE pubkey = $1', [pubkey]);
    await pool.query(
      `INSERT INTO nip05_identities (username, pubkey, tier, expires_at) VALUES ($1, $2, $3, $4)`,
      [lower, pubkey, tier || 'standard', subscriptionEnd]
    );
    console.log(`[API] NIP-05 claimed: ${lower}@zap.cooking for ${pubkey}`);
    res.json({ success: true, username: lower, nip05: `${lower}@zap.cooking` });
  } catch (error) {
    console.error('[API] Error claiming NIP-05:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete/revoke a NIP-05 identity (admin)
app.delete('/api/nip05/:username', authenticate, async (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    const lower = username.toLowerCase();

    const result = await pool.query(
      `UPDATE nip05_identities SET active = false WHERE username = $1 AND active = true RETURNING username, pubkey`,
      [lower]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NIP-05 identity not found' });
    }

    console.log(`[API] NIP-05 revoked: ${lower}@zap.cooking`);
    res.json({ success: true, revoked: result.rows[0] });
  } catch (error) {
    console.error('[API] Error revoking NIP-05:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/nip05/:pubkey', authenticate, async (req: Request, res: Response) => {
  try {
    const { pubkey } = req.params;
    if (!validatePubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }
    const result = await pool.query(
      `SELECT username, tier, claimed_at, expires_at FROM nip05_identities WHERE pubkey = $1 AND active = true AND (expires_at IS NULL OR expires_at > NOW())`,
      [pubkey]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No NIP-05 found for this pubkey' });
    }
    const identity = result.rows[0];
    res.json({
      username: identity.username,
      nip05: `${identity.username}@zap.cooking`,
      tier: identity.tier,
      claimed_at: identity.claimed_at,
      expires_at: identity.expires_at
    });
  } catch (error) {
    console.error('[API] Error getting NIP-05:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/.well-known/nostr.json', async (req: Request, res: Response) => {
  try {
    const { name } = req.query;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    if (!name || typeof name !== 'string') {
      return res.json({ names: {} });
    }
    const lower = name.toLowerCase();
    const result = await pool.query(
      `SELECT pubkey FROM nip05_identities WHERE username = $1 AND active = true AND (expires_at IS NULL OR expires_at > NOW())`,
      [lower]
    );
    if (result.rows.length === 0) {
      return res.json({ names: {} });
    }
    res.json({ names: { [lower]: result.rows[0].pubkey } });
  } catch (error) {
    console.error('[API] Error in NIP-05 verification:', error);
    res.json({ names: {} });
  }
});

// =============================================================================
// Profiles Route
// =============================================================================

app.get('/api/profiles', authenticate, async (req: Request, res: Response) => {
  try {
    const { pubkeys } = req.query;

    if (!pubkeys || typeof pubkeys !== 'string') {
      return res.status(400).json({ error: 'pubkeys query parameter required (comma-separated)' });
    }

    const pubkeyList = pubkeys.split(',').filter(p => validatePubkey(p)).slice(0, 100);

    if (pubkeyList.length === 0) {
      return res.json({ profiles: {} });
    }

    // Get the most recent kind 0 event for each pubkey
    const placeholders = pubkeyList.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT DISTINCT ON (pubkey) pubkey, content
       FROM events
       WHERE kind = 0 AND pubkey IN (${placeholders})
       ORDER BY pubkey, created_at DESC`,
      pubkeyList
    );

    const profiles: Record<string, any> = {};
    for (const row of result.rows) {
      try {
        const meta = JSON.parse(row.content);
        profiles[row.pubkey] = {
          name: meta.name || meta.display_name || null,
          display_name: meta.display_name || meta.name || null,
          picture: meta.picture || null,
          nip05: meta.nip05 || null,
        };
      } catch {
        // skip malformed content
      }
    }

    res.json({ profiles });
  } catch (error) {
    console.error('[API] Error fetching profiles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// Events Browse Route
// =============================================================================

app.get('/api/events', authenticate, async (req: Request, res: Response) => {
  try {
    const { kind, pubkey, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT id, pubkey, kind, created_at, content, tags, raw FROM events';
    const params: any[] = [];
    const conditions: string[] = [];

    if (kind) {
      conditions.push(`kind = $${params.length + 1}`);
      params.push(parseInt(kind as string));
    }

    if (pubkey && typeof pubkey === 'string' && pubkey.length > 0) {
      conditions.push(`pubkey ILIKE $${params.length + 1}`);
      params.push(`%${pubkey}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);

    res.json({ events: result.rows });
  } catch (error) {
    console.error('[API] Error browsing events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// Start Server
// =============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Membership API running on port ${PORT}`);
});

export default app;
