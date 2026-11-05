# Run from the repo root inside WSL. (Install make once with: sudo apt install make)
.PHONY: dev-backend dev-frontend up down seed

# --reload-dir app: only watch our source, not workdir/ (cloned repos) or venv/
dev-backend:
	cd backend && ./venv/bin/uvicorn app.main:app --reload --reload-dir app

dev-frontend:
	cd frontend && npm run dev

# Traefik (port 80 for apps, 8080 for its dashboard)
up:
	docker compose up -d

down:
	docker compose down

seed:
	cd backend && ./venv/bin/python -m app.seed
