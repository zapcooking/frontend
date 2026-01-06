# Regression Checklist - Quick Reference

**Use this for quick verification before/after refactoring**

---

## 🚨 Critical Paths (5-Minute Smoke Test)

### Path 1: Authentication & Feed
```
1. Login (NIP-07 or NIP-46)
2. Navigate to Community feed
3. Verify feed loads
4. Create a post
5. Verify post appears
6. Logout
```

### Path 2: Feed Interactions
```
1. Open Community feed
2. Like a post
3. Reply to a post
4. Repost a post
5. Zap a post
6. Verify all interactions work
```

### Path 3: Profile & Wallet
```
1. Open profile page
2. Edit profile
3. Save changes
4. Open wallet page
5. Connect wallet
6. Verify connection
```

---

## 🔍 Feature-Specific Quick Checks

### Feed (FoodstrFeedOptimized)
- [ ] Global feed loads
- [ ] Following feed loads
- [ ] Replies feed loads
- [ ] Real-time updates work
- [ ] Pagination works
- [ ] No duplicate events

### Authentication (authManager)
- [ ] NIP-07 login works
- [ ] NIP-46 login works
- [ ] Session persists
- [ ] Logout works

### Wallet (walletManager)
- [ ] Spark wallet connects
- [ ] NWC wallet connects
- [ ] Zap works
- [ ] Backup works

### Posts
- [ ] Create post works
- [ ] Post appears in feed
- [ ] Post interactions work
- [ ] Post displays correctly

---

## ⚡ Performance Quick Checks

- [ ] Initial load < 2s
- [ ] Feed loads < 1s (from cache)
- [ ] No memory leaks (check DevTools)
- [ ] Smooth scrolling
- [ ] No console errors

---

## 🐛 Common Regression Areas

### After Feed Refactoring
- [ ] Feed loads correctly
- [ ] Real-time subscriptions work
- [ ] Cache rehydration works
- [ ] Pagination works
- [ ] No duplicate events

### After Auth Refactoring
- [ ] All login methods work
- [ ] Session persists
- [ ] Logout works
- [ ] NIP-46 pairing works

### After Cache Refactoring
- [ ] Cache loads on refresh
- [ ] Cache updates correctly
- [ ] Cache invalidation works
- [ ] No stale data

### After Subscription Refactoring
- [ ] Subscriptions start
- [ ] Subscriptions stop
- [ ] Real-time updates work
- [ ] No subscription leaks

---

## 📋 Pre-PR Checklist

### Must Pass
- [ ] All critical paths work
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Performance maintained
- [ ] Mobile responsive

### Should Pass
- [ ] All affected features work
- [ ] Edge cases handled
- [ ] Error messages clear
- [ ] Loading states work

### Nice to Have
- [ ] Tests updated
- [ ] Documentation updated
- [ ] Performance improved
- [ ] Code comments added

---

## 🔄 Test Workflow

### Before Starting
1. Run critical paths
2. Note current behavior
3. Check performance

### During Development
1. Test incrementally
2. Verify each change
3. Check for side effects

### Before Committing
1. Run critical paths
2. Check affected features
3. Verify performance
4. Check console for errors

### Before PR
1. Full regression for affected areas
2. All critical paths pass
3. Performance maintained
4. No new errors

---

## 🎯 Risk Assessment

### High Risk (Test Thoroughly)
- Authentication changes
- Feed subscription changes
- Cache changes
- Wallet changes

### Medium Risk (Test Affected Areas)
- UI component changes
- Routing changes
- State management changes

### Low Risk (Quick Check)
- Styling changes
- Text content changes
- Documentation changes

---

## 📊 Test Coverage Goals

### Critical Features: 100%
- Authentication
- Feed loading
- Post creation
- Profile management

### Important Features: 80%
- Feed interactions
- Wallet operations
- Real-time updates

### Nice-to-Have: 50%
- Edge cases
- Error handling
- Performance optimizations

---

## 🚀 Quick Test Commands

```bash
# Run TypeScript check
pnpm run check

# Run linter
pnpm run lint

# Build check
pnpm run build

# Dev server
pnpm run dev
```

---

## 📝 Test Notes Template

```markdown
## Test Session: [Date] - [Feature]

### Changes Made
- [ ] Change 1
- [ ] Change 2

### Tests Performed
- [ ] Critical path 1
- [ ] Critical path 2
- [ ] Feature-specific tests

### Issues Found
- [ ] Issue 1
- [ ] Issue 2

### Performance
- Initial load: [time]
- Feed load: [time]
- Memory usage: [MB]

### Notes
[Additional observations]
```

---

**Last Updated:** 2025-01-04

