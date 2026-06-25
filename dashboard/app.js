// State Variables
let currentSource = 'MR';
let currentEnv = 'Combine';
let currentAirport = '';
let currentMetric = 'RSRP';
let currentImplState = 'before';

let map;
let mrLayerGroup = L.layerGroup();
let siteLayerGroup = L.layerGroup();
let sectorLayerGroup = L.layerGroup();
let customSites = []; // Holds user-added/edited proposals
let editedStateChanged = false;
let selectedSite = null;

// Initialize Map
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        contextmenu: true
    }).setView([-2.5489, 118.0149], 5);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB',
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mrLayerGroup.addTo(map);
    sectorLayerGroup.addTo(map);
    siteLayerGroup.addTo(map);

    populateAirportDropdown();
    
    document.getElementById('loading-screen').style.display = 'none';
    
    // Right click map to add a new site
    map.on('contextmenu', function(e) {
        if (!currentAirport) return;
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;
        
        const newSite = {
            id: `MANUAL_ARPT_${Math.floor(Math.random() * 10000)}`,
            lat: lat,
            lon: lon,
            azimuth: 0,
            radius_m: 600,
            beamwidth: 65,
            remark: 'New Site',
            type: 'proposed_new',
            tlp_id: 'N/A',
            tlp_name: 'N/A'
        };
        
        customSites.push(newSite);
        markEdited();
        renderMap();
        openEditor(newSite);
    });
}

function markEdited() {
    editedStateChanged = true;
    document.getElementById('save-banner').style.display = 'block';
}

function populateAirportDropdown() {
    const select = document.getElementById('airport-select');
    select.innerHTML = '';
    
    const sortedAirports = Object.keys(DASHBOARD_DATA).sort();
    sortedAirports.forEach((apt, index) => {
        const option = document.createElement('option');
        option.value = apt;
        option.textContent = apt;
        select.appendChild(option);
        
        if (index === 0) currentAirport = apt;
    });

    select.addEventListener('change', (e) => {
        currentAirport = e.target.value;
        customSites = []; // reset manual edits when switching airports
        editedStateChanged = false;
        document.getElementById('save-banner').style.display = 'none';
        closeEditor();
        renderMap();
    });
}

function getSectorPolygon(center, radius, azimuth, beamwidth) {
    const lat = center[0];
    const lon = center[1];
    const R = 6378.137;
    const rad = (radius / 1000) / R;
    const startAngle = azimuth - beamwidth / 2;
    const endAngle = azimuth + beamwidth / 2;

    const points = [center];
    for (let i = 0; i <= 10; i++) {
        const angle = startAngle + (endAngle - startAngle) * (i / 10);
        const brng = angle * Math.PI / 180;
        
        const lat1 = lat * Math.PI / 180;
        const lon1 = lon * Math.PI / 180;
        
        const lat2 = Math.asin(Math.sin(lat1)*Math.cos(rad) + Math.cos(lat1)*Math.sin(rad)*Math.cos(brng));
        const lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(rad)*Math.cos(lat1), Math.cos(rad)-Math.sin(lat1)*Math.sin(lat2));
        
        points.push([lat2 * 180 / Math.PI, lon2 * 180 / Math.PI]);
    }
    return points;
}

