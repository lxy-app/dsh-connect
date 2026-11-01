# Build stages run natively. On ARM hosts pass
# --build-arg BUILDPLATFORM=linux/arm64 together with --platform linux/amd64.
ARG BUILDPLATFORM=linux/amd64

# Build the React admin without carrying Node.js into the runtime image.
FROM --platform=${BUILDPLATFORM} docker.m.daocloud.io/library/node:24-alpine AS admin-build
WORKDIR /src/admin
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/admin/ ./
RUN npm run build

# Build a static Go binary so the final image needs no Go toolchain.
FROM --platform=${BUILDPLATFORM} docker.m.daocloud.io/library/golang:1.26-alpine AS server-build
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" \
    -o /out/dsh-connect-server ./cmd/server

FROM docker.m.daocloud.io/library/alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app
WORKDIR /app
COPY --from=server-build /out/dsh-connect-server /usr/local/bin/dsh-connect-server
COPY --from=admin-build /src/admin/dist/ ./admin/

ENV DSH_CONNECT_LISTEN_ADDR=0.0.0.0:8787 \
    DSH_CONNECT_ADMIN_DIR=/app/admin
EXPOSE 8787
USER app
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8787/ || exit 1
ENTRYPOINT ["/usr/local/bin/dsh-connect-server"]
