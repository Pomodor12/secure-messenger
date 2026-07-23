FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=

COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN npm install
RUN cd server && npm install
RUN cd client && npm install

COPY . .

RUN cd client && npx react-scripts build

EXPOSE 8080

CMD ["node", "server/index.js"]
