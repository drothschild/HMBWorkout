# Workout diary before debrief (#332)

A deterministic local prelude asks for a diary entry, saves it, then offers an
optional front-camera selfie, image-library selection, or Skip. The existing
coaching conversation starts only after both choices are durably recorded.

A prompt-only interview was considered but cannot guarantee ordering or persistence.
Keeping the entry only in chat would lose it when the ephemeral conversation resets.
The chosen local prelude preserves the entry independently of provider availability
and supplies it to the existing debrief context builder when the conversation starts.

Schema v10 adds nullable `sessions.diary_entry`, `selfie_path`, and `debrief_ready`
through a non-destructive migration. A saved diary resumes at the optional-selfie
step after closing or restarting; completed collection proceeds to chat. The diary
is shown in workout history, with a return link for incomplete collection. Once
completed, a second mounted gate cannot overwrite the first gate's data.

Selfies are copied from picker cache into a unique file under the app's documents
folder; the database holds a relative path so container relocation is harmless.
Copy precedes the database write. Failure removes the new copy without touching
existing media; a racing completed gate wins. Selfies and paths never enter coach
requests. The diary is plain text context, before immutable prompt directives.
The user must save the diary explicitly; unsaved typing is not autosaved.

The feature adds expo-image-picker and its image-loader dependency. A new native
build after `LANG=en_US.UTF-8 npx expo prebuild -p ios --clean` is mandatory. No
existing phone installation or main-checkout native project is changed by this PR.

## Required human QA

- Back up an existing v9 install, regenerate/build a separate v10 native binary,
  then verify routines, history, and logged sets survive upgrade.
- Finish a workout with a configured provider. Confirm the first screen asks for
  a diary, no coaching response appears yet, blank Save is disabled, and a long
  multiline entry remains usable with the keyboard and large accessibility text.
- Save a diary, leave, and reopen from workout history. Confirm it resumes at
  the selfie choice and the saved text is visible. Force quit/relaunch there too.
- Take a front-camera selfie, accept it, and confirm normal debrief starts. Repeat
  with image-library selection and with Skip. Deny camera access and cancel each
  picker; retry/choose/skip must remain usable. Test dark mode and a small device.
- Return directly to the already-mounted workout detail: diary and optional image
  must appear immediately. Force quit/relaunch and verify the image still renders
  offline. Skipping must show no image.
- With each configured provider, verify the first generated response uses the
  diary, does not ask for the diary/selfie again, and continues the existing
  full-routine revision/acceptance flow. A network failure must leave diary and
  selfie saved and permit retry. No live provider response is claimed verified.

Node tests cover persistence, races, failure cleanup, migration, prompt construction,
and source wiring. They do not render SwiftUI controls, run native SQLite, launch
camera/library UI, verify permissions, or prove a model follows its prompt. This PR
remains in Require Human Inteteraction until those checks pass.
