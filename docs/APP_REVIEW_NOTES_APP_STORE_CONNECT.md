# App Review Notes for App Store Connect

Use the text below in **App Store Connect → Your App → App Review Information → Notes** (and optionally **Sign-in required → Demo account** if you provide one).

---

## Notes (paste into "Notes" field)

**Zap Cooking** is a recipe and food community app with native cooking tools and Nostr-based content.

**To try the app without signing in:**
- **Explore** and **Recipes** tabs show public recipes and collections; no account needed.
- Tap the **pot icon** in the header for the **cooking timer** and **unit converter** (work offline, no login).
- **Reads** and **Community** (Global tab) show public content.

**To try features that require an account:**
- Use the demo account below to sign in.
- Then you can: create recipes, use **Sous Chef** (photo → recipe at /extract), view **Notifications**, **Cookbook**, **Wallet**, and other personal features.

**Demo account:**  
[If you create a test account, add instructions here, e.g.:]  
Sign in with **Private key** and use the test key we provided in Resolution Center / Contact Info.  
Or: **Sign in with Browser Signer** and we have provided a test signer URL in Resolution Center.

Thank you for reviewing Zap Cooking.

---

## Optional: Demo account setup

If you create a dedicated review account:

1. Generate a Nostr key pair (or use a throwaway).
2. In App Store Connect → **App Review Information** → **Sign-in required** → set to **Yes** and add:
   - **Username:** (e.g. zapcooking.review@example.com or "Review Account")
   - **Password:** (if your app supports password; otherwise) **Instructions:** "Use the demo private key (nsec) we provided in the Notes / Resolution Center."
3. In **Notes**, add one line: e.g. **Demo private key (nsec):** [paste the nsec for the review account, or say "Provided in Resolution Center"].

This gives reviewers a way to test Create recipe, Extract from photo, Notifications, and Cookbook without creating their own Nostr identity.
