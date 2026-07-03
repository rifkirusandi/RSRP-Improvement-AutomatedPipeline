import pytest
from fastapi.testclient import TestClient
from app import app
import json

client = TestClient(app)

def test_check_deps():
    response = client.get("/api/check_deps")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ok", "missing_deps"]
    assert "installed" in data
    assert "missing" in data

def test_save_edits_validation_error():
    # Sending invalid data types
    payload = {
        "airport": "Test Airport",
        "sites": [
            {
                "id": 123, # should be string but pydantic coerces if possible, let's omit a required field
                "lat": "not_a_float",
                "lon": 100.0,
                "azimuth": "not_an_int"
            }
        ]
    }
    response = client.post("/api/save_edits", json=payload)
    assert response.status_code == 422 # Pydantic validation error

def test_save_edits_empty_payload():
    response = client.post("/api/save_edits", json={})
    assert response.status_code == 422
