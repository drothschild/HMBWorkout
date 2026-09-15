# Manual exercise image search

Approved interaction: always offer Search images in exercise details to open an in-app search screen with editable terms, image thumbnails, and explicit selection. Preserve the current exercise image until a chosen replacement saves successfully.

## Implementation

1. Extend the existing Bing HTML search adapter with a separate manual-search API. Preserve automatic matching and relevance filtering. Return at most 24 distinct HTTPS originals with thumbnail/title/source metadata, bounded query/response size, timeout and cancellation.
2. Add a full-screen search component with initial exercise terms, a two-column results grid, loading/empty/error/content states and cancellation of stale requests. Selecting an image saves once; failure retains results for another selection. Close never changes the image and is disabled while saving.
3. Always offer Search images, including before refresh and after a successful match. Keep it visible but disabled while a photo operation is active. Save a selected URL through the existing validated download/override transaction under the photo-operation lock. Preserve the current image on cancellation or failure.
4. Use test-first commits, focused tests, mutation checks and independent review. Build a new signed standalone Release for renewed human QA; retain the installed prior QA build until replacement is authorized.

## Limits

Bing public HTML is not a supported API. Changed markup and network failures must produce a recoverable search error, not a persisted missing-image decision. Manual choices are explicit URL overrides; automatic relevance filtering remains unchanged. No schema or native dependency changes are needed.
