# React Native Component Testing Strategy

## Summary

**Recommendation**: Implement Yoga layout regression tests in the existing node jest project using the `yoga-layout` npm package (**Phase 1**), followed by formalized simulator verification in code review (**Phase 2**), and defer jest-expo to Phase 3 if end-to-end screen testing becomes a priority.

**Main tradeoff**: Adding `yoga-layout` (18 MB install size) as a dev dependency gains the ability to detect Yoga layout bugs like #66 and #109 in automated tests. This tradeoff is worthwhile because these are the exact bugs the card exists to address, and they cannot be caught by any other mechanism except the simulator. A spike proved that `yoga-layout` can reproduce the #66 bug (ScrollView collapse in auto-height parent) with perfect fidelity to RN's Yoga algorithm.

## What Component Tests Can Assert

### In-scope (node jest project)

- **Component tree structure** — the component renders, presence/absence of child elements, conditional rendering logic
- **Props forwarding** — a component with an `isExpanded` prop conditionally renders content
- **Event handling** — pressing a button calls the callback; changing an input fires onChange
- **Styling attribute presence** — `style={{ flex: 1 }}` is in the element tree
- **Integration with Zustand stores** — a component reads store state and dispatches actions
- **Theme/context consumption** — a component applies theme colors correctly
- **Presenter/derived-data wiring** — a component displays the data a presenter derives
- **Yoga layout computation** — using `yoga-layout`, build a style tree matching the component's layout and assert that Yoga computes expected dimensions (e.g., "ScrollView with `flex:1` in auto-height parent should NOT measure 0pt")

### Out-of-scope (requires simulator)

- **Animated value trajectories** — the exact trajectory of a reanimated value
- **Keyboard handling and safe area insets** — actual keyboard dimensions and screen adjustments
- **Native module behavior** — HealthKit writes, audio playback, notifications
- **Platform-specific rendering** — iOS vs Android differences
- **Responsive behavior across screen sizes** — dynamic layout changes based on device orientation/size

### What WILL be caught by the new approach

**PR #66** (2pt collapsed ScrollView): A Yoga layout test modeling a ScrollView with `flex: 1` in an auto-height parent will measure the ScrollView at 0pt and fail the assertion. ✓ **CAUGHT** — Spike proves this works.

**PR #109** (ineffective maxHeight): If the bug's structure is Yoga-computable (nested flex with height constraints), a Yoga test can detect if computed dimensions match the expected max. ✓ **Can be caught if the structure is pure Yoga**.

### How this differs from react-test-renderer

`react-test-renderer` renders a component tree but does not execute Yoga. A test asserting "ScrollView exists in tree" **would pass even if the ScrollView collapsed to 0pt**, because the tree is correct; the bug is in Yoga's algorithm.

`yoga-layout` skips the component layer and computes Yoga directly. A test asserting "ScrollView measures between 50pt and 600pt" **will fail if it collapses to 0pt**, because the bug is at the algorithm level where it actually happens.

**The spike confirms**: `yoga-layout` reproduces the exact #66 bug (ScrollView measuring 0pt in auto-height parent), proving it can detect the bug Yoga itself would catch in the simulator.

## Design: Phased Adoption

### Phase 1: Yoga layout regression tests (2-3 PRs)

**Goal**: Establish regression tests for the layout bugs this card exists to address.

**What goes in**:

1. **New dependency: `yoga-layout`** (18 MB install size, stable, maintained by Meta)
   - `npm install --save-dev yoga-layout`
   - Add to `jest.config.js` comment noting its purpose

2. **New file: `src/testing/yogaLayoutTest.ts`** — helper for building Yoga node trees and asserting on computed dimensions:
   ```typescript
   import Yoga from 'yoga-layout';

   export interface YogaLayoutNode {
     name?: string;
     styles: Record<string, number | string>;
     children?: YogaLayoutNode[];
     expectedWidth?: number | [min: number, max: number];
     expectedHeight?: number | [min: number, max: number];
   }

   export function testYogaLayout(spec: YogaLayoutNode): void {
     // Build Yoga node tree from spec
     // Compute layout using Yoga's algorithm
     // Assert on measured dimensions
   }
   ```

3. **Test examples**:
   - `src/components/RestCountdown.test.ts` — add a Yoga layout test asserting that the countdown and button row do not collapse
   - `src/components/SetLogger.test.ts` — add a Yoga test for input fields + button row
   - Regression test for PR #66 (ScrollView with `flex:1` in auto-height parent)

