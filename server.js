const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const app = express();

app.use(cors());
app.use(express.json());

const PORT = 5000;

// ------------------ In-memory storage ------------------
let pendingUsers = [];   // { username, password, location }
let approvedUsers = [];  // { username, password, location }
let onlineUsers = {};    
let approvalSockets = {}; 

// ------------------ User requests access ------------------
app.post("/request-access", (req, res) => {
  const { username, password, location } = req.body;

  if (!username || !password || !location) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const uname = username.trim().toLowerCase();

  // Allow re-approval
  pendingUsers = pendingUsers.filter(
    u => u.username.toLowerCase() !== uname
  );

  approvedUsers = approvedUsers.filter(
    u => u.username.toLowerCase() !== uname
  );

  const record = {
    username: username.trim(),
    password,
    location
  };

  pendingUsers.push(record);

  console.log("📥 ACCESS REQUEST");
  console.log("Username:", record.username);
  console.log("Password:", record.password);
  console.log("Location:", record.location);

  res.json({ status: "pending" });
});

// ------------------ Approve user ------------------
app.post('/approve-user', (req, res) => {
  const { username } = req.body;
  const uname = username.trim().toLowerCase();

  const index = pendingUsers.findIndex(
    u => u.username.toLowerCase() === uname
  );

  if (index === -1) {
    return res.json({ message: "User not found in pending." });
  }

  const user = pendingUsers.splice(index, 1)[0];

  approvedUsers.push({
    username: user.username,
    password: user.password,
    location: user.location
  });

  console.log("✅ USER APPROVED");
  console.log("Username:", user.username);
  console.log("Location:", user.location);

  const ws = approvalSockets[uname];
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'approved' }));
  }

  res.json({ message: `${user.username} approved.` });
});

// ------------------ Check approval ------------------
app.get("/check-approval", (req, res) => {
  const uname = req.query.username.trim().toLowerCase();
  const approved = approvedUsers.some(
    u => u.username.toLowerCase() === uname
  );
  res.json({ approved });
});

// ------------------ Admin helpers ------------------
app.get('/pending-users', (req, res) => {
  res.json(pendingUsers);
});

app.get('/', (req, res) => {
  res.send('Chatterbox backend running!');
});

// ------------------ Start server ------------------
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ------------------ WebSocket ------------------
const wss = new WebSocketServer({ server });

function broadcastOnlineUsers() {
  const users = Object.keys(onlineUsers);
  users.forEach(u => {
    onlineUsers[u].send(
      JSON.stringify({ type: 'online-users', users })
    );
  });
}

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'pending-register') {
        approvalSockets[data.username.toLowerCase()] = ws;
      }

      if (data.type === 'join') {
  const uname = data.username.trim().toLowerCase();

  // Find approved user
  const approved = approvedUsers.find(u => u.username.toLowerCase() === uname);
  if (!approved) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not approved' }));
    return;
  }

  // Store original display name in ws
  ws.username = approved.username;

  // Use lowercase username as key in onlineUsers
  onlineUsers[uname] = ws;

  // Send current online users to this user
  ws.send(JSON.stringify({
    type: 'online-users',
    users: Object.values(onlineUsers).map(ws => ws.username)
  }));

  // Broadcast updated online list to everyone
  broadcastOnlineUsers();
}

// ------------------ Message handling ------------------
if (data.type === 'message') {
  const to = data.to.trim().toLowerCase(); // normalize recipient
  const message = data.message;

  if (onlineUsers[to]) {
    onlineUsers[to].send(JSON.stringify({
      type: 'message',
      from: ws.username, // original display name
      message
    }));
  }
}


    } catch (e) {
      console.log("WS error:", e.message);
    }
  });

  ws.on('close', () => {
    if (ws.username) {
      delete onlineUsers[ws.username];
      broadcastOnlineUsers();
    }
    Object.keys(approvalSockets).forEach(u => {
      if (approvalSockets[u] === ws) delete approvalSockets[u];
    });
  });
});
