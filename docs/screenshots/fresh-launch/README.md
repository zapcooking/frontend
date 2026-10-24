# Fresh launch UX (PRs #785 + #786)

Captured on the #786 preview at 390 px wide (Chrome mobile emulation), with
read-only logins (the "member" key can't sign, so its topic tap ends at
"Log in to the feed" after the refused prompt).

| | Member (Seth's key) | Non-member (signed in) | Signed out |
|---|---|---|---|
| Landing: Fresh first, chip row | chips-member-landing.png | chips-nonmember-landing.png | chips-signedout-landing.png |
| Tapping "Japanese" | chips-member-topic.png | chips-nonmember-topic.png | chips-signedout-topic.png |
| "More": the Topics sheet | chips-member-sheet.png | chips-nonmember-sheet.png | chips-signedout-sheet.png |

`sheet-664px-tall.png`: the sheet on a 390×664 viewport (about what iOS
Safari leaves visible with both bars), header and close button in view, the
list scrolling inside.
