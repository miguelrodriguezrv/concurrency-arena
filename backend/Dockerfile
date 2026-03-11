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
ARG CGO_ENABLED=0
ARG GOOS=linux
ARG GOARCH=arm64
ARG BUILDTAGS=""
ARG LDFLAGS="-s -w"

# Build the binary.
RUN CGO_ENABLED=${CGO_ENABLED} GOOS=${GOOS} GOARCH=${GOARCH} \
    go build -trimpath -tags "${BUILDTAGS}" -ldflags "${LDFLAGS}" -o /out/server .

############
# Runtime
############
FROM gcr.io/distroless/static:nonroot

# Create a non-root user is already handled by this distroless image variant.
# Copy the binary from the builder stage
COPY --from=builder /out/server /usr/local/bin/server

# Expose the port your app listens on (adjust if different)
EXPOSE 8080

# Entrypoint: run the server
ENTRYPOINT ["/usr/local/bin/server"]
