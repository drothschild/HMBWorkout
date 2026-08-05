# Coach Onboarding Implementation Plan — Phase 2: Widened settings-proposal contract

**Goal:** Extend the `SettingsProposal` type and `AI_TURN_SCHEMA` to include three new profile fields alongside the existing three (goals, equipment, personality), with full validation on both receipt and before write.

**Architecture:** Widen the existing `SettingsProposal` interface from 3 optional fields to 6, add the three new properties to the JSON schema, and update validators to apply the same constraints (non-empty, length-bounded, string-typed) to all six fields.

**Tech Stack:** TypeScript, Jest (node project, ts-jest).

**Scope:** Phase 2 of 7 from `docs/design-plans/2026-08-05-coach-onboarding.md`.

**Codebase verified:** 2026-08-05.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-onboarding.AC2: Widened settings-proposal contract
- **coach-onboarding.AC2.1 Success:** A proposal carrying only `age`, `gender`, or `experience` validates and round-trips
- **coach-onboarding.AC2.2 Success:** `expectStructuredOutputSafe(AI_TURN_SCHEMA)` passes with the three new properties present
- **coach-onboarding.AC2.3 Failure:** A proposal whose new field is empty string, whitespace, non-string, or exceeds `SETTINGS_FIELD_MAX_LENGTH` is rejected with `DraftValidationError`
- **coach-onboarding.AC2.4 Edge:** A proposal with all six fields undefined is rejected as empty, `parseAiTurn` still drops it before validation

---

<!-- START_TASK_1 -->
### Task 1: Extend SettingsProposal type and AI_TURN_SCHEMA

**Verifies:** coach-onboarding.AC2.1, coach-onboarding.AC2.2

**Files:**
- Modify: `src/ai/draftSchema.ts` (interface at lines 14-18, schema at lines 94-104)

**Implementation:**

Extend the `SettingsProposal` interface to add three new optional fields:

```typescript
export interface SettingsProposal {
  goals?: string;
  equipment?: string;
  personality?: string;
  age?: string;
  gender?: string;
  experience?: string;
}
```

Extend the `AI_TURN_SCHEMA.settingsProposal.properties` object to add the three new fields. Each new property has the same structure as goals/equipment/personality:

```typescript
settingsProposal: {
  type: 'object',
  description:
    'Include only when the user asked to change their training goals, available equipment, coaching style, or profile information. At least one field is required',
  properties: {
    goals: { type: 'string' },
    equipment: { type: 'string' },
    personality: { type: 'string' },
    age: { type: 'string' },
    gender: { type: 'string' },
    experience: { type: 'string' },
  },
  additionalProperties: false,
},
```

The schema itself does not include bounds (minLength, maxLength, pattern) — only the validators do.

**Verification:**

Run: `npx jest src/ai/draftSchema.ts --testNamePattern="structuredOutputSafe"`
Expected: The `expectStructuredOutputSafe(AI_TURN_SCHEMA)` test passes (existing test must still pass with the widened schema).

**Commit:**

```bash
git add src/ai/draftSchema.ts
git commit -m "refactor(schema): widen SettingsProposal to include profile fields

Add age, gender, experience as optional fields to SettingsProposal
and AI_TURN_SCHEMA.settingsProposal. Keeps same structure as existing
goals/equipment/personality fields. No bounds in schema; validators
enforce constraints.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Extend validateSettingsProposal to cover new fields

**Verifies:** coach-onboarding.AC2.1, coach-onboarding.AC2.3, coach-onboarding.AC2.4

**Files:**
- Modify: `src/ai/draftSchema.ts` (validateSettingsProposal function, around line 190)
- Test: `src/ai/draftSchema.test.ts` (extend existing suite)

**Implementation:**

The `validateSettingsProposal` function (lines 190-224 in current codebase) iterates over `['goals', 'equipment', 'personality']` and validates each. Extend this to iterate over all six proposal fields:

```typescript
const SETTINGS_PROPOSAL_FIELDS = ['goals', 'equipment', 'personality', 'age', 'gender', 'experience'] as const;

export function validateSettingsProposal(value: unknown): SettingsProposal {
  if (!value || typeof value !== 'object') {
    throw new DraftValidationError('settingsProposal must be an object');
  }

  const obj = value as Record<string, unknown>;

  for (const field of SETTINGS_PROPOSAL_FIELDS) {
    if (obj[field] !== undefined) {
      if (typeof obj[field] !== 'string') {
        throw new DraftValidationError(`${field} must be a string`);
      }

      const str = (obj[field] as string).trim();
      if (str === '') {
        throw new DraftValidationError(`${field} cannot be empty or whitespace-only`);
      }

      if (str.length > SETTINGS_FIELD_MAX_LENGTH) {
        throw new DraftValidationError(
          `${field} exceeds maximum length of ${SETTINGS_FIELD_MAX_LENGTH} characters`
        );
      }
    }
  }

  if (isEmptyProposal(obj as SettingsProposal)) {
    throw new DraftValidationError('settingsProposal must include at least one field');
  }

  return obj as SettingsProposal;
}
```

Update `isEmptyProposal` to check all six fields:

```typescript
export function isEmptyProposal(proposal: SettingsProposal): boolean {
  return !(
    proposal.goals ||
    proposal.equipment ||
    proposal.personality ||
    proposal.age ||
    proposal.gender ||
    proposal.experience
  );
}
```

**Testing:**

Write tests in `src/ai/draftSchema.test.ts` verifying:

- **AC2.1:** A proposal with only `{ age: '41' }` validates and round-trips without error. Same for gender, experience fields individually.
- **AC2.3 (empty string):** A proposal `{ age: '' }` is rejected. A proposal `{ age: '  ' }` (whitespace) is rejected. A proposal with a non-string field (e.g., `{ age: 123 }`) is rejected. A proposal where age exceeds `SETTINGS_FIELD_MAX_LENGTH` is rejected.
- **AC2.4 (all undefined):** A proposal `{ goals: undefined, equipment: undefined, personality: undefined, age: undefined, gender: undefined, experience: undefined }` is rejected as empty.

**Verification:**

Run: `npx jest src/ai/draftSchema.test.ts`
Expected: All tests pass.

**Commit:**

```bash
git add src/ai/draftSchema.ts src/ai/draftSchema.test.ts
git commit -m "feat(schema): validate all six settings fields

Extend validateSettingsProposal and isEmptyProposal to handle the three
new profile fields (age, gender, experience) with the same
validation rules as existing fields: non-empty, string type, length
bounded. An all-undefined proposal is still rejected as empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_2 -->
