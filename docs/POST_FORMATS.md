# Post formats: text, image and video

Creators publish three kinds of entry. This document is the contract between
`src/media.js`, `src/api.js`, `src/platform.js` and the database, and it describes
what is deployed: the migration below is **already applied to production**, so
the client adapts to it, never the other way round. Change this file in the same
commit as any code that breaks it.

| Kind | Required | Body | Card shows |
| --- | --- | --- | --- |
| `text` | title, body 30–20,000 chars, no media | the entry | editorial cover preset |
| `image` | title, 1–10 images | optional caption ≤ 20,000 | the first image's small card thumbnail (the image itself when it has none), or the blurred preview when locked; image count |
| `video` | title, exactly 1 video (≤ 50 MB) | optional caption ≤ 20,000 | poster frame, or the blurred preview when locked; duration ("Video" when it is unknown) |

Access works exactly as before (`access`: `public` or a tier id). A locked
reader never receives the full-resolution media: `entry_media` rows and the
`entry-media` storage objects are protected by the same rule as `entry_bodies`
(`can_read_entry`), and the owner always passes it, drafts included.

## Database (`supabase/migrations/20261005153611_post_formats.sql`, applied)

### Entries

- `entries.kind` (`text|image|video`, default `text`), `media_count`, `preview_path`,
  `duration_seconds`. The last three are derived and never written by the client
  (see the sync trigger and `save_entry` below).
- Clients cannot write `entries` or `entry_bodies` directly (insert/update are
  revoked); everything goes through `save_entry`. Deleting an own entry still works
  and cascades to `entry_media`.
- `format` accepts `Essay, Guide, Studio note, Field note, Collection, Gallery, Film, Update`.
  The database does not tie formats to a kind. The editor offers the five text formats for text posts
  and all of them plus `Gallery` and `Film` for image and video posts (`Update` is accepted by the
  database but never offered); `Gallery` is the default for image posts, `Film` for video posts.
- `entry_bodies.body` may be empty (captions are optional); the 30-character
  minimum for text entries is enforced by `save_entry`.

### `entry_media`

`(id, entry_id, kind, path, poster_path, preview_path, mime, size_bytes, width, height,
duration_seconds, alt, position, created_at)`. `path` is unique, `size_bytes` 1 – 50 MiB,
`alt` ≤ 200, `position` 0–99, `kind` must agree with the MIME type.

- Select: whoever can read the entry. Insert: the owner only, for the columns the client
  sends; the paths must start with `<creator_id>/<entry_id>/`. Update: the owner, only
  `alt` and `position`. Delete: the owner.
- **Insert guard (transient headroom).** A before-insert trigger lets the owner hold up to
  **20 images** or **2 videos** per entry, counted per kind (so a mixed state is allowed
  too). It exists so the editor can **upload new media first and remove old media afterwards**
  (replace a video, swap images at the cap, switch kind) and an entry is never left
  without media. Beyond the headroom it raises `Remove the previous video before adding
  another.` or `Remove some images before adding more.` (`P0001`, shown as is). Inserts by
  non-owners fall through to the row level security error. Inserts for one entry are serialised.
- **Final shape, enforced when publishing.** `save_entry(..., 'published')` requires, per kind:
  `image` 1–10 images and no video; `video` exactly one video and no images; `text` no media at
  all. Drafts are exempt, so a save that stops half way (for example with old and new media
  both attached) is always recoverable.
- **Sync trigger.** After every insert, delete and `position` update on `entry_media`, the
  entry's `media_count`, `preview_path` (the preview of the first file by position) and
  `duration_seconds` (video entries: the newest video) are recomputed, whoever wrote the rows. **A published
  image or video entry that loses its last file goes back to `draft`** automatically.
  `save_entry` recomputes the same fields again, so the last write always agrees.

### Object names, buckets and quotas

