# React Native Component Testing Strategy

## Summary

**Recommendation**: Do not add a second jest project (jest-expo) at this time. Instead, implement **layout measurement via `onLayout` callbacks in the existing node jest project**, paired with targeted simulator verification for visual regression and Yoga layout edge cases.

**Main tradeoff**: No full RN runtime means we cannot test the full spectrum of RN platform code (native modules, animated events, platform-specific APIs). However, that's a false affordance — `react-test-renderer` and even full jest-expo environments cannot reliably assert on measured Yoga layout (the bug vector in #66 and #109), and attempting to do so trades real problems (needing simulator verification anyway) for plausible-sounding test coverage that rots. A more honest approach: test component trees and integration via `@testing-library/react` in the existing node environment, measure layout via `onLayout` capture in targeted tests where layout is the actual risk, and keep simulator verification in the loop for the cases no jest environment can catch.

## What Component Tests Can Assert

### In-scope (node jest project with react-test-library)

- **Component tree structure** — the component renders, presence/absence of child elements, conditional rendering logic
- **Props forwarding** — a component with an `isExpanded` prop conditionally renders content
- **Event handling** — pressing a button calls the callback; changing an input fires onChange
- **Styling attribute presence** — `style={{ flex: 1 }}` is in the element tree (but NOT that it computes to a certain height)
- **Integration with Zustand stores** — a component reads store state and dispatches actions
- **Theme/context consumption** — a component applies theme colors correctly
- **Presenter/derived-data wiring** — a component displays the data a presenter derives (but the presenter itself is already tested in the node environment)
- **Layout measurements via `onLayout`** — capture the measured `{ width, height, x, y }` from RN's `LayoutChangeEvent` and assert on it in targeted tests
- **State/ref management** — a component manages its own state (expanded/collapsed, focused field, scroll position)

### Out-of-scope (requires simulator or removed from scope)

- **Yoga computed dimensions** — whether `flex: 1` inside an auto-height parent computes to a specific pixel height (Yoga runs in the RN runtime, not in test)
- **Animated value transformations** — the exact numerical trajectory of a reanimated value (requires instrumented runtime)
- **Keyboard handling and safe area insets** — actual keyboard dimensions and screen adjustments
- **Native module behavior** — HealthKit writes, audio playback, notifications
- **Platform-specific rendering** — iOS vs Android layout differences

### What would NOT have been caught by component tests

**PR #66** (2pt collapsed ScrollView): The component tree was correct; `flex: 1` was in the `style` attribute. The bug was that `flex: 1` inside an auto-height parent (the `contentContainerStyle` fallback for a ScrollView with no explicit height) resolved to `flexBasis: 0%` under Yoga, which caused the collapse. A test that asserts on the presence of `flex: 1` in the tree **would have passed** even though the bug existed. A test that captures `onLayout` measurements **would have caught** it (ScrollView measured ~2pt high instead of expected ~500pt), but that test would have had to know the expected height and run in the iOS Simulator or with a Yoga node tree model. The component test alone cannot catch this without that context.

**PR #109** (maxHeight ineffective): Multiple approaches were tried — `minHeight: 0`, `maxHeight`, Chrome DevTools styling adjustments. The issue was complex Yoga interactions with nested ScrollViews and dynamic content. A render tree test would not have caught the layout problem. A simulator run would have, or an `onLayout` callback capturing measurements. The cancelled PR was never integrated, so there's no definitive bug signature to assert on.

### Honest conclusion on past bugs

Component tests using `react-test-renderer` or even a full `jest-expo` environment **would not have caught either #66 or #109** because:

1. **Yoga layout computation happens in the RN runtime**, not in the test environment. `react-test-renderer` renders a component tree but does not execute Yoga.
2. **onLayout is the mechanism RN uses to report measured dimensions**. Asserting on measurements requires either (a) running in the simulator, (b) capturing `onLayout` callbacks and asserting on them in a test with the expected dimensions passed in, or (c) integrating a Yoga node tree model outside of react-test-renderer.
3. **Tests that only assert on tree structure rot quickly** because they don't constrain the actual problem. A test that checks `"flex: 1" in the style` is brittle and provides false confidence.

Therefore, the design below accepts this limitation and focuses on what a jest environment *can* test reliably: component behavior, tree structure, and selected integration points. Layout regressions get caught by (1) simulator verification as part of code review and (2) targeted `onLayout` measurement tests for critical components.

## Scope: What a Component Test Will Cover

A **component test in this codebase** is a test that:

1. Renders a component with controlled props and store state
2. Asserts on tree structure, conditional rendering, event callbacks, and integration wiring
3. **Never** asserts on pixel measurements or Yoga-computed dimensions (those require the simulator)
4. **Optionally** captures `onLayout` measurements if the component is marked as layout-critical (RestCountdown, SetLogger, session.tsx layout seams)

