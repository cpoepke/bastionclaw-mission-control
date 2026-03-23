#!/bin/sh
set -e

# Inject runtime secrets into the Vite bundle.
# The build embeds __VITE_SUPABASE_URL__ and __VITE_SUPABASE_ANON_KEY__
# as literal placeholders; we replace them here from env vars injected
# by the Infisical operator.
for f in /usr/share/nginx/html/assets/*.js; do
  sed -i \
    -e "s|__VITE_SUPABASE_URL__|${VITE_SUPABASE_URL}|g" \
    -e "s|__VITE_SUPABASE_ANON_KEY__|${VITE_SUPABASE_ANON_KEY}|g" \
    "$f"
done

exec nginx -g 'daemon off;'
