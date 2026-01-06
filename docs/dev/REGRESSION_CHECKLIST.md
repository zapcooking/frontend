# Regression Checklist

**Purpose:** Protocol safety net for refactoring  
**Goal:** Prevent "fix one thing, break three others"  
**Outcome:** Confidence to ship faster

---

## How to Use This Checklist

1. **Before refactoring:** Review relevant sections
2. **After refactoring:** Run through affected test scenarios
3. **Before PR:** Verify all critical paths pass
4. **Automate:** Convert manual tests to automated tests where possible

---

## 🔐 Authentication & Login

### NIP-07 Browser Extension
- [ ] Login with NIP-07 extension (Alby, nos2x, etc.)
- [ ] Logout clears session
- [ ] Session persists across page refresh
- [ ] Switching accounts works
- [ ] Extension unavailable shows fallback options

### NIP-46 Remote Signer (Bunker)
- [ ] Login with `bunker://` connection string
- [ ] Login with `nostrconnect://` QR code scan
- [ ] Universal pairing flow works
- [ ] Secret validation in pairing response
- [ ] Reconnection after disconnect
- [ ] Error handling for invalid connection strings
- [ ] Error handling for expired ephemeral events
- [ ] Permission errors show helpful messages

### Private Key Login
- [ ] Login with `nsec` string
- [ ] Login with hex private key
- [ ] Invalid key shows error
- [ ] Key stored securely (encrypted)

### Seed Phrase Login
- [ ] Login with 12-word seed phrase
- [ ] Login with 24-word seed phrase
- [ ] Invalid seed phrase shows error
- [ ] Seed phrase validation (checksum)

### Onboarding
- [ ] New account creation flow
- [ ] Key generation works
- [ ] Profile creation (name, picture, bio)
- [ ] Username assignment with NIP-05
- [ ] Redirect after onboarding

---

## 📱 Feed Functionality

### Global Feed
- [ ] Loads food-related posts (hashtag filter)
- [ ] Shows only top-level notes (no replies)
- [ ] Excludes posts from followed users
- [ ] Real-time updates work
- [ ] Pagination loads older posts
- [ ] Sorting by `created_at` desc
- [ ] Deduplication by event ID
- [ ] Food filter toggle works
- [ ] Muted users excluded

### Following Feed
- [ ] Loads posts from followed users only
- [ ] Uses outbox model (NIP-65)
- [ ] Shows only top-level notes (no replies)
- [ ] Real-time updates work
- [ ] Pagination works
- [ ] Empty state when not following anyone
- [ ] Handles users with no posts

### Replies Feed
- [ ] Shows notes AND replies
- [ ] Reply context loads (parent note)
- [ ] Reply threading displays correctly
- [ ] Real-time updates work
- [ ] Pagination works

### Feed Interactions
- [ ] Like/unlike posts
- [ ] Repost posts
- [ ] Quote posts
- [ ] Reply to posts
- [ ] Zap posts
- [ ] Copy note ID
- [ ] Share note link
- [ ] View author profile

### Feed Performance
- [ ] Initial load < 2s
- [ ] Cache rehydration works
- [ ] Background refresh doesn't block UI
- [ ] Real-time updates don't cause jank
- [ ] Pagination doesn't duplicate events
- [ ] Memory doesn't leak on long sessions

---

## ✍️ Post Creation

### Text Posts
- [ ] Create text post
- [ ] Post appears in feed immediately
- [ ] Post publishes to relays
- [ ] Post includes client tag (NIP-89)
- [ ] Post includes food hashtags if applicable
- [ ] Post content renders correctly

### Posts with Media
- [ ] Upload image
- [ ] Upload video
- [ ] Image optimization works
- [ ] Media displays correctly
- [ ] Media URLs are valid

### Quote Posts
- [ ] Quote existing note
- [ ] Quoted note displays correctly
- [ ] Quote includes original note reference
- [ ] Quote appears in feed

### Post Editing
- [ ] Edit own posts (if supported)
- [ ] Edited posts show edit indicator
- [ ] Edit history preserved

