# Manual WhatsApp Connection — Test Protocol

Tests the concierge connection flow end to end: a clinic submits their number →
your team sends the code → the clinic enters it → your team marks it connected.

There are **two ways to test**:

- **Dry run (recommended first):** exercises all the *app* plumbing — screens,
  status changes, emails, polling, admin gating — **without touching Meta**. You
  can do this today with no spare phone or number. Proves everything we built.
- **Real run:** actually connects a number on Meta (real OTP to a real phone).
  Do this once the dry run passes; finish it with `test-whatsapp.sh` to confirm
  messages actually flow.

---

## 0. Pre-flight (do once, after deploying)

- [ ] On Railway → `zero-ai` → Console: ran `npm run db:push` (adds the new columns — non-destructive).
- [ ] On Railway → `zero-ai` → Variables: `PLATFORM_ADMIN_EMAILS=info.latencyzero@gmail.com` is set, then redeployed.
- [ ] *(Optional, for email checks)* `BREVO_API_KEY` and `FROM_EMAIL` are set. If not, the flow still works — the screens just poll for status instead of emailing.

### You'll need

- **A clinic test account** — for the clinic side. A **fresh signup** is easiest,
  because onboarding lands you straight on Step 3.
- **Your admin account** (`info.latencyzero@gmail.com`) — for the admin dashboard.
- **Two browser windows** (e.g. normal + incognito) so both stay logged in at once.

> Tip: keep the clinic account's login email as one you can actually receive mail
> at, so you can verify the "enter your code" / "you're live" emails.

---

## 1. DRY RUN — full happy path (no Meta needed)

### Part A — Clinic requests a connection  *(clinic window)*

1. Sign up a fresh clinic account → verify email → fill Step 2 (clinic info) →
   you're on **Step 3: Connect WhatsApp**.
2. Q "Does your clinic currently use WhatsApp Business?" → click **No**.
3. In the form, enter any WhatsApp number (e.g. `+2348030000009`) and a contact
   email → click **Connect WhatsApp**.
4. ✅ Screen switches to **"We're setting up your WhatsApp"** (Pending), showing
   the number and email.
5. Click **"I'm ready to receive my code now"** → ✅ it confirms with a green note.
   *(If email is configured, your team address gets a "clinic is ready" email.)*
6. **Leave this window on the Pending screen.** It polls every ~8s and will
   advance itself in Part C.

### Part B — Team sends the code  *(admin window)*

7. Log in as `info.latencyzero@gmail.com` → sidebar shows **Internal → WhatsApp
   Admin** → open it.
8. ✅ The test clinic appears under **In progress** as **"Pending — needs setup"**,
   with its number, email, "New number", and a "clinic said they're ready" note.
9. Click **Send code**.
   - *(Real run: this is the moment you'd actually add the number in Meta
     Business Manager. Dry run: just click it.)*
10. ✅ The card flips to **"Awaiting code"**. *(If email is on, the clinic gets an
    "enter your code now" email.)*

### Part C — Clinic enters the code  *(clinic window)*

11. Within a few seconds the Pending screen auto-advances to **"Enter your
    verification code"**.
12. Type any 6-digit number (e.g. `123456`) → **Submit code**.
13. ✅ Shows **"Code received — we're finishing your setup now"** with a spinner.

### Part D — Team marks it connected  *(admin window)*

14. On the clinic's card, the submitted code (`123456`) now shows big, with a
    **Copy** button.
15. Click **Mark connected** → enter a **unique** fake phone number ID
    (e.g. `TEST_PN_CONNECT_1` — must not already be used by another clinic) →
    **Confirm connected**.
16. ✅ The card moves to the **Connected** section, marked **Live**.
    *(If email is on, the clinic gets a "you're connected 🎉" email.)*

### Part E — Clinic sees it's live  *(clinic window)*

17. Within a few seconds the clinic screen auto-advances to **"Connected ✓"** with
    a **Continue to Staff Setup** button.

**Dry run passes if:** every ✅ above happened and the two windows advanced on
their own without manual refreshes.

---

## 2. Edge cases worth a quick check

- **Wrong code / re-enter:** on the clinic's "code received" screen, click
  **"Entered the wrong code? Re-enter it"** → the input comes back → submit a new
  code → it re-appears on the admin card.
- **Resend:** on the admin card (Awaiting code), click **Resend code** → the
  clinic's submitted code clears and it's back to waiting for a fresh entry.
- **Duplicate phone number ID:** try Mark connected with a phone number ID
  already used by another clinic → ✅ you get a clear "already connected to
  {clinic}" error, not a crash.
- **Reset:** click **Reset** on any card → clinic goes back to the start.
- **Migrate branch:** in Part A pick **Yes → Migrate existing number** → ✅ the
  clinic sees the "remove it from your WhatsApp Business app first" warning, and
  the admin card shows a migration reminder flag.
- **Admin gating:** log in as a **non-admin** clinic account and visit
  `/admin` directly → ✅ you're bounced to the dashboard, and there's no sidebar
  link.

---

## 3. REAL RUN (once dry run passes)

Same steps, but at **Part B step 9** you actually add the clinic's number in your
Meta Business Manager and trigger the real code. Meta texts the 6-digit code to
the clinic's phone → enter *that* code in Part C → in Part D enter the **real**
`phoneNumberId` from Meta (Business Manager → WhatsApp → API Setup).

Then confirm messages actually flow with the existing harness:

```
bash test-whatsapp.sh "Hi, I'd like to see a doctor today"
```

Watch the dashboard's ZeroChat screen for Zero's reply. If that works, the number
is fully live.

---

## 4. Fast backend-only smoke test (optional)

Skips the UI — just confirms the endpoints respond. Grab a token first: log in on
the dashboard, open DevTools → Application → Local Storage → copy `zero_token`.

```bash
BACKEND="https://zero-ai-production-5544.up.railway.app"
TOKEN="paste_zero_token_here"

# Clinic submits a request
curl -s -X POST "$BACKEND/api/clinic/request-whatsapp" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+2348030000009","email":"you@example.com","setupChoice":"new"}'

# Admin lists the pipeline (token must be a PLATFORM_ADMIN_EMAILS user)
curl -s "$BACKEND/api/admin/clinics" -H "Authorization: Bearer $TOKEN"
```

Expect the first to return `"whatsappStatus":"VERIFICATION_PENDING"` and the
second to include your clinic. A `403` on the admin call means the token's email
isn't in `PLATFORM_ADMIN_EMAILS`.
