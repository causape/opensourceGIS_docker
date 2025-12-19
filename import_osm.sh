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
# Check if OSM data is really present
# (table must exist AND contain rows)
# -----------------------------
ROWS=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
"SELECT COUNT(*) FROM planet_osm_point;" 2>/dev/null || echo 0)

if [ "$ROWS" -gt 0 ]; then
  echo "OSM data already imported ($ROWS rows found). Skipping import."
  exit 0
fi

echo "OSM data missing or incomplete. Cleaning old tables..."

# -----------------------------
# Drop partially imported tables
# -----------------------------
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" <<EOF
DROP TABLE IF EXISTS
planet_osm_point,
planet_osm_line,
planet_osm_polygon,
planet_osm_roads;
EOF

# -----------------------------
# Import OSM data (SLIM mode)
# flat-nodes is strongly recommended for stability
# -----------------------------
echo "Starting OSM import (this may take a long time)..."

osm2pgsql \
  --slim \
  --flat-nodes /data/flatnodes.bin \
  --cache 3000 \
  --number-processes 2 \
  -d "$PGDATABASE" \
  -U "$PGUSER" \
  -H "$PGHOST" \
  "$OSM_FILE"

echo "OSM import completed successfully."
