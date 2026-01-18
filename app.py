import psycopg2
import time

# Connection configuration for the Docker network
conn_params = {
    "host": "postgis",
    "port": "5432",
    "database": "gis",
    "user": "gis",
    "password": "password"
}

def get_connection():
    """Establishes and returns a database connection."""
    return psycopg2.connect(**conn_params)

def table_exists(cursor, table_name):
    """Checks if a table exists in the database."""
    cursor.execute(f"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '{table_name}');")
    return cursor.fetchone()[0]

def generate_base_buffers(cursor):
    """
    Cleans duplicates, ensures UNIQUE constraint, and inserts new OSM data.
    """
    start_time = time.time()
    
    # 1. Ensure table exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS city_buffers (
            id SERIAL PRIMARY KEY,
            original_osm_id BIGINT,
            category TEXT,
            sub_type TEXT,
            name TEXT,
            geom GEOMETRY(MultiPolygon, 4326)
        );
    """)

    # 2. CLEANUP: Delete duplicates keeping only the record with the lowest internal ID
    print("Cleaning up existing duplicates to prepare for UNIQUE constraint...")
    cursor.execute("""
        DELETE FROM city_buffers a 
        USING city_buffers b 
        WHERE a.id > b.id 
        AND a.original_osm_id = b.original_osm_id;
    """)

    # 3. Apply the UNIQUE constraint (this will now succeed)
    cursor.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'city_buffers_osm_id_unique'
            ) THEN
                ALTER TABLE city_buffers ADD CONSTRAINT city_buffers_osm_id_unique UNIQUE (original_osm_id);
            END IF;
        END $$;
    """)

    # 4. Ensure spatial index exists
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_city_buffers_geom ON city_buffers USING GIST (geom);")

    print("Checking for new OSM features...")

    # 5. Incremental Upsert
    insert_sql = """
    INSERT INTO city_buffers (original_osm_id, category, sub_type, name, geom)
    SELECT osm_id, category, sub_type, name, geom FROM (
        SELECT osm_id, 'education' as category, amenity as sub_type, name, 
               ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326)) as geom
        FROM education_area
        UNION ALL
        SELECT osm_id, 'education' as category, amenity as sub_type, name, 
               ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326)) as geom
        FROM education_poi
        UNION ALL
        SELECT osm_id, 'leisure' as category, leisure as sub_type, name, 
               ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326)) as geom
        FROM leisure_area
        UNION ALL
        SELECT osm_id, 'transport' as category, public_transport as sub_type, 'Tram Station' as name, 
               ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326)) as geom
        FROM tram_stations
    ) AS source
    ON CONFLICT (original_osm_id) DO NOTHING;
    """
    cursor.execute(insert_sql)
    new_items = cursor.rowcount
    
    print(f"Incremental Update: {new_items} new elements processed in {time.time() - start_time:.2f}s.")
    return new_items > 0

'''
def generate_merged_buffers(cursor, force_update=False):
    """
    Recalculates service islands (merged table).
    This only runs if the table is missing OR if new data was added to city_buffers.
    """
    exists = table_exists(cursor, 'city_buffers_merged')

    if not force_update and exists:
        print("INFO: No changes detected. Skipping global merge.")
        return

    start_time = time.time()
    print("Refreshing merged service islands (Spatial Grid Mode)...")

    # Increase memory for the spatial operation
    cursor.execute("SET work_mem = '1GB';")

    # We refresh the whole merged table to ensure that new overlapping 
    # elements are correctly dissolved into existing islands.
    cursor.execute("DROP TABLE IF EXISTS city_buffer_grid CASCADE;")
    cursor.execute("""
        CREATE TABLE city_buffer_grid AS
        SELECT ST_SetSRID((ST_SquareGrid(0.005, ST_Extent(geom))).geom, 4326) AS geom
        FROM city_buffers;
        CREATE INDEX ON city_buffer_grid USING GIST (geom);
    """)

    cursor.execute("DROP TABLE IF EXISTS city_buffers_merged;")
    cursor.execute("""
        CREATE TABLE city_buffers_merged AS
        WITH gridded AS (
            SELECT b.category, b.sub_type, b.name, b.geom, g.geom as grid_geom
            FROM city_buffers b
            JOIN city_buffer_grid g ON ST_Intersects(b.geom, g.geom)
        ),
        clustered AS (
            SELECT *, ST_ClusterIntersecting(geom) OVER (PARTITION BY grid_geom) AS cluster_id
            FROM gridded
        )
        SELECT 
            string_agg(DISTINCT category, ', ') AS categories,
            string_agg(DISTINCT sub_type, ', ') AS sub_types,
            string_agg(DISTINCT sub_type || ': ' || COALESCE(name, 'Unknown'), ' | ') AS detailed_info,
            COUNT(*) AS element_count,
            ST_Multi(ST_UnaryUnion(ST_Collect(ST_SnapToGrid(geom, 0.0001)))) AS geom
        FROM clustered
        GROUP BY grid_geom, cluster_id;
    """)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_merged_geom ON city_buffers_merged USING GIST (geom);")
    print(f"Success: Merged table updated in {time.time() - start_time:.2f}s.")
'''

