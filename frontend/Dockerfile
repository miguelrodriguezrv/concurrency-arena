# Multi-stage Dockerfile for building a JS SPA with Bun and serving it with nginx
#
# Stage 1: build the frontend static assets using Bun
FROM oven/bun:latest AS build

# Set working directory
WORKDIR /app

# Copy package manifests first for better cacheability.
COPY package.json bun.lockb* ./
# Install dependencies with Bun
RUN bun install

# Copy the rest of the source and build
COPY . .
RUN bun run build

# Stage 2: serve with nginx
FROM nginx:1.29-alpine AS runtime

# Remove the default nginx html (optional)
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets from the build stage into nginx's web root.
COPY --from=build /app/dist /usr/share/nginx/html

# Precompress all .wasm files (handles fingerprinted/hashed names) so nginx can serve pre-gzipped files via gzip_static.
# Keeps the original .wasm alongside the .gz for clients that don't accept gzip.
RUN find /usr/share/nginx/html -type f -name '*.wasm' -exec gzip -9 -k {} \;

# Copy custom nginx configuration (expects `frontend/nginx/default.conf` in the build context)
# This config should implement SPA fallback and proxying for API routes.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Expose HTTP
EXPOSE 80

# Optional: a minimal healthcheck (curl is not available by default in this image)
# If you need more robust checks, install curl/wget in the image or rely on external health checks.
# HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q -O /dev/null http://localhost/ || exit 1

# Run nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
