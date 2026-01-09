// WebSocket Relay Server for Wizard Slam
// Provides low-latency (<30ms) real-time multiplayer

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map(); // code -> { host: ws, client: ws }

// Generate 4-digit room code
const generateCode = () => {
    let code;
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); }
    while (rooms.has(code));
    return code;
};

// HTTP server for health checks and initial room creation
const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname.replace(/\/$/, "");

    console.log(`[HTTP] ${req.method} ${p}`);

    // Health check
    if (p === '' || p === '/' || p === '/test') {
        res.end(JSON.stringify({ ok: true, rooms: rooms.size, ws: true }));
        return;
    }

    // Create room via HTTP (returns code for WebSocket connection)
    if (p === '/host') {
        const code = generateCode();
        rooms.set(code, { host: null, client: null, created: Date.now() });
        console.log(`[ROOM] Created: ${code}`);
        res.end(JSON.stringify({ code }));
        return;
    }

    // Check if room exists (for join validation before WS connect)
    if (p === '/check') {
        const code = url.searchParams.get('code');
        const room = rooms.get(code);
        if (!room) { res.end(JSON.stringify({ error: 'not_found' })); return; }
        if (room.client) { res.end(JSON.stringify({ error: 'full' })); return; }
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
});

// WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `ws://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const role = url.searchParams.get('role'); // 'host' or 'client'

    console.log(`[WS] Connection: code=${code} role=${role}`);

    const room = rooms.get(code);
    if (!room) {
        ws.send(JSON.stringify({ error: 'not_found' }));
        ws.close();
        return;
    }

    if (role === 'host') {
        room.host = ws;
        ws.role = 'host';
        ws.roomCode = code;
        ws.send(JSON.stringify({ type: 'connected', role: 'host' }));
    } else if (role === 'client') {
        if (room.client) {
            ws.send(JSON.stringify({ error: 'full' }));
            ws.close();
            return;
        }
        room.client = ws;
        ws.role = 'client';
        ws.roomCode = code;
        ws.send(JSON.stringify({ type: 'connected', role: 'client' }));

        // Notify host that client joined
        if (room.host && room.host.readyState === 1) {
            room.host.send(JSON.stringify({ type: 'partner_joined' }));
        }
        // Notify client that host exists
        ws.send(JSON.stringify({ type: 'partner_joined' }));
    }

    // Handle messages - relay to partner
    ws.on('message', (data) => {
        const room = rooms.get(ws.roomCode);
        if (!room) return;

        const partner = ws.role === 'host' ? room.client : room.host;
        if (partner && partner.readyState === 1) {
            partner.send(data.toString());
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        console.log(`[WS] Disconnect: code=${ws.roomCode} role=${ws.role}`);
        const room = rooms.get(ws.roomCode);
        if (!room) return;

        // Notify partner
        const partner = ws.role === 'host' ? room.client : room.host;
        if (partner && partner.readyState === 1) {
            partner.send(JSON.stringify({ type: 'partner_left' }));
        }

        // Clean up room
        if (ws.role === 'host') {
            room.host = null;
            // If host leaves, close room
            if (room.client) room.client.close();
            rooms.delete(ws.roomCode);
            console.log(`[ROOM] Deleted: ${ws.roomCode}`);
        } else {
            room.client = null;
        }
    });

    ws.on('error', (err) => {
        console.error(`[WS] Error: ${err.message}`);
    });
});

httpServer.listen(PORT, () => {
    console.log(`🎮 WebSocket Relay on port ${PORT}`);
});

// Cleanup stale rooms every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        // Delete rooms with no connections after 10 minutes
        if (!room.host && !room.client && now - room.created > 600000) {
            rooms.delete(code);
            console.log(`[CLEANUP] Stale room: ${code}`);
        }
    }
}, 300000);
