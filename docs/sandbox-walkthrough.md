# Sandbox walkthrough: mail in, reply out

Eight steps, from an empty mailbox to a customer reply sitting in a UI. Run them in order; each one
prints what the next step needs. IDs differ every run, so do not copy names from an example.

## 0. Three things must be running

| What | Command | Check |
| --- | --- | --- |
| ERPNext + GreenMail | `.\infra\start-wsl.ps1` | prints `ERPNext demo is ready on http://127.0.0.1:8080` |
| Customer inbox (Mailpit) | `.\infra\start-mailpit.ps1` | <http://127.0.0.1:8025> opens |
| A model | Gemini: `GOOGLE_API_KEY` in `.env` — or local: `llama-server` / Ollama | `npm run doctor` |

`npm run doctor` is the honest answer to "is anything broken": it is read-only and calls no model.

## 1. Put mail in the sales mailbox

```powershell
$env:MAILPIT_SMTP='127.0.0.1:3025'
npm run mail:tests                 # all of test/mails
npm run mail:tests -- test/mails/01-rfq-urgent-stock-verification-for-next-q.txt   # or just one
```

Expect `10 messages delivered over SMTP to 127.0.0.1:3025`. `:3025` is GreenMail, the mailbox the ERP
reads. Nothing appears in Mailpit yet: Mailpit is the **customer** side.

## 2. Let the ERP pull it over IMAP

```powershell
$r = (wsl -d Ubuntu -- wslpath -a "$PWD").Trim()
wsl -d Ubuntu -u root -- /usr/bin/docker compose -p order-review-demo -f "$r/infra/compose.yaml" exec -T -w /home/frappe/frappe-bench backend bench --site frontend execute frappe.email.doctype.email_account.email_account.pull
```

Frappe creates one `Communication` per message (deduplicated by `Message-ID`) plus a `Lead` for an
unknown sender.

## 3. Turn that mail into Inquiries

```powershell
npm run inquiry:sync                                  # Gemini
$env:MODEL_PROVIDER='local'; npm run inquiry:sync     # local llama.cpp / Ollama
```

Expect one JSON line per mail, then a summary:

```
{"event":"inquiry.filed","inquiry":"INQ-00044","lines":2,"reply":true,...}
9 Inquiry record(s), 1 screened out, 0 quotation(s), 0 replies sent — 0 model call(s), $0.0000
```

`replies sent: 0` is correct here: nothing has been approved yet.

## 4. Look at what the model proposed

ERPNext → <http://127.0.0.1:8080/app/inquiry> → open a row.

- **Suggested reply (not sent)** — the draft, stored as HTML.
- **Resolved lines** — per line: the customer's words, the matched ERP item, quantity, status.
- **Screening** — why a solicitation was stopped before any model call.

## 5. Approve it, as a sales person would

Top-right of the Inquiry form: the workflow buttons. Click **Qualify**.

(Headless equivalent: `POST /api/method/frappe.model.workflow.apply_workflow` with
`{"doc":"{\"doctype\":\"Inquiry\",\"name\":\"INQ-00044\"}","action":"Qualify"}`.)

## 6. Run the pipeline again

```powershell
npm run inquiry:sync
```

Two things happen for a `Qualified` Inquiry, in this order:

```
{"event":"inquiry.reply_sent","inquiry":"INQ-00044","to":"buyer@example.invalid",...}
{"event":"inquiry.quotation","inquiry":"INQ-00044","quotation":"SAL-QTN-2026-00001","items":2}
```

## 7. Read the customer's inbox

Open <http://127.0.0.1:8025>. The reply is there: `sales@example.invalid` → the customer address, subject
`Re: <the original subject>`.

From the command line:

```powershell
npm run sandbox:inbox
```

## 8. Prove it only happened once

```powershell
npm run inquiry:sync
```

Expect `0 replies sent`: `reply_sent_at` on the Inquiry makes the send idempotent. The mailbox still
holds exactly one reply.

## Why this cannot email a stranger

- A reply is sent **only** for an Inquiry a human moved to `Qualified`.
- `src/mail-send.ts` refuses any SMTP host that is not loopback unless `SANDBOX_ALLOW_REMOTE=1`.
- The reply is stored on the Inquiry first, so an unsent draft never implies correspondence.