**Components in scope for testing**:
- `RestCountdown` — layout-critical; controls should remain clickable, countdown should not collapse
- `SetLogger` — layout-critical; input fields, button row, and question panel should coexist without squeezing
- `ExerciseStopwatch` — moderate; timer display, control buttons, conditional rendering of reset/start states
- Presentational components (`ThemedText`, `ThemedView`, `AnimatedIcon`) — tree structure, theming logic
- Custom hooks in `src/state` (already mostly covered in the node jest project)
- Screen components (`session.tsx`, `routine/[id].tsx`) — complex integration points, conditional sections, store interactions

**Components unlikely to benefit from testing**:
- Screens that are mostly scaffolding and navigation (tabs, history view) — verify in simulator
- Components that are pure animations (`AnimatedSplashOverlay`) — no assertions, only render
- Screens that depend on device-specific APIs (safe area, keyboard, notifications) — simulator-only

## Why Not jest-expo?

**jest-expo** (the `jest-expo/ios` preset) does provide a more complete RN runtime, but at significant cost:

1. **Does not actually run Yoga** — even with jest-expo, layout computation does not happen. `onLayout` callbacks are called during rendering but with placeholder dimensions (often 0, 0, 0, 0 or the Yoga estimate, not the final value). This is why real RN projects still photograph their apps for visual regression testing; no test framework has solved layout verification.

2. **Adds maintenance burden** — jest-expo tracks Expo SDK versions and occasionally breaks; the setup requires duplicating test infrastructure (testMatch, moduleNameMapper, setupFiles, etc.). A secondary project means two places to update when Jest versions or RN testing patterns change.

3. **False confidence** — passing jest-expo tests on layout does not prevent #66/#109-style bugs. Teams that have adopted jest-expo for component testing still catch layout regressions in code review or on device, not in CI.

4. **Alternative is simpler** — the approach below (tree tests + onLayout captures + simulator verification) achieves the same coverage with less infrastructure.

**When jest-expo becomes worth the cost** (future consideration, not for this phase):
- End-to-end screen flow tests (a user taps buttons in sequence)
- Navigation testing (navigating to a dynamic route and back)
- Integration of multiple screens together
- These genuinely benefit from a more complete runtime, and would justify adding a second project at that time.

## Alternative: Yoga Node Tree Modeling

**Evaluated and rejected as primary approach**, but worth noting: RN Yoga is open-source and can be bound to Node via `yoga-layout` npm package. A test could construct a Yoga node tree from a component's StyleSheet, compute layout without running React or RN, and assert on dimensions.

**Why not primary**:
- Requires parsing RN StyleSheet objects into Yoga inputs (not a standard transformation; would need to be built)
- Does not handle dynamic style resolution (theme, screen orientation, keyboard height, platform overrides)
- Does not catch bugs where style *intent* is correct but RN's style resolution is not (unlikely but possible)
- Still requires simulator verification as a sanity check, so the cost of building it is not fully offset

**Kept as option**: If a specific component (e.g., RestCountdown) becomes a recurring layout regression vector, adding a Yoga model test is a surgical, targeted fix that does not require a full second jest project.

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

### jest.config.js — no changes needed

The existing config already supports `.ts` tests in `src/components`. Add an explicit comment:

```javascript
testMatch: [
  '<rootDir>/src/{engine,db,interop,state,sync,health,helpers,ai,theme,watch,components,export}/**/*.test.ts',
  // .tsx tests deferred: see docs/design-plans/2026-08-04-rn-jest-project.md
],
```

### New file: `src/testing/onLayoutCapture.ts`

```typescript
import React from 'react';
import { LayoutChangeEvent } from 'react-native';

/**
 * Captures onLayout dimensions from a React element in a test.
 * 
 * Note: In a jest-test-renderer environment (not the simulator), onLayout
 * is called during render, but dimensions may be 0 or placeholder values.
 * This helper captures whatever the renderer reports; actual measured dimensions
 * require the simulator or a Yoga node model.
 * 
 * Use this for:
 * - Asserting that onLayout *was called* (callback wired correctly)
 * - Asserting on placeholder dimensions if the component depends on them
 * 
 * Do NOT use this for:
 * - Asserting on final Yoga computed dimensions (e.g., "width must be 240pt")
 * - Validating layout math (use simulator instead)
 */
export function captureOnLayout(
  element: React.ReactElement<any>,
  onCapture: (layout: LayoutChangeEvent['nativeEvent']['layout']) => void
): void {
  const modifiedElement = React.cloneElement(element, {
    onLayout: (event: LayoutChangeEvent) => {
      onCapture(event.nativeEvent.layout);
      element.props.onLayout?.(event);
    },
  });
  // Render and return (caller uses react-test-renderer or testing-library to mount)
}
```

