#!/bin/bash
# Obtains the Let's Encrypt certificate. Called by run.sh when PROD=true, before
# nginx starts: --standalone means certbot answers the ACME challenge on port 80
# itself, which is still free at that point. --keep-until-expiring makes this a
# no-op once a certificate exists, so only the first start talks to Let's
# Encrypt. Renewals are the cron job's, see init.sh.
set -e

# Replace example.com with the acquired domain, here and in nginx_letsencrypt.conf.
DOMAIN=example.com
EMAIL=info@example.com

certbot certonly --standalone --keep-until-expiring \
    -d "$DOMAIN" -m "$EMAIL" --agree-tos -n

# list certificates -> certbot certificates
# renew certs test (no changes) -> certbot renew --dry-run
# renew certs real, skip if not time -> certbot renew
# certbot renew force renewal -> certbot renew --force-renewal
# Things to do on auto renew -> certbot renew && /usr/local/nginx/sbin/nginx -s reload