function getBearing(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLon = (lon2 - lon1) * toRad;
    const l1 = lat1 * toRad;
    const l2 = lat2 * toRad;

    const y = Math.sin(dLon) * Math.cos(l2);
    const x = Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(dLon);
    let brng = Math.atan2(y, x) * toDeg;
    return (brng + 360) % 360;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const r1 = lat1 * Math.PI/180;
    const r2 = lat2 * Math.PI/180;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

function openEditor(site) {
    selectedSite = site;
    document.getElementById('editor-panel').style.display = 'block';
    document.getElementById('azimuth-slider').value = site.azimuth;
    document.getElementById('azimuth-val').innerText = site.azimuth;
    
    let remarkSelect = document.getElementById('remark-select');
    remarkSelect.value = site.remark;
    if (site.type === 'existing') {
        remarkSelect.value = 'Existing';
        document.getElementById('btn-delete-site').style.display = 'none'; // Cant delete existing
    } else {
        document.getElementById('btn-delete-site').style.display = 'block';
    }
}

function closeEditor() {
    selectedSite = null;
    document.getElementById('editor-panel').style.display = 'none';
}

function setupEditorListeners() {
    document.getElementById('editor-close').addEventListener('click', closeEditor);
    
    document.getElementById('azimuth-slider').addEventListener('input', (e) => {
        if (!selectedSite) return;
        selectedSite.azimuth = parseInt(e.target.value);
        document.getElementById('azimuth-val').innerText = selectedSite.azimuth;
        renderMap();
        markEdited();
    });
    
    document.getElementById('remark-select').addEventListener('change', (e) => {
        if (!selectedSite) return;
        selectedSite.remark = e.target.value;
        selectedSite.beamwidth = (selectedSite.remark === 'Change Antenna') ? 33 : 65;
        if (selectedSite.remark === 'New Site') selectedSite.type = 'proposed_new';
        else if (selectedSite.remark === 'Existing') selectedSite.type = 'existing';
        else selectedSite.type = 'proposed_sector';
        
        renderMap();
        markEdited();
    });
    
    document.getElementById('btn-delete-site').addEventListener('click', () => {
        if (!selectedSite) return;
        
        // Remove from customSites
        customSites = customSites.filter(s => s !== selectedSite);
        
        // Remove from DASHBOARD_DATA if it was original
        let aptData = DASHBOARD_DATA[currentAirport];
        if (aptData && aptData.sites) {
            aptData.sites = aptData.sites.filter(s => s !== selectedSite);
        }
        
        closeEditor();
        markEdited();
        renderMap();
    });
    
    document.getElementById('btn-save-site').addEventListener('click', () => {
        closeEditor();
    });
    

    document.getElementById('btn-add-new-site').addEventListener('click', () => {
        document.getElementById('map').style.cursor = 'crosshair';
        map.once('click', function(e) {
            document.getElementById('map').style.cursor = '';
            
            const numSectors = prompt("How many sectors?", "3");
            if (!numSectors) return;
            const siteId = prompt("Enter Site ID (e.g. NEW_01):", "NEW_01");
            if (!siteId) return;
            
            for(let i = 0; i < parseInt(numSectors); i++) {
                let az = parseInt(prompt(`Azimuth for Sector ${i+1}?`, (i * 120) % 360));
                if (isNaN(az)) continue;
                
                const newSector = {
                    id: siteId,
                    lat: e.latlng.lat,
                    lon: e.latlng.lng,
                    azimuth: az,
                    radius_m: 600, // Default to urban
                    beamwidth: 65,
                    remark: 'New Site',
                    type: 'proposed_new',
                    tlp_id: 'N/A',
                    tlp_name: 'N/A'
                };
                customSites.push(newSector);
            }
            markEdited();
            renderMap();
        });
    });

    document.getElementById('btn-trigger-save').addEventListener('click', () => {
        const aptData = DASHBOARD_DATA[currentAirport];
        let allSites = [];
        if (aptData && aptData.sites) allSites = aptData.sites;
        
        const payload = {
            airport: currentAirport,
            bbox: aptData.bbox || aptData.bounds,
            sites: allSites
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `Edits_${currentAirport.replace(/\s+/g, '_')}.json`);
        dlAnchorElem.click();
        
        document.getElementById('save-banner').style.display = 'none';
        editedStateChanged = false;
    });
}

function renderMap() {
    mrLayerGroup.clearLayers();
    siteLayerGroup.clearLayers();
    sectorLayerGroup.clearLayers();

    if (!currentAirport) return;

    const airport = DASHBOARD_DATA[currentAirport];
    
    // Auto center
    if (!editedStateChanged) { // Only set view if we just switched airport
        const bbox = airport.bbox || airport.bounds;
        const bounds = [
            [bbox[1], bbox[0]],
            [bbox[3], bbox[2]]
        ];
        map.fitBounds(bounds, { padding: [20, 20] });
    }

    // Determine all active sites (original + custom)
    let activeSites = airport.sites || [];
    
    // Draw Sites & Sectors
    activeSites.forEach(site => {
        // Draw sector
        let radius = 200; // default viz radius
        let beamwidth = site.beamwidth || 65;
        let fillColor = (site.type === 'existing') ? 'orange' : (site.type === 'proposed_new' ? 'purple' : (site.remark === 'Change Antenna' ? 'cyan' : 'yellow'));
        
        if (currentImplState === 'after' && site.type !== 'existing') {
             // In after state, proposed sectors show their full predictive range
             radius = site.radius_m || 600;
        }

        const polygonPoints = getSectorPolygon([site.lat, site.lon], radius, site.azimuth, beamwidth);
        const sector = L.polygon(polygonPoints, {
            color: 'black',
            weight: 1,
            fillColor: fillColor,
            fillOpacity: (currentImplState === 'after' && site.type !== 'existing') ? 0.3 : 0.6
        }).addTo(sectorLayerGroup);
        
        sector.on('click', function(e) {
            if (site.type === 'existing') {
                const changedSite = {
                    id: site.id + "_CHG",
                    lat: site.lat,
                    lon: site.lon,
                    azimuth: site.azimuth,
                    radius_m: (site.clutter_radius || 600) * 1.2, // 3GPP Clutter standard + 20%
                    beamwidth: 33,
                    remark: 'Change Antenna',
                    type: 'proposed_sector',
                    tlp_id: 'N/A',
                    tlp_name: 'N/A'
                };
                customSites.push(changedSite);
                markEdited();
                renderMap();
                openEditor(changedSite);
            } else {
                openEditor(site);
            }
        });

        // Draw marker
        let markerClass = 'existing';
        if (site.type === 'proposed_new') markerClass = 'proposed-new';
        if (site.type === 'proposed_sector') markerClass = 'proposed-sector';

        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="marker ${markerClass}"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });

        const isDraggable = (site.type !== 'existing');
        const marker = L.marker([site.lat, site.lon], { icon: icon, draggable: isDraggable }).addTo(siteLayerGroup);
        
        let popupContent = `<b>${site.id}</b><br>Type: ${site.remark}<br>Azimuth: ${site.azimuth}&deg;`;
        if (site.type === 'proposed_new') {
            popupContent += `<br>TLP: ${site.tlp_id}`;
        }
        marker.bindPopup(popupContent);
        
        marker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            site.lat = pos.lat;
            site.lon = pos.lng;
            markEdited();
            renderMap();
            if(selectedSite === site) openEditor(site);
        });
        
        marker.on('click', function(e) {
            if (site.type === 'existing') {
                // Click on the point of existing sites to add a new fan (new sector)
                const newSector = {
                    id: site.id + "_ADD",
                    lat: site.lat,
                    lon: site.lon,
                    azimuth: (site.azimuth + 120) % 360,
                    radius_m: site.clutter_radius || 600, // 3GPP Clutter standard
                    beamwidth: 65,
                    remark: 'Additional Sector',
                    type: 'proposed_sector',
                    tlp_id: 'N/A',
                    tlp_name: 'N/A'
                };
                customSites.push(newSector);
                markEdited();
                renderMap();
                openEditor(newSector);
            } else {
                openEditor(site);
            }
        });
    });

    // Draw MR/MDT Data if 'NONE' is not selected
    if (currentMetric !== 'NONE') {
        let dataPoints = [];
        if (airport.mr_data && airport.mr_data[currentEnv] && airport.mr_data[currentEnv][currentSource]) {
            const metricKey = currentMetric + '_' + currentImplState;
            dataPoints = airport.mr_data[currentEnv][currentSource][metricKey] || [];
        }

        dataPoints.forEach(raw => {
            // Support both array [lon,lat,val] and object {lon,lat,val} format
            let pt = Array.isArray(raw) ? {lon: raw[0], lat: raw[1], val: raw[2]} : raw;
            let color = '#2ecc71'; // Default good
            let val = pt.val;
            
            if (currentMetric === 'RSRP') {
                if (val < -115) color = '#FF0000';
                else if (val < -110) color = '#FFC000';
                else if (val < -105) color = '#FFFF00';
                else if (val < -95) color = '#92D050';
                else color = '#00B050';
            } else if (currentMetric === 'RSRQ') {
                if (val < -15) color = '#e74c3c';
                else if (val < -12) color = '#f1c40f';
                else color = '#2ecc71';
            }
            
            // Apply After Implementation Logic
            if (currentImplState === 'after' && currentMetric === 'RSRP' && val < -105) {
                // Check if covered by any proposed sector (including custom ones)
                let covered = false;
                for (let site of activeSites) {
                    if (site.type === 'existing') continue;
                    
                    const dist = getDistance(site.lat, site.lon, pt.lat, pt.lon);
                    const eff_radius = site.radius_m || 600;
                    if (dist <= eff_radius) {
                        const bearing = getBearing(site.lat, site.lon, pt.lat, pt.lon);
                        const bw = site.beamwidth || 65;
                        const az = site.azimuth;
                        
                        let angleDiff = Math.abs(bearing - az);
                        if (angleDiff > 180) angleDiff = 360 - angleDiff;
                        
                        if (angleDiff <= (bw / 2)) {
                            covered = true;
                            break;
                        }
                    }
                }
                if (covered) {
                    color = '#92D050'; // Improved!
                }
            }

            L.circle([pt.lat, pt.lon], {
                radius: currentSource === 'MDT' ? 20 : 50,
                fillColor: color,
                color: color,
                weight: 1,
                opacity: 0.8,
                fillOpacity: 0.8
            }).addTo(mrLayerGroup);
        });
    }
}

// Event Listeners
document.getElementById('source-select').addEventListener('change', (e) => {
    currentSource = e.target.value;
    renderMap();
});

document.getElementById('env-select').addEventListener('change', (e) => {
    currentEnv = e.target.value;
    renderMap();
});

const metricRadios = document.querySelectorAll('input[name="metric"]');
metricRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentMetric = e.target.value;
        
        if(currentMetric === 'NONE') {
            document.getElementById('legend-rsrp').style.display = 'none';
            document.getElementById('legend-rsrq').style.display = 'none';
            document.getElementById('metric-title').innerText = 'Map Only';
        } else {
            document.getElementById('metric-title').innerText = currentMetric === 'RSRP' ? 'RSRP (dBm)' : 'RSRQ (dB)';
            document.getElementById('legend-rsrp').style.display = currentMetric === 'RSRP' ? 'block' : 'none';
            document.getElementById('legend-rsrq').style.display = currentMetric === 'RSRQ' ? 'block' : 'none';
        }
        
        renderMap();
    });
});

const stateRadios = document.querySelectorAll('input[name="impl_state"]');
stateRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentImplState = e.target.value;
        renderMap();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupEditorListeners();
    renderMap();
});