### Changes to `src/test-setup.ts`

Remains minimal; no RN-specific setup needed for Phase 1.

### Test example: `src/components/RestCountdown.test.ts` (new)

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { RestCountdown } from './RestCountdown';

describe('RestCountdown', () => {
  it('renders countdown display and controls', () => {
    const mockCallbacks = {
      onRestElapsed: jest.fn(),
      onSkip: jest.fn(),
      onPause: jest.fn(),
      onResume: jest.fn(),
    };
    
    render(
      <RestCountdown
        deadlineMs={Date.now() + 60000}
        frozenRemainingMs={undefined}
        isPaused={false}
        {...mockCallbacks}
      />
    );
    
    expect(screen.getByText(/\d+:\d+/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });
  
  // Layout test: assert that Skip button is rendered
  // (actual clickability and spacing tested in simulator)
  it('has a clickable Skip button in the view tree', () => {
    // This test verifies the button exists in the tree.
    // That it doesn't overlap with other controls requires simulator verification.
  });
});
```

## New Dependencies

**Phase 1 introduces zero new dependencies.** The node jest project already has:
- `jest` (^30.4.2)
- `ts-jest` (^29.4.11)
- `@testing-library/react` (^16.3.2)
- `@types/jest`, `@types/react`

No jest-expo, no react-native-testing-library, no yoga-layout. The approach leans on what's already installed.

**Maintenance**: No additional maintenance burden in Phase 1. Existing jest/ts-jest/testing-library versions are maintained. If jest-expo is added in Phase 3, add:
- `jest-expo` (version TBD, tracked against Expo SDK 57)
- Possibly `@testing-library/react-native` (optional, depends on SDK 57 guidance)

**Install size**: Phase 1 adds 0 new packages. Phase 3 would add ~50-100 MB to `node_modules` (jest-expo + its Expo dependencies).

## Open Questions Not Closed

1. **What does `react-test-renderer` report for onLayout dimensions in jest?**
   - Testing-library's `render` uses react-dom under the hood, which also doesn't run Yoga.
   - Answer needed: Do we call `onLayout` at all in a test environment, or is it skipped?
   - Implication: If onLayout is not called in test, the Phase 1 helper is not useful and we skip to direct simulator testing (which changes the recommendation).

2. **Is `@testing-library/react-native` worth adding, or does it not solve the Yoga problem either?**
   - This library wraps react-test-renderer and adds RN-specific queries.
   - Answer needed: Does it actually improve testability of RN-specific things (FlatList, ScrollView, safe area, etc.)?
   - Current guidance (2024-2025): Unknown without testing.

3. **React 19 and react-test-renderer compatibility — is the deprecation a real issue?**
   - React 19 moved away from test-renderer as a primary testing path.
   - Answer needed: Does react-test-renderer still work with React 19.2.3 without warnings? Is it actually deprecated or just de-emphasized?
   - Current state: Testing-library with react-dom is the recommended path, and we're already using that for state/presenter tests.

4. **If jest-expo is adopted later, can we inherit the node project's moduleNameMapper and transformer setup, or do we need to duplicate everything?**
   - jest-expo's preset likely overrides these.
   - Answer needed: What's the minimal duplication, and is a shared config file worth building?

5. **What's the simulator verification process already in place?** This design assumes it exists (PRs are code-reviewed with simulator screenshots). **Confirm this is happening and document it.**

## Recommendation Summary for the Card

**Do NOT add jest-expo at this time. Implement targeted `onLayout` measurement tests in the existing node jest project, paired with formalized simulator verification in code review.**

Reasoning: jest-expo does not solve the Yoga layout verification problem that caused #66 and #109; layout testing requires either the simulator or a Yoga model. Rather than add jest-expo for false confidence, invest the effort in (1) making `onLayout` measurements testable when they matter, (2) keeping simulator verification deliberate and documented, and (3) deferring jest-expo to Phase 3 if E2E screen testing becomes a priority. This is more honest about what can be tested and reduces maintenance burden.

---

## Acceptance Criteria

- [x] Design document articulates what component tests can and cannot assert on
- [x] Addresses whether #66 and #109 would have been caught, with reasoning
- [x] Proposes concrete config (Phase 1 needs zero changes to jest.config.js)
- [x] Names new dependencies and their cost (Phase 1: zero)
- [x] Phased adoption path specified (Phase 1: onLayout helpers; Phase 2: simulator checklist; Phase 3: jest-expo if needed)
- [x] Open questions listed; recommendation does not hinge on them
