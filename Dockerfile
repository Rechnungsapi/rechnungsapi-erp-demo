# The demo ERP in a small image. Build: docker build -t rechnungsapi-erp-demo .
FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
LABEL org.opencontainers.image.title="rechnungsapi-erp-demo" \
      org.opencontainers.image.description="Open-source demo ERP that creates, validates and reads ZUGFeRD and XRechnung e-invoices with RechnungsAPI" \
      org.opencontainers.image.vendor="RechnungsAPI" \
      org.opencontainers.image.url="https://rechnungsapi.de" \
      org.opencontainers.image.source="https://github.com/Rechnungsapi/rechnungsapi-erp-demo" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data DEMO_IN_DOCKER=1
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public

# The data folder belongs to the unprivileged user that runs the demo.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/index.js"]
