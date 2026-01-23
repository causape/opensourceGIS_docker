// ==========================================
// 0. GLOBAL CONFIGURATION & VARIABLES
// ==========================================

// We define the master list of zone types. 
// NOTE: These names must match EXACTLY with the 'sub_type' column in the PostGIS database.
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

// Global filter state: When the app starts, we want all categories to be visible.
let selectedTypes = [...subTypes];


// ==========================================
// 1. TERMINAL CONFIGURATION (DASHBOARD)
// ==========================================

// We initialize xterm.js to have a "Hacker" style console on the web.
const term = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000', foreground: '#00ff00' }, // Black background, green text
    fontSize: 12, 
    fontFamily: 'Consolas, monospace'
});

// We add the addon so the terminal fits the div container size.
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit(); 

// We connect to the Node.js server using WebSockets (Socket.io).
const socket = io();

// We LISTEN for events: Every time the server sends a 'log', we write it to the terminal.
socket.on('log', (data) => term.write(data));

// If the user resizes the window, we readjust the terminal so it doesn't break.
window.addEventListener('resize', () => fitAddon.fit());


// ==========================================
// 2. MAP CONFIGURATION (MapLibre)
// ==========================================

const map = new maplibregl.Map({
    container: 'map', // The ID of the div in the HTML where the map goes
    style: {
        'version': 8,
        'sources': {
            // SOURCE 1: Base map (Streets and background) using standard OpenStreetMap.
            'osm': {
                'type': 'raster',
                'tiles': ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
                'tileSize': 256,
                'attribution': '&copy; OpenStreetMap'
            },
            
            // SOURCE 2: Main Vector Layer (Schools, parks, etc.) from GeoServer.
            // We use 'tms' (Tile Map Service) to load the .pbf tiles quickly.
            'geoserver-vector': {
                'type': 'vector',
                'scheme': 'tms',
                'tiles': [
                    'http://localhost:8080/geoserver/gwc/service/tms/1.0.0/gis_project:city_buffers_subtype_merged@EPSG:900913@pbf/{z}/{x}/{y}.pbf'
                ]
            },

            // SOURCE 3: Exclusive Layer for Pedestrians.
            // We load it separately to be able to hide/show it independently based on the time.
            // We add '?v=' at the end to avoid browser caching issues.
            'pedestrian-source': {
                'type': 'vector',
                'scheme': 'tms',
                'tiles': [
                    'http://localhost:8080/geoserver/gwc/service/tms/1.0.0/gis_project:pedestrian_buffer@EPSG:900913@pbf/{z}/{x}/{y}.pbf?v='
                ]
            }
        },
        'layers': [
            // Visual background layer (Raster)
            { 'id': 'osm-layer', 'type': 'raster', 'source': 'osm' },
            
            // --- LAYER 1: GENERAL ZONE FILL (Colored by category) ---
            { 
                'id': 'buffers-fill', 
                'type': 'fill', 
                'source': 'geoserver-vector', 
                'source-layer': 'city_buffers_subtype_merged', // Internal layer name in GeoServer
                'paint': { 
                    // Style logic: "If 'sub_type' is 'school', paint it orange..."
                    'fill-color': [
                        'match',
                        ['downcase', ['get', 'sub_type']], // Normalize to lowercase to avoid errors
                        
                        // Education (Orange tones)
                        'school', '#ff9900',
                        'kindergarten', '#ffcc00',
                        'childcare', '#ffb366',
                        'university', '#cc6600',

                        // Sports (Green/Blue tones)
                        'playground', '#33cc33',
                        'pitch', '#008800',
                        'sports_centre', '#009999',
                        'track', '#cc5500',

                        // Others
                        'social_facility', '#3399ff',
                        'tram_station', '#cc0000',
                        
                        // Default color if nothing matches (Grey)
                        '#888888'
                    ],
                    'fill-opacity': 0.6,
                    'fill-outline-color': '#ffffff'
                } 
            },

            // --- LAYER 2: PEDESTRIAN ZONE FILL (Magenta) ---
            {
                'id': 'pedestrian-fill',
                'type': 'fill',
                'source': 'pedestrian-source',
                'source-layer': 'pedestrian_buffer', 
                'paint': {
                    'fill-color': '#ff00ff', // Bright magenta to highlight
                    'fill-opacity': 0.6,
                    'fill-outline-color': '#ffffff'
                }
            },

            // --- LAYER 3: WHITE BORDERS (Aesthetics) ---
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
    center: [8.4037, 49.0069], // Initial center in Karlsruhe
    zoom: 12
});

// We add navigation controls (+ / -) to the bottom right
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');


// ==========================================
// 3. SEARCH FUNCTIONALITY
// ==========================================

// Allow searching by pressing "Enter"
function handleEnter(e) { if(e.key === 'Enter') searchLocation(); }

async function searchLocation() {
    const query = document.getElementById('citySearch').value;
    if(!query) return; // If empty, do nothing

    try {
        // We use the free Nominatim API (OpenStreetMap) to get coordinates
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        // If we find the city, fly to it
        if (data.length > 0) {
            map.flyTo({ center: [data[0].lon, data[0].lat], zoom: 12 });
        }
    } catch (err) { console.error(err); }
}


// ==========================================
// 4. HIGHLIGHT FUNCTIONS
// ==========================================

// This function paints the selected polygon yellow
function highlightFeature(geojsonFeature) {
    const sourceId = 'highlight-source';
    const layerFillId = 'highlight-layer-fill';
    const layerLineId = 'highlight-layer-line';

    // If the source already exists, we just update the data. If not, we create it from scratch.
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojsonFeature);
    } else {
        map.addSource(sourceId, { 'type': 'geojson', 'data': geojsonFeature });

        // Translucent yellow fill layer
        map.addLayer({
            'id': layerFillId, 'type': 'fill', 'source': sourceId,
            'paint': { 'fill-color': '#ffff00', 'fill-opacity': 0.4 }
        });

        // Thick yellow border layer
        map.addLayer({
            'id': layerLineId, 'type': 'line', 'source': sourceId,
            'paint': { 'line-color': '#ffff00', 'line-width': 3 }
        });
    }
}

