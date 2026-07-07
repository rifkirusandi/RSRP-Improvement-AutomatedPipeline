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
let tlpLayerGroup = L.layerGroup();
let customSitesMap = {}; // { 'AirportName': { added: [], deleted: [], modified: {} } }
let customSites = { added: [], deleted: [], modified: {} }; // Active diff for current airport
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

    // Enforce Layer Z-Index Hierarchy
    map.createPane('gridPane');
    map.getPane('gridPane').style.zIndex = 400; // Base RSRP/RSRQ grid matrix
    
    map.createPane('airportPane');
    map.getPane('airportPane').style.zIndex = 410; // Airport Polygon outline

    map.createPane('existingPane');
    map.getPane('existingPane').style.zIndex = 420; // Existing Sites layer
    map.createPane('existingMarkerPane');
    map.getPane('existingMarkerPane').style.zIndex = 425; // Existing Sites Markers

    map.createPane('proposalPane');
    map.getPane('proposalPane').style.zIndex = 430; // All Proposals layer
    map.createPane('proposalMarkerPane');
    map.getPane('proposalMarkerPane').style.zIndex = 435; // All Proposals Markers
    
    map.createPane('tlpPane');
    map.getPane('tlpPane').style.zIndex = 440; // TLP Points layer

    map.createPane('deletePane');
    map.getPane('deletePane').style.zIndex = 450; // Selection circles (Absolute top)

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mrLayerGroup.addTo(map);
    sectorLayerGroup.addTo(map);
    siteLayerGroup.addTo(map);
    tlpLayerGroup.addTo(map);

    populateAirportDropdown();
    
    document.getElementById('loading-screen').style.display = 'none';
    
    // No right-click context menu handler - removed per user request
}

function markEdited() {
    editedStateChanged = true;
    document.getElementById('save-banner').style.display = 'flex';
    document.querySelector('input[name="impl_state"][value="after"]').checked = true;
    currentImplState = 'after';
}

