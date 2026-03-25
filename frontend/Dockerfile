# Multi-stage Dockerfile for building a JS SPA with Bun and serving it with nginx
#
# Stage 1: build the frontend static assets using Bun
FROM oven/bun:latest AS build

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install

COPY . .
RUN bun run build

# Stage 2: serve with nginx
FROM nginx:1.29-alpine AS runtime

# Remove the default nginx html
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets from the build stage into nginx's web root.
COPY --from=build /app/dist /usr/share/nginx/html

# Precompress all .wasm files (handles fingerprinted/hashed names) so nginx can serve pre-gzipped files via gzip_static.
# Keeps the original .wasm alongside the .gz for clients that don't accept gzip.
RUN find /usr/share/nginx/html -type f -name '*.wasm' -exec gzip -9 -k {} \;

# Copy custom nginx configuration (expects `frontend/nginx/default.conf` in the build context)
# This config should implement SPA fallback and proxying for API routes.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
