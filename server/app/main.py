from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import auth, clients, entries, invoices, rates, reports, settings as settings_router, users

app = FastAPI(title="Halifax Time API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in [auth.router, entries.router, clients.router, users.router,
               rates.router, invoices.router, reports.router, settings_router.router]:
    app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
