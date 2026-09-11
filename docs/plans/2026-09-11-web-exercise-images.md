# Web image fallback for catalog misses (#354)

Keep the bundled exercise catalog first. After a catalog decision misses, search
Bing Images for the normalized exercise title and use the first downloadable,
validated raster image in result order. Try at most five candidates per search.
Use existing file validation, per-row fresh paths and source compare-and-set so
manual overrides win races. Share search results across sided exercise titles.

Revisit old none/none:nokey rows once. Persist distinct web miss markers so a
successful empty search terminates observer passes; retain the key-added retry
for no-key misses. HTTP failures, unexpected search markup and download failures
leave rows untouched for later retry. Protect existing catalog and URL choices.

Bing public HTML is an external format, not a supported API: parse only image
result metadata, bound requests with a timeout, and reject unexpected responses.
No extra API key, backend, native dependency or session-engine changes.

Alternatives considered: an authenticated search API adds setup and credentials;
Openverse searches multiple image sources but the live endpoint returned 502.

Verification: individual Jest tests for ordered extraction, HTTP/markup failures,
resolver backfill, terminality, candidate fallback, shared searches, file cleanup,
and override races. Independent review and mutation checks before release.
Because the feature changes images shown on-device, retain a human QA gate and
prepare a signed standalone Release artifact from the reviewed head.