async function populateAirportDropdown() {
    const select = document.getElementById('airport-select');
    select.innerHTML = '<option>Loading...</option>';
    
    try {
        const response = await fetch('/api/airports');
        const data = await response.json();
        const sortedAirports = data.airports || [];
        
        select.innerHTML = '';
        if (sortedAirports.length === 0) {
            select.innerHTML = '<option>No valid airports found</option>';
            return;
        }

        const lastImported = localStorage.getItem('last_imported_airport');
        
        sortedAirports.forEach((apt) => {
            if (DASHBOARD_DATA[apt]) {
                const option = document.createElement('option');
                option.value = apt;
                option.textContent = apt;
                select.appendChild(option);
            }
        });
        
        if (lastImported && DASHBOARD_DATA[lastImported]) {
            currentAirport = lastImported;
            select.value = currentAirport;
            localStorage.removeItem('last_imported_airport');
        } else if (!currentAirport && sortedAirports.length > 0) {
            currentAirport = sortedAirports[0];
            select.value = currentAirport;
        }
        
        // Ensure state is loaded and map is rendered
        if (currentAirport) {
            customSites = customSitesMap[currentAirport] || { added: [], deleted: [], modified: {} };
            editedStateChanged = customSites.added.length > 0 || customSites.deleted.length > 0 || Object.keys(customSites.modified).length > 0;
            document.getElementById('save-banner').style.display = editedStateChanged ? 'flex' : 'none';
            renderMap(true);
        }
        
    } catch (error) {
        console.error("Failed to load airports:", error);
        // Fallback to old behavior
        select.innerHTML = '';
    }

    select.addEventListener('change', (e) => {
        if (currentAirport) customSitesMap[currentAirport] = customSites;
        
        currentAirport = e.target.value;
        customSites = customSitesMap[currentAirport] || { added: [], deleted: [], modified: {} };
        
        editedStateChanged = customSites.added.length > 0 || customSites.deleted.length > 0 || Object.keys(customSites.modified).length > 0;
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

let customSitesSnapshot = null;
function openEditor(site, isMarkerClick = false) {
    customSitesSnapshot = JSON.parse(JSON.stringify(customSites));
    selectedSite = site;
    selectedSite.isMarkerClick = isMarkerClick;
    
    document.getElementById('editor-panel').style.display = 'block';
    document.getElementById('azimuth-slider').value = site.azimuth;
    document.getElementById('azimuth-val').innerText = site.azimuth;
    
    let remarkInput = document.getElementById('remark-input');
    if (remarkInput) {
        document.getElementById('remark-group').style.display = 'block';
        let displayRemark = site.type === 'existing' ? 'Existing' : site.remark;
        if (displayRemark === 'Change Antenna') displayRemark = 'High Gain Antenna';
        remarkInput.value = displayRemark;
    }
    let isChangeAntenna = site.remark === 'Change Antenna';
    
    if (site.type === 'existing') {
        document.getElementById('btn-delete-site').style.display = 'none'; // Cant delete existing (original or high gain)
        document.getElementById('azimuth-slider').disabled = true; // Cant rotate existing here
        document.getElementById('existing-site-actions').style.display = 'flex'; // Show Revert/Add buttons
        document.getElementById('btn-add-sector').style.display = 'block'; // Only for existing
    } else {
        document.getElementById('btn-delete-site').style.display = 'block';
        document.getElementById('btn-delete-site').innerText = isMarkerClick ? "Delete Entire Site" : "Delete Sector";
        document.getElementById('azimuth-slider').disabled = isMarkerClick || (site.type === 'existing');
        document.getElementById('existing-site-actions').style.display = 'flex'; // Show Change/Add buttons
        document.getElementById('btn-add-sector').style.display = 'none'; // Hide for new sites
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
        if (!selectedSite || selectedSite.isMarkerClick) return;
        
        let aptData = DASHBOARD_DATA[currentAirport];
        let originalSite = null;
        
        if (selectedSite.original_azimuth === undefined) {
            selectedSite.original_azimuth = selectedSite.azimuth;
        }
        
        if (aptData && aptData.sites) {
            originalSite = aptData.sites.find(s => s.id === selectedSite.id && (s.original_azimuth !== undefined ? s.original_azimuth === selectedSite.original_azimuth : s.azimuth === selectedSite.original_azimuth));
        }
        
        if (originalSite) {
            if (originalSite.original_azimuth === undefined) {
                originalSite.original_azimuth = originalSite.azimuth;
            }
        }
        
        selectedSite.azimuth = parseInt(e.target.value);
        document.getElementById('azimuth-val').innerText = selectedSite.azimuth;
        
        if (originalSite) {
            const sig = `${originalSite.id}_${originalSite.original_azimuth}`;
            if (!customSites.modified[sig]) customSites.modified[sig] = {};
            customSites.modified[sig].azimuth = selectedSite.azimuth;
        } else {
            const addedSite = (customSites.added || []).find(s => s.id === selectedSite.id && s.original_azimuth === selectedSite.original_azimuth);
            if (addedSite) {
                addedSite.azimuth = selectedSite.azimuth;
            }
        }
        
        renderMap();
        markEdited();
    });

    // Remark select listener removed because the dropdown was changed to a disabled input field
    
    document.getElementById('btn-delete-site').addEventListener('click', () => {
        if (!selectedSite) return;
        
        let aptData = DASHBOARD_DATA[currentAirport];
        
        if (selectedSite.isMarkerClick) {
            // Remove ALL sectors with this site ID from customSites.added
            customSites.added = customSites.added.filter(s => s.id !== selectedSite.id);
            
            // Mark ALL base sectors with this site ID as deleted
            if (aptData && aptData.sites) {
                aptData.sites.forEach(s => {
                    if (s.id === selectedSite.id) {
                        customSites.deleted.push(`${s.id}_${s.azimuth}`);
                    }
                });
            }
        } else {
            // Remove ONLY this sector from customSites.added
            customSites.added = customSites.added.filter(s => s !== selectedSite);
            
            // Mark this specific base sector as deleted
            let originalSite = null;
            if (aptData && aptData.sites) {
                if (selectedSite.original_azimuth === undefined) selectedSite.original_azimuth = selectedSite.azimuth;
                originalSite = aptData.sites.find(s => s.id === selectedSite.id && (s.original_azimuth !== undefined ? s.original_azimuth === selectedSite.original_azimuth : s.azimuth === selectedSite.original_azimuth));
            }
            if (originalSite) {
                if (originalSite.original_azimuth === undefined) originalSite.original_azimuth = originalSite.azimuth;
                customSites.deleted.push(`${originalSite.id}_${originalSite.original_azimuth}`);
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
        
        let aptData = DASHBOARD_DATA[currentAirport];
        
        if (selectedSite.type === 'proposed_new' || selectedSite.remark === 'Additional Sector') {
            // Toggle new site or additional sector in-place
            selectedSite.isHighGain = !selectedSite.isHighGain;
            
            if (selectedSite.type === 'proposed_new') {
                selectedSite.remark = selectedSite.isHighGain ? 'New Site (High Gain)' : 'New Site';
            } else if (selectedSite.remark.includes('Additional Sector')) {
                selectedSite.remark = selectedSite.isHighGain ? 'Additional Sector (High Gain)' : 'Additional Sector';
            }
            
            // Fix: Use strict immutable cache rather than compounding active state
            if (selectedSite.initial_radius === undefined) {
                selectedSite.initial_radius = selectedSite.clutter_radius || selectedSite.radius_m || 600;
            }
            selectedSite.radius_m = selectedSite.isHighGain ? (selectedSite.initial_radius * 1.2) : selectedSite.initial_radius;
            selectedSite.beamwidth = selectedSite.isHighGain ? 33 : 65;
            
            let originalSite = null;
            if (aptData && aptData.sites) {
                if (selectedSite.original_azimuth === undefined) selectedSite.original_azimuth = selectedSite.azimuth;
                originalSite = aptData.sites.find(s => s.id === selectedSite.id && (s.original_azimuth !== undefined ? s.original_azimuth === selectedSite.original_azimuth : s.azimuth === selectedSite.original_azimuth));
            }
            if (originalSite) {
                if (originalSite.original_azimuth === undefined) originalSite.original_azimuth = originalSite.azimuth;
                const sig = `${originalSite.id}_${originalSite.original_azimuth}`;
                if (!customSites.modified[sig]) customSites.modified[sig] = {};
                customSites.modified[sig].isHighGain = selectedSite.isHighGain;
                customSites.modified[sig].remark = selectedSite.remark;
                customSites.modified[sig].radius_m = selectedSite.radius_m;
                customSites.modified[sig].beamwidth = selectedSite.beamwidth;
            }
            
            markEdited();
            renderMap();
            openEditor(selectedSite); // refresh editor UI
            return;
        }

        // It's an existing site or proposed_sector (which includes "Change Antenna" sector)
        if (selectedSite.remark === 'Change Antenna') {
            const isManualEdit = customSites.added && customSites.added.includes(selectedSite);
            if (isManualEdit) {
                // Revert back to normal for manual edits
                customSites.added = customSites.added.filter(s => s !== selectedSite);
            } else {
                // System generated Change Antenna (in aptData.sites)
                let originalSite = null;
                if (aptData && aptData.sites) {
                    if (selectedSite.original_azimuth === undefined) selectedSite.original_azimuth = selectedSite.azimuth;
                    originalSite = aptData.sites.find(s => s.id === selectedSite.id && (s.original_azimuth !== undefined ? s.original_azimuth === selectedSite.original_azimuth : s.azimuth === selectedSite.original_azimuth));
                }
                if (originalSite) {
                    if (originalSite.original_azimuth === undefined) originalSite.original_azimuth = originalSite.azimuth;
                    const sig = `${originalSite.id}_${originalSite.original_azimuth}`;
                    if (!customSites.modified[sig]) customSites.modified[sig] = {};
                    customSites.modified[sig].isHighGain = false;
                    customSites.modified[sig].remark = '';
                    customSites.modified[sig].beamwidth = 65;
                    customSites.modified[sig].radius_m = originalSite.initial_radius || originalSite.clutter_radius || 600;
                }
            }
            markEdited();
            renderMap();
            closeEditor();
            return;
        }
        
        if (selectedSite.type !== 'existing' && selectedSite.type !== 'proposed_sector') return; // Guard
        
        let targetAzimuth = selectedSite.azimuth;
        
        // Find ALL sectors for this site ID
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

        const initialRadius = selectedSite.initial_radius !== undefined ? selectedSite.initial_radius : (selectedSite.clutter_radius || selectedSite.radius_m || 600);
        
        let originalSite = null;
        if (aptData && aptData.sites) {
            if (selectedSite.original_azimuth === undefined) selectedSite.original_azimuth = selectedSite.azimuth;
            originalSite = aptData.sites.find(s => s.id === selectedSite.id && (s.original_azimuth !== undefined ? s.original_azimuth === selectedSite.original_azimuth : s.azimuth === selectedSite.original_azimuth));
        }
        
        if (originalSite) {
            if (originalSite.original_azimuth === undefined) originalSite.original_azimuth = originalSite.azimuth;
            const sig = `${originalSite.id}_${originalSite.original_azimuth}`;
            if (!customSites.modified[sig]) customSites.modified[sig] = {};
            customSites.modified[sig].isHighGain = true;
            customSites.modified[sig].remark = 'Change Antenna';
            customSites.modified[sig].radius_m = initialRadius * 1.2;
            customSites.modified[sig].beamwidth = 33;
            // Leave type as-is (existing type stays 'existing')
        }
        
        markEdited();
        renderMap();
        closeEditor();
    });

    document.getElementById('btn-add-sector').addEventListener('click', () => {
        if (!selectedSite || selectedSite.type !== 'existing') return;
        
        const useHighGain = false; // Default to normal antenna, user can toggle later
        
        const initialAzimuth = (selectedSite.azimuth + 120) % 360;
        const initialRadius = selectedSite.initial_radius !== undefined ? selectedSite.initial_radius : (selectedSite.clutter_radius || selectedSite.radius_m || 600);
        
        const newSector = {
            id: selectedSite.id + "_ADD",
            lat: selectedSite.lat,
            lon: selectedSite.lon,
            azimuth: initialAzimuth,
            original_azimuth: initialAzimuth,
            initial_radius: initialRadius,
            radius_m: useHighGain ? (initialRadius * 1.2) : initialRadius,
            clutter_radius: selectedSite.clutter_radius || 600,
            isHighGain: useHighGain,
            beamwidth: useHighGain ? 33 : 65,
            remark: 'Additional Sector',
            type: 'proposed_sector',
            tlp_id: 'N/A',
            tlp_name: 'N/A'
        };
        customSites.added.push(newSector);
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

    document.getElementById('btn-confirm-new-site').addEventListener('click', async () => {
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
        
        const prefix = currentAirport ? currentAirport.toUpperCase().replace(/\s+/g, '_') : 'SITE';
        const lat = pendingNewSiteLatLng.lat;
        const lon = pendingNewSiteLatLng.lng;
        
        // --- FIX 1: Compute sequential Site ID by scanning max _ARPT_ index ---
        let maxIdx = 0;
        const aptData = DASHBOARD_DATA[currentAirport];
        
        // Scan system-generated proposed_new sites with our prefix pattern
        if (aptData && aptData.sites) {
            aptData.sites.forEach(s => {
                if (s.type === 'proposed_new' && s.id.startsWith(prefix)) {
                    const parts = s.id.split('_');
                    const numPart = parseInt(parts[parts.length - 1]);
                    if (!isNaN(numPart) && numPart > maxIdx) {
                        maxIdx = numPart;
                    }
                }
            });
        }
        // Also scan user-added sites for this airport to continue from their max
        (customSites.added || []).forEach(s => {
            if (s.type === 'proposed_new' && s.id.startsWith(prefix)) {
                const parts = s.id.split('_');
                const numPart = parseInt(parts[parts.length - 1]);
                if (!isNaN(numPart) && numPart > maxIdx) {
                    maxIdx = numPart;
                }
            }
        });
        
        const nextNumber = (maxIdx + 1).toString().padStart(3, '0');
        const siteId = prefix + '_ARPT_' + nextNumber;
        
        // --- FIX 2: Query morphology map for accurate clutter ---
        let clutterRadius = 975;    // default URBAN
        let clutterName = 'Unknown';
        let nearestDist = Infinity;
        
        try {
            const resp = await fetch('/api/get_clutter?lat=' + lat + '&lon=' + lon);
            const data = await resp.json();
            if (data.clutter_name !== 'Unknown') {
                clutterName = data.clutter_name;
                clutterRadius = data.clutter_radius;
            } else {
                throw new Error('No morphology match');
            }
        } catch (e) {
            // --- Fallback: Nearest-Neighbor from existing sites in this airport ---
            console.log('Morphology query failed, using nearest-neighbor fallback:', e);
            if (aptData && aptData.sites) {
                aptData.sites.forEach(s => {
                    if (s.type === 'existing') {
                        let d = getDistance(lat, lon, s.lat, s.lon);
                        if (d < nearestDist) {
                            nearestDist = d;
                            clutterRadius = s.clutter_radius || 975;
                            clutterName = 'Nearest Neighbor';
                        }
                    }
                });
            }
        }
        
        for(let i = 0; i < numSectors; i++) {
            const newSector = {
                id: siteId,
                lat: lat,
                lon: lon,
                azimuth: azimuths[i],
                original_azimuth: azimuths[i],
                radius_m: clutterRadius,
                clutter_radius: clutterRadius,
                clutter_name: clutterName,
                beamwidth: 65,
                remark: 'New Site',
                type: 'proposed_new',
                tlp_id: 'N/A',
                tlp_name: 'N/A'
            };
            customSites.added.push(newSector);
        }
        
        document.getElementById('new-site-modal').style.display = 'none';
        pendingNewSiteLatLng = null;
        
        markEdited();
        renderMap();
    });

    document.getElementById('btn-reset-edits').addEventListener('click', () => {
        if (!confirm("Are you sure you want to delete ALL manual edits across ALL airports? This cannot be undone.")) return;
        customSites = { added: [], deleted: [], modified: {} };
        customSitesMap = {};
        localStorage.removeItem('rsrp_custom_sites');
        editedStateChanged = false;
        document.getElementById('save-banner').style.display = 'none';
        closeEditor();
        renderMap();
        alert("All edits have been reset to the base version.");
    });
    
    const resetAllBtn = document.getElementById('btn-reset-all');
    if (resetAllBtn) {
        resetAllBtn.addEventListener('click', () => {
            document.getElementById('btn-reset-edits').click();
        });
    }

    document.getElementById('btn-trigger-save').addEventListener('click', () => {
        if (!currentAirport) {
            alert('Please select an airport first.');
            return;
        }
        
        // Build FULL list of proposed sites for this airport (base + edits)
        let finalSites = [];
        const aptData = DASHBOARD_DATA[currentAirport];
        
        // 1. Add base proposals that haven't been deleted
        if (aptData && aptData.sites) {
            aptData.sites.forEach(s => {
                const baseAz = s.original_azimuth !== undefined ? s.original_azimuth : s.azimuth;
                const sig = `${s.id}_${baseAz}`;
                const isModified = customSites.modified && customSites.modified[sig] !== undefined;
                
                // Skip if __ALL__ sentinel is set (CSV import overwrite) — only proposals, never existing sites
                if (customSites.deleted && customSites.deleted.includes('__ALL__') && s.type !== 'existing') return;
                
                if (s.type !== 'existing' || s.remark === 'Change Antenna' || isModified) {
                    // Skip if individually deleted
                    if (customSites.deleted && customSites.deleted.includes(sig)) return;
                    
                    // Apply modifications if any
                    let finalSite = { ...s };
                    if (isModified) {
                        finalSite = { ...finalSite, ...customSites.modified[sig] };
                    }
                    
                    // Force type to proposed_sector for system-generated Change Antennas
                    if (finalSite.remark === 'Change Antenna') {
                        finalSite.type = 'proposed_sector';
                    }
                    
                    finalSites.push(finalSite);
                }
            });
        }
        
        // 2. Add newly created proposals
        if (customSites.added) {
            finalSites.push(...customSites.added);
        }

        const payload = {
            airport: currentAirport,
            sites: finalSites,
            bbox: DASHBOARD_DATA[currentAirport].bbox
        };
        
        document.getElementById('btn-trigger-save').innerHTML = 'Saving...';
        
        fetch('/api/save_edits', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            alert(data.message || 'Edits saved successfully!');
            document.getElementById('btn-trigger-save').innerHTML = '💾 Save to Server';
            editedStateChanged = false;
        })
        .catch(err => {
            alert('Error saving to server. Are you running app.py?');
            document.getElementById('btn-trigger-save').innerHTML = '💾 Save to Server';
        });
    });

    document.getElementById('btn-export-pptx').addEventListener('click', () => {
        if (!currentAirport) {
            alert('Please select an airport first.');
            return;
        }
        
        const btn = document.getElementById('btn-export-pptx');
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Generating PPTX...';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        
        fetch('/api/download/pptx/' + encodeURIComponent(currentAirport))
        .then(res => {
            if (!res.ok) {
                // Server returned an error — parse the JSON error message
                return res.json().then(data => {
                    throw new Error(data.error || 'Unknown server error');
                });
            }
            return res.blob();
        })
        .then(blob => {
            // Trigger file download
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = currentAirport + '_Airport_Improvement.pptx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.style.opacity = '1';
        })
        .catch(err => {
            let errorMsg = err.message || String(err);
            
            // Check for common issues and provide helpful guidance
            if (errorMsg.includes('Missing required Python packages') || errorMsg.includes('ModuleNotFoundError') || errorMsg.includes('No module named')) {
                alert('❌ PPTX generation failed — Missing Python packages!\n\n' + errorMsg + '\n\nPlease run: pip install -r requirements.txt');
            } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
                alert('❌ Cannot connect to the server.\n\nMake sure app.py is running:\n  python app.py');
            } else {
                alert('❌ PPTX generation failed:\n\n' + errorMsg);
            }
            
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.style.opacity = '1';
        });
    });

    document.getElementById('pkl-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        document.getElementById('btn-load-pkl').innerHTML = 'Loading...';
        
        fetch('/api/load_pkl', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                customSitesMap = data.data;
                localStorage.setItem('rsrp_custom_sites', JSON.stringify(customSitesMap));
                if (currentAirport) {
                    customSites = customSitesMap[currentAirport] || { added: [], deleted: [], modified: {} };
                }
                renderMap();
                alert('Progress loaded successfully from .pkl!');
            } else {
                alert(data.error || 'Failed to load progress.');
            }
            document.getElementById('btn-load-pkl').innerHTML = '📂 Load .pkl';
            e.target.value = ''; // Reset input
        })
        .catch(err => {
            alert('Error loading file. Are you running app.py?');
            document.getElementById('btn-load-pkl').innerHTML = '📂 Load .pkl';
            e.target.value = '';
        });
    });

    document.getElementById('btn-export-csv').addEventListener('click', () => {
        if (!currentAirport) {
            alert('Please select an airport first.');
            return;
        }
        
        // Sync current airport edits before exporting
        if (currentAirport) customSitesMap[currentAirport] = customSites;
        
        // Build FULL list of proposed sites for this airport (base + edits)
        let finalSites = [];
        const aptData = DASHBOARD_DATA[currentAirport];
        if (aptData && aptData.sites) {
            aptData.sites.forEach(s => {
                const baseAz = s.original_azimuth !== undefined ? s.original_azimuth : s.azimuth;
                const sig = `${s.id}_${baseAz}`;
                const isModified = customSites.modified && customSites.modified[sig] !== undefined;
                
                // Skip if __ALL__ sentinel is set (CSV import overwrite) — only proposals, never existing sites
                if (customSites.deleted && customSites.deleted.includes('__ALL__') && s.type !== 'existing') return;
                
                if (s.type !== 'existing' || s.remark === 'Change Antenna' || isModified) {
                    if (customSites.deleted && customSites.deleted.includes(sig)) return;
                    let finalSite = { ...s };
                    if (isModified) finalSite = { ...finalSite, ...customSites.modified[sig] };
                    if (finalSite.remark === 'Change Antenna') finalSite.type = 'proposed_sector';
                    finalSites.push(finalSite);
                }
            });
        }
        if (customSites.added) finalSites.push(...customSites.added);

        // Save to backend automatically first to ensure export is up to date
        const payload = {
            airport: currentAirport,
            sites: finalSites,
            bbox: DASHBOARD_DATA[currentAirport].bbox
        };
        
        const btn = document.getElementById('btn-export-csv');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Saving & Exporting...';
        btn.disabled = true;
        
        fetch('/api/save_edits', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        })
        .then(res => {
            if (!res.ok) throw new Error('Save failed');
            return fetch(`/api/export_csv/${encodeURIComponent(currentAirport)}`);
        })
        .then(res => res.blob())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${currentAirport}-Proposals.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        })
        .catch(err => alert(err.message))
        .finally(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        });
    });

    document.getElementById('csv-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!currentAirport) {
            alert("Please select an airport first!");
            return;
        }
        
        const formData = new FormData();
        formData.append("file", file);
        
        fetch(`/api/import_csv/${encodeURIComponent(currentAirport)}`, {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') {
                alert(data.message);
                customSitesMap[currentAirport] = {
                    added: data.added,
                    modified: data.modified,
                    deleted: ['__ALL__']
                };
                localStorage.setItem('rsrp_custom_sites', JSON.stringify(customSitesMap));
                localStorage.setItem('last_imported_airport', currentAirport);
                window.location.reload();
            } else {
                alert("Import error: " + JSON.stringify(data));
            }
        })
        .catch(err => {
            alert("Failed to upload: " + err.message);
        });
        
        e.target.value = ''; // Reset input
    });
}

