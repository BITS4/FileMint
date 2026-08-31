FROM node:24-bookworm-slim

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

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/requirements.lock.txt ./server/requirements.lock.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r server/requirements.lock.txt

COPY . .

EXPOSE 8787

CMD ["npm", "run", "server"]
