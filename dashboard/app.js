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
let customSitesMap = {}; // { 'AirportName': [customSites array] }
let customSites = []; // Holds user-added/edited proposals for the current airport
let editedStateChanged = false;
let selectedSite = null;
let pendingNewSiteLatLng = null;
let hiddenSiteTypes = new Set();

// Initialize Map
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        contextmenu: true
    }).setView([-2.5489, 118.0149], 5);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
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
    document.getElementById('save-banner').style.display = 'flex';
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
        if (currentAirport) customSitesMap[currentAirport] = customSites;
        
        currentAirport = e.target.value;
        customSites = customSitesMap[currentAirport] || [];
        
        editedStateChanged = customSites.length > 0;
        document.getElementById('save-banner').style.display = editedStateChanged ? 'flex' : 'none';
        closeEditor();
        renderMap(true);
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

function openEditor(site, isMarkerClick = false) {
    selectedSite = site;
    selectedSite.isMarkerClick = isMarkerClick;
    
    document.getElementById('editor-panel').style.display = 'block';
    document.getElementById('azimuth-slider').value = site.azimuth;
    document.getElementById('azimuth-val').innerText = site.azimuth;
    
    let remarkInput = document.getElementById('remark-input');
    if (remarkInput) {
        document.getElementById('remark-group').style.display = 'block';
        remarkInput.value = site.type === 'existing' ? 'Existing' : site.remark;
    }
    
    if (site.type === 'existing') {
        document.getElementById('btn-delete-site').style.display = 'none'; // Cant delete existing
        document.getElementById('azimuth-slider').disabled = true; // Cant rotate existing here
        document.getElementById('existing-site-actions').style.display = 'flex'; // Show Change/Add buttons
    } else {
        document.getElementById('btn-delete-site').style.display = 'block';
        document.getElementById('btn-delete-site').innerText = isMarkerClick ? "Delete Entire Site" : "Delete Sector";
        document.getElementById('azimuth-slider').disabled = isMarkerClick || site.remark === 'Change Antenna'; // Cant rotate marker or changed antenna
        document.getElementById('existing-site-actions').style.display = 'flex'; // Show Change/Add buttons
    }
    
    let isHighGain = site.remark === 'Change Antenna' || site.isHighGain;
    document.getElementById('btn-change-antenna').innerText = isHighGain ? "Revert Normal Antenna" : "Toggle High Gain";
}

function closeEditor() {
    selectedSite = null;
    document.getElementById('editor-panel').style.display = 'none';
}

