# Build context is the ies-prototype/ root (see docker-compose.yml's `build:`
# block), so this can pull in src/ alongside webhook-server/.
FROM node:22-alpine
WORKDIR /app
COPY src ./src
COPY webhook-server/server.js ./server.js
COPY webhook-server/package.json ./package.json
EXPOSE 3002
CMD ["node", "server.js"]