let globalActiveSites = [];

function renderMap(forceCenter = false) {
    mrLayerGroup.clearLayers();
    siteLayerGroup.clearLayers();
    sectorLayerGroup.clearLayers();
    tlpLayerGroup.clearLayers();

    if (!currentAirport) return;

    const airport = DASHBOARD_DATA[currentAirport];
    
    // Render TLP Markers
    if (airport.tlp_points && !hiddenSiteTypes.has('tlp')) {
        airport.tlp_points.forEach(tlp => {
            L.circleMarker([tlp.lat, tlp.lon], {
                radius: 5,
                fillColor: '#FFFFFF', // Solid White
                color: '#000000',     // Black outline
                weight: 1.5,
                opacity: 1,
                fillOpacity: 1.0,
                pane: 'tlpPane'
            }).bindTooltip(`<strong>TLP:</strong> ${tlp.name}`, {direction: 'top'})
              .addTo(tlpLayerGroup);
        });
    }
    
    // Auto center
    if (forceCenter || !editedStateChanged) {
        const bbox = airport.bbox || airport.bounds;
        const bounds = [
            [bbox[1], bbox[0]],
            [bbox[3], bbox[2]]
        ];
        map.fitBounds(bounds, { padding: [20, 20] });
    }
    
    // Draw Airport Polygon Boundary
    if (airport.geojson) {
        L.geoJSON(airport.geojson, {
            style: {
                color: 'black',
                weight: 2,
                fill: false
            },
            pane: 'airportPane'
        }).addTo(mrLayerGroup); // Attach to mrLayerGroup so it clears cleanly on renderMap
    }

    // Determine all active sites (original + custom)
    let activeSites = [];
    (airport.sites || []).forEach(s => {
        const baseAz = s.original_azimuth !== undefined ? s.original_azimuth : s.azimuth;
        const sig = `${s.id}_${baseAz}`;
        
        // Skip if __ALL__ sentinel is set (CSV import overwrite) — only proposals, never existing sites
        if (customSites.deleted && customSites.deleted.includes('__ALL__') && s.type !== 'existing') return;
        
        // Skip if individually deleted
        if (customSites.deleted && customSites.deleted.includes(sig)) return;
        
        // Skip if replaced by 'Change Antenna' in customSites.added
        const replacedByChange = customSites.added && customSites.added.some(add => 
            add.remark === 'Change Antenna' && add.id.replace('_CHG', '') === s.id && add.original_azimuth === baseAz
        );
        if (replacedByChange) return;
        
        // Apply modifications if any
        let finalSite = { ...s };
        if (customSites.modified && customSites.modified[sig]) {
            finalSite = { ...finalSite, ...customSites.modified[sig] };
        }
        
        activeSites.push(finalSite);
    });
    
    // Append added sites
    if (customSites.added) {
        activeSites = activeSites.concat(customSites.added);
    }
    globalActiveSites = activeSites;
    
    // Draw Sites & Sectors
    activeSites.forEach(site => {
        let isHighGain = site.remark === 'Change Antenna' || site.isHighGain;
        if (isHighGain && hiddenSiteTypes.has('high_gain')) return;
        if (!isHighGain && hiddenSiteTypes.has(site.type)) return;
        
        // Visual dimensions strictly fixed for UI rendering:
        let radius = isHighGain ? 360 : 300;
        let beamwidth = isHighGain ? 33 : 65;
        let fillColor = '#00FFFF'; // existing
        let colorLine = '#000000';
        let weightLine = 1;
        
        if (site.type === 'proposed_new' || site.remark === 'New Site') {
            fillColor = '#000000'; // Black fill
            colorLine = '#FFFFFF'; // White outline
            weightLine = 2;
        } else if (site.type === 'proposed_sector' && !isHighGain) {
            fillColor = '#9400D3'; // Dark Violet
        }
        
        if (isHighGain) fillColor = '#FFA500'; // High Gain
        
        const polygonPoints = getSectorPolygon([site.lat, site.lon], radius, site.azimuth, beamwidth);
        let targetPane = site.type === 'existing' ? 'existingPane' : 'proposalPane';
        const sector = L.polygon(polygonPoints, {
            color: colorLine,
            weight: weightLine,
            dashArray: isHighGain ? '5, 5' : null,
            fillColor: fillColor,
            fillOpacity: 1.0,
            pane: targetPane
        }).addTo(sectorLayerGroup);
        
        let displayRemark = site.type === 'existing' ? 'Existing' : site.remark;
        if (displayRemark === 'Change Antenna') displayRemark = 'High Gain Antenna';
        let tooltipContent = `<b>${site.id}</b><br>Azimuth: ${site.azimuth}&deg;<br>Type: ${displayRemark}`;
        sector.bindTooltip(tooltipContent, {direction: 'top'});
        
        sector.on('click', function(e) {
            openEditor(site);
        });

        // Draw marker
        let markerClass = 'existing';
        if (site.type === 'proposed_new') markerClass = 'proposed-new';
        if (site.type === 'proposed_sector') markerClass = 'proposed-sector';
        if (isHighGain) markerClass = 'high-gain';

        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="marker ${markerClass}"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });

        const isDraggable = (site.type !== 'existing');
        let markerPane = site.type === 'existing' ? 'existingMarkerPane' : 'proposalMarkerPane';
        const marker = L.marker([site.lat, site.lon], { icon: icon, draggable: isDraggable, pane: markerPane }).addTo(siteLayerGroup);
        
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
            if (multiSelectMode) {
                if (site.type === 'existing') {
                    alert('Cannot batch delete existing baseline sites.');
                    return;
                }
                if (selectedSitesForDeletion.has(site.id)) {
                    selectedSitesForDeletion.delete(site.id);
                    if (selectionCircles[site.id]) {
                        map.removeLayer(selectionCircles[site.id]);
                        delete selectionCircles[site.id];
                    }
                } else {
                    selectedSitesForDeletion.add(site.id);
                    selectionCircles[site.id] = L.circleMarker([site.lat, site.lon], {
                        radius: 20,
                        color: 'red',
                        weight: 3,
                        fillOpacity: 0,
                        dashArray: '5, 5',
                        pane: 'deletePane'
                    }).addTo(map);
                    selectionCircles[site.id].bringToFront();
                }
            } else {
                openEditor(site, true);
            }
        });
    });

    // Draw MR/MDT Data if 'NONE' is not selected
    if (currentMetric !== 'NONE') {
        let dataPoints = [];
        let goodCount = 0;
        let fairCount = 0;
        let poorCount = 0;
        if (airport.mr_data && airport.mr_data[currentEnv] && airport.mr_data[currentEnv][currentSource]) {
            dataPoints = airport.mr_data[currentEnv][currentSource][currentMetric] || [];
        }

        dataPoints.forEach(raw => {
            // Support both array [lon,lat,val] and object {lon,lat,val} format
            let pt = Array.isArray(raw) ? {lon: raw[0], lat: raw[1], val: raw[2]} : raw;
            let color = '#2ecc71'; // Default good
            let val = parseFloat(pt.val);
            
            if (currentMetric === 'RSRP') {
                if (val <= -105) color = '#e74c3c'; // Poor
                else color = '#2ecc71'; // Good
            } else if (currentMetric === 'RSRQ') {
                if (val <= -15) color = '#e74c3c';
                else if (val < -12) color = '#f1c40f';
                else color = '#2ecc71';
            }
            
            // Apply After Implementation Logic
            if (currentImplState === 'after' && currentMetric === 'RSRP' && val <= -105) {
                // Check if covered by any proposed sector (including custom ones and high-gain upgrades)
                let covered = false;
                for (let site of activeSites) {
                    let isUpgrade = site.remark === 'Change Antenna' || site.isHighGain;
                    if (site.type === 'existing' && !isUpgrade) continue;
                    
                    const dist = getDistance(site.lat, site.lon, pt.lat, pt.lon);
                    // Authentic RSRP math footprint evaluation
                    let baseline = site.initial_radius !== undefined ? site.initial_radius : (site.clutter_radius || site.radius_m || 600);
                    let eff_radius = isUpgrade ? (baseline * 1.2) : (site.radius_m || 600);
                    
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
                    color = '#2ecc71'; // Improved to new good green!
                }
            }

            if (currentMetric === 'RSRP') {
                if (color === '#2ecc71') goodCount++;
                else poorCount++;
            } else if (currentMetric === 'RSRQ') {
                if (color === '#2ecc71') goodCount++;
                else if (color === '#f1c40f') fairCount++;
                else poorCount++;
            }

            L.circle([pt.lat, pt.lon], {
                radius: currentSource === 'MDT' ? 10 : 25,
                fillColor: color,
                color: color,
                weight: 1,
                opacity: 0.8,
                fillOpacity: 0.8,
                pane: 'gridPane'
            }).addTo(mrLayerGroup);
        });

        let total = goodCount + fairCount + poorCount;
        try {
            if (total > 0) {
                if (currentMetric === 'RSRP') {
                    if(document.getElementById('rsrp-good-stat')) document.getElementById('rsrp-good-stat').innerHTML = `${goodCount} pt (${((goodCount/total)*100).toFixed(1)}%)`;
                    if(document.getElementById('rsrp-poor-stat')) document.getElementById('rsrp-poor-stat').innerHTML = `${poorCount} pt (${((poorCount/total)*100).toFixed(1)}%)`;
                } else if (currentMetric === 'RSRQ') {
                    if(document.getElementById('rsrq-good-stat')) document.getElementById('rsrq-good-stat').innerHTML = `${goodCount} pt (${((goodCount/total)*100).toFixed(1)}%)`;
                    if(document.getElementById('rsrq-fair-stat')) document.getElementById('rsrq-fair-stat').innerHTML = `${fairCount} pt (${((fairCount/total)*100).toFixed(1)}%)`;
                    if(document.getElementById('rsrq-poor-stat')) document.getElementById('rsrq-poor-stat').innerHTML = `${poorCount} pt (${((poorCount/total)*100).toFixed(1)}%)`;
                }
            } else {
                if (currentMetric === 'RSRP') {
                    if(document.getElementById('rsrp-good-stat')) document.getElementById('rsrp-good-stat').innerHTML = "";
                    if(document.getElementById('rsrp-poor-stat')) document.getElementById('rsrp-poor-stat').innerHTML = "";
                } else if (currentMetric === 'RSRQ') {
                    if(document.getElementById('rsrq-good-stat')) document.getElementById('rsrq-good-stat').innerHTML = "";
                    if(document.getElementById('rsrq-fair-stat')) document.getElementById('rsrq-fair-stat').innerHTML = "";
                    if(document.getElementById('rsrq-poor-stat')) document.getElementById('rsrq-poor-stat').innerHTML = "";
                }
            }
        } catch(e) { console.error('Legend update error:', e); }
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

// btn-save-session removed from HTML, omitting event listener

document.getElementById('btn-regenerate-system').addEventListener('click', () => {
    if (!confirm("Are you sure you want to run the full pipeline to regenerate system proposals? This will take 5-10 minutes and overwrite any previous system baseline.")) return;
    
    document.getElementById('btn-regenerate-system').innerHTML = '⚙️ Running Pipeline...';
    document.getElementById('btn-regenerate-system').disabled = true;
    
    fetch('/api/regenerate', { method: 'POST' })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            alert('Pipeline completed successfully! Please refresh the page to load the new data.');
        } else {
            alert('Error running pipeline: ' + data.error);
        }
        document.getElementById('btn-regenerate-system').innerHTML = '⚙️ Run Full Pipeline';
        document.getElementById('btn-regenerate-system').disabled = false;
    })
    .catch(err => {
        alert('Error: ' + err);
        document.getElementById('btn-regenerate-system').innerHTML = '⚙️ Run Full Pipeline';
        document.getElementById('btn-regenerate-system').disabled = false;
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('rsrp_custom_sites');
    if (saved) {
        try {
            customSitesMap = JSON.parse(saved);
        } catch(e) {}
    }
    
    // Strict Baseline Caching: Store immutable baseline radius upon initial load
    for (const apt in DASHBOARD_DATA) {
        if (DASHBOARD_DATA[apt] && DASHBOARD_DATA[apt].sites) {
            DASHBOARD_DATA[apt].sites.forEach(site => {
                if (site.initial_radius === undefined) {
                    site.initial_radius = site.clutter_radius || site.radius_m || 600;
                }
            });
        }
    }
    
    initMap();
    setupEditorListeners();
    
    // Initial sync for the first loaded airport
    if (currentAirport) {
        customSites = customSitesMap[currentAirport] || { added: [], deleted: [], modified: {} };
        editedStateChanged = customSites.added.length > 0 || customSites.deleted.length > 0 || Object.keys(customSites.modified).length > 0;
        document.getElementById('save-banner').style.display = editedStateChanged ? 'flex' : 'none';
    }
    
    renderMap(true);

    // Dependency Health Check (runs once on load)
    fetch('/api/check_deps')
    .then(res => res.json())
    .then(data => {
        if (data.status === 'missing_deps' && data.missing.length > 0) {
            // Create a warning banner at the top of the page
            const banner = document.createElement('div');
            banner.id = 'deps-warning-banner';
            banner.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; z-index: 10000; background: linear-gradient(135deg, #e74c3c, #c0392b); color: white; padding: 12px 20px; font-family: sans-serif; font-size: 14px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,0.3);';
            banner.innerHTML = `
                <span>⚠️ <strong>Missing Python packages:</strong> ${data.missing.join(', ')} — PPTX export will not work! Run: <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 3px;">${data.install_command}</code></span>
                <button onclick="this.parentElement.remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">✕</button>
            `;
            document.body.prepend(banner);
        }
    })
    .catch(() => {
        // Server not running or /api/check_deps not available — silently ignore
        console.log('Dependency check skipped (server not available or endpoint missing)');
    });

    // Autosave Loop (Runs every 15 seconds)
    setInterval(() => {
        if (editedStateChanged) {
            if (currentAirport) customSitesMap[currentAirport] = customSites;
            
            fetch('/api/autosave', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(customSitesMap)
            })
            .then(res => res.json())
            .then(data => {
                if(data.status === 'success') console.log('Autosaved to .pkl');
            })
            .catch(err => console.log('Autosave failed. Server offline?'));
        }
    }, 15000);
});






