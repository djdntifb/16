import uuid

from fastapi import APIRouter, HTTPException, status

from ..deps import AdminOnly, CurrentUser, DB
from ..models import Client
from ..schemas import ClientCreate, ClientOut, ClientUpdate

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("", response_model=list[ClientOut])
def list_clients(user: CurrentUser, db: DB):
    return db.query(Client).filter(Client.deleted == False).order_by(Client.name).all()


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create_client(body: ClientCreate, user: AdminOnly, db: DB):
    client = Client(**body.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return client


@router.put("/{client_id}", response_model=ClientOut)
def update_client(client_id: uuid.UUID, body: ClientUpdate, user: AdminOnly, db: DB):
    client = _get(client_id, db)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(client, k, v)
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_id: uuid.UUID, user: AdminOnly, db: DB):
    client = _get(client_id, db)
    client.deleted = True
    db.commit()


def _get(client_id: uuid.UUID, db) -> Client:
    c = db.query(Client).filter(Client.id == client_id, Client.deleted == False).first()
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")
    return c
