#!/bin/sh
set -e

echo "Waiting for PostGIS..."
until pg_isready -h "$PGHOST" -U "$PGUSER"; do
  sleep 2
done

# Variables
OSM_URL="https://download.geofabrik.de/europe/germany-latest.osm.pbf"
OSM_FILE="/data/germany-latest.osm.pbf"

# Descargar solo si no existe
if [ ! -f "$OSM_FILE" ]; then
  echo "Downloading Germany OSM data from Geofabrik..."
  wget -O "$OSM_FILE" "$OSM_URL"
else
  echo "OSM file already exists, skipping download."
fi

# Comprobar si ya se importó
TABLE_CHECK=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='planet_osm_point');")

if [ "$TABLE_CHECK" = "t" ]; then
  echo "OSM data already imported into PostGIS, skipping import."
else
  echo "Importing Germany OSM data into PostGIS in SLIM mode..."
  osm2pgsql --slim --cache 2000 -d "$PGDATABASE" -U "$PGUSER" -H "$PGHOST" "$OSM_FILE"
  echo "Import completed."
fi