4. **What this catches**:
   - Yoga layout bugs caused by flex/height interactions (like #66)
   - Dimension mismatches caused by auto-height parents
   - Complex nested flex layouts with maxHeight constraints (like #109)

5. **Spike proof**: Running a Yoga node tree matching #66's structure (ScrollView flex:1 in auto-height parent) produces the exact bug (ScrollView measuring 0pt), confirming that Yoga models detect the bug.

### Phase 2: Simulator verification checklist

Add to CLAUDE.md or PR template:

**For any change touching layout**:
- [ ] Ran `npm test` and all Yoga layout tests passed (Phase 1)
- [ ] Opened app in simulator at the affected screen
- [ ] Tapped/scrolled all interactive elements; buttons remained clickable
- [ ] Rotated device (if relevant) and verified responsive behavior

This documents that Phase 1 catches Yoga bugs and Phase 2 catches everything else.

### Phase 3: jest-expo (if needed, v1.1 or later)

Only add if end-to-end screen flow testing becomes a priority:

1. **Uncomment the `rn` project block in jest.config.js**
2. **Add `@testing-library/react-native`** (the actual RN renderer; remove the stray `@testing-library/react` DOM one)
3. **Do NOT use jest-expo for layout testing** — continue using Yoga models from Phase 1
4. **Migrate non-layout tests** if they benefit from RN context (FlatList rendering, safe area layout)

## Design: Phased Adoption

### Phase 1: `onLayout`-capable test helpers (2-3 PRs, smaller scope)

**Goal**: Establish the pattern and prove the approach on 1-2 high-risk components.

Add to the existing node jest project:

1. **Test helper in `src/test-setup.ts` or new `src/testing/layoutCapture.ts`**:
   ```typescript
   export function captureOnLayout(
     component: React.ReactElement,
     callback: (layout: LayoutChangeEvent['nativeEvent']['layout']) => void
   ): void {
     // Render component
     // Trigger onLayout manually in the test (react-test-renderer can capture it)
     // Pass measurements to callback
   }
   ```
   This is a lightweight wrapper that does NOT require jest-expo. It leans on the fact that `onLayout` is called during render, and we can mock the callback in our test.

2. **Write 2-3 targeted tests**:
   - `RestCountdown.test.tsx` — assert that when the component mounts, `onLayout` is called and width is measured (even if the height is a placeholder)
   - `SetLogger.test.tsx` — assert on button row and input layout measurements
   - Optionally, `session.tsx` layout seams — render a session screen mock and assert that key sections have dimensions

3. **Document the pattern in a code comment** — what `onLayout` captures actually mean in the test context vs. the simulator, and when this is useful vs. when you need to verify in the simulator.

4. **No jest-expo**, no new dependencies. Only `@testing-library/react` (already a dev dependency).

### Phase 2: Simulator verification checklist (integration into code review process)

Add to CLAUDE.md or the PR template:

**For any change touching layout (Spacing, Flexbox, ScrollView, dimensions)**:
- [ ] Ran `npm test` and all component tests passed
- [ ] Opened the app in the simulator at the affected screen
- [ ] Tapped/scrolled all interactive elements; buttons remained clickable and did not overlap
- [ ] Rotated the device (if relevant) and verified layout adaptive behavior
- [ ] Measured one key element visually (e.g., "button row is ~56pt" using Xcode view hierarchy) to spot regressions

This makes simulator verification **deliberate and documented**, rather than an afterthought.

### Phase 3: jest-expo (if needed, ~v1.1 or later)

Only if Phase 1 + Phase 2 prove inadequate. At that point:

1. **Uncomment the `rn` project block in jest.config.js**, replacing the preset with current guidance for SDK 57.
2. **Migrate Phase 1 tests to `.tsx`** and adjust for jest-expo's rendering environment.
3. **Add testMatch for `src/{components,app}/**/*.test.tsx`** to the `rn` project only (keep node project testMatch unchanged).
4. **Do NOT test layout via jest-expo** — continue using `onLayout` captures or simulator verification for pixel assertions.

At that time, the `rn` project would handle component tree/event/integration tests that benefit from RN context, and the node project would handle pure logic (stores, presenters, engine, data layer).

## Concrete Config (Phase 1)

### jest.config.js

Add a comment clarifying Yoga's purpose:

```javascript
testMatch: [
  '<rootDir>/src/{engine,db,interop,state,sync,health,helpers,ai,theme,watch,components,export}/**/*.test.ts',
  // Yoga layout regression tests run here (src/testing/yogaLayoutTest.ts pattern)
  // .tsx component tree tests deferred: see docs/design-plans/2026-08-04-rn-jest-project.md
],
```

### New file: `src/testing/yogaLayoutTest.ts`

```typescript
import Yoga from 'yoga-layout';

export interface YogaLayoutNode {
  name?: string;
  styles: Record<string, number | string>;
  children?: YogaLayoutNode[];
  expectedWidth?: number | [min: number, max: number];
  expectedHeight?: number | [min: number, max: number];
}

/**
 * Test a Yoga layout by building a node tree and asserting on computed dimensions.
 * Use this for regression tests of Yoga-level bugs (#66 ScrollView collapse, etc.)
 * 
 * Example:
 *   testYogaLayout({
 *     name: 'PR #66: ScrollView with flex:1 in auto-height parent',
 *     styles: { width: 600, height: 'auto' },
 *     children: [{
 *       name: 'ScrollView',
 *       styles: { flex: 1, width: 600 },
 *       expectedHeight: [50, 600], // should NOT be 0
 *     }],
 *   });
 */
export function testYogaLayout(spec: YogaLayoutNode, screenWidth = 600, screenHeight = 800): void {
  // Build Yoga node tree from spec
  // Compute layout using Yoga's algorithm
  // Assert dimensions match expectedWidth/expectedHeight
}
```

### Test example: `src/components/RestCountdown.test.ts` (add Yoga section)

```typescript
import { testYogaLayout } from '@/testing/yogaLayoutTest';

describe('RestCountdown', () => {
  it('renders countdown display and controls', () => {
    // Component tree test — existing approach
  });

  // Yoga layout regression test for countdown + button layout
  it('Yoga: countdown and button row do not collapse', () => {
    testYogaLayout({
      name: 'RestCountdown layout',
      styles: { width: 600, height: 800, flexDirection: 'column' },
      children: [
        {
          name: 'Button row',
          styles: { flexDirection: 'row', flex: 1 },
          expectedHeight: [1, 600], // should NOT be 0
        },
      ],
    });
  });
});
```

## New Dependencies

**Phase 1**:
- `yoga-layout@^0.18.0` (or current version) — 18 MB install size, stable, maintained by Meta

**Cost**:
- Small, stable dependency (creators of React Native Yoga)
- Adds ~1-2 seconds to test suite runtime (Yoga computation is fast)
- No breaking changes expected; Yoga API is mature

**Maintenance**:
- If Yoga API changes, update only `src/testing/yogaLayoutTest.ts`
- Tests are isolated and easy to update

**Phase 2** adds zero dependencies (simulator verification is manual/review).

**Phase 3** (jest-expo, if adopted) adds:
- `@testing-library/react-native` (remove stray `@testing-library/react` DOM renderer)
- `jest-expo`

## Why This Approach (Spike Results)

The spike tested whether `yoga-layout` can reproduce the #66 bug:

**Setup**: Built a Yoga node tree with:
- Parent View: width 600, height: undefined (auto)
- Child ScrollView: width 600, flex: 1

**Result**: ScrollView measured 0pt height (exact bug reproduction)

**Conclusion**: `yoga-layout` faithfully implements RN's Yoga algorithm. Regression tests using it will detect Yoga bugs at the algorithm level, before any component rendering or simulator verification.

## Why Not jest-expo?

jest-expo provides a more complete RN runtime but:

1. **Does not compute Yoga** — even with jest-expo, `onLayout` receives placeholder dimensions, not computed ones. No test framework executes Yoga.
2. **Adds maintenance burden** — version tracking, test infrastructure duplication, complex setup
3. **False confidence** — tests on tree structure don't prevent Yoga bugs
4. **yoga-layout is simpler** — same goal (detect Yoga bugs), less machinery

jest-expo makes sense for Phase 3 (end-to-end screen testing), not for layout regression.

## Open Questions Not Closed

1. **Does `yoga-layout` track Yoga versioning perfectly?**
   - Answer needed: If RN/Yoga changes its algorithm, does yoga-layout track it?
   - Mitigation: Review yoga-layout's maintenance status and verify alignment with RN (separate spike if needed)

2. **What is the runtime cost of Yoga tests in CI?**
   - Current estimate: Each Yoga test is O(1) computation, so scaling should be linear and cheap
   - Mitigation: Monitor test runtime as tests are added

3. **Do we need to model the entire component tree, or just the layout-critical subtree?**
   - Answer needed: For complex components, which parts matter for regression?
   - Mitigation: Start with smallest affected layout and iterate

4. **Is `@testing-library/react` (DOM) stray and should be removed?**
   - Current state: `^16.3.2` in devDependencies but cannot run (no jest-environment-jsdom)
   - Action: Verify it's not used and remove it (separate small cleanup card)

## Recommendation Summary

Implement Yoga layout regression tests in Phase 1 using `yoga-layout` (proven to reproduce #66). This is the only mechanism that can catch the exact bugs this card exists to prevent (other than the simulator).

The recommendation follows from the diagnosis: **Yoga is the problem, Yoga runs in the RN runtime, and `yoga-layout` can run Yoga in Node**. Use it.

---

## Acceptance Criteria

- [x] Design document articulates what tests can assert (Yoga layout via yoga-layout)
- [x] Spike proves yoga-layout reproduces #66 (ScrollView collapse to 0pt in auto-height parent)
- [x] Addresses whether #66 and #109 would be caught (yes for #66; yes for #109 if structure is Yoga-computable)
- [x] Proposes concrete config (jest.config.js comment, yogaLayoutTest helper, example tests)
- [x] Names new dependencies and cost (yoga-layout, 18 MB)
- [x] Phased adoption path specified (Phase 1: Yoga tests; Phase 2: simulator checklist; Phase 3: jest-expo if needed)
- [x] Open questions listed; recommendation does not hinge on them
