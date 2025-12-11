# Docker GIS Project

We are using Docker to manage all the geographical data and perform calculations efficiently.

## Prerequisites

* Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## Setup

1. Create a folder for your project.
2. Clone the repo in the created folde:
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

#### In QGIS

1. Create a new PostgreSQL connection.
2. Use the following credentials:

   * Name: (choose any)
   * Host: `localhost`
   * Port: `5433` (check your yml file)
   * Database: `gis`
   * User: `gis`
   * Password: `password`

#### From the command line

```bash
psql -h localhost -p 5432 -U gis -d gis
```

---

### GeoServer

* Access via browser: [http://localhost:8080/](http://localhost:8080/)

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

### Notes

* Make sure your Docker containers are running before trying to connect to any service.
* Ports may differ if you modified the `docker-compose.yml`.


### Summary

* Everyone works on their own branch.
* Commit frequently with clear messages.
* Push branches to the remote repo.
* Use Pull Requests to merge changes to `main`.
* Always update your local `main` before starting work.
