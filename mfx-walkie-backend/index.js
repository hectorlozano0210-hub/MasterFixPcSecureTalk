import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100 MB max audio blob size
});

// Estructura de usuarios: { socketId: { role, channel, username, avatar } }
const users = new Map();
// Estructura de salas: { channelId: { password, createdAt } }
const activeRooms = new Map();

// Para pruebas, canal "general" abierto
activeRooms.set('general', { password: '', createdAt: Date.now() });

io.on('connection', (socket) => {
  console.log(`[+] Nueva conexión: ${socket.id}`);

  // Evento para CREAR un canal
  socket.on('create_channel', ({ channel, password }, callback) => {
    if (activeRooms.has(channel)) {
      if(callback) callback({ success: false, message: 'El canal ya existe.' });
      return;
    }
    activeRooms.set(channel, { password, createdAt: Date.now() });
    console.log(`[+] Canal creado: ${channel} con clave: ${password}`);
    if(callback) callback({ success: true, message: 'Canal creado exitosamente.' });
  });

  // Evento para UNIRSE a un canal
  socket.on('join_channel', ({ role, channel, username, password, avatar }, callback) => {
    const room = activeRooms.get(channel);
    
    // Si no existe, rechazar (a menos que quieran auto-crear, pero exigimos que se cree antes)
    if (!room) {
      if(callback) callback({ success: false, message: 'El canal no existe.' });
      return;
    }
    
    // Validar clave (si el canal tiene clave)
    if (room.password && room.password !== password) {
      if(callback) callback({ success: false, message: 'Contraseña incorrecta.' });
      return;
    }

    socket.join(channel);
    users.set(socket.id, { role, channel, username, avatar });
    
    console.log(`[+] ${username} (${role}) se unió al canal: ${channel}`);
    
    socket.to(channel).emit('system_message', {
      message: `${username} se ha unido al canal.`
    });

    if(callback) callback({ success: true, message: 'Unido exitosamente.' });
  });

  // Evento para recibir audio y retransmitirlo
  socket.on('audio_message', (data) => {
    const user = users.get(socket.id);
    if (!user) return; 

    const { channel, username, role, avatar } = user;
    const { audioBlob } = data; 

    socket.to(channel).emit('audio_broadcast', {
      audioBlob,
      sender: username,
      avatar,
      role,
      timestamp: new Date().toISOString()
    });
  });

  // Evento para recibir texto (Despacho TTS)
  socket.on('text_message', (data) => {
    const user = users.get(socket.id);
    if (!user) return; 

    socket.to(user.channel).emit('text_broadcast', {
      text: data.text,
      voice: data.voice,
      sender: user.username,
      avatar: user.avatar,
      role: user.role,
      timestamp: new Date().toISOString()
    });
  });

  // Evento para Alerta SOS
  socket.on('sos_alert', () => {
    const user = users.get(socket.id);
    if (!user) return;
    
    console.log(`[SOS] Alerta de ${user.username} en canal ${user.channel}`);
    socket.to(user.channel).emit('sos_broadcast', {
      sender: user.username,
      avatar: user.avatar,
      role: user.role,
      timestamp: new Date().toISOString()
    });
  });

  // Evento para desconexión
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`[-] ${user.username} (${user.role}) se desconectó.`);
      socket.to(user.channel).emit('system_message', {
        message: `${user.username} se ha desconectado.`
      });
      users.delete(socket.id);
      
      // Se comenta la lógica de limpieza estricta porque causa la eliminación 
      // de la sala si el monitor recarga la página o actualiza la licencia.
      // Queda la sala abierta para que el vigilante pueda entrar.
      /*
      const clientsInRoom = io.sockets.adapter.rooms.get(user.channel);
      if (!clientsInRoom && user.channel !== 'general') {
         activeRooms.delete(user.channel);
         console.log(`[*] Canal vacío eliminado: ${user.channel}`);
      }
      */
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 MFX Walkie-Talkie Backend corriendo en http://localhost:${PORT}`);
});
