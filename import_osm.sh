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
DUMP_FILE="/data/filtered_osm_data.sql.gz"
# -----------------------------
# 1. NEW: Check if SQL Dump exists (Highest Priority)
# -----------------------------
if [ -f "$DUMP_FILE" ]; then
  echo "Found SQL Dump ($DUMP_FILE). Checking database..."
  
  # Check if data is already in the DB to avoid double import
  ROWS=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
  "SELECT COUNT(*) FROM education_poi LIMIT 1;" 2>/dev/null || echo 0)

  if [ "$ROWS" -gt 0 ]; then
    echo "Data already exists in database. Skipping SQL import."
  else
    echo "Database is empty. Importing directly from SQL Dump (Fast mode)..."
    zcat "$DUMP_FILE" | psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE"
    echo "SQL Import finished successfully."
  fi
  
  echo "Process complete."
  exit 0
fi


# -----------------------------
# 2. Check if data is already imported
# -----------------------------
ROWS=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
"SELECT COUNT(*) FROM education_poi LIMIT 1;" 2>/dev/null || echo 0)

if [ "$ROWS" -gt 0 ]; then
  echo "Data already exists in database. Skipping import."
else
  # -----------------------------
  # 3. Download OSM data if missing (Fallback)
  # -----------------------------
  echo "No SQL Dump found. Starting standard OSM processing..."
  if [ ! -f "$OSM_FILE" ]; then
    echo "Downloading Germany OSM data from Geofabrik..."
    wget -O "$OSM_FILE" "$OSM_URL"
  else
    echo "OSM file already exists, skipping download."
  fi
  echo "Cleaning up old tables..."
  psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" <<EOF
DROP TABLE IF EXISTS 
  education_poi, education_area, leisure_poi, leisure_area, 
  pedestrian_roads, tram_stations, landuse_areas;
EOF

  echo "Starting OSM import (Flex Mode - filtering into your custom tables)..."
  
  # --slim is required for memory management
  # --drop cleans up temporary tables after finishing
  osm2pgsql \
    --slim \
    --drop \
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
# 4. Cleanup
# -----------------------------
echo "Cleaning up PBF file..."
rm -f "$OSM_FILE"

echo "--------------------------------------------------"
echo "PROCESS FINISHED!"
echo "--------------------------------------------------"
