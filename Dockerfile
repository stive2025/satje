FROM node:18-alpine

# Dependencias del sistema para Chromium en Alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji

# Puppeteer usará el Chromium del sistema, no el bundled
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
# RUN npm ci --omit=dev

# Por esto:
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p logs

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3030/ping || exit 1

CMD ["node", "src/index.js"]
