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

## 1. Services

| Container              | Purpose                                         | Persistence             | Access / Credentials                         |
|------------------------|-----------------------------------------------|------------------------|---------------------------------------------|
| **postgis_db**          | PostgreSQL + PostGIS database                  | `./data/postgis`       | Host port: 5431                              |
| **geoserver_app**       | OGC-compliant map server (WFS/WMS/WCS)        | `./data/geoserver`     | [http://localhost:8080/geoserver](http://localhost:8080/geoserver) <br> Admin: `admin / admin_geoserver` |
| **pgadmin_app**         | Web-based PostGIS administration               | `./data/pgadmin`       | [http://localhost:5050](http://localhost:5050) <br> User: `postgres@postgres.com` <br> Password: `postgres` |
| **osm2pgsql_importer**  | Initial OSM import using `osm2pgsql`          | N/A                    | Runs once (restart: "no") <br> Entrypoint: `import_osm.sh` <br> Reads: `/data/initial.osm.pbf` |
| **osm_updater**         | Apply OSM diffs periodically using Osmosis    | `./data/diffs`         | Continuous (restart: always) <br> Entrypoint: `update_osm.sh` <br> Moves applied diffs to `applied/` |

---

## 2. Data Flow

### Initial Import (`initial.osm.pbf`)
1. Place the full planet OSM file `initial.osm.pbf` in `./data/osm/`.
2. `osm2pgsql_importer` waits for PostGIS to start.
3. Imports OSM data into PostGIS tables:
   - `planet_osm_point`
   - `planet_osm_line`
   - `planet_osm_polygon`
   - `planet_osm_roads`
4. **SLIM Mode**: 
   - The import uses `--slim` mode.
   - SLIM mode stores intermediate tables on disk instead of memory, which allows importing very large OSM files (like the whole planet) without running out of RAM.

### Periodic Updates (`.osc.gz` diffs)
1. Place incremental change files (diffs) like `125.osc.gz` in `./data/diffs/`.
   - Each `.osc.gz` file contains changes (additions, deletions, modifications) to the OSM data since the last update.
2. `osm_updater` waits for PostGIS to be ready.
3. Applies each diff to the database using **Osmosis**.
4. After applying, each diff is moved to `./data/diffs/applied/` to avoid reapplying.
5. The container sleeps 24h, then checks for new diffs automatically.

> Example: `125.osc.gz` is just one of these periodic diff files. In production, OSM diffs are numbered sequentially (e.g., `125.osc.gz`, `126.osc.gz`, etc.), so the updater can apply them in order to keep your database current.

---
### Important Note on Shell Scripts

All `.sh` files must use **Unix (LF) line endings**.  
If the scripts are edited on Windows, tools like **Notepad++** can convert them:

1. Open the `.sh` file in Notepad++.
2. Go to `Edit` → `EOL Conversion` → `Unix (LF)`.
3. Save the file.

Failing to do this may cause syntax errors such as:

---
## 3. Notes
* The `overv/openstreetmap-tile-server` image already includes **Osmosis**, so no extra installation is needed.
* `osm2pgsql_importer` only uses **osm2pgsql** and never touches Osmosis.
* If you only want to import `.pbf` files and never apply incremental diffs, you can skip `osm_updater`.
* Everything runs inside Docker containers—nothing is installed on your host system.
* Make sure your Docker containers are running before connecting to any service.
* Ports may differ if you modified `docker-compose.yml`.
* Always shut down containers cleanly with:

```bash
docker compose down


