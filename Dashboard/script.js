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
            'geoserver-wms': {
                'type': 'raster',
                'tiles': [
                    'http://localhost:8080/geoserver/gis_project/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=gis_project:city_buffers_merged&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&BBOX={bbox-epsg-3857}'
                ],
                'tileSize': 256
            }
        },
        'layers': [
            { 'id': 'osm-layer', 'type': 'raster', 'source': 'osm' },
            { 'id': 'buffers-layer', 'type': 'raster', 'source': 'geoserver-wms', 'paint': { 'raster-opacity': 0.7 } }
        ]
    },
    center: [10.45, 51.16], 
    zoom: 5
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
        map.addSource(sourceId, {
            'type': 'geojson',
            'data': geojsonFeature
        });

        map.addLayer({
            'id': layerFillId,
            'type': 'fill',
            'source': sourceId,
            'paint': {
                'fill-color': '#ffff00',
                'fill-opacity': 0.4
            }
        });

        map.addLayer({
            'id': layerLineId,
            'type': 'line',
            'source': sourceId,
            'paint': {
                'line-color': '#ffff00',
                'line-width': 3
            }
        });
    }
}

function clearHighlight() {
    const sourceId = 'highlight-source';
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({
            type: 'FeatureCollection',
            features: []
        });
    }
}

// =======================
// 5. CLICK LOGIC (MULTIPOLYGON AWARE)
// =======================
map.on('click', async (e) => {
    const { lng, lat } = e.lngLat;
    const clickPoint = turf.point([lng, lat]);
    
    const wfsUrl = new URL('http://localhost:8080/geoserver/gis_project/ows');
    wfsUrl.searchParams.append('service', 'WFS');
    wfsUrl.searchParams.append('version', '1.0.0');
    wfsUrl.searchParams.append('request', 'GetFeature');
    wfsUrl.searchParams.append('typeName', 'gis_project:city_buffers_merged');
    wfsUrl.searchParams.append('maxFeatures', '10'); 
    wfsUrl.searchParams.append('outputFormat', 'application/json');
    wfsUrl.searchParams.append('CQL_FILTER', `INTERSECTS(geom, POINT(${lng} ${lat}))`);

    try {
        const res = await fetch(wfsUrl);
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            
            // --- CAMBIO AQUÍ: NO APLANAMOS (NO FLATTEN) ---
            // Trabajamos directamente con los features tal cual vienen (MultiPolygon o Polygon)
            
            // 1. Filtrar: ¿En qué polígonos cae realmente el punto?
            // turf.booleanPointInPolygon funciona tanto con Polygon como con MultiPolygon
            const validFeatures = data.features.filter(feature => {
                return turf.booleanPointInPolygon(clickPoint, feature);
            });

            if (validFeatures.length > 0) {
                // 2. Ordenar por área total (El más pequeño primero)
                // Esto ayuda si tienes un buffer pequeño encima de uno grande
                const sorted = validFeatures.sort((a, b) => turf.area(a) - turf.area(b));
                
                const selectedFeature = sorted[0];

                // 3. Highlight & Show Info (Se iluminará TODO el multipolígono)
                highlightFeature(selectedFeature);
                showPanel(selectedFeature.properties);
            } else {
                // Fallback (por si el click fue en el borde exacto)
                showPanel(data.features[0].properties);
            }
        } else {
            closePanel();
        }
    } catch (err) {
        console.error("WFS Error:", err);
    }
});

// =======================
// 6. LIST FORMATTER & UI
// =======================

const typeConfig = {
    'kindergarten': { icon: '🧸', class: 'type-kindergarten' },
    'school':       { icon: '🎓', class: 'type-school' },
    'playground':   { icon: '🛝', class: 'type-playground' },
    'pitch':        { icon: '⚽', class: 'type-playground' },
    'social_facility': { icon: '🤝', class: 'type-social' },
    'university':   { icon: '🏛️', class: 'type-school' },
    'sports_centre':{ icon: '🏋️', class: 'type-playground' },
    'default':      { icon: '📍', class: '' } 
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
            html += `
                <li>
                    <div class="card-icon">📍</div>
                    <div class="card-content">
                        <span class="card-name">${item}</span>
                    </div>
                </li>`;
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
        if (key !== 'bbox' && key !== 'geom' && key.toLowerCase() !== 'detailed_info' && key.toLowerCase() !== 'sub_types') {
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