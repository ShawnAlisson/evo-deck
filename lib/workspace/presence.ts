export type PresenceUser = {
  userId: string;
  name: string | null;
  email: string;
  color: string;
  lastSeen: number;
};

type Room = Map<string, PresenceUser>;

const rooms = new Map<string, Room>();

const COLORS = ["#b65c38", "#3f5d4a", "#2f4f6f", "#8a5a2b", "#5c3d6e", "#1f6f5b"];

function colorFor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash + userId.charCodeAt(i) * 17) % COLORS.length;
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function touchPresence(
  workspaceId: string,
  user: { id: string; name: string | null; email: string },
) {
  let room = rooms.get(workspaceId);
  if (!room) {
    room = new Map();
    rooms.set(workspaceId, room);
  }
  room.set(user.id, {
    userId: user.id,
    name: user.name,
    email: user.email,
    color: colorFor(user.id),
    lastSeen: Date.now(),
  });
  return listPresence(workspaceId);
}

export function listPresence(workspaceId: string) {
  const room = rooms.get(workspaceId);
  if (!room) return [];
  const now = Date.now();
  for (const [id, user] of room) {
    if (now - user.lastSeen > 15_000) room.delete(id);
  }
  return [...room.values()];
}

export function leavePresence(workspaceId: string, userId: string) {
  rooms.get(workspaceId)?.delete(userId);
}
