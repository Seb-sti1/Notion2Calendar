FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

RUN npm install -g npm@latest
COPY ./package*.json /app/
RUN npm install --omit=dev
COPY ./dist/ /app/dist/

CMD ["npm", "run", "production"]