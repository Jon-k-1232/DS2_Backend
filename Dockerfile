FROM node:20.18.0-alpine

RUN apk add --no-cache curl tini

ENV TZ=America/Phoenix
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Drop root for runtime
RUN addgroup -S app && adduser -S -G app app \
  && chown -R app:app /app
USER app

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