- Buckets: `entry-media` (private, 50 MB, `image/jpeg|png|webp|gif`, `video/mp4|webm|quicktime`)
  holds originals, video posters and the card thumbnails of images; `previews` (public, 256 KB, `image/webp|jpeg`) holds the
  tiny blurred teasers shown on locked cards.
- **Object names must be canonical**: `<creator uuid>/<entry uuid>/<file>` with lowercase uuids and
  a file name matching `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. The database checks this for
  uploads and for `entry_media.path`, `poster_path`, `preview_path` and `entries.preview_path`.
  Anything else (mixed case, `..`, `?`, `#`, quotes, a missing folder) is rejected.
- **Uploads** need the canonical name, ownership of the creator folder and of the entry (so the
  entry row must exist: save a draft first), and stay under **60 objects per entry** (both buckets
  together) and **500 MB of `entry-media` per creator**. The quota is measured on stored objects,
  so parallel uploads can overshoot slightly.
- **Owner folder cleanup.** Owners can read and delete anything in their own creator folder
  (`<creator uuid>/…`), in both buckets, **even after the entry row is gone**. This is what lets
  `deleteEntry` remove the files after the cascade, and lets leftovers be cleaned later.
  Readers get `entry-media` objects only through the entry's access rule (signed URLs).
- `save_entry(p_id, p_title, p_subtitle, p_body, p_category, p_format, p_image, p_access,
  p_status, p_kind default 'text') → uuid` validates by kind (title 3–100, introduction ≤ 180,
  caption/body rules above, `kind` in `text|image|video`, status `draft|published`), derives
  the excerpt and reading time (video: duration in minutes; image: caption words), and checks
  the final shape above when publishing.

## Save flow (editor)

The order never varies, so a failed step cannot leave a published entry without its media:

1. Validate locally (`validateEntry` in `store.js`, plus the media rules the form cannot express).
2. New entry with files → `api.saveEntry(null, values, 'draft')` to obtain an id (object names need it).
3. **Upload** each new file, **two at a time** (`UPLOADS_AT_ONCE`): `media.prepareImage` / `media.prepareVideo`, then
   `api.uploadMedia(entryId, creatorId, prepared, {position, alt, onProgress, signal})`. While one file is prepared (decoded and
   re-encoded) the other uploads. Every queued file shows its own progress bar from the start, `position` is the file's index in the
   list, and **every upload is stored before step 4 begins**. The database serialises the inserts of one entry, so two at a time is safe.
4. **Then remove** the media the creator deleted: `api.removeMedia(list)`, one request for the whole list.
5. **At the same time**, persist reordering and alt edits: `api.updateMedia(id, {alt, position})`, up to four at once. Steps 4 and 5
   touch different rows (a removed file is never among the files that stay), so they run concurrently; if one fails the other has
   still been done, and a retry repeats only what is missing.
6. `api.saveEntry(id, values, status)` with the final status; the server re-checks the final shape.
7. The studio's data is reloaded. When that reload fails the save itself still stands, so it is tried once more; only when that fails too the
   toast says "Saved, but your studio could not be refreshed. Reload the page to see the latest." instead of announcing the draft or the
   publication (the lists may be one save behind until the next load).

Failure handling:

- If a step fails the entry keeps what it had: the dialog stays open with the error, the created
  draft id, the finished uploads and the pending removals are remembered, and Save or Publish
  again continues where it stopped. Nothing half-uploaded is published.
- **When a file fails** nothing new starts, but the upload still running is allowed to finish (it is not thrown away). **Every file that
  failed says why next to itself** ("Not uploaded: The upload was interrupted. It will be sent again when you save."; a cancelled one has
  no reason to give). The summary above the buttons names the first failure and counts the others ("b.jpg: … 1 other file also failed.").
  Files that never started are not marked. The next save sends only the files that are still missing.
- **Cancel upload** (a button outside the disabled fieldset, shown only while saving) aborts the uploads in flight through an
  `AbortController` (`signal` of `uploadMedia`) and every step after them. What was stored stays, the form unlocks with
  "Upload cancelled. Your draft and N uploaded files are kept…", and Save or Publish continues. While a save runs, closing the dialog
  only says "Still uploading. Use Cancel upload to stop."
