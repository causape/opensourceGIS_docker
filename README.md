# Docker GIS Project

We are using Docker to manage all the geographical data and perform calculations efficiently.

## Prerequisites

* Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
* Install [QGIS](https://qgis.org/) if you want to connect to PostGIS from a GIS software.

---

## Setup

1. Create a folder for your project.
2. Place your `docker-compose.yml` file in this folder.
3. Modify the `docker-compose.yml` file if needed.
4. Open a terminal or command prompt and run:

```bash
docker compose up
```

This will create all the containers defined in your Docker Compose file. You can monitor them in Docker Desktop.

---

## Useful Docker Commands

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
psql -h localhost -p 5433 -U gis -d gis
```

---

### GeoServer

* Access via browser: [http://localhost:8080/](http://localhost:8080/)

---

### PgAdmin (PostgreSQL Admin)

* Access via browser: [http://localhost:5050/](http://localhost:5050/)
* Use credentials from your `docker-compose.yml`.

---

### Notes

* Make sure your Docker containers are running before trying to connect to any service.
* Ports may differ if you modified the `docker-compose.yml`.



## Collaborative Workflow with Git

When working with multiple collaborators, follow these steps to avoid conflicts and keep the project organized:

### 1. Clone the repository

Your collaborator should clone the repository to their local machine:

```bash
git clone https://github.com/causape/opensourceGIS_docker.git
cd opensourceGIS_docker
```

### 2. Create separate branches

Never work directly on `main`. Each collaborator should create a branch for their changes:

```bash
git checkout -b my_branch
```

* Name your branch descriptively, e.g., `feature/postgis-fix` or `update-geoserver-config`.
* This avoids direct conflicts on `main`.

### 3. Make changes and commit

Work on your branch and commit your changes frequently:

```bash
git add .
git commit -m "Description of changes"
```

### 4. Push the branch to the remote repository

```bash
git push -u origin my_branch
```

* This uploads your branch to GitHub without affecting `main`.

### 5. Merge changes to `main` via Pull Request (PR)

1. Open a Pull Request on GitHub from your branch to `main`.
2. Review changes with teammates.
3. If approved, merge the branch into `main`.
4. This ensures `main` always contains a stable, synchronized version.

There are two ways to merge your branch into `main`:

#### Option 1: Using GitHub (recommended for teams)

1. Push your branch to the remote repository:

```bash
git push -u origin my_branch
```

2. On GitHub, go to the repository → **Pull requests** → **New Pull Request**.
3. Select your branch (`my_branch`) as the source and `main` as the target.
4. Review the changes, leave comments if needed.
5. Click **Merge Pull Request** → **Confirm Merge**.
6. Now `main` contains the merged changes and is synchronized for everyone.

> Advantage: visual, easy to review, ideal for teams.

#### Option 2: Using command line

If you prefer, you can merge directly in your local repository:

```bash
# Switch to main branch
git checkout main

# Make sure your main branch is up to date
git pull origin main

# Merge the collaborator's branch
git merge my_branch

# Push the merge to the remote
git push origin main
```

**Notes:**

* If there are conflicts (two people edited the same lines), Git will notify you, and you will need to resolve them manually before committing.
* This method is faster but does not allow a visual review like a Pull Request.

> Tip: For teams, always use **GitHub Pull Requests** to review and approve changes before merging.

### 6. Update your local `main` branch

Before starting new work, make sure your local `main` is up to date:

```bash
git checkout main
git pull origin main
```

### Summary

* Everyone works on their own branch.
* Commit frequently with clear messages.
* Push branches to the remote repo.
* Use Pull Requests to merge changes to `main`.
* Always update your local `main` before starting work.
