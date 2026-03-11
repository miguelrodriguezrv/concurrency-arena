# Makefile for building frontend + backend and packaging static assets
SHELL := /bin/bash

# Customize these if needed
FRONTEND_DIR := frontend
BACKEND_DIR := backend
FRONTEND_BUILD_DIR := $(FRONTEND_DIR)/dist
BACKEND_STATIC_DIR := $(BACKEND_DIR)/static
BIN_DIR := bin
BACKEND_BIN := $(BIN_DIR)/relay

.PHONY: all build frontend build-frontend build-wasm bundle build-backend clean run docker-build

all: build

# Top-level build: frontend -> copy into backend/static -> build backend native binary
# Note: wasm build/compression is intentionally detached (see build-wasm targets)
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

# Build wasm (compile then compress). This target compiles the wasm package and
# produces both pre-compressed artifacts (.br and .gz) for efficient serving.
# This is intentionally a separate step because the wasm rarely changes.
build-wasm: build-wasm-compile compress-wasm
	@echo "==> build-wasm complete (compiled + compressed)"

# Compile the WASM runner into backend/static/main.wasm
build-wasm-compile:
	@echo "==> Building WASM runner (GOOS=js GOARCH=wasm)"
	mkdir -p $(BACKEND_STATIC_DIR)
	cd $(BACKEND_DIR) && \
		GOOS=js GOARCH=wasm go build -ldflags "-s -w" -o static/main.wasm ./wasm

# Compress the compiled wasm with Brotli and gzip (if available)
compress-wasm:
	@echo "==> Compressing WASM (brotli + gzip)"
	if [ ! -f $(BACKEND_STATIC_DIR)/main.wasm ]; then \
	  echo "Error: $(BACKEND_STATIC_DIR)/main.wasm not found. Run build-wasm-compile first."; exit 1; \
	fi
	# Brotli (high quality) - skip if brotli not available
	if command -v brotli >/dev/null 2>&1; then \
	  echo "  - brotli (high quality)"; \
	  brotli -q 11 -o $(BACKEND_STATIC_DIR)/main.wasm.br $(BACKEND_STATIC_DIR)/main.wasm || true; \
	else \
	  echo "  - brotli not found; skipping .br generation"; \
	fi
	# gzip (max compression)
	if command -v gzip >/dev/null 2>&1; then \
	  echo "  - gzip"; \
	  gzip -9 -c $(BACKEND_STATIC_DIR)/main.wasm > $(BACKEND_STATIC_DIR)/main.wasm.gz || true; \
	else \
	  echo "  - gzip not found; skipping .gz generation"; \
	fi

# Build backend binary - only build the main package (.) to avoid compiling everything (./...)
build-backend:
	@echo "==> Building backend"
	mkdir -p $(BIN_DIR)
	cd $(BACKEND_DIR) && \
		CGO_ENABLED=0 go build -ldflags "-s -w" -o ../$(BACKEND_BIN) .

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
