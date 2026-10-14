FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html privacy.html terms.html styles.css logo.svg icon.png promo.mp4 promo-poster.png promo-poster.webp CNAME /usr/share/nginx/html/
COPY privacy /usr/share/nginx/html/privacy
COPY terms /usr/share/nginx/html/terms
COPY .well-known /usr/share/nginx/html/.well-known

EXPOSE 80 3000
