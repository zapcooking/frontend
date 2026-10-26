# Aggregate palette scope verification

Compared with main `198c665e`. Generated 2026-10-26T00:01:55.839Z.

**211 palette-only Svelte files passed; 0 findings; 4 intentional foundation Svelte files are listed separately.** Every checked file compiles; no new Svelte compiler warnings were introduced. `git diff --check` also passed for the working tree.

## What the guard verifies

- Svelte template hierarchy, displayed text, attributes, control-flow expressions, handlers and component props remain equal after normalizing presentation color values.
- Class strings retain non-color utility tokens: dimensions, layout, spacing, typography, radii, transforms and motion. Only recognized color utilities are normalized. Existing 80%/90% hover opacity may be replaced by an accessible hover color.
- CSS retains non-color declarations, media contexts and selector geometry. Border width/style, outline width/style, shadow offsets/blur/spread and gradient geometry remain equal after color normalization. CSS color-only declarations can change or be added/removed.
- Script ASTs remain equal after normalizing presentation class/color literals. Every changed palette-only script is individually described below; no event handler, branch, fetch or calculation changed.
- Two exact harmless normalizations: removing a static inline `--color-primary` override to inherit the site palette; omitting default `0%`/`100%` stops on a two-stop linear gradient.

This guard establishes source-level scope, not visual/contrast correctness or runtime integration. The root agent's browser, palette-contrast and preference/build checks cover those separately. The four foundation files intentionally add/move appearance initialization or Settings controls and are not claimed to be structurally identical.

Reproduce with `node /workspace/artifacts/site-wide-themes/scope-aggregate.mjs`, then `python /workspace/artifacts/site-wide-themes/scope-aggregate-report.py` from the configured repository environment. Machine-readable results: `scope-aggregate.json`; strict checker: `scope-aggregate.mjs`.

## Manually reviewed script changes

| File | Review |
| --- | --- |
| `src/components/Button.svelte` | Action/secondary variant color classes; hover opacity replaced by safe color. |
| `src/components/DesktopSideNav.svelte` | Active navigation border color class only. |
| `src/components/IntelligenceMenu.svelte` | Comment only; no executable script change. |
| `src/components/MobileNavDrawer.svelte` | Active navigation border color class only. |
| `src/components/SaveButton.svelte` | Unsaved primary-action color classes only; saved-state logic unchanged. |
| `src/components/ZapButton.svelte` | Variant color classes only; handlers unchanged. |
| `src/components/planner/CheffyPlanModal.svelte` | Selected chip color classes only; planning logic unchanged. |
| `src/components/table/ArticleCardBody.svelte` | Skeleton color classes only; size/layout classes unchanged. |
| `src/routes/membership/TierCard.svelte` | Tier card/button color classes only; selection/pricing/payment logic unchanged. |
| `src/routes/recipes/+page.svelte` | Two SVG gradient color constants and explanatory comment only. |

## Palette-only Svelte diff summary, per file

Each pass includes unchanged structure, copy, non-color utilities, non-color CSS/geometry and business logic. `+ / −` counts are whole-file diff lines, including comment/formatting changes.

