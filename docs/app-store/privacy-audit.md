# HMB Workout privacy audit (#399)

Audited against `main` at 7cf57fd on 2026-10-09. Method: searched `src/` for every
network-capable call, read `app.json`, the generated `Info.plist` and
`PrivacyInfo.xcprivacy` of a built app, and the dependency list in `package.json`.
This is an engineering audit to support the policy and the App Privacy label. It is
not legal advice, and the label answers in section 5 are recommendations for the
account holder to confirm.

Items marked **(verify)** were not confirmed by running the app.

## 1. Where data leaves the device

Every destination found in non-test source. The app has **no backend of its own**, no
analytics or crash-reporting SDK (none in `package.json`), no ad SDK, and no push
registration (no `getExpoPushToken*` call; notifications are local only).

| # | Destination | Code | Trigger | What the host receives | Store build |
|---|---|---|---|---|---|
| 1 | `api.anthropic.com` | `src/ai/anthropicClient.ts`, `alternatesClient.ts`, `exerciseQuestionClient.ts`, `provider/validateKey.ts` | User uses an AI Coach feature with an Anthropic key | The user's API key (`x-api-key` header) and the prompt for that feature (see section 2) | Yes, if the user supplies a key |
| 2 | `api.openai.com` | `src/ai/openaiClient.ts`, `openaiAlternatesClient.ts`, `openaiExerciseQuestionClient.ts`, `provider/validateKey.ts` | Same, with an OpenAI key | The user's API key (`Authorization: Bearer`) and the prompt | Yes, if the user supplies a key |
| 3 | `api.hevyapp.com` | `src/hevy/hevyClient.ts` | User runs a Hevy import and has entered a Hevy key | The user's Hevy key (`api-key` header) in `GET` requests; data flows from Hevy to the app, not the reverse | Yes, if the user supplies a key |
| 4 | `www.bing.com` | `src/state/exerciseWebImages.ts` (lines 106 and 137) | An exercise has no catalog image match, or the user opens "Search images" | The search text `<exercise title> exercise`, plus IP address and user agent | **Off by default after #397 (PR #410, open)**. On main it is on. |
| 5 | Host of a user-pasted image URL | `src/state/exerciseImageFiles.ts` (`File.downloadFileAsync`) | User pastes an image URL on an exercise | Whatever that host logs (IP address, user agent) | Yes, user-initiated |
| 6 | `raw.githubusercontent.com` | `src/state/exerciseCatalog.ts:38`, `exerciseImageResolver.ts:104,217` | Catalog image download path in the resolver | IP address, user agent | **(verify)**. Catalog images are bundled (`assets/seeded-exercise-images`, `isBundledCatalogImagePath`); this download path may be unreachable when a bundled image exists. |

Not network egress, but user-initiated and worth stating:

- **Markdown export / share sheet** (`src/app/(tabs)/settings/data.tsx`, `expo-sharing`): the user chooses where the file goes.
- **Markdown import** (`expo-document-picker`): reads a file the user picks.
- `src/components/external-link.tsx` (in-app browser) is **not used anywhere** (no `<ExternalLink` usage on main), so the app opens no external web pages.

Findings on the network layer:

- All provider and Hevy endpoints are HTTPS. No `http://` endpoint is hard-coded.
- The AI clients add only content-type and the provider auth/version headers. No device identifier is added **(verify at the wire for the exercise-question and alternates clients, whose headers were not individually printed)**.

## 2. What the AI providers receive

Prompts are built in `src/ai/`. Nothing goes to a provider unless the user has
entered that provider's key; there is **no developer-side proxy**, so the request
goes straight from the phone to the provider under the user's own account.

| Feature | Content sent (from `contextBuilder.ts`, `restCommentaryPrompt.ts`, `catalogPickPrompt.ts`) |
|---|---|
| Create / edit routine, onboarding | Profile fields (goals, equipment, personality, age, experience), the user's routines and exercises, the last 10 completed workouts (one line each), up to 5 recent working sets per exercise with dates |
| Workout debrief | The just-finished session's log and the **diary text** the user wrote (`contextBuilder.ts:142-145`) |
| Rest commentary | One exercise, its targets and its recent sets, plus the personality string |
| Exercise question | The question the user typed and the exercise context **(verify exact fields in `exerciseQuestionContext.ts`)** |
| Alternates | The exercise and routine context **(verify exact fields in `alternatesPrompt.ts`)** |
| Catalog match | An exercise title plus candidate catalog titles, to pick a photo |

- **Photos and selfies are not sent.** No AI client builds an image part (no `base64`, `image_url` or `input_image`), and `src/state/workoutSelfieFiles.ts` copies selfies into the app's own Documents folder. The #399 card says "including photos"; that does not match the code today.
- The API keys themselves are never put in a prompt (asserted by `restCommentaryStore.test.ts` per the prompt-module comment).
- Providers have their own retention and training terms, which the policy cannot control and should point to.

## 3. What is stored on the device

| Data | Where | Notes |
|---|---|---|
| Routines, exercises, sessions, sets, diary text, image paths | SQLite via WatermelonDB, `hmbworkout.db` in the app's Documents | Included in iOS device backups unless excluded |
| Selfies / diary photos | `Documents/workout-selfies/` | Local only |
| Exercise photos the user adds | App file storage | Local only |
| API keys (Anthropic, OpenAI, Hevy) and profile fields (age, goals, equipment, personality, experience) | `expo-secure-store` (iOS Keychain), key `SETTINGS_KEY` in `src/state/settings.ts` | The keychain survives uninstall on iOS unless removed |
| Workouts in Apple Health | Apple Health, **write only**: workouts and active energy (`src/health/healthkit.ts` requests `toShare` only) | The app never reads Health data |

