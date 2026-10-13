############
# Builder
############
FROM golang:1.26-alpine AS builder

# Install tools needed during build
RUN apk add --no-cache git ca-certificates

WORKDIR /src

# Cache dependencies: copy module files and download
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# Build arguments (can be overridden at docker build time)
# TARGETARCH is set by Docker to the architecture being built for
# (amd64 on an Intel NUC, arm64 on Apple Silicon).
ARG CGO_ENABLED=0
ARG GOOS=linux
ARG TARGETARCH
ARG BUILDTAGS=""
ARG LDFLAGS="-s -w"

# Build the binary.
RUN CGO_ENABLED=${CGO_ENABLED} GOOS=${GOOS} GOARCH=${TARGETARCH} \
    go build -trimpath -tags "${BUILDTAGS}" -ldflags "${LDFLAGS}" -o /out/server . && \
    mkdir -p /out/data

############
# Runtime
############
FROM gcr.io/distroless/static:nonroot

# Create a non-root user is already handled by this distroless image variant.
# Copy the binary from the builder stage
COPY --from=builder /out/server /usr/local/bin/server

# State file location (named volume). Created here owned by the nonroot user
# so a fresh volume inherits a writable directory.
COPY --from=builder --chown=nonroot:nonroot /out/data /data

# Expose the port your app listens on (adjust if different)
EXPOSE 8080

# Entrypoint: run the server
ENTRYPOINT ["/usr/local/bin/server"]
