.PHONY: build build-all build-arm64 build-amd64 build-universal build-current clean gen-version dev help

# Makefile wrapper for Taskfile - Deprecated, use 'task' directly
# All build logic has been migrated to Taskfile.yml

help:
	@echo "Harmony Hadice - Build System"
	@echo ""
	@echo "NOTICE: This Makefile is deprecated. Use 'task' directly instead."
	@echo ""
	@echo "Available tasks:"
	@task --list
	@echo ""
	@echo "Examples:"
	@echo "  task build:all          - Build all architectures"
	@echo "  task build:arm64        - Build arm64 architecture"
	@echo "  task build:amd64        - Build amd64 architecture"
	@echo "  task build:universal    - Build universal binary"
	@echo "  task clean              - Clean build artifacts"
	@echo "  task gen:version        - Generate version file"
	@echo "  task dev                - Run in development mode"

# Legacy Make targets - forward to task equivalents

build: build-all

build-all:
	@task build:all

build-arm64:
	@task build:arm64

build-amd64:
	@task build:amd64

build-universal:
	@task build:universal

build-current: build-arm64
	@echo "Build complete for current architecture"

clean:
	@task clean

gen-version:
	@task gen:version

dev:
	@task dev

# Default target
.DEFAULT_GOAL := help
