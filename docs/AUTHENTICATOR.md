# Family & Friends Authenticator

A way for the people close to you to check that they are really talking to you —
and for you to check that you are really talking to them.

## The problem

A convincing voice of you asking for money, a WhatsApp message from your account
after it was hijacked, a video call that looks almost right. None of these can be
settled by asking "how do you know it's me?", because everything a stranger would
need to answer that is already public or already in the chat history.

What does settle it is a number that changes every 30 seconds and that only the
two of you can produce.

## How it works

You and each contact share one secret, enrolled in **both** phones' Google
Authenticator. From that secret each phone derives the same 6-digit code, and the
code changes every 30 seconds.

```
   Your phone                        Keren's phone
   Google Authenticator              Google Authenticator
   "Shmulik <-> Keren"    ------->   "Shmulik <-> Keren"
        394 776             same          394 776
                           secret
```

So, on a call:

- **They verify you.** "What's the code?" You read the 6 digits from your app.
  They compare with theirs. Match means it is you.
- **You verify them.** You ask them for their code and compare with yours, or run
  `verify` on your laptop.

Each contact gets a **different** secret. If one is ever exposed, only that one
relationship is affected, and you know exactly which.

Nothing leaves your devices. There is no server to call, so this works on a plane,
during an outage, and there is nobody to breach.

## Setup

```bash
npm install
npm run auth -- init
```

You will be asked for your name and a master passphrase. The passphrase encrypts
the file holding every contact's secret. **There is no recovery if you forget it** —
if that happens you have to re-enroll everyone.

## Enrolling someone

```bash
npm run auth -- add "Keren"
```

This prints a QR code and the same key in typeable form. The other person adds it
in Google Authenticator via **+ → Scan a QR code**, or **+ → Enter a setup key**
(choose "Time based"). You need this key on **both** phones.

**How you hand over the key matters more than anything else here.** In person is
best. If you cannot, use a channel that is already trusted and separate from the
one you are trying to protect — an encrypted call you initiated to a number you
already had, not a WhatsApp message and not email. Anyone who sees the key can
generate your codes forever.

Then clear your terminal (`clear`) so the key is not sitting in scrollback.

To see the QR again later — a new phone, a deleted entry:

```bash
npm run auth -- show "Keren"
```

## Everyday use

**Someone needs to check it's you.** Read out the code from your phone's Google
Authenticator, or from your laptop:

```bash
npm run auth -- code "Keren"     # one contact
npm run auth -- code --watch     # everyone, refreshing live
```

**You need to check it's them.** Ask for their code and compare it with what your
app shows, or:

```bash
npm run auth -- verify "Keren" 394776
```

A code is accepted **once**. If the same code is offered a second time it is
rejected as a replay — which is what you want if somebody recorded an earlier call
and is playing it back.

## When it does not match

Codes roll over every 30 seconds, so a near-miss on timing is normal. Ask for a
fresh one and try again. The tool already accepts a code up to 30 seconds either
side to allow for phone clocks that drift.

If a fresh code fails again, **stop and assume it is not them.** Hang up and call
back on the number you already have saved. Do not act on anything that was asked
for during that call.

Same for a rejected replay: an old code coming back is a signal worth taking
seriously.

## Managing contacts

```bash
npm run auth -- list                          # who is enrolled
npm run auth -- rename "Keren" "Keren M."     # label only, no re-enrollment
npm run auth -- remove "Keren"                # revoke the shared key
```

After `remove`, delete the matching entry from Google Authenticator on both
phones. To re-issue, `remove` and then `add` again — the new key must be enrolled
on both phones like the first time.

## Lost or replaced phone

- **Their phone is replaced** — run `show` and let them scan again. Same key, no
  change on your side.
- **Their phone is lost or stolen** — `remove` and then `add`. Whoever holds the
  old phone keeps generating valid-looking codes until you do this.
- **Your phone is replaced** — `show` each contact and re-scan on your new phone.
  Their side does not change.

Google Authenticator can also transfer entries to a new phone directly, via
**Settings → Transfer accounts → Export accounts**.

## Where the secrets live

`data/authenticator/vault.json`, encrypted with AES-256-GCM under a key derived
from your passphrase with scrypt. The file is written with owner-only permissions
and is gitignored. Without your passphrase it is unreadable, so a stolen laptop or
a synced backup does not give anything away.

Back it up (a copy on a USB stick, or in a password manager) — losing it means
re-enrolling everyone. Because it is encrypted, the backup is only as strong as
your passphrase.

Codes and secrets are never written to the log files.

`AUTH_VAULT_PATH` moves the vault elsewhere. `AUTH_PASSPHRASE` skips the prompt;
useful for scripts, but it leaves your passphrase in the environment and in shell
history, so prefer typing it.

## What this does and does not cover

It proves the person on the other end holds a secret you handed them. That is
exactly the question "is this really you?".

It does not help if:

- the key was sent over a channel someone was already reading;
- their phone is unlocked in someone else's hands;
- someone is standing next to them reading their screen.

And it only works if you actually ask. Agree with your family now: **any request
for money, account details, or anything urgent and unusual gets a code check
first, no exceptions and no embarrassment about asking.** The moment you make an
exception because it sounded urgent is the moment the whole thing stops working.

---

## למשפחה ולחברים — מה צריך לעשות (Hebrew, for the people you enroll)

**למה זה טוב:** אפשר לזייף קול, אפשר לפרוץ לוואטסאפ, אפשר לזייף וידאו. אי אפשר
לזייף את הקוד הזה.

**התקנה, פעם אחת:**

1. התקינו את Google Authenticator (חינם, מהחנות של האייפון/אנדרואיד).
2. פתחו את האפליקציה, לחצו על **+**, ואז **סרוק קוד QR**.
3. סרקו את הקוד שהראיתי לכם. תופיע שורה עם השם שלי ומספר בן 6 ספרות.

זהו. אין מה לעשות יותר.

**מתי משתמשים:** בכל פעם שאני מבקש כסף, פרטי חשבון, או משהו דחוף ולא רגיל —
**גם אם זה נשמע בדיוק כמוני**:

1. תשאלו אותי: "מה הקוד?"
2. פתחו את Google Authenticator ותסתכלו על המספר.
3. אם המספר שאני אומר זהה — זה באמת אני.
4. אם לא — **תנתקו**, ותתקשרו אליי חזרה למספר ששמור אצלכם.

**חשוב לדעת:**

- המספר מתחלף כל 30 שניות. זה תקין. אם לא הספקתם — תבקשו את הקוד הבא.
- אל תשלחו את המספר לאף אחד ואל תצלמו את המסך.
- אם החלפתם טלפון — תגידו לי, נעשה את הסריקה מחדש.
- לא נעים לבקש? זה בדיוק מה שמי שמתחזה סומך עליו. תמיד תבקשו.
