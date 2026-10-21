# The House — REFLUENZ brand identity

REFLUENZ is a premium membership platform for work of **every** kind: writing, music, film, food, education,
technology, art, photography, wellness, design, style. It is not a fashion app. The earlier vocabulary
("atelier", "circle", the tiers Essential / Premium / Signature, "the digital atelier") is retired.

**Line:** Your work. Your House. Your rules.

## The idea

- A creator runs a **Studio**: their public page, their space and their dashboard.
- The people who care join the creator's **House**.
- A House has three levels of closeness: **Member**, **Private** and **Black Label**. The creator names, prices and
  describes each level; the order of the levels is fixed.
- Following is free. Joining a House unlocks what the creator keeps for members. Payments stay switched off until
  funding; joining is free during early access.

## Look

- Black, stone and gold. Calm, editorial, expensive. No loud gradients, no emoji.
- Headings use an Apple-like sans stack:
  `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter Tight', 'Helvetica Neue', Arial, sans-serif`.
- Body text stays in Hanken Grotesk.
- The pitch site (`public/pitch/`) is the reference for tone and palette.

## Vocabulary

| Old copy | New copy |
|---|---|
| atelier: a creator's space, public page or account ("Open your atelier", "Your atelier", "showcase atelier", "Atelier settings", "That atelier could not be found.") | **Studio**, capitalised as a proper noun: "Open your Studio", "Your Studio", "showcase Studio", "Studio settings", "That Studio could not be found." Plural: Studios. Article: "a Studio". |
| circle, creator side ("your circle", "circle notes", "posted a note to the circle") | **House**: "your House", "House notes", "posted a note to the House" |
| circle, viewer side ("join their circle", "Leave circle", "Elena’s circle", "Your circles") | **House**: "join their House", "Leave the House", "Elena’s House", "Your Houses" |
| "Your circle and suggestions", "Your circle is empty" | "Your Houses and suggestions", "You have not joined a House yet" |
| Essential / Premium / Signature | **Member / Private / Black Label**. For example, "Essential and above" becomes "Member and above". |
| "The digital atelier" | "Your work. Your House. Your rules." or "The House for work of every kind." |

- The dashboard at `/app/studio` is called "Studio", and so is the creator's public page. Reword sentences that
  would end up as awkward doubles.
- "Members", "followers", and "tier" or "level" (as functional words in settings) stay as they are.
- Generic copy should not lean on fashion. Replace "wardrobe", "looks" and "lookbook" with words that fit any field:
  "work", "posts", "projects", "notes".
- Tone: elite, calm, short, plain English. No exclamation marks. Curly ’ apostrophes in copy. Sentence case.

## Default levels

These are the defaults that `public.tiers` hands to every new Studio. Creators can rewrite all of them.

| Level | Id (fixed) | Name | Line | Perks |
|---|---|---|---|---|
| 1 | `essential` | Member | A closer look at the work. | Every House post · The complete archive · The members’ conversation |
| 2 | `premium` | Private | Closer to the work, closer to the creator. | Everything in Member · In-depth Studio notes · First in the conversation |
| 3 | `signature` | Black Label | Inside the creative process. | Everything in Private · Black Label collections · Private sessions and notes |

Rows written before the House identity still hold the old defaults. `houseTier()` in `src/api/util.js` shows the
House defaults in their place, so the app reads correctly before the database is migrated. Any save then stores the
new values.

## What does not change (code rules)

Only user-visible copy changes. The following keep their names, because renaming them would break the database,
links, saved sessions or tests:

- Identifiers: `createAtelier`, `cleanAtelier`, `circleIds`, `circleMembers` and similar.
- API method names.
- CSS classes such as `.atelier-*`.
- `data-*` attributes and element ids.
- Routes and URLs.
- Tables and columns, for example `circle_notes`.
- Tier ids: `essential`, `premium`, `signature`.
- Cover preset values: `'atelier'`, `'ritual'`, `'architecture'`. Their display labels may change.

Error text that the database raises (P0001) and that still says "atelier" or "circle" is translated in the client
by `houseWords()` in `src/api/util.js`.
