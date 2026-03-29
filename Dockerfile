FROM node:20-alpine

# Install global Google Workspace CLI
RUN npm install -g @googleworkspace/cli

WORKDIR /app

# Install dependencies
COPY package.json .
RUN npm install --production

# Copy app files
COPY server.js .
COPY public/ ./public/
COPY scrapers/ ./scrapers/
COPY i18n/ ./i18n/
COPY help/ ./help/

# Data directory (will be mounted as a volume)
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