- The one case where a removal may come before an upload: files this editing session stored itself and
  the creator then discarded again after a failed save. They were never part of the entry, and they
  would use up the transient headroom (20 images, 2 videos) that the next upload needs, so only as
  many of them as the cap requires are removed first (`makeRoom` in `platform.js`). At least one other
  file of that kind (an original, or the newest upload) always remains, so a published entry is never
  left empty and the sync trigger never demotes it. The original files are always removed after the
  uploads.
- Removing without replacing (every file deleted, or a media post switched to Text) has nothing to
  upload first. The last removal moves a published entry to `draft` (sync trigger) and the final
  `saveEntry` then sets the requested status.
- Files of another kind than the entry (for example the new video left by a failed switch from
  images) cannot be published with it. Opening the editor queues them for removal and the next save
  clears them; the editor shows only files of the entry's own kind.
- Cards, the reader and the editor never depend on signing succeeding (see `signedUrls`).

## `src/media.js` (browser only for prepare*)

```js
export const LIMITS = { maxImages: 10, maxImageInputBytes: 25 MB, maxVideoBytes: 50 MB,
  imageTypes: ['image/jpeg','image/png','image/webp','image/gif'],
  videoTypes: ['video/mp4','video/webm','video/quicktime'] };
export function classify(file) → 'image' | 'video' | null      // by MIME, falls back to extension
export function mimeOf(file) → string                          // MIME to store; .mov/.m4v follow the extension
export function validateFiles(kind, files, existingCount = 0) → void   // throws Error with a friendly message
export function formatDuration(seconds) → 'm:ss' | 'h:mm:ss'
export function fitWithin(width, height, maxEdge) → { width, height }  // never upscales; {0, 0} for junk
export async function prepareImage(file) → Prepared            // downscale to ≤ 2400px, webp ≈0.86 (jpeg fallback); GIFs kept
export async function prepareVideo(file) → Prepared            // reads metadata, grabs a poster frame
// Prepared = { kind, blob, mime, ext, size, width, height, duration|null,
//              poster: Blob|null (video: the frame, ≤ 1280px; image: the card thumbnail, ≤ 640px, null when the picture is already that small or a GIF is light; webp, jpeg fallback), preview: Blob (≈32px wide webp, jpeg fallback), name }
```

`validateFiles(kind, files, existingCount)` rules:

- `'text'`: no files are accepted. An empty list passes; any file throws "Text entries carry no images
  or videos…". (The editor never calls it for text with files: dropping a file on a text entry first
  switches the post to the file's kind.)
- Any other unknown kind throws "Choose Text, Image or Video as the post format."
- `'image'` / `'video'`: an empty selection throws; every file must be of that kind (the error names
  the mismatch, "is a video, but this is an image post"); images: `existingCount + files ≤ 10`;
  video: exactly one file and `existingCount` must be 0; empty files are rejected; images up to 25 MB
  before optimisation, videos up to 50 MB.

`prepare*` returns blobs that already fit the buckets: the preview is a few hundred bytes to a few
KB (limit 256 KB), the poster is a webp or jpeg, and the video blob keeps the original bytes with a
normalised MIME type. The module imports cleanly in Node (the pure helpers are unit tested).

## `src/api.js`

```js
createApi(client, { url = SUPABASE_URL, key = SUPABASE_KEY,
                    XHR = globalThis.XMLHttpRequest,        // constructor used for uploads (progress); tests inject a fake
                    now = () => Date.now(),                  // clock for the signed URL cache
                    uuid = () => crypto.randomUUID() })      // source of the random part of object names
saveEntry(id, values, status)            // values.kind is sent as p_kind; returns the entry id
media(entryIds) → { [entryId]: Media[] } // sorted by position; RLS leaves out entries the reader cannot open
signedUrls(paths, expiresIn = 3600) → { [path]: url }   // entry-media only; cached until 5 min before expiry
uploadMedia(entryId, creatorId, prepared, { position = 0, alt = '', onProgress, signal }) → Media
updateMedia(mediaId, { alt, position })
removeMedia(media)                        // row first, then storage objects (best effort)
deleteEntry(id)                           // also removes the entry's storage objects
previewUrl(path) → string | null          // public URL in the previews bucket
// Media = { id, entryId, kind, path, posterPath, previewPath, mime, size, width, height, duration, alt, position }
// Entries from load() gain: kind, mediaCount, previewUrl, duration
```

