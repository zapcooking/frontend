# Cheffy’s Table: experience audit and design plan

Audited current main `e323b7c` after PR #685, including the route, all game/persistence modules and tests, native layout and scroll container, app tokens/Albert Sans, Button/Modal, desktop/mobile navigation, Capacitor safe areas and haptics, CheffyAvatar/host surfaces, Explore/discovery, recipe and cookbook cards, profiles, reactions and notifications. No general product analytics transport exists; this upgrade will not introduce tracking.

## Observed friction

- The first screen introduces storage and login before a guest or a dish. The game competes with the full site sidebar, search and footer. At 1280px the three-column game overflows the available content width; the plate is clipped.
- The large title, service progress and guest card repeat context. Ingredient tiles repeat category, selection and information controls; explanatory panels consume the space the food needs.
- The player alternates between textual settings and a separate plate preview. Selected ingredients do not form a persistent, actionable board. Mobile continuation controls require scrolling beyond the pantry.
- Guest initials and a constraint list have little emotional presence. Serving has a delay but no theatrical arc; the result gives equal weight to analytical components and guest response.
- Finale actions are visually equal. Daily play is hidden in options. History is technically informative but has no progression language. Dark-mode surfaces mix semantic colors with fixed cream/green.
- The 700+ line route and 1,600+ line global stylesheet couple state, persistence, visual layout and interactions. Model and persistence separation are strengths to preserve.

## New flow

Enter the kitchen → choose Open Kitchen or Today’s Table → meet the guest → tap food onto a persistent board → choose a stove and timer → choose a vessel and finish → send the plate → see the guest’s reaction → open the next ticket → celebrate the best dish and turn the service into dinner.

The compact HUD owns back-to-Zap, score, service book and pause. Tickets establish momentum. Desktop is one shared kitchen with the guest left, station center and food on the pass right. Tablet keeps the order above station/pass. Mobile keeps the compact order visible and the live dish plus next action at thumb level. Education appears on request, first-use hints and one review lesson. All four real score components remain available in expandable detail.

## Boundaries

`service.ts`, `history.ts`, `nostrHistory.ts` and their existing tests remain unchanged. No new scoring, public leaderboard, history format, encryption, automatic social posting, or identity behavior. Preserve the submitted-dish snapshot and account generation guards added on main. Open Kitchen keeps its existing guest roster; do not advertise random guests. Daily date remains UTC. A new presentation reducer controls only stations/overlays/serving/restarts. Existing history remains readable without migration.

## Visual and interaction system

Use Zap orange, Albert Sans, Phosphor icons and the existing original pantry atlas. Local semantic tokens support a warm daylight kitchen and a charcoal night kitchen. Original small SVG guest portraits complement Cheffy’s line art. Food is layered with separate bowl/toast/plate compositions. Bounded transform/opacity animation handles arrival, garnish, service and reactions; reduced motion skips travel and counting. No game engine or animation dependency.

## Verification plan

Existing suite plus presentation-state tests; typecheck, changed-file lint, production build. Inspect opening, pantry, stove, plating, review, finale and Service Book at 375/390/430/768/1024/1280/1440px, light/dark. Exercise keyboard/focus, tap, navigation, restarts, daily, sound, reduced motion and guest transitions. Use isolated test transports for account changes, sync failures and recipe outcomes; never publish from a real account during automated QA. Record actual coverage and limitations in the validation report.
