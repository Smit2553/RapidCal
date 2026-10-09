FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html privacy.html terms.html styles.css logo.svg icon.png CNAME /usr/share/nginx/html/
COPY privacy /usr/share/nginx/html/privacy
COPY terms /usr/share/nginx/html/terms

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/health || exit 1