// Clears the highlight (empties the source data)
function clearHighlight() {
    const sourceId = 'highlight-source';
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] });
    }
}


// ==========================================
// 5. CLICK LOGIC (WFS + VISIBILITY). IMPORTANT. WITH THIS WE TAKE THE PARAMETERS WITH THE CLIC
// ==========================================

map.on('click', async (e) => {
    const { lng, lat } = e.lngLat;
    const clickPoint = turf.point([lng, lat]); // Create a geometric point to use with Turf.js. Obtain lat and long of the click to later obtain the parameteers 
    
    // We prepare the URL to ask GeoServer (WFS GetFeature)
    // This returns the real DATA, not just the map image
    const wfsUrl = new URL('http://localhost:8080/geoserver/gis_project/ows');
    wfsUrl.searchParams.append('service', 'WFS');
    wfsUrl.searchParams.append('version', '1.0.0');
    wfsUrl.searchParams.append('request', 'GetFeature');
    wfsUrl.searchParams.append('typeName', 'gis_project:city_buffers_subtype_merged'); 
    wfsUrl.searchParams.append('maxFeatures', '10'); 
    wfsUrl.searchParams.append('outputFormat', 'application/json');
    // Spatial filter: Give us what intersects with our click
    wfsUrl.searchParams.append('CQL_FILTER', `INTERSECTS(geom, POINT(${lng} ${lat}))`);  // This line searchs the parameters taking into account the lat and long taken by the user clcik

    try {
        const res = await fetch(wfsUrl);
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            
            // SMART FILTERING:
            // 1. We verify geometrically with Turf.js if the point is really INSIDE the polygon
            // 2. We verify if that category is active in the user filters
            const validFeatures = data.features.filter(feature => {
                const isInside = turf.booleanPointInPolygon(clickPoint, feature);
                const type = feature.properties.sub_type ? feature.properties.sub_type.toLowerCase() : '';
                const isVisible = selectedTypes.includes(type);

                return isInside && isVisible;
            });

            if (validFeatures.length > 0) {
                // If multiple polygons overlap, we pick the smallest one (usually the most specific)
                const sorted = validFeatures.sort((a, b) => turf.area(a) - turf.area(b));
                const selectedFeature = sorted[0];

                highlightFeature(selectedFeature); // Paint it yellow
                showPanel(selectedFeature.properties); // Show its info
            } else {
                closePanel(); // If not valid, close panel
            }
        } else {
            closePanel(); // If no data, close panel
        }
    } catch (err) {
        console.error("WFS Error:", err);
    }
});


// ==========================================
// 6. UI & DATA FORMATTING
// ==========================================

// Configuration of icons and colors for the side panel
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

