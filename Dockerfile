FROM node:20-slim

# Install latest official Google Chrome Stable and fonts for Puppeteer
RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates procps \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] https://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instruct Puppeteer to use the pre-installed system Google Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Install root dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy entire application (including tracked sign-app/build)
COPY . .

# Ensure production frontend build exists
RUN if [ ! -f /app/sign-app/build/index.html ]; then \
      echo "Building sign-app frontend..." && \
      cd /app/sign-app && npm install && npm run build && cd /app; \
    fi

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
