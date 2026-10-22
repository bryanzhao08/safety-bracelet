# Fly deployment

The image runs Node 24 as a non-root user. SQLite and `secret.json` live on the `/data` volume. Keep one Fly Machine for this pilot: volumes are tied to one Machine and are not automatically replicated. The hourly retention job also needs the Machine running.

1. Install and log in to `flyctl`. Change `app` and `primary_region` in `fly.toml` to your app name and preferred region.
2. Run `fly launch --no-deploy` from this directory and keep the checked-in Dockerfile and fly.toml settings. Create the volume if launch did not create it: `fly volumes create homebound_data --region sjc --size 1 -a APP` (replace `sjc` and `APP`). Ensure only one volume named `homebound_data` is attached to the Machine.
3. Set an owner token for the pilot-signup list: `fly secrets set HB_OWNER_TOKEN='a-long-random-token' -a APP`. Fly injects this environment variable at runtime. Do not put it in `fly.toml` or source control.
4. Run `fly deploy -a APP`. Check `fly status -a APP` and `fly logs -a APP`. The app serves HTTPS through Fly's proxy, which sends `X-Forwarded-Proto`; generated band URLs and monitor cookies use HTTPS and Secure.

The app creates `/data/secret.json` on its first use. Keep this file with the database during recovery: it is needed for existing ID hashes and encrypted Luma credentials. Do not commit either file.

## Backup

Use Node's SQLite online backup API so the backup includes committed data even when the live database uses WAL. For example:

```sh
fly ssh console -a APP -C 'node /app/scripts/backup.js /tmp/homebound-backup.sqlite'
fly ssh sftp get -a APP /tmp/homebound-backup.sqlite ./homebound-backup.sqlite
fly ssh sftp get -a APP /data/secret.json ./homebound-secret.json
```

Store both downloaded files in an encrypted backup location. The script checks SQLite integrity before it reports success. To restore, stop the Machine, put the database at `/data/homebound.sqlite` and the secret at `/data/secret.json`, then restart it. A Fly volume snapshot adds a second recovery option, but it does not replace an off-platform backup.

References: [Fly app configuration](https://docs.fly.io/reference/configuration/), [Fly volumes](https://docs.fly.io/volumes/overview/), [Node SQLite backup API](https://nodejs.org/api/sqlite.html).
