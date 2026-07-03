from pydantic import BaseModel, Field
from typing import List, Optional

class SiteEditRequest(BaseModel):
    id: str
    type: str
    lat: float
    lon: float
    azimuth: int
    radius_m: Optional[int] = 600
    remark: Optional[str] = 'New Site'
    tlp_id: Optional[str] = 'N/A'
    tlp_name: Optional[str] = 'N/A'
    antenna_type: Optional[str] = 'Normal' # Normal or High-Gain

class SaveEditsRequest(BaseModel):
    airport: str
    sites: List[SiteEditRequest]
    bbox: Optional[List[float]] = None

class ProcessLogRequest(BaseModel):
    file_path: str
