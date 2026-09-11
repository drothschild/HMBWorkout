# HealthKit export

Last verified: 2026-09-10 (instruction organization).

## Purpose

Export workouts without allowing HealthKit failure to affect persisted workout data.

## Contracts and dependencies

- Before HealthKit changes, read the write-only and injected-dependency contract. [health](../../docs/project-context/health.md).
- For completion effects, read the CompleteSession versus DiscardSession contract. [engine](../../docs/project-context/engine.md).

Read only the references relevant to the change; the detailed files preserve the
contract rationale and verification history. Update those files when contracts change.
