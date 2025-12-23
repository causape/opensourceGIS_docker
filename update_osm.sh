#!/bin/sh
# Apply OSM diffs using osm2pgsql Flex Mode

echo "Waiting for PostGIS..."
until pg_isready -h "$PGHOST" -U "$PGUSER"; do
  sleep 2
done

# Ensure the directory for processed diffs exists
mkdir -p /data/diffs/applied

while true; do
  # Check for compressed OSM change files (.osc.gz)
  for diff in /data/diffs/*.osc.gz; do
    # If no files are found, skip to the next step
    [ -e "$diff" ] || continue

    echo "Applying update: $diff..."
    
    # IMPORTANT: We use --append to update existing tables
    # and point to your custom Flex style (.lua)
    osm2pgsql \
      --append \
      --slim \
      --output=flex \
      --style /styles/osm.lua \
      --flat-nodes /data/flatnodes.bin \
      --cache 12000 \
      -d "$PGDATABASE" \
      -U "$PGUSER" \
      -H "$PGHOST" \
      "$diff"
    
    echo "$diff applied successfully."

    # Move the processed file to the "applied" folder to avoid re-processing
    mv "$diff" /data/diffs/applied/
  done

  # Wait for 1 hour before checking the directory again
  echo "Sleeping 3600s (1h) before checking for new diffs..."
  sleep 3600
done
