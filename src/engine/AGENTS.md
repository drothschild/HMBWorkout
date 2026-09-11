# Session engine

Last verified: 2026-09-10 (instruction organization).

## Purpose

The pure Rill core owns session flow; the host translates values and executes effects.

## Contracts and dependencies

- Before changing rules, state conversion, effects, rest or rehydrate, read the engine contracts and numbered conventions. [engine](../../docs/project-context/engine.md).
- For supersets, entry identity, prescribed loads or zero-set behavior, read the cross-domain boundaries. [boundaries](../../docs/project-context/boundaries.md).

Read only the references relevant to the change; the detailed files preserve the
contract rationale and verification history. Update those files when contracts change.
