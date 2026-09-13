# YouTube Exercise Demonstrations — Proposed Design

Issue: #390

## Recommendation

Store one nullable, canonical YouTube video URL on each `exercises` row and
render it only on the exercise-detail screen. The detail screen initially shows
a native “Watch demonstration” control; tapping it mounts a small, inline
YouTube `iframe` in an Expo DOM component. This is deliberately user initiated:
merely opening an exercise does not contact YouTube. The app stores only the
validated URL, never a thumbnail, player response, or video bytes.

Use Expo SDK 57's built-in DOM component support rather than adding
`react-native-webview`. The app already runs Expo 57 and DOM components use the
SDK's webview runtime without another dependency. The native detail screen,
navigation, field, and error copy remain React Native; the player is the one
small web island that requires an iframe.

```
AI draft (new exercise only) ──> validator ──> exercises.youtube_demo_url
                                                    │
manual edit ──> YouTube URL parser ────────────────┤
                                                    └─> exercise details only
                                                          └─ tap ─> inline iframe
```

## Data and write rules

Schema v11 adds nullable `exercises.youtube_demo_url`, with a v10-to-v11
`addColumns` migration. Existing exercises remain intact and read `null` until
the user provides a URL; there is no background backfill or resolver.

`parseYouTubeDemoUrl(value)` is a pure boundary. It trims and accepts only a
single video identity from HTTPS `youtube.com/watch?v=…`, `youtu.be/…`,
`youtube.com/embed/…`, or `youtube.com/shorts/…` URLs. It rejects HTTP, bare
text, playlist-only links, query/search URLs, non-YouTube hosts, credentials,
and IDs outside YouTube's 11-character video-ID alphabet. It returns the
canonical watch URL `https://www.youtube.com/watch?v=<id>` or `null`.

`updateExerciseYouTubeDemoUrl` calls that parser, persists either the canonical
URL or `null` for blank input, and updates no other exercise field. The AI
draft adds an optional `youtubeDemoUrl` to `DraftExercise`; its schema,
validator, and persona instructions stay in lockstep. `acceptDraft` passes it
only through the existing create-only exercise path. Re-accepting a draft for
an existing global exercise must never overwrite a user-selected URL.

## Inline player and privacy

The player derives a YouTube `videoId` from the stored canonical URL and renders
only `https://www.youtube-nocookie.com/embed/<id>?playsinline=1&rel=0` after an
explicit tap. The iframe has a fixed 16:9 frame, `loading="lazy"`, no autoplay,
and a restrictive sandbox (`allow-scripts allow-same-origin
allow-presentation`) so it cannot navigate the app's top-level document or
open pop-ups. The DOM component receives only the `videoId`, not the database
model or settings. It has no native callback and no cache or download path.

If loading/playback fails, the frame's compact message tells the user to update
the URL; the saved field remains unchanged. With no network, the screen keeps
the native control and displays a clear offline/error state after a tap. The
video must not appear in the session, routines, history, exports, engine state,
or AI prompt context.

## UI direction

Place the player immediately beneath the exercise photo and above the editable
fields. It is a practical training reference, not another hero competing with
the image: a quiet full-width 16:9 rectangle, sentence-case “Watch
demonstration” control before first load, and “YouTube demonstration” label
above the editable field. The field accepts a paste, preserves the app's
existing compact form styling, and shows specific URL errors. This keeps video
discovery and correction together while keeping all other screens unchanged.

## Alternatives considered

1. **Recommended — Expo DOM iframe after an explicit tap.** No new dependency,
   native detail screen remains native, and the no-cookie embed plus sandbox
   constrain third-party content. Tradeoff: YouTube iframe behavior must be
   human-tested on iOS and Android.
2. **`react-native-webview` player.** Provides native navigation callbacks but
   introduces a native dependency, regeneration, and a custom-build/release
   verification burden for one iframe. It is only justified if DOM-component
   playback is unsuitable in device QA.
3. **`expo-web-browser`.** Already installed, but opens SFSafariViewController
   / Custom Tabs rather than rendering in the detail screen, so it fails the
   inline-only requirement.

## Unresolved product decision

The installed Anthropic/OpenAI clients make text-only requests and have no
YouTube search or browsing tool. They can produce a syntactically valid URL but
cannot truthfully establish that it is the *most popular* real demonstration.

Choose one before implementation:

1. Treat “most popular” as **best effort**: the model proposes a canonical URL;
   the app validates its shape and the user can correct unavailable/wrong videos.
   This is the smallest implementation and needs no new secret or service.
2. Require a **verified popularity result**: add a server-side YouTube Data API
   search/ranking integration and credentials. This introduces an external API,
   key custody, quota/error policy, terms review, and a distinct data-fetching
   architecture.

The recommendation proceeds only with option 1. Option 2 materially changes
the implementation and should be its own design/review before code.

## Test plan (TDD order)

1. Add failing pure tests for URL parsing: accepted canonical variants,
   normalization, and rejected hosts/schemes/IDs.
2. Add failing repository tests for create-only AI population, manual update,
   whitespace clearing, and preservation of existing user URLs.
3. Add failing schema/migration tests that prove a populated v10 database
   upgrades to v11 without a reset, with the new field null on old rows.
4. Add failing draft-schema/prompt tests proving the optional field is validated
   and requested while malformed AI URLs are rejected.
5. Add a structural detail-screen test for detail-only mounting, explicit tap,
   `youtube-nocookie.com` embed construction, 16:9 bounds, and no cache/file
   imports. Follow with device QA for portrait/landscape playback, unavailable
   videos, offline mode, keyboard field visibility, and iOS/Android back-stack
   behavior.
