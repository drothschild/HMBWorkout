# Markdown export

Last verified: 2026-09-10 (instruction organization).

## Purpose

Map database values to the shared serializer and report partial history export failures.

## Contracts and dependencies

- Before export changes, read the serializer, null-normalization and export-failure contracts. [interop](../../docs/project-context/interop.md).
- For history readers, read performed-set identity and orphan handling. [boundaries](../../docs/project-context/boundaries.md).
- Read the export entry for Settings wiring and outcome presentation. [structure](../../docs/project-context/structure.md).

Read only the references relevant to the change; the detailed files preserve the
contract rationale and verification history. Update those files when contracts change.
