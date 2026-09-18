# Imagem única: o mesmo processo serve o site e aceita as conexões WebSocket.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/game/track.ts ./src/game/track.ts
COPY tsconfig.server.json ./
EXPOSE 3001
CMD ["npm", "start"]
