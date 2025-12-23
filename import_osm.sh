#!/bin/sh
set -e

echo "Waiting for PostGIS to be ready..."
until pg_isready -h "$PGHOST" -U "$PGUSER"; do
  sleep 2
done

# -----------------------------
# Variables
# -----------------------------
DUMP_FILE="/data/filtered_osm_data.sql.gz"

# -----------------------------
# 1. Check if DB is already populated
# -----------------------------
ROWS=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
"SELECT COUNT(*) FROM education_poi LIMIT 1;" 2>/dev/null || echo 0)

if [ "$ROWS" -gt 0 ]; then
  echo "Data already exists in database. Nothing to do."
  exit 0
fi

# -----------------------------
# 2. Check for SQL Dump
# -----------------------------
if [ -f "$DUMP_FILE" ]; then
  echo "Found SQL Dump ($DUMP_FILE). Starting import..."
  
  # Importamos el archivo comprimido directamente a Postgres
  zcat "$DUMP_FILE" | psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE"
  
  echo "--------------------------------------------------"
  echo "IMPORT COMPLETED SUCCESSFULLY FROM SQL DUMP"
  echo "--------------------------------------------------"
else
  echo "--------------------------------------------------"
  echo "ERROR: SQL Dump not found at $DUMP_FILE"
  echo "No heavy import will be performed. System idle."
  echo "--------------------------------------------------"
  exit 1
fi
