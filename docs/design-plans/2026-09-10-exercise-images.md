# Exercise Images Design

## Summary
<!-- TO BE GENERATED after body is written -->

## Definition of Done

Board issue #335.

- **Every exercise gets one image, chosen automatically from free-exercise-db**
  (public domain, ~876 exercises, nearly all with photos). When an AI key is
  configured, the AI picks the best entry for the exercise's title from a
  shortlist; installs with no AI key use a code-only name match; no acceptable
  match leaves a placeholder. The AI never supplies a free-form image URL.
- **Fetched in the background when an exercise is created** — coach draft,
  markdown import, Hevy import, Replace — and retried on first view if that
  attempt failed. Exercises already in the database are backfilled once after
  the update ships.
- **The image file is stored on-device permanently and displays offline.** It
  appears on the exercise detail screen, the session screen, as thumbnails on
  the routine detail rows, and as a thumbnail strip on each Routines tab card.
- **The image belongs to the exercise record**, so a Replace swap shows the new
  exercise's image with no extra logic. The exercise detail screen offers a
  paste-an-image-URL override.
- **Out of scope:** an exercise rename feature (none exists; the exercise id is
  `slugifyTitle(title)`, so a new title is a new exercise), images in the
  markdown export, image licensing. The session engine is untouched — images are
  display data only.

## Acceptance Criteria
<!-- TO BE GENERATED and validated before glossary -->

## Glossary
<!-- TO BE GENERATED after body is written -->
