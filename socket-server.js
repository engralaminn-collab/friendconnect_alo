const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.SOCKET_PORT || 3114;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Socket.IO Server Running");
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["polling", "websocket"],
  allowEIO3: true
});

const onlineUsers = new Map();
const socketUserMap = new Map();
const activeCalls = new Map();

io.on("connection", (socket) => {
  console.log("[+] Connected:", socket.id);

  socket.on("auth", (userId) => {
    if (!userId) return;
    socket.data.userId = userId;
    socketUserMap.set(socket.id, userId);

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    console.log("[AUTH] " + userId + " (" + socket.id + ")");
    io.emit("online:update", Array.from(onlineUsers.keys()));
  });

  socket.on("chat:message", (data) => {
    const { senderId, receiverId, message, type = "text", fileUrl, fileName, fileSize, mimeType } = data || {};
    if (!senderId || !receiverId) return;

    const payload = {
      id: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      senderId,
      receiverId,
      message: message || "",
      type,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      fileSize: fileSize || null,
      mimeType: mimeType || null,
      timestamp: new Date().toISOString()
    };

    const recSockets = onlineUsers.get(receiverId);
    if (recSockets) {
      recSockets.forEach(sid => io.to(sid).emit("chat:message", payload));
    }

    const sndSockets = onlineUsers.get(senderId);
    if (sndSockets) {
      sndSockets.forEach(sid => {
        if (sid !== socket.id) io.to(sid).emit("chat:message", payload);
      });
    }

    socket.emit("chat:message:ack", payload);
  });

  socket.on("chat:typing", ({ senderId, receiverId, isTyping }) => {
    if (!senderId || !receiverId) return;
    const recSockets = onlineUsers.get(receiverId);
    if (recSockets) {
      recSockets.forEach(sid => io.to(sid).emit("chat:typing", { senderId, isTyping }));
    }
  });

  socket.on("call:initiate", ({ callerId, receiverId, callType = "video" }) => {
    if (!callerId || !receiverId) return;
    const callId = "call_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    socket.data.callId = callId;
    activeCalls.set(callerId, callId);
    activeCalls.set(receiverId, callId);

    const recSockets = onlineUsers.get(receiverId);
    if (recSockets) {
      recSockets.forEach(sid => io.to(sid).emit("call:incoming", { callId, callerId, callType }));
    }
  });

  socket.on("call:accept", ({ callId, callerId, receiverId }) => {
    const callerSockets = onlineUsers.get(callerId);
    if (callerSockets) {
      callerSockets.forEach(sid => io.to(sid).emit("call:accepted", { callId, receiverId }));
    }
  });

  socket.on("call:reject", ({ callId, callerId, receiverId }) => {
    const callerSockets = onlineUsers.get(callerId);
    if (callerSockets) {
      callerSockets.forEach(sid => io.to(sid).emit("call:rejected", { callId, receiverId }));
    }
    activeCalls.delete(receiverId);
    activeCalls.delete(callerId);
  });

  socket.on("call:offer", ({ targetUserId, offer }) => {
    const targetSockets = onlineUsers.get(targetUserId);
    if (targetSockets) {
      targetSockets.forEach(sid => io.to(sid).emit("call:offer", { senderId: socket.data.userId, offer }));
    }
  });

  socket.on("call:answer", ({ targetUserId, answer }) => {
    const targetSockets = onlineUsers.get(targetUserId);
    if (targetSockets) {
      targetSockets.forEach(sid => io.to(sid).emit("call:answer", { senderId: socket.data.userId, answer }));
    }
  });

  socket.on("call:ice-candidate", ({ targetUserId, candidate }) => {
    const targetSockets = onlineUsers.get(targetUserId);
    if (targetSockets) {
      targetSockets.forEach(sid => io.to(sid).emit("call:ice-candidate", { senderId: socket.data.userId, candidate }));
    }
  });

  socket.on("call:end", ({ targetUserId }) => {
    const userId = socket.data.userId;
    if (userId) activeCalls.delete(userId);
    if (targetUserId) {
      activeCalls.delete(targetUserId);
      const targetSockets = onlineUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(sid => io.to(sid).emit("call:ended", { userId }));
      }
    }
  });

  socket.on("disconnect", () => {
    const userId = socketUserMap.get(socket.id);
    socketUserMap.delete(socket.id);
    if (userId && onlineUsers.has(userId)) {
      const uSockets = onlineUsers.get(userId);
      uSockets.delete(socket.id);
      if (uSockets.size === 0) {
        onlineUsers.delete(userId);
        activeCalls.delete(userId);
      }
      io.emit("online:update", Array.from(onlineUsers.keys()));
    }
    console.log("[-] Disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Socket.IO Server running on 0.0.0.0:" + PORT);
});
