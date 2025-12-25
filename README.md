
[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)

# Docker GIS Project

We are using Docker to manage all the geographical data and perform calculations efficiently.

## Prerequisites

* Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## Setup

1. Create a folder for your project.
2. Clone the repo in the created folder:
```bash
 git clone https://github.com/causape/opensourceGIS_docker.git
```
3. Modify the `docker-compose.yml` file if needed.
4. Open a terminal or command prompt and run:

```bash
docker compose up
```

This will create all the containers defined in your Docker Compose file. You can monitor them in Docker Desktop.

---

## Useful Docker Commands (Not every commands should be needed)

| Command                  | Description                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| `docker compose up`      | Create and start the containers using the `.yml` file                      |
| `docker compose down`    | Stop all running containers (stop before shutting down your computer)      |
| `docker compose rm -f`   | Delete containers if something is broken. **Does not delete data volumes** |
| `docker compose down -v` | Delete all containers **and volumes**                                      |

---

## Accessing Services

All credentials and ports are configured in `docker-compose.yml`.

### PostGIS

---

### PgAdmin (PostgreSQL Admin)

* Access via browser: [http://localhost:5050/](http://localhost:5050/)
* Use credentials from your `docker-compose.yml`.
* Register New Server:
  * Right button Server:
    * Register new server with the following parameters:


| Field                 | Value                      |
|-----------------------|----------------------------|
| `Name`                | Choose the name you prefer |
| `Host name / address` | localhost                  |
| `Port`                | 5432                       |
| `Username`            | gis                        |
| `Database`            | gis                        |
| `Password`            | password                   |


---

#### In QGIS

1. Create a new PostgreSQL connection.
2. Use the following credentials:

   * Name: (choose any)
   * Host: `localhost`
   * Port: `5433` (check your yml file)
   * Database: `gis`
   * User: `gis`
   * Password: `password`
---
#### From the command line

```bash
psql -h localhost -p 5432 -U gis -d gis
```

---

### GeoServer

* Access via browser: [http://localhost:8080/](http://localhost:8080/)

1. To access the GeoServer account, you need to use the username and password configured in the .yml
2. Use the following credentials:
3. e.g. The credentials will be found in the following line: "GEOSERVER_ADMIN_PASSWORD: admin_geoserver # GeoServer admin password (user: admin)"

---

# Docker GIS Stack Setup

# Automated Docker GIS Stack: OSM Incremental Processing & Spatial Analysis

This repository contains a containerized GIS environment designed for automated OpenStreetMap (OSM) data ingestion, incremental updates, and custom spatial analysis. The stack transforms raw OSM data into "Service Islands" with aggregated infrastructure data using a Python-based analytical engine.

## 1. System Services

| Service | Image | Purpose | Persistence & Access |
| :--- | :--- | :--- | :--- |
| **postgis_db** | `postgis/postgis:15-3.3` | Core PostGIS database. | **Port:** 5431 |
| **geoserver_app** | `kartoza/geoserver` | OGC Map Server (WFS/WMS). | [http://localhost:8080](http://localhost:8080) (`admin` / `admin_geoserver`) |
| **pgadmin_app** | `dpage/pgadmin4` | Web-based Database UI. | [http://localhost:5050](http://localhost:5050) |
| **osm2pgsql_importer**| `overv/tile-server` | Initial bootstrap loader. | Runs once (SQL Dump > PBF). |
| **osm_updater** | `Custom Python/Alpine` | Analytical engine & updater. | **Continuous 1-hour cycle**. |

---

## 2. Data Workflow

### A. Initial Import Logic
When the stack starts, `import_osm.sh` follows a priority-based bootstrap:
* **Fast Import (SQL Dump):** If `/data/filtered_osm_data.sql.gz` exists, it restores the database directly for immediate deployment.
### B. Standard Import (PBF)
If no dump is found, the system downloads the latest **Germany PBF** and executes `osm2pgsql` in **Flex Output** mode using the `styles/osm.lua` schema. 

**How the Lua engine processes the Germany dataset:**
Instead of importing the entire OpenStreetMap database (which would be hundreds of gigabytes), the `osm.lua` script acts as a high-performance filter that scans every node and way to build a specialized schema:

* **Rule-Based Filtering:** The engine inspects specific OSM tags (`amenity`, `leisure`, `highway`, `landuse`) to determine which features are relevant for urban analysis.
* **Infrastructure Classification:**
    * **Education:** Filters nodes and polygons tagged as `school`, `kindergarten`, `childcare`, or `social_facility`, splitting them into point (`education_poi`) and area (`education_area`) tables.
    * **Leisure & Recreation:** Isolates `playground`, `pitch`, `sports_centre`, and `track` features into dedicated leisure tables.
    * **Public Transport:** Specifically extracts `tram_station` nodes for transport accessibility analysis.
    * **Connectivity:** Filters `highway=pedestrian` ways to identify walkable zones.
* **On-the-fly Projection:** All geometries are automatically projected to **EPSG:3857** (Web Mercator) during the import process to ensure they are ready for high-speed spatial calculations in PostGIS.



### C. The Updater Loop (`osm_updater`)
This service runs a continuous 60-minute loop to keep data current:
1. **Apply Diffs:** Scans `./data/diffs/` for `.osc.gz` files and applies them via `osm2pgsql --append` to update source tables.
2. **Trigger `app.py`:** Executes the Python analysis engine to recalculate spatial buffers.
3. **Generate Dump:** Generates a fresh `.sql.gz` dump for future fast-start deployments.
4. **Idle Phase:** Sleeps for 1 hour before the next check.

---

## 3. Spatial Analysis Pipeline (`app.py`)

The `app.py` script is the core analytical engine, transforming raw features into structured "Service Islands".

### Phase I: Single Feature Buffering
The system identifies infrastructure (schools, tram stops, playgrounds) and generates a **100-meter proximity buffer** around each:
* **Coordinate Transformation:** Data is transformed from `EPSG:3857` to `EPSG:4326` for consistent geography-based buffering.
* **Deduplication:** A `UNIQUE` constraint on `original_osm_id` prevents duplicate geometries even if an update process restarts.

### Phase II: Spatial Partitioning (Grid Mode)
To handle large-scale datasets like the whole of Germany without exceeding RAM limits:
* **Grid Creation:** The map is divided into a virtual grid of 0.005-degree squares.
* **Clustering:** Overlapping buffers are grouped within these cells using `ST_ClusterIntersecting`.

### Phase III: Data Absorption & Aggregation
When buffers overlap, they dissolve into a single "Service Island" that absorbs data from its constituent parts:
* **Element Count:** Calculates the total number of services within that specific island.
* **Category Aggregation:** Collects a distinct list of all categories present (e.g., "education, transport").
* **Detailed Information String:** Uses `string_agg` to list every sub-type and facility name (e.g., `school: Grundschule Haidmühle | tram_station: Unknown`).
* **Spatial Union:** Geometries are dissolved using `ST_UnaryUnion` with `ST_SnapToGrid` for clean multipolygons.



---

## 4. Performance & Setup

### Optimization
* **RAM Tuning:** `app.py` uses `work_mem = '1GB'` for large joins.
* **Flex Schema:** Filters specific OSM tags via `styles/osm.lua` for Education, Leisure, Transport, and Landuse.
* **Slim Mode:** `osm2pgsql` uses disk-based intermediate storage for large datasets.

### Setup Instructions
1. **Prerequisites:** Install Docker/Compose. Ensure all `.sh` files use **Unix (LF)** line endings.
2. **Configuration:** Create a `.env` file with credentials matching `app.py`.
3. **Deployment:**
   ```bash
   docker compose up -d


