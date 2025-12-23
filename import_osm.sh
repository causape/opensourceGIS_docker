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
FLAT_NODES="/data/flatnodes.bin"
DUMP_FILE="/data/filtered_osm_data.sql.gz"

# -----------------------------
# 1. Check if data is already in DB
# -----------------------------
ROWS=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
"SELECT COUNT(*) FROM education_poi LIMIT 1;" 2>/dev/null || echo 0)

if [ "$ROWS" -gt 0 ]; then
  echo "Data already exists in database. Skipping everything."
  exit 0
fi

# -----------------------------
# 2. Try to restore from SQL Dump first
# -----------------------------
if [ -f "$DUMP_FILE" ]; then
  echo "Found SQL Dump ($DUMP_FILE). Importing directly..."
  zcat "$DUMP_FILE" | psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE"
  echo "SQL Import finished successfully."
  exit 0
fi

# -----------------------------
# 3. Fallback: Heavy import (PBF + Flat-nodes)
# -----------------------------
echo "No SQL Dump found. Starting heavy OSM import process..."

# Download PBF if missing
if [ ! -f "$OSM_FILE" ]; then
  echo "Downloading Germany OSM data..."
  wget -O "$OSM_FILE" "$OSM_URL"
fi

echo "Starting osm2pgsql Flex import (this will create flatnodes)..."
osm2pgsql \
  --slim \
  --output=flex \
  --style /styles/osm.lua \
  --flat-nodes "$FLAT_NODES" \
  --cache 12000 \
  --number-processes 2 \
  -d "$PGDATABASE" \
  -U "$PGUSER" \
  -H "$PGHOST" \
  "$OSM_FILE"

# 4. Generate the Dump for next time
echo "Generating SQL Dump for future fast imports..."
pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
  -t education_poi -t education_area -t leisure_poi -t leisure_area \
  -t pedestrian_roads -t tram_stations -t landuse_areas | gzip > "$DUMP_FILE"

echo "--------------------------------------------------"
echo "PROCESS FINISHED!"
echo "--------------------------------------------------"
