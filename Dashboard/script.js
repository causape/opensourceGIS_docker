// =======================
// 0. GLOBAL CONFIG & VARIABLES
// =======================

// Master list of subtypes (must match your database)
const subTypes = [
    "childcare",
    "kindergarten",
    "school",
    "university",
    "playground",
    "pitch",
    "sports_centre",
    "track",
    "social_facility",
    "tram_station",
    "pedestrian_zone"
];

// Global filter state (all active at start)
let selectedTypes = [...subTypes];


// =======================
// 1. TERMINAL CONFIGURATION
// =======================
const term = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000', foreground: '#00ff00' },
    fontSize: 12, fontFamily: 'Consolas, monospace'
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit(); 

const socket = io();
socket.on('log', (data) => term.write(data));
window.addEventListener('resize', () => fitAddon.fit());


// =======================
// 2. MAP CONFIGURATION
// =======================
const map = new maplibregl.Map({
    container: 'map',
    style: {
        'version': 8,
        'sources': {
            'osm': {
                'type': 'raster',
                'tiles': ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
                'tileSize': 256,
                'attribution': '&copy; OpenStreetMap'
            },
            // VECTOR SOURCE (LAYER MERGED BY SUBTYPE)
            'geoserver-vector': {
                'type': 'vector',
                'scheme': 'tms',
                'tiles': [
                    // Ensure 'gis_project' is your workspace
                    'http://localhost:8080/geoserver/gwc/service/tms/1.0.0/gis_project:city_buffers_subtype_merged@EPSG:900913@pbf/{z}/{x}/{y}.pbf'
                ]
            },

            'pedestrian-source': {
                'type': 'vector',
                'scheme': 'tms',
                'tiles': [
                    // Apuntamos a la capa 'pedestrian_buffer' que mostraste en la imagen
                    'http://localhost:8080/geoserver/gwc/service/tms/1.0.0/gis_project:pedestrian_buffer@EPSG:900913@pbf/{z}/{x}/{y}.pbf?v='
                ]
            }
        },
        'layers': [
            { 'id': 'osm-layer', 'type': 'raster', 'source': 'osm' },
            
            // --- FILL LAYER (Colors by category) ---
            { 
                'id': 'buffers-fill', 
                'type': 'fill', 
                'source': 'geoserver-vector', 
                // Internal layer name (without workspace if GeoServer removes it)
                'source-layer': 'city_buffers_subtype_merged', 
                'paint': { 
                    'fill-color': [
                        'match',
                        ['downcase', ['get', 'sub_type']], // Normalize to lowercase
                        
                        // --- EDUCATION ---
                        'school', '#ff9900',
                        'kindergarten', '#ffcc00',
                        'childcare', '#ffb366',
                        'university', '#cc6600',

                        // --- SPORTS ---
                        'playground', '#33cc33',
                        'pitch', '#008800',
                        'sports_centre', '#009999',
                        'track', '#cc5500',

                        // --- OTHERS ---
                        'social_facility', '#3399ff',
                        'tram_station', '#cc0000',
                        

                        // --- FALLBACK ---
                        '#888888'
                    ],
                    'fill-opacity': 0.6,
                    'fill-outline-color': '#ffffff'
                } 
            },
            {
                'id': 'pedestrian-fill',
                'type': 'fill',
                'source': 'pedestrian-source',
                'source-layer': 'pedestrian_buffer', 
                'paint': {
                    'fill-color': '#ff00ff', // MAGENTA
                    'fill-opacity': 0.6,
                    'fill-outline-color': '#ffffff'
                }
            },
            // --- BORDER LAYER ---
            {
                'id': 'buffers-line',
                'type': 'line',
                'source': 'geoserver-vector',
                'source-layer': 'city_buffers_subtype_merged',
                'paint': {
                    'line-color': '#ffffff',
                    'line-width': 1.5,
                    'line-opacity': 0.7
                }
            }
        ]
    },
    center: [8.4037, 49.0069], 
    zoom: 12
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');


// =======================
// 3. SEARCH FUNCTIONALITY
// =======================
function handleEnter(e) { if(e.key === 'Enter') searchLocation(); }

async function searchLocation() {
    const query = document.getElementById('citySearch').value;
    if(!query) return;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.length > 0) map.flyTo({ center: [data[0].lon, data[0].lat], zoom: 12 });
    } catch (err) { console.error(err); }
}


