# Membership Expiration Notification System

## Summary

This PR adds an automated system to send Nostr direct messages (DMs) to users when their Zap Cooking membership is about to expire. The system runs daily via a Cloudflare cron job and sends encrypted renewal reminders 7 days before expiration.

## Features

- ✅ **Automated DM Notifications**: Sends encrypted Nostr DMs to users with expiring memberships
- ✅ **Cron Job Integration**: Configured to run daily at 10:00 UTC via Cloudflare cron trigger
- ✅ **NIP-04 Encryption**: Uses NIP-04 for maximum client compatibility
- ✅ **Security**: Optional CRON_SECRET for endpoint protection
- ✅ **Comprehensive Logging**: Detailed logs for debugging and monitoring

## Technical Details

### New Files

- `src/lib/membershipNotificationService.ts` - Core notification service
- `src/routes/api/cron/check-expiring-memberships/+server.ts` - Cron endpoint
- `MEMBERSHIP_NOTIFICATIONS.md` - Setup and configuration documentation
- `CLOUDFLARE_TESTING.md` - Testing guide for Cloudflare deployment

### Modified Files

- `wrangler.toml` - Added cron trigger configuration

## Setup Required

### Environment Variables

The following environment variables need to be set in Cloudflare:

```bash
NOTIFICATION_PRIVATE_KEY=nsec1... # or hex private key for service account
RELAY_API_SECRET=...              # Already configured
MEMBERSHIP_ENABLED=true           # Already configured
CRON_SECRET=...                   # Optional but recommended
```

See `MEMBERSHIP_NOTIFICATIONS.md` for detailed setup instructions.

## Testing

- ✅ Tested locally with development endpoint
- ✅ Verified NIP-04 encryption/decryption
- ✅ Tested with multiple recipients
- 🔄 Ready for Cloudflare deployment testing

See `CLOUDFLARE_TESTING.md` for testing procedures.

## Message Format

The renewal message sent to users:

```
⚡ Your Zap Cooking membership is due for renewal in X days
(January 15, 2026)
Renew to continue your Zap Cooking membership without interruption.
🔗 Renew here: https://zap.cooking/membership
We're glad you're cooking with us 🍳
```

## Service Account

- Service account npub: `npub1lhfx8a5ln6269g993mp706q9xqgjznaxvqrajwex6t68zlf3j9asnezaf4`
- Dedicated keypair for membership notifications only
- Private key stored securely in Cloudflare Workers secrets

## Cron Schedule

- **Frequency**: Daily
- **Time**: 10:00 UTC
- **Route**: `/api/cron/check-expiring-memberships`
- **Window**: Checks for memberships expiring within 7 days

## Related Work

This PR focuses specifically on the notification system. Other membership-related changes (payment flows, Lightning integration, etc.) can be included in follow-up PRs if needed.

## Checklist

- [x] Code follows project conventions
- [x] Documentation added
- [x] Tested locally
- [ ] Tested on Cloudflare (pending deployment)
- [x] Environment variables documented
- [x] No sensitive data committed
