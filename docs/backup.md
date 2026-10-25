# Backup and recovery

What survives a machine death, in two layers: the ERPNext data (business objects) and the
application state (checkpoints + ledger). The two need different treatment.

## 1. ERPNext

The canonical backup is Frappe's own, run inside the backend container:

```bash
cd ~/langorder-ai
docker compose -p order-review-demo -f infra/compose.yaml exec -T -w /home/frappe/frappe-bench backend \
  bench --site frontend backup --with-files
```

This writes a timestamped `.tgz` under `sites/frontend/private/backups/` that includes the database
dump, the site files and the private files. Copy it off the machine.

A raw database dump alone (faster, files excluded) is the stock MariaDB client:

```bash
docker compose -p order-review-demo -f infra/compose.yaml exec -T db sh -c \
  "mariadb-dump -uroot -padmin --all-databases" > erp.sql
```

> Honest label: the `bench backup` command was not executed in this session (the stack was down when
> this was written). It is the documented Frappe path; `mariadb-dump` is the standard MariaDB client.
> Run either once and confirm the file is non-empty before relying on it.

**Restore (new machine):**

```bash
bash infra/start.sh                                  # brings up a fresh site
docker compose -p order-review-demo -f infra/compose.yaml exec -T -w /home/frappe/frappe-bench backend \
  bench --site frontend restore /home/frappe/frappe-bench/sites/frontend/private/backups/<file>.tgz
bash infra/seed-inquiry.sh                           # re-applies the DocType/workflow (idempotent)
```

## 2. Application state (SQLite)

Three files under `data/` are not in git and are not backed up by `bench backup`:

| File | What it holds | Lose it and… |
| --- | --- | --- |
| `checkpoints.sqlite` | paused order workflows (the `interrupt` resume state) | orders waiting for review can no longer be resumed; the mail must be re-processed |
| `model-budget.sqlite` | the model-call ledger (every attempt, including failures) | the transparency claim loses its record |
| `inquiry`/`quotation` linkage | `Message-ID` → Inquiry dedup | the next run re-files mail (idempotent, so only noise, not data loss) |

They are one `cp` away:

```bash
cp data/*.sqlite /safe/location/
```

The checkpoints are the only one with *recoverable* value — the ledger is evidence, and the Inquiry
dedup is self-healing because it keys on `Message-ID`.

## 3. The one-liner

For a disposable demo, a single archive of everything is enough:

```bash
tar czf langorder-backup-$(date +%F).tgz data/
docker compose -p order-review-demo -f infra/compose.yaml exec -T -w /home/frappe/frappe-bench backend \
  bench --site frontend backup --with-files
# copy the resulting sites/.../backups/*.tgz next to the tar above
```

## 4. What this does and does not prove

It documents the mechanics; it does not prove they run. A restore is only real after it has been
executed against a fresh volume once. Do that before you depend on it, and record the date in
[verification.md](verification.md).
