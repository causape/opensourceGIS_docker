#!/bin/sh
set -e

# Wait for the database to be ready before starting
echo "Waiting for PostGIS..."
until pg_isready -h "$PGHOST" -U "$PGUSER"; do
  sleep 2
done

# Ensure the required directories exist
mkdir -p /data/diffs/applied

DUMP_FILE="/data/osm/filtered_osm_data.sql.gz"

while true; do
  # 1. Look for and apply new OSM diff files (.osc.gz)
  for diff in /data/diffs/*.osc.gz; do
    # Skip if no files are found
    [ -e "$diff" ] || continue

    echo "Applying update: $diff..."
    
    # Use --append to update existing data tables
    osm2pgsql \
      --append \
      --slim \
      --output=flex \
      --style /styles/osm.lua \
      --cache 12000 \
      -d "$PGDATABASE" \
      -U "$PGUSER" \
      -H "$PGHOST" \
      "$diff"
    
    echo "$diff applied successfully."
    # Move processed file to 'applied' folder to prevent re-processing
    mv "$diff" /data/diffs/applied/
  done

  # 2 Recalculate buffers if OSM data changed-------------------
  echo "OSM data updated. Recalculating city buffers..."
  python3 /usr/local/bin/app.py
  echo "Buffer recalculation finished."
  

  # 2.5 Generate/Update the SQL Dump
  # Run if new data was applied OR if the dump file is missing
  
  echo "Generating updated SQL Dump..."
    
  # We include both the base OSM tables and your custom buffer tables
  pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
    -t education_poi \
    -t education_area \
    -t leisure_poi \
    -t leisure_area \
    -t pedestrian_roads \
    -t tram_stations \
    -t landuse_areas \
    -t city_buffers \
    -t city_buffers_merged | gzip > "${DUMP_FILE}.tmp"
    
  # Safely replace the old dump with the new one
  mv "${DUMP_FILE}.tmp" "$DUMP_FILE"
  echo "SQL Dump updated successfully at $(date)."
  

  # 3. Wait for 1 hour before checking for new updates again
  echo "Sleeping 3600s (1h) before next check..."
  sleep 60
done
