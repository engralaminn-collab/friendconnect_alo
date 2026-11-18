# Group Calls (LiveKit)

## How it works
Group calls use LiveKit (open-source SFU, Apache-2.0) instead of P2P WebRTC.
LiveKit handles media mixing/forwarding for 3+ participants efficiently.

## Setup
1. Start LiveKit: `docker compose up livekit -d` (in deploy/)
2. Set env vars:
   - LIVEKIT_URL=wss://your-server:7881
   - LIVEKIT_API_KEY=devkey
   - LIVEKIT_API_SECRET=secret
3. The group call button appears in group conversations

## API
- `POST /api/calls/group` — actions: start, join, end
  - Returns LiveKit JWT token + room URL
  - Token expires after 1 hour
  - Room auto-deletes 10 min after all participants leave

## Components
- `src/components/fc/calls/GroupCallView.tsx` — full-screen group call UI
  - Uses @livekit/components-react VideoConference
  - Handles participant grid, active speaker, screen share
  - Mute/camera/leave controls built into LiveKit components