| File | + / − | Script | Scope result |
| --- | ---: | --- | --- |
| `src/components/AccountNudgeItem.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/AltTextEditorModal.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/ArticleCard.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/AuthorName.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/BottomNav.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/Button.svelte` | 2 / 2 | Presentation/comment only | PASS |
| `src/components/CheffyMessenger.svelte` | 9 / 9 | Unchanged | PASS |
| `src/components/CheffyNoteReview.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/CheffyRecipeCard.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/CheffyStarterPrompts.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/ClientAttribution.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/ContinueAsChip.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/ConverterWidget.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/CookPlusPromoBar.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/CookingToolsWidget.svelte` | 12 / 12 | Unchanged | PASS |
| `src/components/CreateMenuButton.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/CulinaryMesh.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/CustomName.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/DesktopSideNav.svelte` | 1 / 1 | Presentation/comment only | PASS |
| `src/components/ErrorBoundary.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/ExportCookbookModal.svelte` | 5 / 5 | Unchanged | PASS |
| `src/components/Feed.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/FeedPostSkeleton.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/FollowButton.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/FoodstrFeedOptimized.svelte` | 9 / 9 | Unchanged | PASS |
| `src/components/Footer.svelte` | 1 / 4 | Unchanged | PASS |
| `src/components/FreshFeed.svelte` | 8 / 8 | Unchanged | PASS |
| `src/components/FreshFinishLine.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/FreshFloorCard.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/FreshMemberPitch.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/FreshOnThisDayCard.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/FreshRecipeBox.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/FreshReportModal.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/FreshSettings.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/FreshSpecialShell.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/FreshTopicChips.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/Header.svelte` | 19 / 20 | Unchanged | PASS |
| `src/components/IntelligenceMenu.svelte` | 3 / 5 | Presentation/comment only | PASS |
| `src/components/LazarusDeltaPanel.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/LazarusRecoverySection.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/LightningInvoiceCard.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/LinkPreview.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/LoadingState.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/MediaDrawer.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/MediaUploader.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/MemoriesCard.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/MemoryNoteCard.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/MentionDropdown.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/MobileNavDrawer.svelte` | 1 / 1 | Presentation/comment only | PASS |
| `src/components/MuteListEditor.svelte` | 9 / 9 | Unchanged | PASS |
| `src/components/Nip05ClaimModal.svelte` | 18 / 18 | Unchanged | PASS |
| `src/components/NoteContent.svelte` | 12 / 12 | Unchanged | PASS |
| `src/components/NoteEmbed.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/NoteTotalZaps.svelte` | 6 / 6 | Unchanged | PASS |
| `src/components/NotificationBell.svelte` | 5 / 5 | Unchanged | PASS |
| `src/components/NotificationPanel.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/PendingIndicator.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/PollCreator.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/PollDisplay.svelte` | 13 / 13 | Unchanged | PASS |
| `src/components/PostComposer.svelte` | 19 / 19 | Unchanged | PASS |
| `src/components/PostEngagementToggle.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/ProfileDrafts.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/ProfileSheet.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/PullToRefresh.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/QueryBatcherDemo.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/Reactions/EmojiReactionPicker.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/Reactions/ReactionDisplay.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/Recipe/DirectionsPhases.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/Recipe/Ingredients.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/Recipe/PrintRecipeModal.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/Recipe/Recipe.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/RecipePickerModal.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/RelaySelectorDebug.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/RichTextNostr.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/SaveButton.svelte` | 3 / 3 | Presentation/comment only | PASS |
| `src/components/SectionHeader.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/SectionNav.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/ShareModal.svelte` | 9 / 9 | Unchanged | PASS |
| `src/components/ShareMyRecipesAction.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/SharePackModal.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/SidebarWallet.svelte` | 9 / 9 | Unchanged | PASS |
| `src/components/SuggestedFollowsModal.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/TimerWidget.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/TopZappers.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/TwitterEmbed.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/UserSidePanel.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/VaultUnlockOutcomeDialog.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/ZapButton.svelte` | 3 / 3 | Presentation/comment only | PASS |
| `src/components/ZapDisplay.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/auth/SignInCard.svelte` | 32 / 35 | Unchanged | PASS |
| `src/components/auth/SignupFlow.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/clink/NofferButton.svelte` | 8 / 11 | Unchanged | PASS |
| `src/components/clink/NofferPayModal.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/comments/ReplyComposer.svelte` | 15 / 15 | Unchanged | PASS |
| `src/components/grocery/AddToListModal.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/grocery/GroceryItemRow.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/grocery/GroceryListCard.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/marketplace/CategoryFilter.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/marketplace/KitchenCard.svelte` | 5 / 5 | Unchanged | PASS |
| `src/components/marketplace/KitchenForm.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/marketplace/KitchenHeader.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/marketplace/MessageSellerModal.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/marketplace/PaymentActionPanel.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/marketplace/ProductCard.svelte` | 11 / 11 | Unchanged | PASS |
| `src/components/marketplace/ProductForm.svelte` | 13 / 13 | Unchanged | PASS |
| `src/components/marketplace/ProductViewModal.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/marketplace/SellerAcknowledgmentModal.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/marketplace/TrustBadge.svelte` | 5 / 5 | Unchanged | PASS |
| `src/components/mesh/MeshControlPanel.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/mesh/MeshDetailDrawer.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/mesh/MeshHeroOverlay.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/mesh/MeshLegend.svelte` | 5 / 5 | Unchanged | PASS |
| `src/components/notifications/NotifText.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/nourish/NourishDimensionTile.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/nourish/NourishInputTabs.svelte` | 10 / 10 | Unchanged | PASS |
| `src/components/nourish/NourishLoadingState.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/nourish/NourishModal.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/nourish/NourishPhotoInput.svelte` | 4 / 4 | Unchanged | PASS |
| `src/components/nourish/NourishResult.svelte` | 9 / 13 | Unchanged | PASS |
| `src/components/pantry/PantryEditor.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/pantry/PantryItem.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/planner/CheffyPlanModal.svelte` | 5 / 5 | Presentation/comment only | PASS |
| `src/components/planner/GeneratedPlanPreview.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/pow/PowHeatMap.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/pow/PowZapButton.svelte` | 2 / 2 | Unchanged | PASS |
| `src/components/reads/ArticleMetadata.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/reads/ContentUnavailable.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/reads/EditorToolbar.svelte` | 9 / 9 | Unchanged | PASS |
| `src/components/reads/LongformEditorModal.svelte` | 16 / 16 | Unchanged | PASS |
| `src/components/reads/MentionList.svelte` | 3 / 3 | Unchanged | PASS |
| `src/components/reads/ReportArticleModal.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/reads/TiptapEditor.svelte` | 7 / 7 | Unchanged | PASS |
| `src/components/table/ArticleCardBody.svelte` | 8 / 8 | Presentation/comment only | PASS |
| `src/components/table/CoverSection.svelte` | 19 / 19 | Unchanged | PASS |
| `src/components/table/FeedSection.svelte` | 6 / 6 | Unchanged | PASS |
| `src/components/table/FilterBar.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/wallet/WalletModal.svelte` | 1 / 1 | Unchanged | PASS |
| `src/components/wallet/WalletPanel.svelte` | 78 / 78 | Unchanged | PASS |
| `src/lib/components/groups/AddMemberModal.svelte` | 1 / 1 | Unchanged | PASS |
| `src/lib/components/groups/CreateGroupModal.svelte` | 1 / 1 | Unchanged | PASS |
| `src/lib/components/groups/GroupList.svelte` | 6 / 6 | Unchanged | PASS |
| `src/lib/components/groups/GroupMessage.svelte` | 1 / 1 | Unchanged | PASS |
| `src/lib/components/groups/GroupThread.svelte` | 4 / 4 | Unchanged | PASS |
| `src/lib/components/groups/InviteLinkModal.svelte` | 1 / 1 | Unchanged | PASS |
| `src/lib/components/messages/ConversationList.svelte` | 1 / 1 | Unchanged | PASS |
| `src/lib/components/messages/MessageBubble.svelte` | 1 / 1 | Unchanged | PASS |
| `src/lib/components/messages/MessageThread.svelte` | 1 / 1 | Unchanged | PASS |
| `src/routes/admin/deletion-requests/+page.svelte` | 5 / 5 | Unchanged | PASS |
| `src/routes/admin/nourish-flags/+page.svelte` | 12 / 12 | Unchanged | PASS |
| `src/routes/admin/promos/+page.svelte` | 5 / 5 | Unchanged | PASS |
| `src/routes/admin/reads-moderation/+page.svelte` | 4 / 4 | Unchanged | PASS |
| `src/routes/boost/+page.svelte` | 7 / 7 | Unchanged | PASS |
| `src/routes/cheffy/+page.svelte` | 15 / 15 | Unchanged | PASS |
| `src/routes/create/+page.svelte` | 4 / 4 | Unchanged | PASS |
| `src/routes/delete-account/+page.svelte` | 1 / 1 | Unchanged | PASS |
| `src/routes/drafts/+page.svelte` | 11 / 11 | Unchanged | PASS |
| `src/routes/feed-post/+page.svelte` | 10 / 10 | Unchanged | PASS |
| `src/routes/feed/+page.svelte` | 6 / 6 | Unchanged | PASS |
| `src/routes/founders/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/groups/join/+page.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/kitchen/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/list/[slug]/fork/+page.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/market/+page.svelte` | 16 / 16 | Unchanged | PASS |
| `src/routes/market/kitchen/[npub]/+page.svelte` | 4 / 4 | Unchanged | PASS |
| `src/routes/market/products/+page.svelte` | 12 / 12 | Unchanged | PASS |
| `src/routes/market/trust/+page.svelte` | 21 / 21 | Unchanged | PASS |
| `src/routes/membership/+page.svelte` | 138 / 88 | Unchanged | PASS |
| `src/routes/membership/BitcoinPayment.svelte` | 9 / 9 | Unchanged | PASS |
| `src/routes/membership/HeroSection.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/membership/PaymentModal.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/membership/PaymentSelection.svelte` | 10 / 10 | Unchanged | PASS |
| `src/routes/membership/PaymentSuccess.svelte` | 28 / 28 | Unchanged | PASS |
| `src/routes/membership/PlanPicker.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/membership/StripeCheckout.svelte` | 5 / 5 | Unchanged | PASS |
| `src/routes/membership/TierCard.svelte` | 24 / 24 | Presentation/comment only | PASS |
| `src/routes/membership/TimelineSection.svelte` | 19 / 19 | Unchanged | PASS |
| `src/routes/membership/UltraLimitedBanner.svelte` | 17 / 17 | Unchanged | PASS |
| `src/routes/membership/confirmation/+page.svelte` | 68 / 68 | Unchanged | PASS |
| `src/routes/membership/cook-plus-checkout/+page.svelte` | 52 / 52 | Unchanged | PASS |
| `src/routes/membership/genesis-checkout/+page.svelte` | 48 / 48 | Unchanged | PASS |
| `src/routes/membership/pro-kitchen-checkout/+page.svelte` | 67 / 52 | Unchanged | PASS |
| `src/routes/membership/success/[tier]/+page.svelte` | 42 / 37 | Unchanged | PASS |
| `src/routes/memories/+page.svelte` | 1 / 1 | Unchanged | PASS |
| `src/routes/mesh/+page.svelte` | 1 / 1 | Unchanged | PASS |
| `src/routes/messages/+page.svelte` | 1 / 1 | Unchanged | PASS |
| `src/routes/my-kitchen/+page.svelte` | 29 / 29 | Unchanged | PASS |
| `src/routes/my-kitchen/[naddr]/+page@.svelte` | 8 / 8 | Unchanged | PASS |
| `src/routes/my-kitchen/grocery/+page.svelte` | 4 / 4 | Unchanged | PASS |
| `src/routes/my-kitchen/grocery/[id]/+page.svelte` | 5 / 5 | Unchanged | PASS |
| `src/routes/my-kitchen/pantry/+page.svelte` | 5 / 5 | Unchanged | PASS |
| `src/routes/my-kitchen/planner/+page.svelte` | 13 / 13 | Unchanged | PASS |
| `src/routes/my-store/+page.svelte` | 8 / 8 | Unchanged | PASS |
| `src/routes/my-store/edit/[id]/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/my-store/kitchen/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/my-store/new/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/notifications/+page.svelte` | 6 / 6 | Unchanged | PASS |
| `src/routes/nourish/+page.svelte` | 16 / 16 | Unchanged | PASS |
| `src/routes/nourish/explore/+page.svelte` | 22 / 22 | Unchanged | PASS |
| `src/routes/pack/[naddr]/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/packs/+page.svelte` | 12 / 12 | Unchanged | PASS |
| `src/routes/pantry/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/r/[naddr]/+page.svelte` | 3 / 3 | Unchanged | PASS |
| `src/routes/reads/+page.svelte` | 6 / 6 | Unchanged | PASS |
| `src/routes/reads/[naddr]/+page.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/recipe/[slug]/+page.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/recipes/+page.svelte` | 7 / 11 | Presentation/comment only | PASS |
| `src/routes/s/[code]/+page.svelte` | 1 / 1 | Unchanged | PASS |
| `src/routes/s/[code]/info/+page.svelte` | 2 / 2 | Unchanged | PASS |
| `src/routes/souschef/+page.svelte` | 11 / 24 | Unchanged | PASS |
| `src/routes/sponsors/+page.svelte` | 16 / 16 | Unchanged | PASS |
| `src/routes/user/[slug]/+page.svelte` | 23 / 23 | Unchanged | PASS |