---

## 👤 Profile Management

### Profile Display
- [ ] Profile loads correctly
- [ ] Avatar displays
- [ ] Display name shows
- [ ] Bio renders correctly
- [ ] Lightning address shows
- [ ] Follow/unfollow button works
- [ ] Follow count updates
- [ ] Follower count shows

### Profile Tabs
- [ ] Recipes tab shows recipes
- [ ] Posts tab shows posts
- [ ] Drafts tab shows drafts (if applicable)
- [ ] Tab switching works

### Profile Editing
- [ ] Edit profile modal opens
- [ ] Update display name
- [ ] Update bio
- [ ] Upload profile picture
- [ ] Picture upload shows progress
- [ ] Changes save to relays
- [ ] Changes reflect immediately

### Profile Navigation
- [ ] Click avatar → profile page
- [ ] Click name → profile page
- [ ] Profile URL format: `/user/{npub}`
- [ ] Profile deep links work

---

## ⚡ Lightning & Zaps

### Zap Functionality
- [ ] Zap button opens modal
- [ ] Enter zap amount
- [ ] Zap sends successfully
- [ ] Zap receipt displays
- [ ] Zap count updates
- [ ] Zap history shows
- [ ] Zap notifications work

### Lightning Address
- [ ] Lightning address displays
- [ ] Copy lightning address
- [ ] Lightning address syncs to profile
- [ ] Lightning address validation

### Wallet Integration
- [ ] Spark wallet connection
- [ ] NWC wallet connection
- [ ] Bitcoin Connect wallet
- [ ] Wallet balance displays
- [ ] Payment history loads
- [ ] Wallet backup works
- [ ] Wallet restore works

---

## 🍳 Recipe Functionality

### Recipe Display
- [ ] Recipe page loads
- [ ] Recipe content renders
- [ ] Recipe images display
- [ ] Recipe metadata shows
- [ ] Recipe tags display
- [ ] Recipe author shows

### Recipe Creation
- [ ] Create recipe flow
- [ ] Recipe template validation
- [ ] Recipe saves to relays
- [ ] Recipe appears in feed
- [ ] Recipe appears on profile

### Recipe Interactions
- [ ] Like recipe
- [ ] Zap recipe
- [ ] Fork recipe
- [ ] Bookmark recipe
- [ ] Share recipe

### Recipe Discovery
- [ ] Explore page shows recipes
- [ ] Category filtering works
- [ ] Tag filtering works
- [ ] Search works (if implemented)

---

## 🔄 Real-Time Subscriptions

### Subscription Management
- [ ] Subscriptions start on feed load
- [ ] Subscriptions stop on page unload
- [ ] Subscriptions cleanup on mode change
- [ ] No subscription leaks
- [ ] EOSE handling works

### Real-Time Updates
- [ ] New posts appear in real-time
- [ ] Likes update in real-time
- [ ] Reposts update in real-time
- [ ] Replies update in real-time
- [ ] Zaps update in real-time
- [ ] Profile updates in real-time

### Subscription Performance
- [ ] Subscriptions don't cause memory leaks
- [ ] Multiple subscriptions don't slow down
- [ ] Subscription errors handled gracefully
- [ ] Reconnection after disconnect

---

## 💾 Caching & Storage

### Feed Cache
- [ ] Feed events cached
- [ ] Cache loads on page refresh
- [ ] Cache expires correctly
- [ ] Cache invalidation works
- [ ] Cache compression works

### Profile Cache
- [ ] Profiles cached
- [ ] Profile cache updates
- [ ] Profile cache expires
- [ ] Profile cache invalidation

### IndexedDB
- [ ] Events stored in IndexedDB
- [ ] IndexedDB queries work
- [ ] IndexedDB cleanup works
- [ ] IndexedDB size limits handled

### LocalStorage
- [ ] Auth state persisted
- [ ] Settings persisted
- [ ] Relay list persisted
- [ ] Muted users persisted

---

## 🧭 Navigation & Routing

