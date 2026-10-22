# Raksha — User Guide

Open the app URL on your phone. To install it, use **Install app** in Android Chrome, or **Share → Add to Home Screen** in iPhone Safari. No sign-up is needed: your phone gets a private, anonymous device ID automatically.

Bottom navigation: **Home · Report · SOS · Trip · More**. *More* contains Map, Safe Circles, Share location, Evidence, Events, Contacts, My reports, Alerts and Settings.

---

## 1. Report harassment anonymously (`Report`)
1. **Describe what happened (optional):** type in English, Hindi or Hinglish, then tap **✨ AI: fill the form for me**. Raksha fills in the type, severity, frequency, tags and time, and you can edit anything.
2. **Choose the details:**
   - incident type
   - severity (1–5)
   - frequency (once, happened before, ongoing)
   - tags (night, metro, bus stop, …)
   - when it happened
3. **Where:** tap the map or use *My location*. Only an approximate area of about 150 m is stored.
4. **Submit.** You'll see which personal details were removed (phone numbers, emails, Aadhaar, vehicle numbers, names…) and whether the area is visible on the map yet. An area appears only after at least 3 different people report there.
5. **Optional complaint draft:** open the **📄 Complaint draft generator** and pick **Police, College ICC, Workplace IC (POSH), Transport or Cybercrime**. Then add optional details and tap *Generate*. Edit the draft, then copy, share or download it. Raksha never files anything on its own.

**My reports** (`More → My reports`) lists the reports sent from this phone. Open one to see its area status, or tap **Retract** to withdraw it from the risk calculations.

## 2. Safety map (`More → Safety map`)
- Areas are coloured **low / moderate / high / critical**.
- Tap an area to see its patterns (for example "recurring in the late night window" or "recent spike"), the most common incident types, and safety tips.
- Areas with too few independent reports stay hidden to protect reporters.

## 3. Safe Circles (`More → Safe Circles`)
- **Create** a circle (e.g. "Late-shift buddies") and share the **invite code**, or **Join** with a code. Use `DEMO42` for the demo.
- See each member's state: *idle, on a trip, overdue, needs help* or *SOS*.
- Tap **Are you okay?** to nudge a member. They answer *I'm okay* or *Need help*. *Need help* tells you and shares their live location.

## 4. Trip check-ins (`Trip`)
1. Enter the destination (optionally pin it on the map), an **ETA**, a **check-in interval**, and the circle to notify. Keep *Share my live location* on.
2. While the trip is active:
   - **✅ I'm safe**: check in on time.
   - **Delayed +10**: tell the circle you're running late.
   - **🆘 Need help**: alerts the circle and your trusted contacts immediately.
   - **+10 / +30**: extend the ETA.
   - **I've arrived**: ends the trip and stops sharing.
   - **Cancel**: ends the trip without arriving.
3. **If you miss a check-in:**
   - *Stage 1*: you get a reminder.
   - *Stage 2*: your Safe Circle is alerted, with a live-location link.
   - *Stage 3*: your trusted contacts are alerted.
   - Raksha never calls the police automatically.

## 5. Share location temporarily (`More → Share location`)
1. Add a label, choose a duration (15 min to 4 h), and pick the recipients (circles and contacts). You can also tick *Stop automatically when I mark a trip as arrived*.
2. You get a link (`…/t/<code>`) and a QR code. Anyone can open it in a browser without installing the app.
3. **Before it expires,** you get a reminder so you can **extend** it or let it end. You can also **Stop** it at any time. Once it expires or is stopped, the link shows "Location sharing has ended for this link".

## 6. SOS (`SOS` — red button)
- Choose who to alert (all circles and contacts are selected by default), then press **SOS**.
- Your circle gets an instant alert with your live location. Contacts with linked Telegram are messaged automatically. For the others, tap **SMS** or **WhatsApp** to send the prepared message.
- **I'm safe now** resolves the SOS; **False alarm** cancels it. Both tell the same people and stop sharing.
- The call buttons are **112** (emergency) and **181** (women helpline). For cybercrime, call **1930**.
- **Voice Guard** (Settings): while the app is open, saying a keyword such as *"bachao"* or *"help me"* starts a 5-second countdown to SOS, which you can cancel.

