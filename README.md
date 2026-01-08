# Wizard Slam Relay Server

A WebSocket relay server enabling cross-internet multiplayer for Wizard Slam.

## Local Development

```bash
npm install
npm start
```

Server runs on port 8080 by default.

## Deployment to Fly.io

1. Install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
2. Login: `fly auth login`
3. Deploy: `fly launch` then `fly deploy`

The server will be available at `wss://wizard-slam-relay.fly.dev`

## Protocol

### Messages (Client → Server)

```json
{"type": "CREATE_ROOM"}
{"type": "JOIN_ROOM", "code": "1234"}
{"type": "RELAY", "data": "...game data..."}
{"type": "LEAVE"}
```

### Messages (Server → Client)

```json
{"type": "ROOM_CREATED", "code": "1234"}
{"type": "JOINED", "code": "1234"}
{"type": "PLAYER_JOINED"}
{"type": "PLAYER_LEFT"}
{"type": "RELAY", "data": "...game data..."}
{"type": "ERROR", "message": "..."}
```
