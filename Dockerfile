# UNA Chat en Docker (parte 3 del laboratorio de monitoreo)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencias primero (aprovecha la caché de Docker)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código de la aplicación
COPY server.js instrument.js otel.js index.html ./
COPY libs ./libs
COPY public ./public

# Usuario sin privilegios
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Mismo comando de inicio definido en package.json
CMD ["npm", "start"]
