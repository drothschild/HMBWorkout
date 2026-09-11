> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## HealthKit (`src/health`)

Write-only. All HealthKit errors are logged and swallowed — a Health failure must
never affect DB state. Dependencies are injected (`HealthKitSaveDeps`) so the
save path is testable in the node jest project.

[Back to reference index](README.md)