- `media(ids)` queries in chunks of 100 and returns only entries the reader may open, so a locked
  entry is simply absent from the result.
- `signedUrls` makes one storage call for everything not cached, shares in-flight requests,
  leaves out files that fail to sign, and drops its cache on sign-out, user change and removal.
  **It throws when the call as a whole fails** (network, session). Every caller catches that and
  degrades: cards keep the blurred preview and try again on the next render, the reader opens with
  the caption and a "could not be loaded, open it again" note, the editor opens without thumbnails.
- `uploadMedia` sends each object with `XMLHttpRequest` to `/storage/v1/object/<bucket>/<path>` with the
  session token (`x-upsert: false`), so the editor can show progress. `onProgress(fraction 0..1)`
  is monotonic, the main file counts for 90 %, and 1 is reported only once the row is saved.
  Objects, all named `<creator>/<entry>/<uuid>…` in lowercase (creator and entry ids are lowercased,
  the uuid comes from `uuid()`, the extension is lowercased, stripped to `[a-z0-9]` and cut at 10
  characters, `bin` when nothing is left), so every name satisfies the database's canonical rule:

  | Object | Bucket | Name |
  | --- | --- | --- |
  | the file | `entry-media` | `<uuid>.<ext>` |
  | poster (video frame) or card thumbnail (image) | `entry-media` | `<uuid>-poster.<jpg\|webp>` |
  | blurred preview | `previews` | `<uuid>.<jpg\|webp>` (only when it is a webp/jpeg of at most 256 KB; otherwise the upload goes ahead without one) |

  If any step fails (including the row insert, e.g. over the headroom) everything uploaded so far is
  removed best effort and the error is rethrown in plain words. `signal` cancels an upload.
- Upload errors are mapped: 413 → too large (50 MB), 415 / mime → type not supported, 401 or an
  expired token → "session expired, sign in again", 403 / row level security → "upload refused, your
  storage may be full (500 MB, 60 files per entry)", 5xx → try again, offline → network message.
  Messages raised by the database (`P0001`) pass through unchanged.
- `removeMedia(media)` deletes the row, then the files; storage failures never throw (orphans are harmless
  and the owner can still remove them). Removing a row that is already gone still cleans the files, so
  a retry is safe.
- `deleteEntry(id)` reads the entry's media rows first (a failed read stops the delete), deletes the
  entry (the rows cascade), then removes the files from both buckets best effort. This works after the
  cascade because the owner policies authorise by creator folder.

## UI (`src/platform.js`)

- `mount(api, { storage, media })`: `storage` defaults to `localStorage` (guarded), `media` defaults to
  `src/media.js`. Tests inject a fake of each; `media` needs `LIMITS`, `classify`, `validateFiles`,
  `prepareImage`, `prepareVideo` and `formatDuration`. Returns `{ handleAction, render, hydrateMedia }`.
- Editor: a Text / Image / Video switch at the top (group "Post type"; the select below it is "Editorial format"). Image:
  multi-select or drop, thumbnails with remove, move earlier/later and alt text. Video: one file, inline preview player. Per-file
  progress, and the whole form is locked while saving (disabled controls are dimmed to 45 %; keyboard focus moves to the status line
  and, when a save stops, back to the button that was used). Captions are optional for media posts. The format can only change
  while no media is attached (remove the files first); dropping a file on a text entry switches it to
  the file's kind. Publishing needs at least one image, or exactly one video; a draft may be empty.
