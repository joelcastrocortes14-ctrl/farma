# VitalTrack: imagen pequeña de producción. La base de datos y las fotos van en /data (volumen persistente).
FROM node:22-alpine
ENV NODE_ENV=production TZ=America/Bogota DB_FILE=/data/drogueria.db PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
# Se ejecuta como root a propósito: los discos persistentes de Render/Railway se montan como root y un usuario
# sin privilegios no podría escribir la base de datos en el primer arranque.
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:${PORT}/api/salud || exit 1
CMD ["node", "--no-warnings", "src/server.js"]