// =======================
// 4. HIGHLIGHT FUNCTIONS
// =======================
function highlightFeature(geojsonFeature) {
    const sourceId = 'highlight-source';
    const layerFillId = 'highlight-layer-fill';
    const layerLineId = 'highlight-layer-line';

    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojsonFeature);
    } else {
        map.addSource(sourceId, { 'type': 'geojson', 'data': geojsonFeature });

        map.addLayer({
            'id': layerFillId, 'type': 'fill', 'source': sourceId,
            'paint': { 'fill-color': '#ffff00', 'fill-opacity': 0.4 }
        });

        map.addLayer({
            'id': layerLineId, 'type': 'line', 'source': sourceId,
            'paint': { 'line-color': '#ffff00', 'line-width': 3 }
        });
    }
}

function clearHighlight() {
    const sourceId = 'highlight-source';
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] });
    }
}


// =======================
// 5. CLICK LOGIC (WFS + VISIBILITY CHECK)
// =======================
map.on('click', async (e) => {
    const { lng, lat } = e.lngLat;
    const clickPoint = turf.point([lng, lat]);
    
    // WFS query to the merged layer
    const wfsUrl = new URL('http://localhost:8080/geoserver/gis_project/ows');
    wfsUrl.searchParams.append('service', 'WFS');
    wfsUrl.searchParams.append('version', '1.0.0');
    wfsUrl.searchParams.append('request', 'GetFeature');
    wfsUrl.searchParams.append('typeName', 'gis_project:city_buffers_subtype_merged'); 
    wfsUrl.searchParams.append('maxFeatures', '10'); 
    wfsUrl.searchParams.append('outputFormat', 'application/json');
    wfsUrl.searchParams.append('CQL_FILTER', `INTERSECTS(geom, POINT(${lng} ${lat}))`);

    try {
        const res = await fetch(wfsUrl);
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            
            // --- SMART FILTERING ---
            const validFeatures = data.features.filter(feature => {
                // 1. Does the point geometrically fall inside?
                const isInside = turf.booleanPointInPolygon(clickPoint, feature);
                
                // 2. Is the type active in the filter menu?
                // Use toLowerCase() to avoid case sensitivity issues
                const type = feature.properties.sub_type ? feature.properties.sub_type.toLowerCase() : '';
                const isVisible = selectedTypes.includes(type);

                return isInside && isVisible;
            });

            if (validFeatures.length > 0) {
                // Sort by area (smallest first to facilitate selection)
                const sorted = validFeatures.sort((a, b) => turf.area(a) - turf.area(b));
                const selectedFeature = sorted[0];

                highlightFeature(selectedFeature);
                showPanel(selectedFeature.properties);
            } else {
                // If nothing visible under click, close
                closePanel();
            }
        } else {
            closePanel();
        }
    } catch (err) {
        console.error("WFS Error:", err);
    }
});


// =======================
// 6. UI & FORMATTING
// =======================
const typeConfig = {
    'school':          { icon: '🎓', class: 'type-school' },
    'kindergarten':    { icon: '🧸', class: 'type-kindergarten' },
    'childcare':       { icon: '👶', class: 'type-kindergarten' },
    'university':      { icon: '🏛️', class: 'type-school' },
    'playground':      { icon: '🛝', class: 'type-playground' },
    'pitch':           { icon: '⚽', class: 'type-playground' },
    'sports_centre':   { icon: '🏋️', class: 'type-playground' },
    'track':           { icon: '🏃', class: 'type-playground' },
    'social_facility': { icon: '🤝', class: 'type-social' },
    'tram_station':    { icon: '🚋', class: 'type-social' },
    'pedestrian_zone': { icon: '🚶', class: 'type-social' },
    'default':         { icon: '📍', class: '' } 
};

function formatDetailedInfo(text) {
    if (!text) return '<span style="color:#777">No details available</span>';

    const items = text.split('|');
    let html = '<ul class="detail-list">';
    
    items.forEach(item => {
        item = item.trim();
        if(item.length === 0) return;

        const firstColonIndex = item.indexOf(':');
        
        if (firstColonIndex !== -1) {
            const rawType = item.substring(0, firstColonIndex).trim().toLowerCase();
            const name = item.substring(firstColonIndex + 1).trim();
            const config = typeConfig[rawType] || typeConfig['default'];

            html += `
                <li class="${config.class}">
                    <div class="card-icon">${config.icon}</div>
                    <div class="card-content">
                        <span class="card-type">${rawType.replace(/_/g, ' ')}</span>
                        <span class="card-name">${name}</span>
                    </div>
                </li>
            `;
        } else {
            html += `<li><div class="card-content"><span class="card-name">${item}</span></div></li>`;
        }
    });
    html += '</ul>';
    return html;
}

