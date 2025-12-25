import psycopg2
import time

# Connection configuration
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

def table_has_data(cursor, table_name):
    """Checks if a table exists and contains at least one record."""
    cursor.execute(f"""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = '{table_name}'
        );
    """)
    exists = cursor.fetchone()[0]
    if exists:
        cursor.execute(f"SELECT COUNT(*) FROM {table_name};")
        return cursor.fetchone()[0] > 0
    return False

def generate_base_buffers(cursor):
    """Creates individual 100m buffers for all OSM categories."""
    if table_has_data(cursor, 'city_buffers'):
        print("INFO: 'city_buffers' already exists. Skipping base generation.")
        return

    start_time = time.time()
    print("Creating individual 100m buffers in 'city_buffers'...")
    
    cursor.execute("DROP TABLE IF EXISTS city_buffers CASCADE;")
    cursor.execute("""
        CREATE TABLE city_buffers (
            id SERIAL PRIMARY KEY,
            original_osm_id BIGINT,
            category TEXT,
            sub_type TEXT,
            name TEXT,
            geom GEOMETRY(MultiPolygon, 4326)
        );
    """)

    insert_sql = """
    INSERT INTO city_buffers (original_osm_id, category, sub_type, name, geom)
    SELECT osm_id, 'education', amenity, name, 
           ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326))
    FROM education_area
    UNION ALL
    SELECT osm_id, 'education', amenity, name, 
           ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326))
    FROM education_poi
    UNION ALL
    SELECT osm_id, 'leisure', leisure, name, 
           ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326))
    FROM leisure_area
    UNION ALL
    SELECT osm_id, 'transport', public_transport, 'Tram Station', 
           ST_Multi(ST_Transform(ST_Buffer(ST_Transform(geom, 4326)::geography, 100)::geometry, 4326))
    FROM tram_stations;
    """
    cursor.execute(insert_sql)
    cursor.execute("CREATE INDEX idx_city_buffers_geom ON city_buffers USING GIST (geom);")
    
    end_time = time.time()
    print(f"Success: Individual buffers created in {end_time - start_time:.2f} seconds.")

def generate_merged_buffers(cursor):
    """
    Scalable dissolve-by-overlap for large datasets (500k+ buffers).
    Uses spatial grid partitioning to avoid global clustering.
    """

    if table_has_data(cursor, 'city_buffers_merged'):
        print("INFO: 'city_buffers_merged' already exists. Skipping.")
        return

    start_time = time.time()
    print("Merging overlapping buffers using spatial grid partitioning...")

    # --- SAFE PERFORMANCE TUNING ---
    cursor.execute("SET work_mem = '1GB';")
    cursor.execute("SET maintenance_work_mem = '2GB';")

    # -------------------------------------------------
    # 1. CREATE SPATIAL GRID (~500m cells)
    # -------------------------------------------------
    cursor.execute("DROP TABLE IF EXISTS city_buffer_grid;")
    cursor.execute("""
        CREATE TABLE city_buffer_grid AS
        SELECT
            ST_SetSRID(
                (ST_SquareGrid(
                    0.005,          -- ~500m in EPSG:4326
                    ST_Extent(geom)
                )).geom,
                4326
            ) AS geom
        FROM city_buffers;
    """)
    cursor.execute("""
        CREATE INDEX idx_city_buffer_grid_geom
        ON city_buffer_grid
        USING GIST (geom);
    """)

    # -------------------------------------------------
    # 2. ASSIGN BUFFERS TO GRID CELLS
    # -------------------------------------------------
    cursor.execute("DROP TABLE IF EXISTS city_buffers_gridded;")
    cursor.execute("""
        CREATE TABLE city_buffers_gridded AS
        SELECT
            b.category,
            b.sub_type,
            b.name,
            ST_SnapToGrid(b.geom, 0.0001) AS geom,
            g.geom AS grid_geom
        FROM city_buffers b
        JOIN city_buffer_grid g
        ON ST_Intersects(b.geom, g.geom);
    """)
    cursor.execute("""
        CREATE INDEX idx_city_buffers_gridded_geom
        ON city_buffers_gridded
        USING GIST (geom);
    """)

    # -------------------------------------------------
    # 3. LOCAL CLUSTER + DISSOLVE (FIXED)
    # -------------------------------------------------
    cursor.execute("""
        DROP TABLE IF EXISTS city_buffers_merged;

        CREATE TABLE city_buffers_merged AS
        WITH clustered AS (
            SELECT
                category,
                sub_type,
                name,
                geom,
                grid_geom,
                ST_ClusterIntersecting(geom)
                    OVER (PARTITION BY grid_geom) AS cluster_id
            FROM city_buffers_gridded
        )
        SELECT
            string_agg(DISTINCT category, ', ') AS categories,
            string_agg(DISTINCT sub_type, ', ') AS sub_types,
            string_agg(
                DISTINCT sub_type || ': ' || COALESCE(name, 'Unknown'),
                ' | '
            ) AS detailed_info,
            COUNT(*) AS element_count,
            ST_Multi(
                ST_UnaryUnion(
                    ST_Collect(geom)
                )
            ) AS geom
        FROM clustered
        GROUP BY grid_geom, cluster_id;
    """)

    cursor.execute("""
        CREATE INDEX idx_city_buffers_merged_geom
        ON city_buffers_merged
        USING GIST (geom);
    """)

    end_time = time.time()
    print(f"Success: merged buffers created in {end_time - start_time:.2f} seconds.")



def main():
    """Main execution entry point."""
    conn = None
    total_start = time.time()
    try:
        conn = get_connection()
        cursor = conn.cursor()

        # Step 1: Generate individual buffers
        generate_base_buffers(cursor)
        conn.commit()

        # Step 2: Merge overlapping polygons (UNCOMMENTED & READY)
        generate_merged_buffers(cursor)
        conn.commit()

        total_end = time.time()
        print("-" * 30)
        print(f"All processes completed in {total_end - total_start:.2f} seconds.")

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            cursor.close()
            conn.close()

if __name__ == "__main__":
    main()