## 7. Evidence vault (`More → Evidence`)
- **Upload** photos, audio, video, screenshots or documents.
  - Your phone computes a SHA-256 fingerprint first.
  - The server checks the fingerprint and stores the file **encrypted**.
- **Download** a file at any time.
- **Verify** re-downloads the file and checks that its fingerprint is unchanged.
- **Certificate** opens a printable integrity certificate (file details, SHA-256, receipt time, signature). Print it or save it as PDF to attach to a complaint.

## 8. Event Safety Bubble (`More → Events`)
- **Attendees:**
  - Join with the event code (`FEST24` for the demo).
  - Set your status to **I'm safe** or **Need help**, and pick your subzone (e.g. "Main Stage"). *Need help* alerts everyone in the event bubble.
  - Report harassment for the event: the report is counted against the matching subzone.
  - When reports in a subzone cross the **advisory** or **warning** threshold, every member gets an alert. The subzone is highlighted on the event map.
- **Organisers:**
  - Create an event with a centre, radius, times and thresholds, then tap the map to add subzones.
  - Watch the live counts, members' statuses and the alert history.

## 9. Trusted contacts (`More → Contacts`)
- Add people by name and, optionally, phone number.
- **Link Telegram** creates a link for your contact to open. Once they press *Start* in the Raksha bot, they automatically receive your SOS, share and missed-check-in alerts. Use **Send test** to confirm it works.
- If the contact has no Telegram, Raksha prepares SMS or WhatsApp messages for you to send with one tap.

## 10. Settings
- **Name** shown to your circles and events.
- **Voice Guard** (on/off and keywords).
- **Watch areas:** get notified when an area you care about (home, office, college) escalates to *high* or *critical*.
- **Notifications:** turn on push, send a test, and choose which alert types you receive.
- **Default share duration.**
- **Permissions:** check and test location, microphone and notifications. Phones require an `https://` address for these.
- **Delete all my data:** permanently removes everything linked to this phone.

---

## 👮 Authority dashboard (`/authority`)
Open `https://<host>/authority` and enter the authority key (printed in the server console and stored in `server/data/authority.key`).

| Tab | What you see |
|---|---|
| **Patterns** | Map and table of visible risk areas, filterable by level, type and period |
| **Escalations** | Areas that crossed high/critical or showed a burst. You can **Acknowledge**, mark **Actioned** or **Dismiss** each one, with a note |
| **Zone graph** | Adjacent hot cells joined into clusters, i.e. corridors that need patrols or lighting |
| **Analytics** | Reports by type, severity, time of day, day and tag |
| **Events** | Live events with subzone counts and alerts |

---

## 🎬 5-minute demo script (with `DEMO_MODE=true` and `npm run seed`)
1. **Map:** open *Safety map* to show the Bengaluru hot-spots, then tap one to show its patterns and guidance.
2. **Report:** type *"Kal raat metro station ke bahar ek aadmi ne peecha kiya, mera number 9876543210"*, tap **✨ AI: fill the form for me**, then submit. Point out that the phone number was redacted. Then generate a **Police** draft.
3. **Circle and trip:**
   - Join `DEMO42` on two phones (or two browser profiles).
   - On phone A, start a trip with ETA 3 and interval 1. Don't check in.
   - Within about 10 seconds, phone B gets the stage-2 alert with a live link.
4. **Share:** create a 2-minute share. The reminder appears within seconds, and then the link shows that sharing has ended.
5. **SOS:** press SOS on phone A; phone B gets the alert. Then press **I'm safe**.
6. **Event:** join `FEST24`, set **Need help** at "Main Stage", and file two event reports to show the subzone alert.
7. **Authority:** open `/authority`, show the escalations, acknowledge one, and show the zone graph.
