const WebSocket = require('ws');
const http = require('http');
const net = require('net');

// Configuration
const PORT = process.env.PORT || 8080;
const TCP_PORT = process.env.TCP_PORT || 6789;

// Room storage
const rooms = new Map();

// Generate a random 4-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// ======================
// HTTP Server for health checks and REST API
// ======================
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/health' || url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, mode: 'websocket' }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use WebSocket connection for game relay' }));
});

// ======================
// WebSocket Server for game relay
// ======================
const wss = new WebSocket.Server({ server });

function broadcast(room, message, excludeSocket) {
    const clients = [room.hostWS, room.clientWS].filter(ws => ws && ws !== excludeSocket && ws.readyState === WebSocket.OPEN);
    clients.forEach(ws => {
        ws.send(JSON.stringify(message));
    });
}

wss.on('connection', (ws) => {
    console.log('WebSocket connected');

    ws.roomCode = null;
    ws.isHost = false;
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
                case 'CREATE_ROOM': {
                    const code = generateRoomCode();
                    rooms.set(code, {
                        hostWS: ws,
                        clientWS: null,
                        created: Date.now()
                    });
                    ws.roomCode = code;
                    ws.isHost = true;
                    ws.send(JSON.stringify({ type: 'ROOM_CREATED', code }));
                    console.log(`Room created: ${code}`);
                    break;
                }

                case 'JOIN_ROOM': {
                    const room = rooms.get(msg.code);
                    if (!room) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
                        return;
                    }
                    if (room.clientWS) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
                        return;
                    }

                    room.clientWS = ws;
                    ws.roomCode = msg.code;
                    ws.isHost = false;

                    ws.send(JSON.stringify({ type: 'JOINED', code: msg.code }));
                    if (room.hostWS && room.hostWS.readyState === WebSocket.OPEN) {
                        room.hostWS.send(JSON.stringify({ type: 'PLAYER_JOINED' }));
                    }
                    console.log(`Player joined room: ${msg.code}`);
                    break;
                }

                case 'RELAY': {
                    // Forward game data to the other player
                    const room = rooms.get(ws.roomCode);
                    if (!room) return;

                    const target = ws.isHost ? room.clientWS : room.hostWS;
                    if (target && target.readyState === WebSocket.OPEN) {
                        target.send(JSON.stringify({ type: 'RELAY', data: msg.data }));
                    }
                    break;
                }

                case 'LEAVE': {
                    handleDisconnect(ws);
                    break;
                }
            }
        } catch (err) {
            console.error('Message parse error:', err);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
        console.log('WebSocket disconnected');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

function handleDisconnect(ws) {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (ws.isHost) {
        // Host left - notify client and destroy room
        if (room.clientWS && room.clientWS.readyState === WebSocket.OPEN) {
            room.clientWS.send(JSON.stringify({ type: 'HOST_LEFT' }));
            room.clientWS.roomCode = null;
        }
        rooms.delete(ws.roomCode);
        console.log(`Room destroyed: ${ws.roomCode}`);
    } else {
        // Client left - notify host
        if (room.hostWS && room.hostWS.readyState === WebSocket.OPEN) {
            room.hostWS.send(JSON.stringify({ type: 'PLAYER_LEFT' }));
        }
        room.clientWS = null;
        console.log(`Player left room: ${ws.roomCode}`);
    }

    ws.roomCode = null;
}

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            handleDisconnect(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Cleanup old rooms
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        if (now - room.created > 2 * 60 * 60 * 1000) { // 2 hours
            if (room.hostWS) room.hostWS.close();
            if (room.clientWS) room.clientWS.close();
            rooms.delete(code);
            console.log(`Cleaned up old room: ${code}`);
        }
    }
}, 10 * 60 * 1000);

wss.on('close', () => {
    clearInterval(heartbeat);
});

server.listen(PORT, () => {
    console.log(`🎮 Wizard Slam Relay Server`);
    console.log(`   HTTP/WebSocket: port ${PORT}`);
    console.log(`   URL: wss://wizard-slam-relay-production.up.railway.app`);
});