function setupEditorListeners() {
    document.getElementById('editor-close').addEventListener('click', closeEditor);
    
    document.getElementById('azimuth-slider').addEventListener('input', (e) => {
        if (!selectedSite || selectedSite.isMarkerClick || selectedSite.remark === 'Change Antenna') return;
        selectedSite.azimuth = parseInt(e.target.value);
        document.getElementById('azimuth-val').innerText = selectedSite.azimuth;
        renderMap();
        markEdited();
    });
    
    // Remark select listener removed because the dropdown was changed to a disabled input field
    
    document.getElementById('btn-delete-site').addEventListener('click', () => {
        if (!selectedSite) return;
        
        if (selectedSite.isMarkerClick) {
            // Remove ALL sectors with this site ID from customSites
            customSites = customSites.filter(s => s.id !== selectedSite.id);
            
            // Remove ALL sectors with this site ID from DASHBOARD_DATA
            let aptData = DASHBOARD_DATA[currentAirport];
            if (aptData && aptData.sites) {
                aptData.sites = aptData.sites.filter(s => s.id !== selectedSite.id);
            }
        } else {
            // Remove ONLY this sector from customSites
            customSites = customSites.filter(s => s !== selectedSite);
            
            // Remove ONLY this sector from DASHBOARD_DATA
            let aptData = DASHBOARD_DATA[currentAirport];
            if (aptData && aptData.sites) {
                aptData.sites = aptData.sites.filter(s => s !== selectedSite);
            }
        }
        
        closeEditor();
        markEdited();
        renderMap();
    });
    
    document.getElementById('btn-save-site').addEventListener('click', () => {
        closeEditor();
    });
    

    document.getElementById('btn-change-antenna').addEventListener('click', () => {
        if (!selectedSite) return;
        
        if (selectedSite.type === 'proposed_new') {
            // Toggle new site in-place
            selectedSite.isHighGain = !selectedSite.isHighGain;
            selectedSite.remark = selectedSite.isHighGain ? 'New Site (High Gain)' : 'New Site';
            let baseRadius = selectedSite.clutter_radius || 600;
            selectedSite.radius_m = selectedSite.isHighGain ? (baseRadius * 1.2) : baseRadius;
            selectedSite.beamwidth = selectedSite.isHighGain ? 33 : 65;
            
            markEdited();
            renderMap();
            openEditor(selectedSite); // refresh editor UI
            return;
        }

        // It's an existing site or proposed_sector (which includes "Change Antenna" sector)
        if (selectedSite.remark === 'Change Antenna') {
            // Revert back to normal
            customSites = customSites.filter(s => s !== selectedSite);
            markEdited();
            renderMap();
            closeEditor();
            return;
        }
        
        if (selectedSite.type !== 'existing') return; // Guard
        
        let targetAzimuth = selectedSite.azimuth;
        
        // Find ALL sectors for this site ID
        const aptData = DASHBOARD_DATA[currentAirport];
        let allSectorsForSite = (aptData.sites || []).filter(s => s.id === selectedSite.id);
        
        if (selectedSite.isMarkerClick && allSectorsForSite.length > 1) {
            // Ask which one!
            const azs = allSectorsForSite.map(s => s.azimuth).join('/');
            const chosen = prompt(`This site has multiple sectors (${azs}). Which azimuth do you want to change?`, allSectorsForSite[0].azimuth);
            if (!chosen) return; // User cancelled
            const parsedAz = parseInt(chosen);
            if (isNaN(parsedAz)) {
                alert("Invalid azimuth entered.");
                return;
            }
            targetAzimuth = parsedAz;
        }

        const changedSite = {
            id: selectedSite.id + "_CHG",
            lat: selectedSite.lat,
            lon: selectedSite.lon,
            azimuth: targetAzimuth,
            original_azimuth: targetAzimuth,
            radius_m: (selectedSite.clutter_radius || 600) * 1.2, // 3GPP Clutter standard + 20%
            beamwidth: 33,
            remark: 'Change Antenna',
            type: 'proposed_sector',
            tlp_id: 'N/A',
            tlp_name: 'N/A'
        };
        customSites.push(changedSite);
        markEdited();
        renderMap();
        closeEditor();
    });

    document.getElementById('btn-add-sector').addEventListener('click', () => {
        if (!selectedSite || selectedSite.type !== 'existing') return;
        
        const useHighGain = confirm("Do you want to use a High Gain Antenna?\n\nOK = High Gain (+20% radius, 33° beamwidth)\nCancel = Standard Antenna (Normal radius, 65° beamwidth)");
        
        const newSector = {
            id: selectedSite.id + "_ADD",
            lat: selectedSite.lat,
            lon: selectedSite.lon,
            azimuth: (selectedSite.azimuth + 120) % 360,
            radius_m: useHighGain ? ((selectedSite.clutter_radius || 600) * 1.2) : (selectedSite.clutter_radius || 600),
            beamwidth: useHighGain ? 33 : 65,
            remark: 'Additional Sector',
            type: 'proposed_sector',
            tlp_id: 'N/A',
            tlp_name: 'N/A'
        };
        customSites.push(newSector);
        markEdited();
        renderMap();
        openEditor(newSector); // Switch editor to the new sector so they can adjust azimuth
    });

    document.getElementById('btn-add-new-site').addEventListener('click', () => {
        alert("Please click anywhere on the map to place the new site.");
        document.getElementById('map').style.cursor = 'crosshair';
        map.once('click', function(e) {
            document.getElementById('map').style.cursor = '';
            pendingNewSiteLatLng = e.latlng;
            document.getElementById('new-site-modal').style.display = 'block';
            document.getElementById('new-site-error').style.display = 'none';
        });
    });

    document.getElementById('btn-cancel-new-site').addEventListener('click', () => {
        document.getElementById('new-site-modal').style.display = 'none';
        pendingNewSiteLatLng = null;
    });

    document.getElementById('btn-confirm-new-site').addEventListener('click', () => {
        const numSectorsStr = document.getElementById('new-site-sectors').value;
        const azimuthsStr = document.getElementById('new-site-azimuths').value;
        const errDiv = document.getElementById('new-site-error');
        
        const numSectors = parseInt(numSectorsStr);
        if (isNaN(numSectors) || numSectors < 1) {
            errDiv.innerText = "Please enter a valid number of sectors.";
            errDiv.style.display = 'block';
            return;
        }
        
        const azimuths = azimuthsStr.split('/').map(s => parseInt(s.trim()));
        if (azimuths.length !== numSectors || azimuths.some(isNaN)) {
            errDiv.innerText = `Please enter exactly ${numSectors} valid azimuths separated by '/'.`;
            errDiv.style.display = 'block';
            return;
        }
        
        // Generate site ID: e.g. KOMODO_842
        const prefix = currentAirport ? currentAirport.toUpperCase().replace(/\s+/g, '_') : 'SITE';
        const siteId = prefix + '_' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        
        const lat = pendingNewSiteLatLng.lat;
        const lon = pendingNewSiteLatLng.lng;
        
        let nearestDist = Infinity;
        let inferredClutterRadius = 600;
        
        const aptData = DASHBOARD_DATA[currentAirport];
        if (aptData && aptData.sites) {
            aptData.sites.forEach(s => {
                if (s.type === 'existing') {
                    let d = getDistance(lat, lon, s.lat, s.lon);
                    if (d < nearestDist) {
                        nearestDist = d;
                        inferredClutterRadius = s.clutter_radius || 600;
                    }
                }
            });
        }
        
        for(let i = 0; i < numSectors; i++) {
            const newSector = {
                id: siteId,
                lat: lat,
                lon: lon,
                azimuth: azimuths[i],
                radius_m: inferredClutterRadius,
                clutter_radius: inferredClutterRadius,
                beamwidth: 65,
                remark: 'New Site',
                type: 'proposed_new',
                tlp_id: 'N/A',
                tlp_name: 'N/A'
            };
            customSites.push(newSector);
        }
        
        document.getElementById('new-site-modal').style.display = 'none';
        pendingNewSiteLatLng = null;
        markEdited();
        renderMap();
    });

    document.getElementById('btn-trigger-save').addEventListener('click', () => {
        const payload = {
            airport: currentAirport,
            edited_sites: customSites
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `Edits_Only_${currentAirport.replace(/\s+/g, '_')}.json`);
        dlAnchorElem.click();
        
        document.getElementById('save-banner').style.display = 'none';
        editedStateChanged = false;
    });

    document.getElementById('btn-export-csv').addEventListener('click', () => {
        // Sync current airport edits before exporting
        if (currentAirport) customSitesMap[currentAirport] = customSites;
        
        const choice = prompt("What do you want to export across ALL airports?\n\n1 = All Sites (Existing + Edited/New)\n2 = Edited/New Sites Only\n\nType 1 or 2:");
        if (!choice) return; // Cancelled
        const isAll = choice.trim() === '1';
        if (!isAll && choice.trim() !== '2') {
            alert("Invalid choice. Export cancelled.");
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Airport,ID,Latitude,Longitude,Azimuth,Radius_m,Beamwidth,Type,Remark\n";
        
        for (const aptName in DASHBOARD_DATA) {
            const aptData = DASHBOARD_DATA[aptName];
            const aptCustomSites = customSitesMap[aptName] || [];
            
            if (!isAll && aptCustomSites.length === 0) continue; // Skip airports with no edits if they want edited only
            
            let sitesToExport = [];
            
            if (isAll) {
                const replacedSignatures = aptCustomSites
                    .filter(s => s.remark === 'Change Antenna')
                    .map(s => `${s.id.replace('_CHG', '')}_${s.original_azimuth}`);
                    
                let baseSites = (aptData.sites || []).filter(s => {
                    const sig = `${s.id}_${s.azimuth}`;
                    return !replacedSignatures.includes(sig);
                });
                
                baseSites = baseSites.map(s => ({...s, remark: s.remark || 'Existing'}));
                sitesToExport = baseSites.concat(aptCustomSites);
            } else {
                sitesToExport = aptCustomSites;
            }
            
            sitesToExport.forEach(site => {
                const row = [
                    `"${aptName}"`,
                    site.id,
                    site.lat,
                    site.lon,
                    site.azimuth,
                    site.radius_m || site.clutter_radius || 600,
                    site.beamwidth || 65,
                    site.type,
                    `"${site.remark || 'Existing'}"`
                ];
                csvContent += row.join(",") + "\n";
            });
        }
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        
        const fileName = isAll ? "All_Sites_All_Airports.csv" : "Edited_Sites_All_Airports.csv";
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        document.getElementById('save-banner').style.display = 'none';
        editedStateChanged = false;
    });
}

function renderMap(forceCenter = false) {
    mrLayerGroup.clearLayers();
    siteLayerGroup.clearLayers();
    sectorLayerGroup.clearLayers();

    if (!currentAirport) return;

    const airport = DASHBOARD_DATA[currentAirport];
    
    // Auto center
    if (forceCenter || !editedStateChanged) {
        const bbox = airport.bbox || airport.bounds;
        const bounds = [
            [bbox[1], bbox[0]],
            [bbox[3], bbox[2]]
        ];
        map.fitBounds(bounds, { padding: [20, 20] });
    }

    // Determine all active sites (original + custom)
    const replacedSignatures = customSites
        .filter(s => s.remark === 'Change Antenna')
        .map(s => `${s.id.replace('_CHG', '')}_${s.original_azimuth}`);

    let activeSites = (airport.sites || []).filter(s => {
        return !replacedSignatures.includes(`${s.id}_${s.azimuth}`);
    }).concat(customSites);
    
    // Draw Sites & Sectors
    activeSites.forEach(site => {
        if (hiddenSiteTypes.has(site.type)) return;
        
        // Draw sector
        let radius = 250; // standard viz radius for fans
        let beamwidth = site.beamwidth || 65;
        let fillColor = (site.type === 'existing') ? '#3498db' : ((site.type === 'proposed_new') ? '#000000' : '#9b59b6');
        let isHighGain = site.remark === 'Change Antenna' || site.isHighGain;
        
        const polygonPoints = getSectorPolygon([site.lat, site.lon], radius, site.azimuth, beamwidth);
        const sector = L.polygon(polygonPoints, {
            color: isHighGain ? '#ffffff' : 'black',
            weight: isHighGain ? 2 : 1,
            dashArray: isHighGain ? '5, 5' : null,
            fillColor: fillColor,
            fillOpacity: 0.8
        }).addTo(sectorLayerGroup);
        
        sector.on('click', function(e) {
            openEditor(site);
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
        
        let siteAzimuths = activeSites
            .filter(s => s.id === site.id)
            .map(s => s.azimuth)
            .sort((a,b) => a-b)
            .join('/');
            
        let popupContent = `<b>${site.id}</b><br>Type: ${site.remark || 'Existing'}<br>Azimuths: ${siteAzimuths}&deg;`;
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
            if(selectedSite === site) openEditor(site, true);
        });
        
        marker.on('click', function(e) {
            openEditor(site, true);
        });
    });

    // Draw MR/MDT Data if 'NONE' is not selected
    if (currentMetric !== 'NONE') {
        let dataPoints = [];
        if (airport.mr_data && airport.mr_data[currentEnv] && airport.mr_data[currentEnv][currentSource]) {
            dataPoints = airport.mr_data[currentEnv][currentSource][currentMetric] || [];
        }

        dataPoints.forEach(raw => {
            // Support both array [lon,lat,val] and object {lon,lat,val} format
            let pt = Array.isArray(raw) ? {lon: raw[0], lat: raw[1], val: raw[2]} : raw;
            let color = '#2ecc71'; // Default good
            let val = pt.val;
            
            if (currentMetric === 'RSRP') {
                if (val < -105) color = '#e74c3c'; // Poor
                else color = '#2ecc71'; // Good
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
                radius: currentSource === 'MDT' ? 10 : 25,
                fillColor: color,
                color: color,
                weight: 1,
                opacity: 0.8,
                fillOpacity: 0.8
            }).addTo(mrLayerGroup);
        });
    }

    // Ensure sectors and markers are drawn on top of the MR grid
    sectorLayerGroup.eachLayer(layer => { if (layer.bringToFront) layer.bringToFront(); });
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

// Legend Toggle Listeners
document.querySelectorAll('.legend-item.toggleable').forEach(item => {
    item.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const siteType = target.getAttribute('data-sitetype');
        
        if (hiddenSiteTypes.has(siteType)) {
            hiddenSiteTypes.delete(siteType);
            target.classList.add('active');
            target.style.opacity = '1';
        } else {
            hiddenSiteTypes.add(siteType);
            target.classList.remove('active');
            target.style.opacity = '0.5';
        }
        renderMap();
    });
});

document.getElementById('btn-save-session').addEventListener('click', () => {
    if (currentAirport) customSitesMap[currentAirport] = customSites;
    localStorage.setItem('rsrp_custom_sites', JSON.stringify(customSitesMap));
    alert('Session saved successfully! Your edits will be available even if you reload the page.');
});

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('rsrp_custom_sites');
    if (saved) {
        try {
            customSitesMap = JSON.parse(saved);
        } catch(e) {}
    }
    
    initMap();
    setupEditorListeners();
    
    // Initial sync for the first loaded airport
    if (currentAirport) {
        customSites = customSitesMap[currentAirport] || [];
        editedStateChanged = customSites.length > 0;
        document.getElementById('save-banner').style.display = editedStateChanged ? 'flex' : 'none';
    }
    
    renderMap(true);
});





