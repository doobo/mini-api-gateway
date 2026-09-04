FROM oven/bun:alpine

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun build src/index.ts \
    --compile \
    --outfile /app/mini-api-gateway

RUN mkdir -p /data

VOLUME ["/data"]

EXPOSE 5630

ENV DATABASE_PATH=/data/gateway.db
ENV PORT=5630

CMD ["/app/mini-api-gateway"]
