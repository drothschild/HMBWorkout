# Persistence

Last verified: 2026-09-10 (instruction organization).

## Purpose

Preserve on-device data and performed exercise identity across routine changes.

## Contracts and dependencies

- Before schema, migration or adapter changes, read the migration contracts. [database](../../docs/project-context/database.md).
- Before repository writes or history reads, read identity stamping, routine row and prescription contracts. [boundaries](../../docs/project-context/boundaries.md).
- For exercise image columns, writes or observers, read the image contracts. [exercise-images](../../docs/project-context/exercise-images.md).

Read only the references relevant to the change; the detailed files preserve the
contract rationale and verification history. Update those files when contracts change.