### Route Navigation
- [ ] Home page loads
- [ ] Community feed loads
- [ ] Explore page loads
- [ ] Profile pages load
- [ ] Recipe pages load
- [ ] Settings page loads
- [ ] Login page loads
- [ ] Deep links work (nevent, npub, naddr)

### URL Handling
- [ ] NIP-19 URLs decode correctly
- [ ] Invalid URLs handled gracefully
- [ ] URL parameters work
- [ ] Browser back/forward works

### Protected Routes
- [ ] Unauthenticated users redirected
- [ ] Authenticated users can access
- [ ] Route guards work

---

## 🎨 UI/UX

### Responsive Design
- [ ] Mobile layout works
- [ ] Tablet layout works
- [ ] Desktop layout works
- [ ] Touch interactions work
- [ ] Keyboard navigation works

### Loading States
- [ ] Loading skeletons show
- [ ] Loading indicators display
- [ ] Empty states show
- [ ] Error states show

### Accessibility
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Focus management works
- [ ] ARIA labels present

### Theme
- [ ] Light mode works
- [ ] Dark mode works
- [ ] Theme persists
- [ ] Theme toggle works

---

## 🛡️ Error Handling

### Network Errors
- [ ] Relay connection failures handled
- [ ] Timeout errors handled
- [ ] Retry logic works
- [ ] Fallback relays used

### Authentication Errors
- [ ] Invalid credentials handled
- [ ] Expired sessions handled
- [ ] Permission errors handled
- [ ] Error messages are clear

### Data Errors
- [ ] Invalid event data handled
- [ ] Missing data handled
- [ ] Corrupted cache handled
- [ ] Malformed JSON handled

### User Errors
- [ ] Invalid input validation
- [ ] Error messages displayed
- [ ] Recovery suggestions shown

---

## 🔧 Performance

### Initial Load
- [ ] Time to First Contentful Paint < 1s
- [ ] Time to Interactive < 3s
- [ ] Bundle size reasonable
- [ ] Code splitting works

### Runtime Performance
- [ ] No memory leaks
- [ ] Smooth scrolling
- [ ] No janky animations
- [ ] Efficient re-renders

### Network Performance
- [ ] Minimal relay queries
- [ ] Efficient subscriptions
- [ ] Bandwidth usage reasonable
- [ ] Caching reduces requests

---

## 🧪 Integration Points

### NDK Integration
- [ ] NDK initializes correctly
- [ ] NDK connects to relays
- [ ] NDK cache works
- [ ] NDK subscriptions work
- [ ] NDK event publishing works

### Relay Integration
- [ ] Relay connection works
- [ ] Relay health monitoring works
- [ ] Circuit breaker works
- [ ] Relay fallback works

### Lightning Integration
- [ ] WebLN provider works
- [ ] NWC connection works
- [ ] Spark SDK works
- [ ] Bitcoin Connect works

---

## 📊 Data Integrity

### Event Validation
- [ ] Events have valid signatures
- [ ] Events have required fields
- [ ] Events match expected kinds
- [ ] Event timestamps valid

### Data Consistency
- [ ] No duplicate events
- [ ] Event ordering correct
- [ ] Cache consistency maintained
- [ ] State synchronization works

### Data Persistence
- [ ] Data persists across refresh
- [ ] Data persists across sessions
- [ ] Data cleanup works
- [ ] Data migration works

---

## 🔍 Edge Cases

### Empty States
- [ ] No posts → empty state
- [ ] No follows → empty state
- [ ] No recipes → empty state
- [ ] No notifications → empty state

### Large Data Sets
- [ ] Many follows handled
- [ ] Many posts handled
- [ ] Large profiles handled
- [ ] Long threads handled

### Concurrent Operations
- [ ] Multiple tabs work
- [ ] Rapid interactions handled
- [ ] Race conditions avoided
- [ ] State conflicts resolved

### Browser Compatibility
- [ ] Chrome works
- [ ] Firefox works
- [ ] Safari works
- [ ] Mobile browsers work

---

## 🚨 Critical Paths (Must Always Work)