import time

def generate_merged_buffers_by_subtype(cursor, force_update=False):
    """
    Recalculates service islands while MAINTAINING distinction by sub_type.
    If two buffers touch but are of different types, they are NOT merged.
    If two buffers of the same type touch, they ARE merged.
    """
    table_name = 'city_buffers_subtype_merged'
    
    # Basic existence check (assuming you have the table_exists function)
    # If you don't have it, you can comment out the next 3 lines.
    exists = table_exists(cursor, table_name)
    if not force_update and exists:
        print(f"INFO: No changes detected for {table_name}. Skipping update.")
        return

    start_time = time.time()
    print(f"Refreshing merged islands by SUBTYPE ({table_name})...")

    # Increase working memory for the geometric operation
    cursor.execute("SET work_mem = '512MB';")

    cursor.execute(f"DROP TABLE IF EXISTS {table_name};")
    
    # Optimized query using ST_ClusterDBSCAN
    # eps := 0 means they must touch or overlap to be considered the same cluster
    cursor.execute(f"""
        CREATE TABLE {table_name} AS
        WITH clustered AS (
            SELECT 
                id,
                category,
                sub_type,
                name,
                geom,
                -- Group geometries that touch (eps=0), but ONLY within the same sub_type
                ST_ClusterDBSCAN(geom, eps := 0, minpoints := 1) 
                OVER (PARTITION BY sub_type) AS cid
            FROM city_buffers
        )
        SELECT 
            row_number() OVER () AS id,  -- Generate a new unique ID
            sub_type,
            MAX(category) as category,   -- The category is the same for the group
            
            -- Generate the detailed list for your side panel
            string_agg(DISTINCT sub_type || ': ' || COALESCE(name, 'Unknown'), ' | ') as detailed_info,
            
            COUNT(*) as element_count,
            
            -- Merge the geometry and force SRID 4326
            ST_Multi(ST_Union(geom))::geometry(MultiPolygon, 4326) as geom
        FROM clustered
        GROUP BY sub_type, cid;
    """)
    
    # Spatial index vital for fast Vector Tiles performance
    cursor.execute(f"CREATE INDEX idx_{table_name}_geom ON {table_name} USING GIST (geom);")
    
    # Index for fast lookups by subtype
    cursor.execute(f"CREATE INDEX idx_{table_name}_subtype ON {table_name} (sub_type);")

    print(f"Success: Table '{table_name}' updated in {time.time() - start_time:.2f}s.")

def generate_pedestrian_buffers(cursor):
    """
    Creates an EXCLUSIVE table 'pedestrian_buffer' and populates it
    with 5-meter buffers generated from the 'pedestrian_roads' table.
    """
    start_time = time.time()
    print("--- Generating Exclusive Pedestrian Buffers (5m) ---")

    # 1. Create the exclusive output table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS pedestrian_buffer (
            id SERIAL PRIMARY KEY,
            osm_id BIGINT UNIQUE,
            name TEXT,
            sub_type TEXT DEFAULT 'pedestrian_zone',
            geom GEOMETRY(MultiPolygon, 4326)
        );
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_ped_buffer_geom "
        "ON pedestrian_buffer USING GIST (geom);"
    )

    # 2. Check if the source table exists
    if not table_exists(cursor, 'pedestrian_roads'):
        print("WARNING: Source table 'pedestrian_roads' not found.")
        return 0

    # 3. Insert buffers (5 meters)
    print("Buffering pedestrian roads (5m)...")

    # --- FIX APPLIED HERE ---
    # We no longer try to read the 'name' column from the source table
    # because it does not exist.
    # Instead, we use a fixed text value: 'Pedestrian Zone'.
    cursor.execute("""
        INSERT INTO pedestrian_buffer (osm_id, name, sub_type, geom)
        SELECT
            osm_id,
            'Pedestrian Zone',  -- Fixed text because there is no 'name' column
            'pedestrian_zone',
            ST_Multi(
                ST_Transform(
                    ST_Buffer(
                        ST_Transform(geom, 4326)::geography,
                        5
                    )::geometry,
                    4326
                )
            )
        FROM pedestrian_roads
        ON CONFLICT (osm_id) DO NOTHING;
    """)

    new_items = cursor.rowcount
    print(
        f"Stored {new_items} items in 'pedestrian_buffer' (Exclusive). "
        f"Time: {time.time() - start_time:.2f}s"
    )

    return new_items

def main():
    """Main incremental execution entry point."""
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()

        # Step 1: Add new buffers (returns count of new items)
        new_items_added = generate_base_buffers(cursor)
        new_items_pedestrian = generate_pedestrian_buffers(cursor)
        conn.commit()

        # Step 2: Refresh merge ONLY if there is new data
        #generate_merged_buffers(cursor, force_update=(new_items_added > 0))
        generate_merged_buffers_by_subtype(cursor, force_update=(new_items_added > 0))
        conn.commit()

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        if conn: conn.rollback()
    finally:
        if conn: conn.close()

if __name__ == "__main__":
    main()
