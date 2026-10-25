#!/bin/bash
# PROD is set in compose.yml and defaults to false. It picks the certificate:
#   false: self-signed, generated here on first start -> nginx_no_letsencrypt.conf
#   true:  Let's Encrypt, obtained by lets_enc.sh below -> nginx_letsencrypt.conf
set -e

if [ "${PROD,,}" = "true" ]; then
    echo "PROD=true - using the Let's Encrypt certificate."
    ./lets_enc.sh
    # Monthly renewal job, put in the crontab by init.sh at image build time.
    service cron start
    CONF=/nginx_letsencrypt.conf
else
    # Generate a self-signed certificate on first start if none exists yet. The
    # certs live in /certificates inside the container, so they are regenerated
    # whenever it is recreated and no private key is ever committed. The Let's
    # Encrypt flow uses a separate store (/etc/letsencrypt) and is unaffected.
    CERT_DIR=/certificates
    if [ ! -f "$CERT_DIR/serverKey.pem" ] || [ ! -f "$CERT_DIR/server.pem" ]; then
        echo "No self-signed certificate found in $CERT_DIR - generating one..."
        mkdir -p "$CERT_DIR"
        openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
            -keyout "$CERT_DIR/serverKey.pem" \
            -out "$CERT_DIR/server.pem" \
            -subj "/CN=localhost"
    fi
    CONF=/nginx_no_letsencrypt.conf
fi

exec /usr/local/nginx/sbin/nginx -c $CONF
