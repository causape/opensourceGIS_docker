#!/bin/sh
# Apply OSM diffs using osm2pgsql only (no Osmosis)

echo "Waiting for PostGIS..."
until pg_isready -h "$PGHOST" -U "$PGUSER"; do
  sleep 2
done

mkdir -p /data/diffs/applied

while true; do
  for diff in /data/diffs/*.osc.gz; do
    [ -e "$diff" ] || continue

    echo "Applying $diff..."
    osm2pgsql --append --slim --cache 200 -d "$PGDATABASE" -U "$PGUSER" -H "$PGHOST" "$diff"
    echo "$diff applied successfully."

    mv "$diff" /data/diffs/applied/
  done

  echo "Sleeping 86400s (24h) before checking new diffs..."
  sleep 3600
done
