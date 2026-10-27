# AI Monitor field evaluation (after 1.0.38)

You use this to measure how AI Monitor really performs on phones, with a few
people who agreed to help. The goal is real numbers for the next tuning
update. There's no pass/fail threshold.

## Ground rules
- **Consent and safety:**
  - Everyone in view agrees to take part.
  - Stage all "shoving" gently. Use pads or a hand on the shoulder, on grass or mats.
  - Never stage a real strike.
- **Don't record video for this evaluation.** AI Monitor itself never records or uploads.
- **No personal or biometric data.** Use role letters (A, B, C), never names. Don't write down faces, clothing or locations finer than "indoor / outdoor / street".
- **Write down only what the app showed.** That means the label, its status, roughly how long after the action it appeared, and whether the banner showed. Don't add your own guesses.

## Before each session
- [ ] App version shows 1.0.38. Note the phone model and Android version.
- [ ] AI Monitor opened and **Start** pressed. Note which camera is in use (back or front).
- [ ] If you're testing banners, turn on "Alert when someone is getting closer" and "Show a banner for new movement events". Both are off by default.
- [ ] Mount the phone steadily at chest height (tripod or a shelf), unless the scenario says "hand-held".
- [ ] Distance from the phone: 3–8 m to the people.

## Scenarios
Run each one **5 times**. Mark each run in the results table below.

| # | Scenario | Expected | Count as wrong if |
|---|---|---|---|
| 1 | A walks straight toward the phone | "Getting closer in camera view" (↗) for A | Nothing shown, or "Moving away" |
| 2 | A walks straight away from the phone | "Moving away in camera view" (↘) for A | "Getting closer" |
| 3 | A stands still for 10 s | "Still" (•) | "Getting closer" or "Moving away" |
| 4 | A walks across the view, side to side | "Unsure" (?) or "Still" | A confident closer/away state |
| 5 | A and B walk together at the same pace | No movement event | "Fast movement after another person" |
| 6 | A jogs to catch up with B, who is walking | "Fast movement after another person" after about 1–2 s | Nothing within 5 s |
| 7 | A runs alone; then A and B run side by side | No movement event | Any movement event |
| 8 | A and B cross paths walking | No movement event | Any movement event |
| 9 | A and B walk up and hug | No event, or at most "Unsure" | "Possible struggle" or an active "Close, sudden interaction" |
| 10 | A and B greet: handshake, high-five | No event, or "Unsure" | Active event |
| 11 | A runs up to B and stops (no contact) | "Unsure" or "Building", no banner (an active event shows as "Seen for a few seconds") | Active event with a banner |
| 12 | Staged gentle push: A pushes B's shoulder, B steps back (pads) | "Close, sudden interaction" or "Possible struggle" | Nothing within 5 s |
| 13 | Staged shoving, back and forth for 3–5 s (pads) | "Possible struggle" | Nothing within 5 s |
| 14 | 3–5 people chatting and moving around a small area | No movement event | Any active event |
| 15 | Repeat 6 and 12 with the phone **hand-held while walking** | Same events or "Unsure", with "Phone moving" shown | Silent, with no "Phone moving" reason |
| 16 | Pan the phone quickly across people | "Can't judge right now: phone moving too much" | Active events during the pan |
| 17 | Repeat 1 and 6 with the **front camera** | Same as the back camera | — |
| 18 | One person half-hidden behind a pillar, or at the frame edge | Reasons named ("partly hidden", "edge") | States flapping on and off |

## Results table (copy one per session)

| Field | Value |
|---|---|
| Session | date, phone model, Android version, indoor or outdoor, light (good / dim / night) |

| # | Run | What the app showed (label and status) | Delay (s) | Banner? | Correct / Missed / False alarm | Notes (no names) |
|---|---|---|---|---|---|---|
| | | | | | | |

**False alarms during normal use:** in 10 minutes of ordinary activity (people walking past, a café, a street), count the active movement events and banners that should not have appeared.

**Comfort:** after 10 minutes, note the phone's heat (cool / warm / hot), the battery drop in %, and whether the camera view stuttered.

## Summarize per scenario
- **Detection rate:** runs where the expected label appeared ÷ runs.
- **False alarms:** active events or banners where none should appear, per scenario and per 10 minutes of normal use.
- **Median delay** to the label appearing.
- **Uncertainty:** how often "Unsure" or "Can't judge" appeared, and whether it was justified (phone moving, hidden, dim light).

Send the summary tables only, with no photos or video. They decide which thresholds in `BEHAVIOR_CONFIG` and `PROXIMITY_CONFIG` change in the next update.
