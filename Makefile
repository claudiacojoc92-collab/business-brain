.PHONY: help install build type-check lint test test-all \
        db-up db-down db-migrate db-seed db-reset \
        dev-api dev-workers dev-all \
        validate-prompts \
        k8s-apply k8s-delete \
        clean

# ─── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo "Business Brain — Available targets:"
	@echo ""
	@echo "  Setup"
	@echo "    install          Install all npm dependencies"
	@echo "    build            Type-check all packages"
	@echo ""
	@echo "  Quality"
	@echo "    type-check       Run tsc --noEmit across all packages"
	@echo "    lint             Run eslint across all packages"
	@echo "    test             Run unit tests across all packages"
	@echo "    test-all         type-check + lint + test"
	@echo ""
	@echo "  Database"
	@echo "    db-up            Start Postgres and Redis"
	@echo "    db-down          Stop and remove containers"
	@echo "    db-migrate       Apply Flyway migrations"
	@echo "    db-seed          Seed dev data"
	@echo "    db-reset         db-down + db-up + db-migrate + db-seed"
	@echo ""
	@echo "  Development"
	@echo "    dev-api          Start API server (ts-node)"
	@echo "    dev-workers      Start workers (ts-node)"
	@echo "    dev-all          db-up + dev-api + dev-workers"
	@echo ""
	@echo "  Prompts"
	@echo "    validate-prompts Verify all prompt checksums"
	@echo ""
	@echo "  Kubernetes"
	@echo "    k8s-apply        Apply all K8s manifests"
	@echo "    k8s-delete       Delete all K8s resources"
	@echo ""
	@echo "  Cleanup"
	@echo "    clean            Remove node_modules and dist/"

# ─── Setup ────────────────────────────────────────────────────────────────────
install:
	npm install

build: type-check

# ─── Quality ──────────────────────────────────────────────────────────────────
type-check:
	npx tsc --noEmit -p packages/shared/tsconfig.json
	npx tsc --noEmit -p packages/domain/tsconfig.json
	npx tsc --noEmit -p packages/application/tsconfig.json
	npx tsc --noEmit -p packages/infrastructure/tsconfig.json
	npx tsc --noEmit -p apps/api/tsconfig.json
	npx tsc --noEmit -p apps/workers/tsconfig.json

lint:
	npx eslint packages/shared/src --max-warnings 0
	npx eslint packages/domain/src --max-warnings 0
	npx eslint packages/application/src --max-warnings 0
	npx eslint packages/infrastructure/src --max-warnings 0
	npx eslint apps/api/src --max-warnings 0
	npx eslint apps/workers/src --max-warnings 0

test:
	npx vitest run packages/shared
	npx vitest run packages/domain
	npx vitest run packages/application
	npx vitest run packages/infrastructure
	npx vitest run apps/api
	npx vitest run apps/workers

test-all: type-check lint test

# ─── Database ─────────────────────────────────────────────────────────────────
db-up:
	docker compose up postgres redis -d
	@echo "Waiting for Postgres to be ready..."
	@until docker compose exec postgres pg_isready -U bbuser -d businessbrain; do sleep 1; done
	@echo "Postgres ready."

db-down:
	docker compose down -v

db-migrate:
	docker compose run --rm migrate

db-seed:
	bash deployment/scripts/seed-dev.sh

db-reset: db-down db-up db-migrate db-seed
	@echo "Database reset complete."

# ─── Development ──────────────────────────────────────────────────────────────
dev-api:
	DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5432/businessbrain \
	REDIS_URL=redis://localhost:6379 \
	NODE_ENV=development \
	npx ts-node apps/api/src/main.ts

dev-workers:
	DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5432/businessbrain \
	REDIS_URL=redis://localhost:6379 \
	NODE_ENV=development \
	SCHEDULER=true \
	npx ts-node apps/workers/src/main.ts

dev-all:
	$(MAKE) db-up
	$(MAKE) db-migrate
	@echo "Starting API and workers in background..."
	$(MAKE) dev-api &
	$(MAKE) dev-workers &
	@echo "Dev environment running. Ctrl+C to stop."

# ─── Prompts ──────────────────────────────────────────────────────────────────
validate-prompts:
	bash deployment/scripts/validate-prompts.sh

# ─── Kubernetes ───────────────────────────────────────────────────────────────
k8s-apply:
	kubectl apply -f deployment/k8s/configmaps/
	kubectl apply -f deployment/k8s/api-deployment.yaml
	kubectl apply -f deployment/k8s/workers-deployment.yaml
	kubectl apply -f deployment/k8s/hpa.yaml

k8s-delete:
	kubectl delete -f deployment/k8s/ --ignore-not-found

# ─── Cleanup ──────────────────────────────────────────────────────────────────
clean:
	find . -name "node_modules" -type d -prune -exec rm -rf {} +
	find . -name "dist" -type d -prune -exec rm -rf {} +
