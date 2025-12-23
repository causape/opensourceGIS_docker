-- =========================
-- TABLE DEFINITIONS
-- =========================

local education_poi = osm2pgsql.define_node_table('education_poi', {
    { column = 'osm_id', type = 'bigint' },
    { column = 'name', type = 'text' },
    { column = 'amenity', type = 'text' },
    { column = 'geom', type = 'point', projection = 3857 }
})

local education_area = osm2pgsql.define_way_table('education_area', {
    { column = 'osm_id', type = 'bigint' },
    { column = 'name', type = 'text' },
    { column = 'amenity', type = 'text' },
    { column = 'geom', type = 'polygon', projection = 3857 }
})

local leisure_poi = osm2pgsql.define_node_table('leisure_poi', {
    { column = 'osm_id', type = 'bigint' },
    { column = 'name', type = 'text' },
    { column = 'leisure', type = 'text' },
    { column = 'geom', type = 'point', projection = 3857 }
})

local leisure_area = osm2pgsql.define_way_table('leisure_area', {
    { column = 'osm_id', type = 'bigint' },
    { column = 'name', type = 'text' },
    { column = 'leisure', type = 'text' },
    { column = 'geom', type = 'polygon', projection = 3857 }
})

local pedestrian_roads = osm2pgsql.define_way_table('pedestrian_roads', {
    { column = 'osm_id', type = 'bigint' },
    { column = 'highway', type = 'text' },
    { column = 'geom', type = 'linestring', projection = 3857 }
})

local tram_stations = osm2pgsql.define_node_table('tram_stations', {
    { column = 'osm_id', type = 'bigint' },
    { column = 'public_transport', type = 'text' },
    { column = 'geom', type = 'point', projection = 3857 }
})

local landuse_areas = osm2pgsql.define_way_table('landuse_areas', {
    { column = 'osm_id', type = 'bigint' },
    { column = 'landuse', type = 'text' },
    { column = 'geom', type = 'polygon', projection = 3857 }
})

-- =========================
-- PROCESS NODES
-- =========================

function osm2pgsql.process_node(object)
    local amenity = object.tags.amenity
    if amenity == 'school' or amenity == 'childcare' or amenity == 'kindergarten' or amenity == 'social_facility' then
        education_poi:add_row({
            osm_id = object.id,
            name = object.tags.name,
            amenity = amenity
        })
    end

    local leisure = object.tags.leisure
    if leisure == 'playground' or leisure == 'pitch' or leisure == 'sports_centre' or leisure == 'track' then
        leisure_poi:add_row({
            osm_id = object.id,
            name = object.tags.name,
            leisure = leisure
        })
    end

    if object.tags.public_transport == 'tram_station' then
        tram_stations:add_row({
            osm_id = object.id,
            public_transport = 'tram_station'
        })
    end
end

-- =========================
-- PROCESS WAYS
-- =========================

function osm2pgsql.process_way(object)
    local amenity = object.tags.amenity
    if amenity == 'school' or amenity == 'childcare' or amenity == 'kindergarten' or amenity == 'social_facility' then
        education_area:add_row({
            osm_id = object.id,
            name = object.tags.name,
            amenity = amenity
        })
    end

    local leisure = object.tags.leisure
    if leisure == 'playground' or leisure == 'pitch' or leisure == 'sports_centre' or leisure == 'track' then
        leisure_area:add_row({
            osm_id = object.id,
            name = object.tags.name,
            leisure = leisure
        })
    end

    if object.tags.highway == 'pedestrian' then
        pedestrian_roads:add_row({
            osm_id = object.id,
            highway = 'pedestrian'
        })
    end

    local landuse = object.tags.landuse
    if landuse == 'education' or landuse == 'military' then
        landuse_areas:add_row({
            osm_id = object.id,
            landuse = landuse
        })
    end
end