// Multi-Select Deletion Feature
let multiSelectMode = false;
let selectedSitesForDeletion = new Set();
let selectionCircles = {};

document.getElementById('btn-polygon-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    multiSelectMode = !multiSelectMode;
    const btn = document.getElementById('btn-polygon-delete');
    
    if (multiSelectMode) {
        btn.style.background = 'linear-gradient(135deg, #f39c12, #e67e22)';
        btn.innerHTML = 'Finish Deletion';
        selectedSitesForDeletion.clear();
        for (let id in selectionCircles) {
            map.removeLayer(selectionCircles[id]);
        }
        selectionCircles = {};
        document.getElementById('map').style.cursor = 'crosshair';
    } else {
        // Finish deletion
        if (selectedSitesForDeletion.size > 0) {
            // Find all sectors associated with these sites
            let toDelete = [];
            globalActiveSites.forEach(site => {
                if (selectedSitesForDeletion.has(site.id) && site.type !== 'existing') {
                    toDelete.push(site);
                }
            });
            
            if (toDelete.length > 0) {
                const confirmDelete = confirm(`Are you sure you want to delete ${selectedSitesForDeletion.size} sites (${toDelete.length} sectors)?`);
                if (confirmDelete) {
                    let aptData = DASHBOARD_DATA[currentAirport];
                    toDelete.forEach(site => {
                        if (site.type === 'proposed_new' || site.remark === 'Additional Sector') {
                            customSites.added = customSites.added.filter(s => s !== site);
                            let originalSite = null;
                            if (aptData && aptData.sites) {
                                if (site.original_azimuth === undefined) site.original_azimuth = site.azimuth;
                                originalSite = aptData.sites.find(s => s.id === site.id && (s.original_azimuth !== undefined ? s.original_azimuth === site.original_azimuth : s.azimuth === site.original_azimuth));
                            }
                            if (originalSite) {
                                if (originalSite.original_azimuth === undefined) originalSite.original_azimuth = originalSite.azimuth;
                                customSites.deleted.push(originalSite.id + '_' + originalSite.original_azimuth);
                            }
                        } else {
                            let originalSite = null;
                            if (aptData && aptData.sites) {
                                if (site.original_azimuth === undefined) site.original_azimuth = site.azimuth;
                                originalSite = aptData.sites.find(s => s.id === site.id && (s.original_azimuth !== undefined ? s.original_azimuth === site.original_azimuth : s.azimuth === site.original_azimuth));
                            }
                            if (originalSite) {
                                if (originalSite.original_azimuth === undefined) originalSite.original_azimuth = originalSite.azimuth;
                                customSites.deleted.push(originalSite.id + '_' + originalSite.original_azimuth);
                            }
                        }
                    });
                    markEdited();
                    renderMap();
                }
            }
        }
        cancelMultiSelectMode();
    }
});

function cancelMultiSelectMode() {
    multiSelectMode = false;
    const btn = document.getElementById('btn-polygon-delete');
    btn.style.background = 'linear-gradient(135deg, #e74c3c, #c0392b)';
    btn.innerHTML = '🗑️ Select Sites to Delete';
    document.getElementById('map').style.cursor = '';
    selectedSitesForDeletion.clear();
    for (let id in selectionCircles) {
        map.removeLayer(selectionCircles[id]);
    }
    selectionCircles = {};
}

// Marker click is handled in the render loop. If multiSelectMode is true, we should toggle the site.
// We can modify the marker.on('click') in renderMap or add a map click that finds the closest site.
// A better way is to override marker clicks when in multiSelectMode. Let's do that in renderMap.

// (Moved to initMap)

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && multiSelectMode) {
        cancelMultiSelectMode();
    }
});