function showPanel(properties) {
    const contentDiv = document.getElementById('infoContent');
    const panel = document.getElementById('infoPanel');
    let html = '';

    const detailKey = Object.keys(properties).find(k => k.toLowerCase() === 'detailed_info');

    if(detailKey && properties[detailKey]) {
        html += `
            <div class="info-section">
                <span class="label">Facilities Inside</span>
                ${formatDetailedInfo(properties[detailKey])}
            </div>
        `;
    }

    for (const [key, value] of Object.entries(properties)) {
        // Hide technical columns
        if (!['bbox', 'geom', 'detailed_info', 'sub_types', 'names_list'].includes(key.toLowerCase())) {
            html += `
                <div class="info-section">
                    <span class="label">${key.replace(/_/g, ' ')}</span>
                    <span class="value">${value}</span>
                </div>
            `;
        }
    }
    contentDiv.innerHTML = html;
    panel.classList.add('active');
}

function closePanel() {
    document.getElementById('infoPanel').classList.remove('active');
    clearHighlight(); 
}


// =======================
// 7. FILTER CONTROL LOGIC
// =======================
function initFilterControl() {
    const filterGroup = document.getElementById('filter-control');
    
    // Function to visually update the map
    const updateMapFilter = () => {
        // MapLibre syntax: ['in', 'field', val1, val2...]
        const filter = ['in', 'sub_type', ...selectedTypes];
        
        if (map.getLayer('buffers-fill')) map.setFilter('buffers-fill', filter);
        if (map.getLayer('buffers-line')) map.setFilter('buffers-line', filter);
        if (map.getLayer('pedestrian-fill')) map.setFilter('pedestrian-fill', filter);
        
    };

    // Generate checkboxes
    subTypes.forEach(type => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = true; // All active by default
        input.value = type;
        
        input.addEventListener('change', (e) => {
            const value = e.target.value;
            if (e.target.checked) {
                // Add to global list
                if (!selectedTypes.includes(value)) selectedTypes.push(value);
            } else {
                // Remove from global list
                selectedTypes = selectedTypes.filter(item => item !== value);
            }
            // Update map
            updateMapFilter();
        });

        const text = document.createTextNode(` ${type.replace(/_/g, ' ')}`);
        label.appendChild(input);
        label.appendChild(text);
        filterGroup.appendChild(label);
    });
}


// =======================
// 8. REAL-TIME GEOLOCATION & SMOKING CHECK  / ////EXTRA FUNCTIONANILTY IN THE APP.  
// =======================

let userPosition = null;
const userMarker = new maplibregl.Marker({ color: '#007cbf', scale: 1.2 }); // Blue dot for user

// 8.1. Start location tracking
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
        (position) => {
            const { longitude, latitude } = position.coords;
            userPosition = [longitude, latitude];

            // Update marker on map in real-time
            userMarker.setLngLat(userPosition).addTo(map);
            /*
            userPosition = [8.404854, 49.014147];

            // Update marker on map in real-time
            //userMarker.setLngLat(userPosition).addTo(map);
            userMarker.setLngLat(userPosition).addTo(map);
            
            // Fly directly to the map
            map.flyTo({ center: userPosition, zoom: 16 });

            */
        },
        (error) => {
            console.error("Error getting location:", error);
            updateStatusUI('error');
        },
        {
            enableHighAccuracy: true, // Use GPS if available
            maximumAge: 0,
            timeout: 5000
        }
    );
} else {
    console.error("Geolocation is not supported by this browser.");
}

// 8.2. Check Logic (Queries GeoServer)
async function checkSmokingStatus() {
    if (!userPosition) return;
    const [lng, lat] = userPosition;
    const currentHour = new Date().getHours(); // System time

    // WFS URL (Standard setup)
    const wfsUrl = new URL('http://localhost:8080/geoserver/gis_project/ows');
    wfsUrl.searchParams.append('service', 'WFS');
    wfsUrl.searchParams.append('version', '1.0.0');
    wfsUrl.searchParams.append('request', 'GetFeature');
    wfsUrl.searchParams.append('typeName', 'gis_project:city_buffers_subtype_merged');
    wfsUrl.searchParams.append('outputFormat', 'application/json');
    wfsUrl.searchParams.append('CQL_FILTER', `INTERSECTS(geom, POINT(${lng} ${lat}))`);

    try {
        const res = await fetch(wfsUrl);
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            let isRestricted = false;

            for (const feature of data.features) {
                const type = feature.properties.sub_type ? feature.properties.sub_type.toLowerCase() : '';

                // --- TIME LOGIC ---
                if (type === 'pedestrian_zone') {
                    // Only restricted between 07:00 and 20:00
                    if (currentHour >= 7 && currentHour < 20) {
                        isRestricted = true; // Day = Restricted
                        break;
                    } else {
                        // Night = Safe (Ignore this zone)
                        console.log("Inside Pedestrian Zone, but it's night time. Safe.");
                        continue; 
                    }
                } else {
                    // Schools, playgrounds, etc. are ALWAYS restricted (24/7)
                    isRestricted = true;
                    break;
                }
            }

            if (isRestricted) {
                updateStatusUI('warning');
            } else {
                // Inside a polygon, but it's a "Safe" time (Night pedestrian zone)
                updateStatusUI('safe'); 
            }

        } else {
            // Outside of any buffer
            updateStatusUI('safe');
        }
    } catch (err) { 
        console.error("Error checking zone:", err); 
        updateStatusUI('error');
    }
}

