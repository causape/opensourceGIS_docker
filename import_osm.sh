#!/bin/sh
# Import initial OSM data using osm2pgsql (SLIM mode)

echo "Waiting for PostGIS..."
until pg_isready -h "$PGHOST" -U "$PGUSER"; do
  sleep 2
done

if [ -f /data/initial.osm.pbf ]; then
  echo "Importing initial OSM data into PostGIS in SLIM mode..."
  osm2pgsql --slim --cache 2000 -d "$PGDATABASE" -U "$PGUSER" -H "$PGHOST" /data/initial.osm.pbf
  echo "Initial import completed."
else
  echo "ERROR: No /data/initial.osm.pbf file found."
fi
