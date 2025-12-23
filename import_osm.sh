#!/bin/sh
set -e

echo "Waiting for PostGIS to be ready..."
until pg_isready -h "$PGHOST" -U "$PGUSER"; do
  sleep 2
done

# -----------------------------
# Variables
# -----------------------------
OSM_URL="https://download.geofabrik.de/europe/germany-latest.osm.pbf"
OSM_FILE="/data/germany-latest.osm.pbf"
# Path to the massive flat-nodes file (stored in your mounted volume)
DUMP_FILE="/data/filtered_osm_data.sql.gz"

# -----------------------------
# Download OSM data if missing
# -----------------------------
if [ ! -f "$OSM_FILE" ]; then
  echo "Downloading Germany OSM data from Geofabrik..."
  wget -O "$OSM_FILE" "$OSM_URL"
else
  echo "OSM file already exists, skipping download."
fi

# -----------------------------
# Check if data is already imported
# -----------------------------
# We check one of your custom tables to see if the import was already done
ROWS=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
"SELECT COUNT(*) FROM education_poi LIMIT 1;" 2>/dev/null || echo 0)

if [ "$ROWS" -gt 0 ]; then
  echo "Data already exists in database. Skipping import."
else
  echo "Cleaning up old tables..."
  psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" <<EOF
DROP TABLE IF EXISTS 
  education_poi, education_area, leisure_poi, leisure_area, 
  pedestrian_roads, tram_stations, landuse_areas;
EOF

  echo "Starting OSM import using Flat-nodes mode (Fastest)..."
  
 
  osm2pgsql \
    --slim \
    --output=flex \
    --style /styles/osm.lua \
    --cache 12000 \
    --number-processes 2 \
    -d "$PGDATABASE" \
    -U "$PGUSER" \
    -H "$PGHOST" \
    "$OSM_FILE"

  echo "OSM import completed successfully."
fi

# -----------------------------
# Generate SQL Dump for sharing
# -----------------------------
echo "Generating compressed SQL Dump of the filtered data..."

# This exports ONLY the specific tables you filtered in Lua
pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
  -t education_poi \
  -t education_area \
  -t leisure_poi \
  -t leisure_area \
  -t pedestrian_roads \
  -t tram_stations \
  -t landuse_areas | gzip > "$DUMP_FILE"

echo "--------------------------------------------------"
echo "PROCESS FINISHED!"
echo "Database Dump: ./data/osm/filtered_osm_data.sql.gz"
echo "Flat-nodes file: ./data/osm/flatnodes.bin (Safe to delete if no longer needed)"
echo "--------------------------------------------------"
