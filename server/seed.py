"""
Seed the database from client/assets/dummy_data.json.
Run after migrations: python seed.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.auth import hash_password
from app.database import SessionLocal
from app.models import AppSettings, Base, Client, Rate, User
from app.database import engine

Base.metadata.create_all(bind=engine)

DATA_FILE = Path(__file__).parent.parent / "client" / "assets" / "dummy_data.json"


def seed():
    data = json.loads(DATA_FILE.read_text())
    db = SessionLocal()

    try:
        if db.query(User).count() > 0:
            print("Database already seeded — skipping.")
            return

        user_map: dict[str, User] = {}
        for u in data["users"]:
            user = User(
                name=u["name"],
                email=u["email"],
                password_hash=hash_password(u["password"]),
                role=u["role"],
                deleted=u.get("deleted", False),
            )
            db.add(user)
            db.flush()
            user_map[u["email"]] = user

        client_map: dict[str, Client] = {}
        for c in data["clients"]:
            client = Client(
                name=c["name"],
                billing_email=c.get("billing_email"),
                terms=c.get("terms"),
                address=c.get("address"),
                deleted=c.get("deleted", False),
            )
            db.add(client)
            db.flush()
            client_map[c["id"]] = client

        for r in data.get("rates", []):
            user = user_map.get(r["consultant_email"])
            client = client_map.get(r["client_id"])
            if user and client:
                db.add(Rate(
                    user_id=user.id,
                    client_id=client.id,
                    rate=r["rate"],
                    effective_from=r.get("effective_from"),
                ))

        s = data.get("settings", {})
        db.add(AppSettings(
            id=1,
            company_name=s.get("company_name"),
            rounding_minutes=s.get("rounding_minutes", 6),
            week_ending=s.get("week_ending", "Sunday"),
            timezone=s.get("timezone", "America/New_York"),
            currency=s.get("currency", "USD"),
        ))

        db.commit()
        print(f"Seeded {len(user_map)} users, {len(client_map)} clients.")

    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()


if __name__ == "__main__":
    seed()
