# Exercise Library Search Design

## Goal

Issue #370 adds a search field at the top of the Exercises tab so a person can
quickly narrow the on-device exercise catalog. Search is local, immediate, and
limited to exercise titles. Matching is case-insensitive substring matching;
leading and trailing whitespace does not change the result. Clearing the field
restores the full alphabetized list.

## Approach

The screen already loads the full, presenter-shaped catalog once on focus. The
recommended approach keeps that fetch unchanged and derives a filtered array in
memory from the current query. This avoids database traffic on each keystroke,
preserves the presenter's ordering, and is appropriate for the bounded catalog.
Filtering in the database would add asynchronous cancellation and repeated
queries without improving this use case. Filtering inside the existing database
presenter would couple a reusable read model to transient screen state.

The screen renders a controlled React Native `TextInput` above its `FlatList`.
`@expo/ui`'s `List` is not suitable because the catalog requires virtualization,
and its universal component set does not provide a search-bar control that
improves on the existing themed input pattern. The input uses the current theme,
an explicit accessibility label, search keyboard behavior, and a clear button.
When a non-empty query has no matches, the screen distinguishes that state from
an actually empty exercise library.

## Verification

A pure filter function covers empty, whitespace, case-insensitive, substring,
and no-match behavior. A structural screen test pins the controlled input above
the list, verifies the filtered data reaches the `FlatList`, and preserves row
navigation. Mutation checks replace case-insensitive matching, remove trimming,
and bypass the filtered list; each relevant focused test must fail. Because the
change affects layout, the PR remains draft behind the existing human-interaction
gate. An exact-head signed Release artifact with embedded JavaScript will be
prepared for physical-device QA but not installed.
