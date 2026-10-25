export CC=gcc

# get desired nginx version
wget http://nginx.org/download/nginx-1.25.1.tar.gz
tar xzvf nginx-1.25.1.tar.gz
cd nginx-1.25.1

./configure --with-http_ssl_module
make

# install and finish
make install

# check
/usr/local/nginx/sbin/nginx -v
# nginx version: nginx/1.25.1

# Create chron job that activates once per month to renew certificates. The
# certificate is first issued with --standalone (see letsencrypt_cert_gen.sh), but
# by renewal time nginx owns port 80, so renewals go through the webroot instead:
# both nginx configurations serve /.well-known/acme-challenge from /var/www/certbot.
echo "0 3 1 * * certbot renew --webroot -w /var/www/certbot && /usr/local/nginx/sbin/nginx -s reload" | crontab -
