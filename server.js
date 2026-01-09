// HTTP Relay Server for Wizard Slam (Low-latency Polling)
// Optimized for fast response times

const http = require('http');
const PORT = process.env.PORT || 3000;
const rooms = new Map();

const generateCode = () => {
    let code;
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); }
    while (rooms.has(code));
    return code;
};

const json = (res, data, status = 200) => {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
    });
    res.end(JSON.stringify(data));
};

http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(); return; }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname.replace(/\/$/, "");
    const q = (k) => url.searchParams.get(k);

    // Health / Test
    if (p === '' || p === '/' || p === '/test') {
        json(res, { ok: true, rooms: rooms.size, time: Date.now() });
        return;
    }

    // Host creates room
    if (p === '/host') {
        const code = generateCode();
        rooms.set(code, { messages: { host: [], client: [] }, hasClient: false, lastPing: Date.now() });
        console.log('Room:', code);
        json(res, { code });
        return;
    }

    // Client joins
    if (p === '/join') {
        const room = rooms.get(q('code'));
        if (!room) { json(res, { error: 'not_found' }, 404); return; }
        if (room.hasClient) { json(res, { error: 'full' }, 400); return; }
        room.hasClient = true;
        room.messages.host.push('JOINED');
        json(res, { ok: true });
        return;
    }

    // Send message
    if (p === '/send') {
        const room = rooms.get(q('code'));
        if (!room) { json(res, { error: 'not_found' }, 404); return; }
        const target = q('role') === 'host' ? 'client' : 'host';
        room.messages[target].push(q('msg'));
        room.lastPing = Date.now();
        json(res, { ok: true });
        return;
    }

    // Poll for messages
    if (p === '/poll') {
        const room = rooms.get(q('code'));
        if (!room) { json(res, { error: 'not_found' }, 404); return; }
        const role = q('role');
        const msgs = room.messages[role].splice(0);
        room.lastPing = Date.now();
        json(res, { msgs, partner: role === 'host' ? room.hasClient : true });
        return;
    }

    // Leave room
    if (p === '/leave') {
        const code = q('code');
        const role = q('role');
        const room = rooms.get(code);
        if (room) {
            if (role === 'host') {
                room.messages.client.push('HOST_LEFT');
                rooms.delete(code);
            } else {
                room.hasClient = false;
                room.messages.host.push('PLAYER_LEFT');
            }
        }
        json(res, { ok: true });
        return;
    }

    json(res, { error: 'not_found' }, 404);
}).listen(PORT, () => console.log('🎮 Relay on', PORT));

// Cleanup every 5 min
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        if (now - room.lastPing > 600000) { rooms.delete(code); console.log('Cleaned:', code); }
    }
}, 300000);