### Authentication Flow
1. User logs in
2. Session persists
3. User can post
4. User can interact

### Feed Flow
1. Feed loads
2. Posts display
3. Interactions work
4. Real-time updates work

### Post Creation Flow
1. User creates post
2. Post publishes
3. Post appears in feed
4. Post visible to others

### Profile Flow
1. Profile loads
2. Profile displays correctly
3. Profile edits save
4. Profile updates reflect

---

## 📝 Test Scenarios by Feature Area

### Feed (FoodstrFeedOptimized)
```typescript
// Test scenarios
- Load global feed → verify top-level notes only
- Load following feed → verify followed users only
- Load replies feed → verify replies included
- Switch feed modes → verify subscriptions update
- Pagination → verify no duplicates
- Real-time → verify new posts appear
- Cache → verify cache rehydration
```

### Authentication (authManager)
```typescript
// Test scenarios
- NIP-07 login → verify session
- NIP-46 login → verify pairing
- Private key login → verify auth
- Seed phrase login → verify auth
- Logout → verify cleanup
- Session refresh → verify persistence
```

### Wallet (walletManager)
```typescript
// Test scenarios
- Connect Spark → verify connection
- Connect NWC → verify connection
- Create wallet → verify creation
- Restore wallet → verify restore
- Backup wallet → verify backup
- Zap → verify payment
```

---

## 🔄 Regression Test Workflow

### Before Refactoring
1. Identify affected features
2. Review relevant checklist sections
3. Note current behavior
4. Document expected outcomes

### During Refactoring
1. Test incrementally
2. Verify each change
3. Check for side effects
4. Update tests as needed

### After Refactoring
1. Run full checklist for affected areas
2. Verify critical paths
3. Check performance
4. Test edge cases

### Before PR
1. All critical paths pass
2. No new errors
3. Performance maintained
4. Documentation updated

---

## 🤖 Automation Opportunities

### Unit Tests
- [ ] Feed filtering logic
- [ ] Event parsing
- [ ] Cache operations
- [ ] Authentication flows

### Integration Tests
- [ ] Feed loading
- [ ] Post creation
- [ ] Profile updates
- [ ] Wallet operations

### E2E Tests
- [ ] Login flow
- [ ] Post creation flow
- [ ] Feed interaction flow
- [ ] Profile editing flow

---

## 📈 Monitoring & Metrics

### Performance Metrics
- [ ] Initial load time
- [ ] Time to interactive
- [ ] Relay query count
- [ ] Cache hit rate
- [ ] Memory usage
- [ ] Bundle size

### Error Metrics
- [ ] Error rate
- [ ] Error types
- [ ] Error frequency
- [ ] Recovery time

### User Metrics
- [ ] Active users
- [ ] Feature usage
- [ ] Conversion rates
- [ ] Engagement metrics

---

## 🎯 Quick Reference

### Critical Paths
1. **Login → Feed → Post → Logout**
2. **Feed → Profile → Edit → Save**
3. **Feed → Post → Like → Zap**
4. **Profile → Wallet → Connect → Zap**

### High-Risk Areas
- Authentication (NIP-46 pairing)
- Feed subscriptions (real-time)
- Cache invalidation
- Wallet connections

### Low-Risk Areas
- UI styling
- Text content
- Static pages
- Documentation

---

## 📚 Related Documentation

- [Feed Inventory](./FEED_INVENTORY.md)
- [Top-Level Notes Analysis](./TOP_LEVEL_NOTES_ANALYSIS.md)
- [Repost Analysis](./REPOST_ANALYSIS.md)
- [Relay Strategy Analysis](./RELAY_STRATEGY_ANALYSIS.md)

---

## 🔄 Checklist Maintenance

### When to Update
- New features added
- Bugs discovered
- User reports issues
- Architecture changes

### How to Update
1. Add new test scenarios
2. Update existing scenarios
3. Remove obsolete scenarios
4. Reorganize as needed

---

**Last Updated:** 2025-01-04  
**Maintained By:** Development Team  
**Review Frequency:** Before each major refactor