// Converts the raw text list from DB into a better look HTML list with icons
function formatDetailedInfo(text) {
    if (!text) return '<span style="color:#777">No details available</span>';

    const items = text.split('|'); // Split by pipe separator
    let html = '<ul class="detail-list">';
    
    items.forEach(item => {
        item = item.trim();
        if(item.length === 0) return;

        const firstColonIndex = item.indexOf(':');
        
        if (firstColonIndex !== -1) {
            // Split type and name (e.g., "school: Goethe Gymansium")
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

// Fills the side panel with data and shows it
function showPanel(properties) {
    const contentDiv = document.getElementById('infoContent');  //Get the panels where the info will be displayed
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

    // Loop through the rest of the properties to show them (hiding technical ones like bbox or geom)
    for (const [key, value] of Object.entries(properties)) {
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
    panel.classList.add('active'); // CSS does the slide-in animation
}

function closePanel() {
    document.getElementById('infoPanel').classList.remove('active');
    clearHighlight(); 
}


// ==========================================
// 7. FILTER CONTROL (Checkboxes)
// ==========================================

function initFilterControl() {
    const filterGroup = document.getElementById('filter-control');
    
    // Internal function to visually update the map
    const updateMapFilter = () => {
        // MapLibre syntax: ['in', 'field', val1, val2...]
        const filter = ['in', 'sub_type', ...selectedTypes];
        
        // Apply the filter to all relevant layers
        if (map.getLayer('buffers-fill')) map.setFilter('buffers-fill', filter);
        if (map.getLayer('buffers-line')) map.setFilter('buffers-line', filter);
        if (map.getLayer('pedestrian-fill')) map.setFilter('pedestrian-fill', filter);
    };

    // Dynamically generate checkboxes based on the subTypes list
    subTypes.forEach(type => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = true; // All active by default
        input.value = type;
        
        // Listener: Every time we change a checkbox, we update the list and the map
        input.addEventListener('change', (e) => {
            const value = e.target.value;
            if (e.target.checked) {
                if (!selectedTypes.includes(value)) selectedTypes.push(value);
            } else {
                selectedTypes = selectedTypes.filter(item => item !== value);
            }
            updateMapFilter();
        });

        const text = document.createTextNode(` ${type.replace(/_/g, ' ')}`);
        label.appendChild(input);
        label.appendChild(text);
        filterGroup.appendChild(label);
    });
}


// ==========================================
// 8. GEOLOCATION & SMOKING STATUS (Extra Feature)
// ==========================================

let userPosition = null;
const userMarker = new maplibregl.Marker({ color: '#007cbf', scale: 1.2 }); // Blue dot

// 8.1. Start location tracking // This check the user location in real time and give the location parameters. 
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
        (position) => {
            const { longitude, latitude } = position.coords;
            userPosition = [longitude, latitude];
            
            //castle. Non permited area
            //userPosition = [8.403941, 49.014229];
            //Permited area
            //userPosition = [8.401055, 49.029898];

            // Move the marker in real-time
            userMarker.setLngLat(userPosition).addTo(map);
        },
        (error) => {
            console.error("Error getting location:", error);
            updateStatusUI('error');
        },
        {
            enableHighAccuracy: true, // Ask for GPS if possible
            maximumAge: 0,
            timeout: 5000
        }
    );
} else {
    console.error("Geolocation not supported by the browser.");
}

// 8.2. Verification Logic (Query GeoServer)
async function checkSmokingStatus() {
    if (!userPosition) return; // If there is no user location, the system cannot do anything. 
    const [lng, lat] = userPosition;
    const currentHour = new Date().getHours(); // System time

    // Configure WFS request
    const wfsUrl = new URL('http://localhost:8080/geoserver/gis_project/ows');
    wfsUrl.searchParams.append('service', 'WFS');
    wfsUrl.searchParams.append('version', '1.0.0');
    wfsUrl.searchParams.append('request', 'GetFeature');
    wfsUrl.searchParams.append('typeName', 'gis_project:city_buffers_subtype_merged');
    wfsUrl.searchParams.append('outputFormat', 'application/json');
    // Spatial filter: Am I stepping on a polygon?
    wfsUrl.searchParams.append('CQL_FILTER', `INTERSECTS(geom, POINT(${lng} ${lat}))`);  // There is some polygon in our database that overlap with the exact point of the user? 

    try {
        const res = await fetch(wfsUrl);
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            let isRestricted = false;

            // Analyze what zone type I am stepping on
            for (const feature of data.features) {
                const type = feature.properties.sub_type ? feature.properties.sub_type.toLowerCase() : '';

                // --- TIME LOGIC ---
                if (type === 'pedestrian_zone') { // If the user is into a pedestrial area, logic stop and it says the user is in a forbiden area
                    // Only restricted from 07:00 to 19:00 (according to our code logic)
                    if (currentHour >= 7 && currentHour < 19) {
                        isRestricted = true; // Day = Prohibited / RESTRICTED AREA ACTIVATE
                        break;
                    } else {
                        // Night = Allowed (We ignore this zone)
                        console.log("Inside Pedestrian Zone, but it's night time. Safe.");
                        continue; 
                    }
                } else { // If you are into another forbiden area 
                    // Schools, parks, etc. ALWAYS prohibited (24/7)
                    isRestricted = true; // RESTRICTED AREA ACTIVATES
                    break;
                }
            }

            // Update UI
            if (isRestricted) {
                updateStatusUI('warning'); // aCTIVATE THE RED PANNEL
            } else {
                updateStatusUI('safe'); // ACTIVATES TEH GREEN PANEL
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
setInterval(checkSmokingStatus, 30000); // Run the check every 30 secs

// Optional: Run once after 3s so we don't wait too long at start
setTimeout(() => {
    if(userPosition) checkSmokingStatus();
}, 3000);


// ==========================================
// 8.4. HELPER FOR STATUS UI
// ==========================================
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


// ==========================================
// 9. CLOCK LOGIC (DAY/NIGHT LAYER CONTROL)
// ==========================================

function initClock() {
    const timeDisplay = document.getElementById('time-display');
    const statusDisplay = document.getElementById('time-status');
    const pedType = 'pedestrian_zone';
    
    // Helper function to manually refresh filters if we change 'selectedTypes'
    const refreshMapLayers = () => {
        const filter = ['in', 'sub_type', ...selectedTypes];
        
        // 1. Update main layer
        if (map.getLayer('buffers-fill')) map.setFilter('buffers-fill', filter);
        if (map.getLayer('buffers-line')) map.setFilter('buffers-line', filter);
        
        // 2. CRITICAL: Update the separate pedestrian layer
        if (map.getLayer('pedestrian-fill')) map.setFilter('pedestrian-fill', filter);
    };

    setInterval(() => {  // Initialization of the clock
        const now = new Date();
        const hours = now.getHours(); 
        const timeString = now.toLocaleTimeString(); 

        // 1. Update visual clock
        if(timeDisplay) timeDisplay.innerText = timeString;

        // 2. CHECK RESTRICTION (07:00 - 19:00)
        // The restriction is active if it is >= 7 AM and < 7 PM (19:00)
        const isRestrictedTime = hours >= 7 && hours < 19;

        // Update status text
        if(statusDisplay) { // Updated message in case the user is in relaxed time or forbiden time.
            statusDisplay.innerText = isRestrictedTime ? "⚠ RESTRICTIONS ACTIVE" : "🌙 NIGHT MODE (RELAXED)"; // It activates one on other depending the time ? its an if
            statusDisplay.style.color = isRestrictedTime ? "#ff9900" : "#00ccff"; // It activates the color depending the restriction time
        }

        // 3. AUTOMATIC LAYER CONTROL (DAY vs NIGHT)
        const checkbox = document.querySelector(`input[value="${pedType}"]`); //Check box for the pedestrian areas
        
        if (isRestrictedTime) {
            // --- IT IS DAYTIME (RESTRICTED) ---
            if (checkbox) { //If its restricted hours, it deactivate teh checkbox
                if (checkbox.disabled) { 
                    // Re-enable interaction
                    checkbox.disabled = false;
                    checkbox.parentElement.style.opacity = "1";
                    checkbox.parentElement.title = "Active Restriction Zone";
                    
                    // If not selected, automatically select it at sunrise
                    if (!selectedTypes.includes(pedType)) {
                         selectedTypes.push(pedType);
                         checkbox.checked = true;
                         refreshMapLayers(); // Apply changes to map
                    }
                }
            }

        } else {
            // --- IT IS NIGHTTIME (RELAXED) ---
            
            // 1. If the layer is active, remove it
            if (selectedTypes.includes(pedType)) {
                // Filter the array to remove 'pedestrian_zone'
                selectedTypes = selectedTypes.filter(t => t !== pedType);
                
                // Visually uncheck the box
                if (checkbox) checkbox.checked = false;
                
                // Update map (This is where the magenta layer disappears)
                refreshMapLayers(); 
            }

            // 2. Disable checkbox so it cannot be activated by mistake
            if (checkbox) {
                checkbox.disabled = true; 
                checkbox.parentElement.style.opacity = "0.5"; 
                checkbox.parentElement.title = "Restriction inactive at night (20:00 - 07:00)";
            }
        }

    }, 1000); // Runs every second
}

// Start the clock
initClock();

// Initialize filters only when the map has finished loading styles
map.on('load', () => {
    initFilterControl();
});
