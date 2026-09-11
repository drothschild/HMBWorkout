# Router screens

Last verified: 2026-09-10 (instruction organization).

## Purpose

Screens render presenter data and dispatch intent while preserving shell and engine boundaries.

## Contracts and dependencies

- Before screen changes, read layout verification and structural-test limitations. [testing](../../docs/project-context/testing.md).
- For session forms, routine lists, prefill or identity, read the shared contracts. [boundaries](../../docs/project-context/boundaries.md).
- For exercise images, session layout, keyboard handling or observers, read the image guide. [exercise-images](../../docs/project-context/exercise-images.md).
- For coach or provider screens, read the settings, autosave and prompt contracts. [ai-coach](../../docs/project-context/ai-coach.md).
- For Settings data import/export, read the result and failure-reporting contracts. [interop](../../docs/project-context/interop.md).

Read only the references relevant to the change; the detailed files preserve the
contract rationale and verification history. Update those files when contracts change.