## 4. Permissions and declarations

| Item | Current value on main | Assessment |
|---|---|---|
| `NSHealthShareUsageDescription` | "We use HealthKit to write your workout data to Apple Health" | **Wrong**: this is the read string and the app never reads. Fixed by #396 (PR #406, open). |
| `NSHealthUpdateUsageDescription` | same text | Acceptable; improved by #396. |
| `NSCameraUsageDescription` | "Take an optional photo for an exercise or your workout diary." | OK. Optional use. |
| `NSPhotoLibraryUsageDescription` | "Choose an optional photo for an exercise or your workout diary." | OK. |
| Microphone | disabled in the `expo-image-picker` plugin config | OK. |
| `NSAppTransportSecurity.NSAllowsArbitraryLoads` | `true` (also in the built Release `Info.plist`) | **Should be removed.** Every endpoint is HTTPS. Already tracked as #395. The code comment in `exerciseImageOverride.ts` even says ATS blocks cleartext, which this setting contradicts. |
| Local-network keys (`NSBonjourServices`, `NSLocalNetworkUsageDescription`) | Present in Debug builds only; absent from the Release `Info.plist` | OK for the store build. |
| `NSUserTrackingUsageDescription` | Absent | OK; no tracking. |

### Privacy manifest (`ios/HMBWorkout/PrivacyInfo.xcprivacy`, generated)

- `NSPrivacyTracking` = false; `NSPrivacyCollectedDataTypes` = empty.
- Required-reason APIs declared: File timestamp (`C617.1`), User defaults (`CA92.1`), System boot time (`35F9.1`).
- A built app also bundles the Expo and React Native modules' own manifests (`ExpoFileSystem`, `ExpoNotifications`, `ExpoApplication`, `ExpoConstants`, `ExpoDevice`, `ExpoSystemUI`, `React-Core`, `React-cxxreact`, `React-timing`).
- No source use of disk-space or uptime APIs was found in `src/`. **(verify)** Run Xcode's **Product → Archive → Generate Privacy Report** on the archive to confirm the aggregate declaration; that is the check App Review effectively runs.
- The empty `NSPrivacyCollectedDataTypes` is consistent with "no developer-side collection", but see section 5: it does not mean no data leaves the device.

## 5. Recommended App Privacy label answers

These are recommendations for the account holder to confirm in App Store Connect.

**Tracking:** No.

**Data collected by the developer:** None. The developer operates no server and
receives nothing.

**Data sent to third parties through the app (disclose):** Apple's questionnaire
asks about data that the app, or third-party partners reachable through the app,
transmit off the device. The user's workouts and diary text reach Anthropic or OpenAI
when the user uses the AI Coach with their own key. The conservative answer is to
disclose, for those two categories, that they are collected, used for **App
Functionality**, **not used for tracking**:

| Apple data type | Why | Notes |
|---|---|---|
| Health & Fitness: Fitness | Workout logs and sets in prompts | Only when the AI Coach is used |
| User Content: Other User Content | Diary text, routine and exercise names | Only when the AI Coach is used |
| Other Data / profile fields | Goals, equipment, personality, age, experience | Only when the AI Coach is used |

Whether data sent directly to a provider under the user's own account must be
declared by the developer is a judgment call; disclosure is the safe choice and
matches the policy wording. Apple allows omitting data a user explicitly sends
themselves to a third party in a user-initiated, clearly-disclosed way, but do not
rely on that without the consent screen (#394) in place.

**Other disclosures consistent with the code:** HealthKit write access (declared by
the entitlement and the usage string); no contacts, location, browsing history,
identifiers, purchases, or diagnostics collected.

## 6. Findings

| # | Finding | Severity | Tracked |
|---|---|---|---|
| F1 | **No consent screen exists on main** (no occurrence of "consent" in `src/`). The policy cannot truthfully say data is sent "only after consent" until it lands. | Blocker for policy accuracy | #394 |
| F2 | `NSAllowsArbitraryLoads` is on in Release; all endpoints are HTTPS. | Likely App Review question | #395 |
| F3 | `NSHealthShareUsageDescription` claims writing; the app never reads. | Rejection risk | #396 (PR #406) |
| F4 | Bing web-image search is on by default and sends exercise titles and IP address to a third party. | Policy and label impact | #397 (PR #410) |
| F5 | Selfie photos are local-only; the card's "including photos" wording is inaccurate for current code. | Wording | this PR |
| F6 | A GitHub raw download path for catalog images remains in the resolver although images are bundled. | Verify reachability; drop from the policy if unreachable | none; **suggest a card** |
| F7 | Keychain items survive uninstall; the policy should tell users how to remove their keys and data. | Policy content | this PR |
| F8 | Run Xcode's Privacy Report on the archive before submission. | Process | #398/#401 |

## 7. Open questions for the account holder

1. Publisher name and contact email for the policy header and support URL.
2. Will the store build ship with the Bing fallback off (#397) and Hevy import in the app? The policy and label list both.
3. Which URL will host the policy (the card requires a stable public URL)?
4. Should the policy name Anthropic and OpenAI explicitly as recipients? This draft does.
