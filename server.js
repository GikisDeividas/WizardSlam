const WebSocket = require('ws');

// Configuration
const PORT = process.env.PORT || 8080;

// Room storage: { roomCode: { host: ws, client: ws } }
const rooms = new Map();

// Generate a random 4-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

console.log(`🎮 Wizard Slam Relay Server running on port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('New connection');

    ws.roomCode = null;
    ws.isHost = false;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            switch (msg.type) {
                case 'CREATE_ROOM':
                    handleCreateRoom(ws);
                    break;

                case 'JOIN_ROOM':
                    handleJoinRoom(ws, msg.code);
                    break;

                case 'RELAY':
                    handleRelay(ws, msg.data);
                    break;

                case 'LEAVE':
                    handleLeave(ws);
                    break;
            }
        } catch (err) {
            console.error('Error parsing message:', err);
        }
    });

    ws.on('close', () => {
        handleLeave(ws);
        console.log('Connection closed');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        handleLeave(ws);
    });
});

function handleCreateRoom(ws) {
    const code = generateRoomCode();
    rooms.set(code, { host: ws, client: null });
    ws.roomCode = code;
    ws.isHost = true;

    ws.send(JSON.stringify({
        type: 'ROOM_CREATED',
        code: code
    }));

    console.log(`Room created: ${code}`);
}

function handleJoinRoom(ws, code) {
    const room = rooms.get(code);

    if (!room) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            message: 'Room not found'
        }));
        return;
    }

    if (room.client) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            message: 'Room is full'
        }));
        return;
    }

    room.client = ws;
    ws.roomCode = code;
    ws.isHost = false;

    // Notify both players
    ws.send(JSON.stringify({ type: 'JOINED', code: code }));
    room.host.send(JSON.stringify({ type: 'PLAYER_JOINED' }));

    console.log(`Player joined room: ${code}`);
}

function handleRelay(ws, data) {
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    // Send to the other player
    const target = ws.isHost ? room.client : room.host;
    if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({
            type: 'RELAY',
            data: data
        }));
    }
}

function handleLeave(ws) {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    // Notify the other player
    const other = ws.isHost ? room.client : room.host;
    if (other && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify({ type: 'PLAYER_LEFT' }));
    }

    // If host leaves, destroy room
    if (ws.isHost) {
        if (room.client) {
            room.client.roomCode = null;
        }
        rooms.delete(ws.roomCode);
        console.log(`Room destroyed: ${ws.roomCode}`);
    } else {
        room.client = null;
        console.log(`Player left room: ${ws.roomCode}`);
    }

    ws.roomCode = null;
}

// Cleanup inactive rooms every 5 minutes
setInterval(() => {
    for (const [code, room] of rooms) {
        if (!room.host || room.host.readyState !== WebSocket.OPEN) {
            if (room.client && room.client.readyState === WebSocket.OPEN) {
                room.client.send(JSON.stringify({ type: 'PLAYER_LEFT' }));
            }
            rooms.delete(code);
            console.log(`Cleaned up inactive room: ${code}`);
        }
    }
}, 5 * 60 * 1000);

console.log(`Listening for connections...`);