- Errors about the files appear in the media section next to the controls that caused them; errors about saving stay above the
  buttons. Both are `role="alert"` and scrolled into view.
- **Enter never saves.** The form has no default submit button: a hidden, disabled submit button comes first (a disabled default
  button blocks implicit submission everywhere, phone "Go" keys included), Enter in a single-line field is also swallowed, and a
  submit that does not come from Save draft or Publish is ignored (no guessing "published"). Preview is a plain button.
- **Cover study.** Text posts show the preset select with its preview. Media posts hide it (the card shows the first image or the
  film's poster) and say so in one help line: "Cards show your first image. The editorial cover stays as the fallback card image."
  The chosen preset is still saved with the entry and is what a card shows until the media loads or if it cannot.
- **Touch.** Every editor control is at least 40 px (44 px on phones and on any touch screen, `pointer: coarse`, which also swaps
  "Drop images here, or browse" for "Choose images from your device").
- **Opening.** The reader and the editor fetch the caption and the file list at the same time (signing follows), the tapped control
  shows `aria-busy` (progress cursor) and ignores a second tap, and a read or edit still loading when the dialog is closed, the
  account changes or another one is requested is dropped instead of opening later.
- Cards: kind badge (image count, or ▶ duration; a film whose length is unknown says "Video" and shows no 0:00). Covers load after
  render in one batched `media()` plus one `signedUrls()` call (`hydrateMedia`), for the first file of the entry's own kind: an
  image's **card thumbnail** (the `poster_path` of that file, about 640 px) or a film's poster frame. Older images, and pictures that were
  already small, have no thumbnail and use the file itself, so a card never downloads a full-size original while a thumbnail signs and
  loads. A thumbnail that cannot be signed (its object is gone) is replaced by the image file in a second signing call, once that file
  signs; one that signs but fails to load is signed again once, then replaced by the file; after that it is left alone, and the choice
  is remembered until the account changes. A card that ends up with nothing to show reads its file list again on the next render.
  The `<img>` is `loading="lazy"` (the studio's 68 px covers too; only the lead picture of the atelier page is eager) and receives its
  signed `src` once known, so only covers near the screen are fetched; the blurred preview (or editorial preset) stays until the cover
  has loaded. Load and error listeners are attached once per cover, including covers drawn from a cached link. The page keeps a cover
  link for 4 minutes; the api hands out a link only until 5 minutes before its hour is up, so a link is never used past 59 minutes.
  Locked media posts show the blurred public preview and are never hydrated.
- Reader: images as a vertical gallery of the originals (lazy, alt text) and video with native controls (`preload="metadata"`,
  `playsinline`, poster, accessible name "<title>, video"; the editor's preview player is named too). The file list is read again on
  every open, so files added or removed since a card was drawn show up. Locked: blurred preview + lock card, and no media request at
  all. If the media cannot be loaded the caption is still shown, with a retry note. Closing the dialog, another dialog taking its place or
  an account change pauses and unloads any video, so nothing plays on unseen. Appreciating or saving only repaints the action buttons
  (`syncReaderActions`): the dialog is not rebuilt, so a film keeps playing and the gallery is not decoded again.
- Discover: a type filter (All types / Text / Images / Video; the select is labelled "Filter by type"). "Clear search" on the empty result
  resets the search, the category and the type filter. The published entries are sorted once per render and creators are matched
  against a set of authors, instead of scanning the entries again for every creator.
- Account changes. On sign-out, or when another account signs in (a second tab, say), the open dialog and the editor go (an upload in
  progress is aborted) and the caches of captions, file lists, cover links and rejected thumbnails, the search and filters and the studio
  state are cleared. Answers still on their way for the previous account (the initial load, the reload after a write, the member list,
  file lists, signed links) are dropped by `epoch`, so they can never replace the new account's data.
- Every user-provided string that reaches HTML (titles, captions, alt text, file names, URLs) goes
  through `esc()`.
