# Halovinovo — Halloween costume vote

Mobile web app for one party: the host photographs each mask on arrival, guests vote from
their phones (no login), the top N go to a live final, and the host publishes the podium.
Behaviour spec and designs are in [specs/](specs/).

Stack: FastAPI + Postgres + nginx (TLS, serves photos) via Docker Compose. Frontend is plain
HTML/CSS/JS in [app/src/static/](app/src/static/).

## Run

```bash
cp .example.env .env      # set ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET_KEY
docker compose up -d --build
```

- Guests: `https://<host>/`
- Host: `https://<host>/admin`

With `PROD=false` nginx uses a self-signed certificate. For a real domain set `PROD=true` and
replace `example.com` in `nginx/letsencrypt_cert_gen.sh` and `nginx/nginx_letsencrypt.conf`.

Data lives in `./db_persist_data` (Postgres) and `./uploads` (mask photos).

## Running the party

1. **Check-in** — on the Check-in tab, take a photo of each mask and tap *Add to gallery*.
2. **Voting** — on Settings, set *Voting closes at* and save. A future close time opens voting.
3. **Final** — voting closes by itself at that time, or tap *End voting now*. Guests see the finalists.
4. **Winners** — after the live final, fill in the Winners tab and *Publish winners*.
5. **Reset tournament** (Settings) wipes everything for the next party.

## Rule decisions

- **Ties at the cut-off:** every mask tied with the Nth place goes through, so there can be more than N finalists.
- **Zero votes** never qualify as a finalist.
- **Unlocked votes count.** *Lock in my votes* only stops a guest changing them.
- **Reopening voting:** saving a future close time during the final phase reopens voting.
- **Podium:** 1st place is required; 2nd and 3rd are optional. Winners can be re-published to fix a typo.
- **Guest identity** is an anonymous cookie. A guest who clears cookies can vote again; no party-code gate is implemented.
- **Live updates** use polling every 3 s.
