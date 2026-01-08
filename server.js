const WebSocket = require('ws');
const http = require('http');

// Configuration
const PORT = process.env.PORT || 8080;

// Room storage: { roomCode: { host: ws, client: ws, hostPublicIP: string, created: Date } }
const rooms = new Map();

// Generate a random 4-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// Create HTTP server for REST API + WebSocket upgrade
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // Health check
    if (url.pathname === '/health' || url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
        return;
    }

    // Create a new room (returns room code)
    if (url.pathname === '/create' && req.method === 'GET') {
        const code = generateRoomCode();
        const hostIP = url.searchParams.get('ip') || req.socket.remoteAddress || 'unknown';

        rooms.set(code, {
            hostIP: hostIP,
            created: Date.now(),
            active: true
        });

        console.log(`Room created: ${code} by ${hostIP}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: code, success: true }));
        return;
    }

    // Join a room (returns host IP)
    if (url.pathname === '/join' && req.method === 'GET') {
        const code = url.searchParams.get('code');
        const room = rooms.get(code);

        if (!room || !room.active) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Room not found', success: false }));
            return;
        }

        console.log(`Join request for room: ${code}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            hostIP: room.hostIP,
            code: code,
            success: true
        }));
        return;
    }

    // Close a room
    if (url.pathname === '/close' && req.method === 'GET') {
        const code = url.searchParams.get('code');
        if (rooms.has(code)) {
            rooms.delete(code);
            console.log(`Room closed: ${code}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // List active rooms (debug)
    if (url.pathname === '/rooms' && req.method === 'GET') {
        const roomList = [];
        for (const [code, room] of rooms) {
            roomList.push({ code, created: room.created });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rooms: roomList }));
        return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// Also support WebSocket for future real-time features
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('WebSocket connection');

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            console.log('WS message:', msg);

            if (msg.type === 'CREATE_ROOM') {
                const code = generateRoomCode();
                rooms.set(code, {
                    hostWS: ws,
                    clientWS: null,
                    hostIP: msg.ip || 'unknown',
                    created: Date.now(),
                    active: true
                });
                ws.roomCode = code;
                ws.isHost = true;
                ws.send(JSON.stringify({ type: 'ROOM_CREATED', code }));
            }
            else if (msg.type === 'JOIN_ROOM') {
                const room = rooms.get(msg.code);
                if (room && room.active) {
                    ws.roomCode = msg.code;
                    ws.isHost = false;
                    room.clientWS = ws;
                    ws.send(JSON.stringify({ type: 'JOINED', hostIP: room.hostIP }));
                    if (room.hostWS) {
                        room.hostWS.send(JSON.stringify({ type: 'PLAYER_JOINED' }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
                }
            }
            else if (msg.type === 'RELAY' && ws.roomCode) {
                const room = rooms.get(ws.roomCode);
                if (room) {
                    const target = ws.isHost ? room.clientWS : room.hostWS;
                    if (target && target.readyState === WebSocket.OPEN) {
                        target.send(JSON.stringify({ type: 'RELAY', data: msg.data }));
                    }
                }
            }
        } catch (err) {
            console.error('WS error:', err);
        }
    });

    ws.on('close', () => {
        if (ws.roomCode) {
            const room = rooms.get(ws.roomCode);
            if (room) {
                if (ws.isHost) {
                    if (room.clientWS) {
                        room.clientWS.send(JSON.stringify({ type: 'HOST_LEFT' }));
                    }
                    rooms.delete(ws.roomCode);
                } else {
                    room.clientWS = null;
                    if (room.hostWS) {
                        room.hostWS.send(JSON.stringify({ type: 'PLAYER_LEFT' }));
                    }
                }
            }
        }
    });
});

// Cleanup old rooms every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        // Remove rooms older than 1 hour
        if (now - room.created > 60 * 60 * 1000) {
            rooms.delete(code);
            console.log(`Cleaned up old room: ${code}`);
        }
    }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
    console.log(`🎮 Wizard Slam Relay Server running on port ${PORT}`);
    console.log(`   HTTP API: http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
});
