# Exercise Detail History Design

## Goal

Show an exercise's logged history on its detail screen. History includes every
set type performed in completed workouts, grouped by workout and ordered with
the newest workout first.

## Read model

The repository exposes an all-set exercise identity query alongside the
existing working-set-only progression query. Both preserve the established
identity rule: a set's stamped `exercise_id` wins, while an unstamped legacy set
falls back through its `routine_exercises` row.

The presenter joins those sets to completed sessions, drops sets from active
sessions, groups by session, sorts workouts by `ended_at` descending, sorts
sets within a workout by logged position, and formats metrics through the
shared set formatter. Warmups and non-warmups use independent display counters.

## Screen behavior

The existing exercise-detail ScrollView gains a History section beneath the
editable fields. It refreshes whenever the screen gains focus and shows
loading, empty, error, or grouped-history content. A stale-result guard prevents
an older asynchronous request from overwriting a newer exercise's history.

## Scope and risks

This intentionally renders the complete local history in the existing
ScrollView; pagination or virtualization is deferred until measured data shows
it is necessary. The layout must remain behind human QA, with a signed
standalone Release artifact prepared from the exact reviewed commit.
