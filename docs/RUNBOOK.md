# Runbook

Everything operational, in one place. If a command is here, it is required for the loop; if a
section is here, it is optional. The product itself is in the [README](../README.md); the reasoning
is in [decisions.md](decisions.md); the dated evidence is in [verification.md](verification.md).

## Where things run

| Plane | What | How |
| --- | --- | --- |
| Windows PowerShell | the repo, `npm` | your terminal |
| WSL Ubuntu → Docker | ERPNext (8 containers), MariaDB, Redis, GreenMail | `wsl -d Ubuntu -u root -- docker …` |
| Browser | the only review surface | <http://127.0.0.1:8080> |
| Node | the workflow | `npm run …` |

The ERP is **not** on Docker Desktop. It runs in the Ubuntu WSL engine, which is why every ERP
command is wrapped in `wsl`.

## Start, seed, loop

```powershell
.\infra\start-wsl.ps1      # 1. start the ERP + seed masters + write .env.erp (Linux: infra/start.sh)
.\infra\seed-inquiry.ps1   # 2. Inquiry DocType + workflow + opening stock (idempotent; Linux: seed-inquiry.sh)
```

`start-wsl` prints `ERPNext demo is ready on http://127.0.0.1:8080`. Site creation takes 3–5 min on
a desktop, 15–30 min on a 2-core Codespaces machine; `configurator` and `create-site` show
`Exited (0)`, which is success, not a crash.

The whole loop in one command:

```powershell
npm run demo               # start (idempotent) → seed (idempotent) → send → pull → sync
```

Or step by step, so you can see each one:

```powershell
$env:MAILPIT_SMTP='127.0.0.1:3025'
npm run mail:tests                                   # send test/mails/* to GreenMail
wsl -d Ubuntu -u root -- /usr/bin/docker compose -p order-review-demo -f "$((wsl -d Ubuntu -- wslpath -a "$PWD").Trim())/infra/compose.yaml" exec -T -w /home/frappe/frappe-bench backend bench --site frontend execute frappe.email.doctype.email_account.email_account.pull
npm run inquiry:sync                                 # file Inquiries, draft Quotations, send replies
```

Mail flows through two mailboxes:

| Mailbox | Tool | Port | Role |
| --- | --- | --- | --- |
| Sales inbox | GreenMail | SMTP 3025 / IMAP 3143 | the ERP pulls from here |
| Customer inbox | Mailpit | SMTP 1025 / web 8025 | receives the reply, readable at <http://127.0.0.1:8025> |

`MAILPIT_SMTP=:3025` means "send to GreenMail", not "use Mailpit" — Mailpit has no IMAP, so the ERP
cannot read from it.

## Review, approve, reply

1. Open <http://127.0.0.1:8080/app/inquiry> and open a row: the draft reply is `Suggested reply`.
2. Click **Qualify** (top-right workflow buttons).
3. Run `npm run inquiry:sync` again — it sends the reply and drafts a Quotation.
4. Read the customer's inbox: <http://127.0.0.1:8025>, or `npm run sandbox:inbox`.

A reply is sent **only** for an Inquiry a human Qualified, only once, and only to a loopback SMTP
host. `npm run review:sync` resumes paused order workflows from ERP `docstatus`; it cannot approve.

## Model provider

`MODEL_PROVIDER` picks the model explicitly; nothing is implicit.

| `MODEL_PROVIDER` | Model | Requires |
| --- | --- | --- |
| `gemini` (default) | `gemini-2.5-flash-lite` | `GOOGLE_API_KEY` in `.env` |
| `local` | llama.cpp / Ollama on loopback | `LOCAL_MODEL_URL` (default `http://127.0.0.1:8081`) |
| `bedrock` | `eu.amazon.nova-lite-v1:0` | AWS credentials with `bedrock:InvokeModel`; `BEDROCK_REGION` (default `eu-north-1`), `BEDROCK_MODEL_ID` |

```powershell
$env:MODEL_PROVIDER='local'; $env:LOCAL_MODEL_URL='http://127.0.0.1:8081'; npm run inquiry:sync
$env:MODEL_PROVIDER='bedrock'; npm run inquiry:sync     # defaults to eu.amazon.nova-lite-v1:0
```

A small local model returns plain values; `src/evidence.ts` locates each one, so an ungrounded value
is dropped exactly as on the Gemini path.

Nova must be addressed by a cross-region inference profile (`eu.amazon.nova-*`), never a bare model
id: bare ids fail with `on-demand throughput isn't supported`. Measured 2026-10-26 on
`eu.amazon.nova-lite-v1:0`: forced tool use returns schema-conforming JSON in ~440 ms per call, and
a whole mail (extraction + draft reply) costs $0.0001, recorded per model in the ledger.

## Diagnose and verify

```powershell
npm run doctor        # read-only: config, ERP ping, token scope, Inquiry DocType, GreenMail ports
npm run check         # tsc --noEmit
npm test              # deterministic tests, no network, no model
npm run failure-lab   # four failure scenarios against an in-process mock ERP
npm run coverage      # Node built-in coverage
```

## Backup

```bash
docker compose -p order-review-demo -f infra/compose.yaml exec -T -w /home/frappe/frappe-bench backend bench --site frontend backup --with-files
cp data/*.sqlite /safe/location/      # checkpoints + model ledger, not in git
```

Restore is `bench … restore <tgz>` then `bash infra/seed-inquiry.sh`.

## Deploy and cloud

- **GitHub Codespaces**: open the repo, create a codespace; the devcontainer gives Docker + Node.
  Run `bash infra/start.sh && bash infra/seed-inquiry.sh`; port 8080 is forwarded.
- **GitHub Actions**: `.github/workflows/integration.yml` boots the stack and re-runs the seeds to
  prove idempotency. Manual trigger, no model calls.
- **Oracle Always Free ARM VM** (4 OCPU / 24 GB): `infra/start.sh` is host-agnostic; all four images
  publish arm64, so it runs natively. Needs an account; bind the site, add TLS, and change the admin
  password.
- **Cloudflare cannot host this**: Workers run JS only, D1 is not MariaDB, and Containers have no
  free tier.

## Troubleshooting

- **`connection refused` on :8080** — the ERP stack is stopped. Run `.\infra\start-wsl.ps1`.
- **`Cannot convert argument to a ByteString`** — `ERP_TOKEN` in `.env.erp` contains a non-ASCII
  character. Read it again from `.env.erp`.
- **`Exited (0)` on `configurator` / `create-site`** — one-shot setup jobs; that is success.
- **`command: LOGIN => socket error: EOF`** — GreenMail was started with a duplicate user. Let it
  provision the user on first login (auth is disabled).
- **`on-demand throughput isn't supported`** — a bare Nova model id; use a cross-region inference
  profile such as `eu.amazon.nova-lite-v1:0`.
