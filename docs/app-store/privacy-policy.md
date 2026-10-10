# HMB Workout Privacy Policy

**DRAFT for review. Not yet published.** Bracketed items marked **[FILL]** need your
details. Items marked **[CONFIRM BEFORE PUBLISHING]** describe behavior that depends
on cards still open (see `privacy-audit.md`, section 6). Delete this banner and all
bracketed notes before hosting.

*Effective date:* **[FILL: date]**  
*Publisher:* **[FILL: your name or entity]**  
*Contact:* **[FILL: support email]**

HMB Workout is a workout logger for iPhone with an optional AI coach. This policy
explains what the app does with your information. The short version: your workouts
stay on your phone, I do not run any servers that receive your data, and the app
sends information to an outside service only when you turn on a feature that needs
one.

## 1. What stays on your device

The app stores the following **only on your iPhone**:

- your routines, exercises, workout sessions, sets and rest times;
- your workout diary notes and any photos you add to a diary entry or an exercise;
- your settings, including your profile answers (goals, equipment, coaching
  personality, age and experience) and any API keys you enter. API keys and profile
  settings are kept in the iOS Keychain.

I do not have access to this information. I do not operate a server, an account
system, or analytics. The app contains no advertising, tracking, or
crash-reporting software.

Because this data lives on your device, it may be included in your iPhone backups
(iCloud or a computer) according to your own iOS backup settings.

## 2. Apple Health

If you allow it, the app **writes** your completed workouts and active energy to
Apple Health. The app does **not read** any data from Apple Health. You can change
this at any time in Settings > Health > Data Access & Devices > HMB Workout.

## 3. The AI Coach (optional, you bring your own key)

The AI Coach only works if you enter your own API key from Anthropic or OpenAI.
Without a key, the app makes no AI requests.

When you use an AI Coach feature, the app sends a request **directly from your
phone to the provider you chose**, using your key and under your account with that
provider. I do not see, proxy, or store these requests. Depending on the feature,
the request can include:

- your profile answers (goals, equipment, coaching personality, age, experience);
- your routines and exercise names;
- a short summary of your recent workouts and recent sets for the exercises
  involved;
- for a workout debrief, the notes you wrote in your workout diary;
- the question you type, in the case of exercise questions.

**Photos and selfies are not sent to AI providers.** They stay on your device.

**[CONFIRM BEFORE PUBLISHING: consent. Replace this paragraph with the final wording
once the consent screen (#394) ships.]** Before any of this information is sent, the
app asks for your permission, and you can revoke it at any time in Settings.

Your use of these providers is governed by their own terms and privacy policies,
including how long they keep the data and whether they use it for training:

- Anthropic: **[FILL: link to Anthropic's current privacy policy]**
- OpenAI: **[FILL: link to OpenAI's current privacy policy]**

You can stop at any time by removing your key in Settings. This stops future
requests; it does not delete anything the provider already holds, which you would
manage with them.

## 4. Hevy import (optional)

If you enter a Hevy API key and import from Hevy, the app contacts Hevy's service
(`api.hevyapp.com`) with your key to download your workout history to your phone.
Nothing from the app is uploaded to Hevy. Hevy's own privacy policy governs that
service.

## 5. Exercise images

- Exercise pictures that come with the app are stored in the app itself.
- **[CONFIRM BEFORE PUBLISHING: remove this bullet in builds where #397 turns the
  web image search off.]** When an exercise has no included picture, the app may
  search the web (Bing Images) using the exercise name to find one. The search
  provider sees the exercise name, your IP address and your device's browser
  identification, like any web search.
- If you paste an image link for an exercise, the app downloads that image from the
  address you entered. That site will see your IP address.

## 6. What I do not collect

I do not collect your name, email, contacts, location, advertising identifiers,
purchases, usage analytics, or crash reports. I do not use cookies or third-party
tracking, and I do not sell or share your information for advertising.

## 7. Exporting and sharing

The export feature creates a file from your routines. It goes wherever you choose
to send it using the iOS share sheet. The import feature reads a file you pick.

## 8. Keeping and deleting your data

- To delete your workout data and settings, delete the app. This removes the app's
  database, photos and settings from your device.
- iOS may keep Keychain entries (your API keys) after the app is deleted. To be
  sure they are gone, remove your keys in the app's Settings before deleting it.
- Data you sent to an AI provider or to Hevy is held by them under their own
  policies. Contact them to delete it.

## 9. Children

HMB Workout is not directed to children under 13, and I do not knowingly collect
information from them.

## 10. Changes

If this policy changes, I will update the date at the top and publish the new
version at **[FILL: policy URL]**.

## 11. Contact

Questions about this policy: **[FILL: support email]**.
