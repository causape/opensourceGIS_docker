// File: Dashboard/server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const Docker = require('dockerode');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve static files (index.html)
app.use(express.static(path.join(__dirname, '.')));

const server = http.createServer(app);
const io = new Server(server);

// Connect to local Docker socket
const docker = new Docker(); 

io.on('connection', (socket) => {
  console.log('🔌 Web client connected');

  // --- CONFIGURATION ---
  // You must put the EXACT name of your container here.
  // Run 'docker ps' in your terminal to check the NAMES column.
  // Example: 'opensourcegis_postgis_1' or 'opensourcegis-db-1'
  const containerName = 'postgis_db'; 
  // ---------------------

  const container = docker.getContainer(containerName);

  // Options for log streaming
  const logOpts = {
    follow: true,
    stdout: true,
    stderr: true,
    tail: 50 // Load the last 50 lines on startup
  };

  container.logs(logOpts, (err, stream) => {
    if (err) {
      socket.emit('log', `\r\nError finding container '${containerName}': ${err.message}\r\n`);
      socket.emit('log', ` Hint: Make sure 'docker-compose up' is running and check the container name in server.js\r\n`);
      return;
    }

    socket.emit('log', `\r\n✅ Successfully connected to logs: ${containerName}\r\n----------------------------------------\r\n`);

    // Stream data to frontend when new logs arrive
    stream.on('data', (chunk) => {
      socket.emit('log', chunk.toString('utf8'));
    });

    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected');
      stream.destroy(); // Close stream to prevent zombie processes
    });
  });
});

server.listen(3000, () => {
  console.log('Server ready at: http://localhost:3000');
});