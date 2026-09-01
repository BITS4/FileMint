FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PYTHONUNBUFFERED=1 \
    FILEMINT_FAST_HOSTED_OCR=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-dejavu \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-core \
    ghostscript \
    libgl1 \
    libglib2.0-0 \
    libreoffice \
    ocrmypdf \
    poppler-utils \
    python3 \
    python3-pip \
    qpdf \
    tesseract-ocr \
    tesseract-ocr-ara \
    tesseract-ocr-chi-sim \
    tesseract-ocr-eng \
    tesseract-ocr-fas \
    tesseract-ocr-rus \
    unpaper \
  && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

COPY server/requirements.lock.txt ./server/requirements.lock.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r server/requirements.lock.txt \
  && python3 -m pip check

COPY --chown=node:node . .

RUN mkdir -p /app/server/data && chown -R node:node /app/server/data

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent http://localhost:8787/health >/dev/null || exit 1

CMD ["npm", "run", "start", "--prefix", "server"]