// 8.3. Run check every 30 seconds
setInterval(checkSmokingStatus, 30000); 

// Optional: Run immediately once to avoid waiting 30s for the first status
setTimeout(() => {
    if(userPosition) checkSmokingStatus();
}, 3000);


// =======================
// 8.4. UI HELPER FUNCTION
// =======================
function updateStatusUI(status) {
    const panel = document.getElementById('status-panel');
    const text = document.getElementById('status-text');
    const icon = document.getElementById('status-icon');

    // Remove previous classes
    panel.classList.remove('waiting', 'warning', 'safe');

    if (status === 'warning') {
        panel.classList.add('warning');
        icon.innerText = '🚭';
        text.innerText = 'NO SMOKING (Protected Zone)';
    } else if (status === 'safe') {
        panel.classList.add('safe');
        icon.innerText = '✅';
        text.innerText = 'Smoking Permitted Here';
    } else {
        panel.classList.add('waiting');
        icon.innerText = '⚠️';
        text.innerText = 'Searching GPS...';
    }
}

// =======================
// 9. TIME LOGIC (CLOCK & LAYER CONTROL)
// =======================

function initClock() {
    const timeDisplay = document.getElementById('time-display');
    const statusDisplay = document.getElementById('time-status');
    const pedType = 'pedestrian_zone';
    
    // HELPER: Refreshes the map filters based on the 'selectedTypes' list
    const refreshMapLayers = () => {
        // Create the filter syntax for MapLibre
        const filter = ['in', 'sub_type', ...selectedTypes];
        
        // 1. Update the main merged layer (if it exists)
        if (map.getLayer('buffers-fill')) map.setFilter('buffers-fill', filter);
        if (map.getLayer('buffers-line')) map.setFilter('buffers-line', filter);
        
        // 2. CRITICAL: Update the separate pedestrian layer (if you added it separately)
        if (map.getLayer('pedestrian-fill')) map.setFilter('pedestrian-fill', filter);
    };

    setInterval(() => {
        const now = new Date();
        const hours = now.getHours(); // We define 'hours' here
        const timeString = now.toLocaleTimeString(); 

        // 1. Update Visual Clock
        if(timeDisplay) timeDisplay.innerText = timeString;

        // 2. CHECK RESTRICTION (07:00 - 20:00)
        // FIX: Use the variable 'hours', not 'currentHour'
        const isRestrictedTime = hours >= 7 && hours < 20;

        // Update Text Status
        if(statusDisplay) {
            statusDisplay.innerText = isRestrictedTime ? "⚠ RESTRICTIONS ACTIVE" : "🌙 NIGHT MODE (RELAXED)";
            statusDisplay.style.color = isRestrictedTime ? "#ff9900" : "#00ccff";
        }

        // 3. AUTOMATIC LAYER CONTROL
        const checkbox = document.querySelector(`input[value="${pedType}"]`);
        
        if (isRestrictedTime) {
            // --- DAYTIME (RESTRICTED) ---
            if (checkbox) {
                if (checkbox.disabled) {
                    // Re-enable the interaction
                    checkbox.disabled = false;
                    checkbox.parentElement.style.opacity = "1";
                    checkbox.parentElement.title = "Active Restriction Zone";
                    
                    // If not currently selected, auto-select it when the day starts
                    if (!selectedTypes.includes(pedType)) {
                         selectedTypes.push(pedType);
                         checkbox.checked = true;
                         refreshMapLayers(); // Apply changes to the map
                    }
                }
            }

        } else {
            // --- NIGHTTIME (SAFE/CHILL) ---
            
            // 1. If the layer is currently active, remove it
            if (selectedTypes.includes(pedType)) {
                // Filter the array to remove 'pedestrian_zone'
                selectedTypes = selectedTypes.filter(t => t !== pedType);
                
                // Visually uncheck the box
                if (checkbox) checkbox.checked = false;
                
                // Update the map (This is where the magenta layer disappears)
                refreshMapLayers(); 
            }

            // 2. Disable the checkbox so it cannot be enabled by mistake
            if (checkbox) {
                checkbox.disabled = true; 
                checkbox.parentElement.style.opacity = "0.5"; 
                checkbox.parentElement.title = "Restriction inactive at night (20:00 - 07:00)";
            }
        }

    }, 1000); // Run every second
}

// Start clock
initClock();


// Initialize filters when the map is ready
map.on('load', () => {
    initFilterControl();
});
