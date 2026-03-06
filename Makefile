# Makefile for building frontend + backend and packaging static assets
SHELL := /bin/bash

# Customize these if needed
FRONTEND_DIR := frontend
BACKEND_DIR := backend
FRONTEND_BUILD_DIR := $(FRONTEND_DIR)/dist
BACKEND_STATIC_DIR := $(BACKEND_DIR)/static
BIN_DIR := bin
BACKEND_BIN := $(BIN_DIR)/relay

.PHONY: all build frontend build-frontend build-backend bundle clean run docker-build

all: build

build: build-frontend bundle build-backend

# Build frontend (production)
build-frontend:
	@echo "==> Building frontend (production) with bun"
	@( \
	  cd $(FRONTEND_DIR) && \
	  if [ -f bun.lockb ] || [ -f package.json ]; then \
	    bun install; \
	  else \
	    echo "No bun project found in $(FRONTEND_DIR)"; exit 1; \
	  fi; \
	  BUN_ENV=production bun run build; \
	)

# Copy frontend build into backend/static
bundle: build-frontend
	@echo "==> Bundling frontend assets into backend static directory"
	rm -rf $(BACKEND_STATIC_DIR)
	mkdir -p $(BACKEND_STATIC_DIR)
	cp -r $(FRONTEND_BUILD_DIR)/* $(BACKEND_STATIC_DIR)/

# Build backend binary (output in ./bin)
build-backend:
	@echo "==> Building backend"
	mkdir -p $(BIN_DIR)
	cd $(BACKEND_DIR) && \
	CGO_ENABLED=0 go build -ldflags "-s -w" -o ../$(BACKEND_BIN) ./...

run: build
	@echo "==> Running backend binary"
	./$(BACKEND_BIN)

# Build a Docker image for production (optional)
docker-build:
	docker build -t concurrency-arena:prod .

clean:
	@echo "==> Cleaning build artifacts"
	rm -rf $(BACKEND_STATIC_DIR)
	rm -rf $(FRONTEND_BUILD_DIR)
	rm -rf $(BIN_DIR)
