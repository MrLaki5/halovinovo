# Halovinovo: Raspberry Pi + Cloudflare Tunnel Deployment

Runs the app with Docker Compose on a Raspberry Pi and publishes it at
`halovinovo.mementoweb.cc` through a Cloudflare Tunnel. You don't need port forwarding or
certificates, and the Pi only needs outbound internet.

```
Phone → https://halovinovo.mementoweb.cc
      → Cloudflare (TLS terminated, photos cached)
        → cloudflared tunnel
          → Pi 127.0.0.1:8013
            → halovinovo_app (FastAPI) → halovinovo_db (Postgres)
```

All commands below run on the Pi over SSH unless noted. They use `$USER` and `$HOME`, so
you can paste them as they are.

---

## 1. Flash the OS

On your laptop, open Raspberry Pi Imager and choose **Raspberry Pi OS Lite (64-bit)**. On a
Pi 3 the 64-bit OS is required, because the Docker images and `cloudflared` below are arm64.
In the Imager settings:

- set the hostname (e.g. `halovinovo`), username and password
- enable SSH
- set up Wi-Fi if you won't use Ethernet

Use a good A1/A2 SD card (or a USB SSD) and a proper 5V/2.5A power supply.

```bash
# From your laptop
ssh <user>@halovinovo.local
```

---

## 2. Update the System

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git
sudo reboot
```

---

## 3. Install Docker

Docker's official install script supports Raspberry Pi OS:

```bash
curl -fsSL https://get.docker.com | sudo sh

# Run docker without sudo
sudo usermod -aG docker $USER
```

Log out and SSH back in so the group change applies, then check:

```bash
docker run --rm hello-world
docker compose version
```

Docker is enabled on boot by the installer. The containers have `restart: always`, so the
app comes back by itself after a reboot.

---

## 4. Get the App

```bash
git clone https://github.com/MrLaki5/halovinovo.git ~/halovinovo
cd ~/halovinovo
```

> If the repo is private, cloning over HTTPS asks for a GitHub personal access token as the
> password. You can also add an SSH key to the Pi and clone `git@github.com:MrLaki5/halovinovo.git`.

---

## 5. Create the Environment File

```bash
cd ~/halovinovo
cp .example.env .env
sed -i "s/^SESSION_SECRET_KEY=.*/SESSION_SECRET_KEY=$(openssl rand -hex 32)/" .env
nano .env        # set ADMIN_PASSWORD (and ADMIN_USERNAME if you want another name)
chmod 600 .env
```

---

## 6. Start the App

```bash
cd ~/halovinovo
docker compose up -d --build
```

The first build takes a few minutes on a Pi 3. Check that it answers locally:

```bash
docker compose ps
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8013/    # expect 200
```

The app listens on `127.0.0.1` only, so your LAN can't reach it directly. Everyone goes
through the tunnel.

---

## 7. Install Cloudflared

```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared-linux-arm64
sudo mv cloudflared-linux-arm64 /usr/local/bin/cloudflared

cloudflared --version
```

---

## 8. Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This prints a URL. Open it in your laptop's browser, select `mementoweb.cc` and authorize.
That saves `~/.cloudflared/cert.pem` on the Pi.

---

## 9. Create the Tunnel

```bash
cloudflared tunnel create halovinovo
```

This saves the tunnel's credentials to `~/.cloudflared/<UUID>.json`.

---

## 10. Create the Tunnel Config

On a clean Pi the credentials file is the only `.json` file in `~/.cloudflared`, so the
UUID can be read from its name:

```bash
TUNNEL_ID=$(basename ~/.cloudflared/*.json .json)
echo "$TUNNEL_ID"    # should be a single UUID

cat > ~/.cloudflared/config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: halovinovo.mementoweb.cc
    service: http://localhost:8013
  - service: http_status:404   # required catch-all
EOF

chmod 600 ~/.cloudflared/config.yml
cat ~/.cloudflared/config.yml
```

---

## 11. Route DNS

This creates the `halovinovo` CNAME in Cloudflare DNS:

```bash
cloudflared tunnel route dns halovinovo halovinovo.mementoweb.cc
```

---

## 12. Test the Tunnel Manually

```bash
cloudflared tunnel run halovinovo
```

On your phone, open `https://halovinovo.mementoweb.cc` and `https://halovinovo.mementoweb.cc/admin`.
If both load, stop it with `Ctrl+C` and continue.

---

## 13. Install Cloudflared as a systemd Service

```bash
# Use the explicit config path, because sudo resolves ~ to /root
sudo cloudflared --config $HOME/.cloudflared/config.yml service install

sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

> The service reads a copy of the config at `/etc/cloudflared/config.yml`. If you edit
> `~/.cloudflared/config.yml` later, copy it there again and run `sudo systemctl restart cloudflared`.

---

## 14. Reboot Test

```bash
sudo reboot
```

After the Pi is back up, `https://halovinovo.mementoweb.cc` should load without you doing anything.

---

## Running on Boot

```
docker.service        → halovinovo_db + halovinovo_app (restart: always), app on 127.0.0.1:8013
cloudflared.service   → Cloudflare tunnel → halovinovo.mementoweb.cc
```

---

## Before the Party

```bash
vcgencmd get_throttled    # 0x0 means no undervoltage or overheating
docker stats --no-stream  # memory use of the two containers
df -h /                   # free space for photos and Postgres
```

Leave about 10 browser tabs open on the guest page for an hour, and watch the commands above.

---

## Updating the App

```bash
cd ~/halovinovo
git pull
docker compose up -d --build
```

The database (`db_persist_data/`), photos (`uploads/`) and `.env` aren't tracked by git, so
updates leave them alone.

---

## Logs

```bash
docker compose -f ~/halovinovo/compose.yml logs -f app
sudo journalctl -u cloudflared -f
```

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `permission denied ... docker.sock` | Docker group not active yet | Log out and SSH back in after `usermod` |
| Cloudflare error 1033 | Tunnel not running | `sudo systemctl status cloudflared`, check `journalctl -u cloudflared` |
| Cloudflare error 502 | Tunnel is up but the app isn't | `docker compose ps`, then `curl http://127.0.0.1:8013/` on the Pi |
| Cloudflared config not found | `sudo` resolves `~` to `/root/` | Use the full path: `--config $HOME/.cloudflared/config.yml` |
| `route dns` fails with "record already exists" | A `halovinovo` DNS record already exists | Delete it in the Cloudflare dashboard and run the command again |
| Host login doesn't stick | Opened over plain `http://` with the Pi's IP | Use `https://halovinovo.mementoweb.cc`, because the cookies are HTTPS-only |
| Pi slow, `get_throttled` not `0x0` | Weak power supply or overheating | Use a 5V/2.5A supply, give the Pi some airflow |