## Intentional foundation Svelte changes

| File | + / − | Review boundary |
| --- | ---: | --- |
| `src/components/landing/LandingThemePicker.svelte` | 22 / 2 | Existing picker reused in Settings; label/inApp props and control-ready notification. New Settings-specific presentation is an intentional foundation exception. |
| `src/routes/+layout.svelte` | 7 / 8 | Shared header/separator color substitutions only in current diff; excluded at root reviewer request. |
| `src/routes/explore/+page.svelte` | 0 / 3 | Removes page-specific controller import/head script now supplied by app.html; landing content unchanged. |
| `src/routes/settings/+page.svelte` | 42 / 42 | Adds existing style picker beside independent mode controls; automatic store subscription and pressed-state accessibility. Remaining substitutions are colors. |

## Other modified source/configuration files

These are not Svelte templates and are outside the aggregate AST proof. The root agent owns the palette/preferences foundation and related tests/build integration. `meshTheme.ts` was manually verified: only eight default-container/legend color values change; its semantic node/edge and Constellation definitions are unchanged.

| File | + / − | Group |
| --- | ---: | --- |
| `_headers` | 4 / 0 | Foundation / integration / tests; root review |
| `src/app.css` | 27 / 67 | Foundation / integration / tests; root review |
| `src/app.html` | 12 / 2 | Foundation / integration / tests; root review |
| `src/components/auth/signInContrast.test.ts` | 73 / 31 | Foundation / integration / tests; root review |
| `src/lib/landing/exploreTheme.client.js` | 0 / 104 | Foundation / integration / tests; root review |
| `src/lib/landing/exploreTheme.test.ts` | 165 / 16 | Foundation / integration / tests; root review |
| `src/lib/landing/exploreThemes.css` | 1 / 217 | Foundation / integration / tests; root review |
| `src/lib/landing/meta.ts` | 4 / 13 | Foundation / integration / tests; root review |
| `src/lib/landing/route.test.ts` | 6 / 3 | Foundation / integration / tests; root review |
| `src/lib/mesh/meshTheme.ts` | 8 / 8 | Palette-only configuration (manually verified) |
| `src/lib/themeStore.test.ts` | 112 / 0 | Foundation / integration / tests; root review |
| `src/lib/themeStore.ts` | 36 / 85 | Foundation / integration / tests; root review |
| `src/lib/themes/palettes.css` | 292 / 0 | Foundation / integration / tests; root review |
| `static/appearance.js` | 149 / 0 | Foundation / integration / tests; root review |
| `svelte.config.js` | 1 / 1 | Foundation / integration / tests; root review |
| `vite.config.ts` | 0 / 5 | Foundation / integration / tests; root review |
