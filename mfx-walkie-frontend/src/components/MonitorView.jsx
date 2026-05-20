import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { LogOut, MonitorCheck, RadioReceiver, Volume2, Mic, AlertTriangle, UserCircle2, Copy, CheckCircle, MessageSquare, Send, AlertCircle } from 'lucide-react';
import { startSOSAlarm, playRogerBeep, playTextPing } from '../utils/audio';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001";

export default function MonitorView({ session, onLogout, onUpgrade }) {
  const [socket, setSocket] = useState(null);
  const [logs, setLogs] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const alarmRef = useRef(null);
  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  
  const [textMsg, setTextMsg] = useState('');
  const [voiceGender, setVoiceGender] = useState('female');
  
  const isRecordingRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join_channel', session);
    });

    newSocket.on('audio_broadcast', (data) => {
      const blob = new Blob([data.audioBlob], { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      
      const logEntry = {
        id: Date.now(),
        sender: data.sender,
        avatar: data.avatar,
        role: data.role,
        time: new Date(data.timestamp).toLocaleTimeString(),
        audioUrl
      };

      setLogs(prev => [logEntry, ...prev].slice(0, 50));

      const audio = new Audio(audioUrl);
      audio.play().catch(e => console.error("Auto-play prevented", e));
      audio.onended = () => {
        playRogerBeep();
      };
    });

    newSocket.on('sos_broadcast', (data) => {
      if (alarmRef.current) alarmRef.current.stop();
      alarmRef.current = startSOSAlarm();
      setSosActive(true);
      setLogs(prev => [{
        id: Date.now(),
        sender: data.sender,
        avatar: data.avatar,
        role: 'system',
        time: new Date().toLocaleTimeString(),
        message: '¡ALERTA SOS ACTIVADA!'
      }, ...prev].slice(0, 50));
    });

    newSocket.on('system_message', (data) => {
      setLogs(prev => [{
        id: Date.now(),
        sender: 'SISTEMA',
        role: 'system',
        time: new Date().toLocaleTimeString(),
        message: data.message
      }, ...prev].slice(0, 50));
    });

    newSocket.on('text_broadcast', (data) => {
      playTextPing();
      setLogs(prev => [{
        id: Date.now(),
        sender: data.sender,
        avatar: data.avatar,
        role: data.role,
        time: new Date(data.timestamp).toLocaleTimeString(),
        message: `(TTS - ${data.voice === 'female' ? 'Mujer' : 'Hombre'}): "${data.text}"`
      }, ...prev].slice(0, 50));
    });

    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && !isRecordingRef.current) {
        if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
           e.preventDefault();
           startRecording();
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
           e.preventDefault();
           stopRecording();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const handleHeadsetClick = () => {
      clickCountRef.current += 1;
      if (clickCountRef.current === 1) {
        clickTimeoutRef.current = setTimeout(() => {
          if (isRecordingRef.current) stopRecording();
          else startRecording();
          clickCountRef.current = 0;
        }, 400); 
      } else if (clickCountRef.current === 2) {
        clearTimeout(clickTimeoutRef.current);
        sendSOS();
        clickCountRef.current = 0;
      }
    };

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'MFX Walkie-Talkie',
        artist: 'Monitor - Canal ' + session.channel,
      });
      navigator.mediaSession.setActionHandler('play', handleHeadsetClick);
      navigator.mediaSession.setActionHandler('pause', handleHeadsetClick);
    }

    const handleMediaKeys = (e) => {
      if (e.key === 'MediaPlayPause') {
        e.preventDefault();
        handleHeadsetClick();
      }
    };
    window.addEventListener('keydown', handleMediaKeys);

    return () => {
      newSocket.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('keydown', handleMediaKeys);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
      }
    };
  }, [session]);

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (socket && socket.connected) {
          socket.emit('audio_message', { audioBlob });
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error al acceder al micrófono:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendSOS = () => {
    if (socket) {
      socket.emit('sos_alert');
      setLogs(prev => [{
        id: Date.now(),
        sender: 'TÚ (MONITOR)',
        role: 'system',
        time: new Date().toLocaleTimeString(),
        message: '¡ENVIASTE ALERTA GLOBAL AL CANAL!'
      }, ...prev].slice(0, 50));
    }
  };

  const acknowledgeSOS = () => {
    if (alarmRef.current) {
      alarmRef.current.stop();
      alarmRef.current = null;
    }
    setSosActive(false);
  };

  const sendTextMsg = (e) => {
    e.preventDefault();
    if (!textMsg.trim() || !socket) return;
    
    socket.emit('text_message', {
      text: textMsg,
      voice: voiceGender
    });
    
    setLogs(prev => [{
      id: Date.now(),
      sender: 'TÚ (DESPACHO)',
      role: 'system',
      time: new Date().toLocaleTimeString(),
      message: `Enviado TTS (${voiceGender}): "${textMsg}"`
    }, ...prev].slice(0, 50));
    
    setTextMsg('');
  };

  const playAudio = (url) => {
    const audio = new Audio(url);
    audio.play();
  };

  const copyAccessInfo = () => {
    const text = `Únete a mi canal táctico:\nID Canal: ${session.channel}\nClave: ${session.password || 'Sin clave'}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopyMsg('¡Copiado!');
      setTimeout(() => setCopyMsg(''), 2000);
    });
  };

  return (
    <div className="flex-column" style={{ minHeight: '100vh', padding: '20px', backgroundColor: sosActive ? 'rgba(255, 0, 0, 0.2)' : 'transparent', transition: 'background-color 0.5s' }}>
      <header className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', marginBottom: '20px', borderColor: sosActive ? 'var(--neon-red)' : 'var(--border-glass)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <MonitorCheck className="text-neon-blue" size={32} />
          <div>
            <h2 style={{ margin: 0, color: sosActive ? 'var(--neon-red)' : '#fff', display: 'flex', alignItems: 'center', gap: '10px' }}>
              Centro de Control MFX
              <button onClick={copyAccessInfo} style={{ background: 'rgba(0,240,255,0.2)', border: '1px solid var(--neon-cyan)', color: 'var(--neon-cyan)', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <Copy size={12} /> {copyMsg || 'Copiar Acceso'}
              </button>
            </h2>
            <small className="text-secondary">Monitor: {session.username} | Canal: {session.channel.toUpperCase()}</small>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '15px' }}>
          {sosActive && (
            <button onClick={acknowledgeSOS} style={{ background: 'var(--neon-green)', border: 'none', color: '#000', borderRadius: '8px', padding: '8px 16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', boxShadow: '0 0 15px rgba(57, 255, 20, 0.4)' }}>
              <CheckCircle size={18} /> APAGAR ALARMA
            </button>
          )}
          <button onClick={sendSOS} style={{ background: 'var(--neon-red)', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <AlertTriangle size={18} /> ALERTA GENERAL
          </button>
          <button onClick={onLogout} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LogOut size={16} /> SALIR
          </button>
        </div>
      </header>

      <div className="dashboard-grid" style={{ flex: 1, alignItems: 'start' }}>
        <div className="glass-panel" style={{ padding: '30px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
          <h3 style={{ marginBottom: '40px', color: 'var(--neon-blue)' }}>Transmisión Global</h3>
          <button 
            className={`hud-button ${isRecording ? 'recording' : ''}`}
            style={{ borderColor: 'var(--neon-blue)', color: 'var(--neon-blue)' }}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={stopRecording}
          >
            <Mic size={48} />
          </button>
          <p className="text-secondary" style={{ marginTop: '30px', textAlign: 'center' }}>
            {isRecording ? "TRANSMITIENDO A CANAL..." : "PULSAR O PRESIONAR BARRA ESPACIADORA"}
          </p>

          <hr style={{ width: '100%', borderColor: 'var(--border-glass)', margin: '30px 0' }} />
          
          <h3 style={{ marginBottom: '15px', color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquare size={20} /> Despacho Text-to-Speech
          </h3>
          <form onSubmit={sendTextMsg} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                type="button"
                className={`input-glass ${voiceGender === 'female' ? 'active' : ''}`}
                style={{ borderColor: voiceGender === 'female' ? 'var(--neon-cyan)' : 'var(--border-glass)', flex: 1, cursor: 'pointer' }}
                onClick={() => setVoiceGender('female')}
              >Mujer</button>
              <button 
                type="button"
                className={`input-glass ${voiceGender === 'male' ? 'active' : ''}`}
                style={{ borderColor: voiceGender === 'male' ? 'var(--neon-cyan)' : 'var(--border-glass)', flex: 1, cursor: 'pointer' }}
                onClick={() => setVoiceGender('male')}
              >Hombre</button>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                className="input-glass" 
                placeholder="Escribir instrucción..."
                value={textMsg}
                onChange={(e) => setTextMsg(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn-primary" style={{ padding: '0 15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Send size={18} />
              </button>
            </div>
          </form>
        </div>

        <div className="glass-panel" style={{ padding: '20px', height: '100%', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <RadioReceiver className="text-neon-cyan" size={20} /> Historial de Transmisiones
          </h3>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '10px' }}>
            {logs.length === 0 ? (
              <p className="text-secondary" style={{ textAlign: 'center', marginTop: '40px' }}>Esperando transmisiones...</p>
            ) : (
              logs.map(log => (
                <div key={log.id} style={{ 
                  background: 'rgba(0,0,0,0.3)', 
                  borderLeft: `4px solid ${log.role === 'system' ? (log.message?.includes('SOS') ? 'var(--neon-red)' : '#8a8a93') : 'var(--neon-cyan)'}`,
                  padding: '12px 15px',
                  borderRadius: '0 8px 8px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {log.role !== 'system' && (
                       log.avatar ? (
                         <img src={log.avatar} alt="Avatar" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                       ) : (
                         <UserCircle2 size={40} color="var(--text-secondary)" />
                       )
                    )}
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '14px', color: log.role === 'system' ? 'var(--text-secondary)' : '#fff' }}>
                        {log.sender} <span style={{ fontWeight: 'normal', color: 'var(--text-secondary)', fontSize: '12px' }}>{log.time}</span>
                      </div>
                      {log.message && <div style={{ fontSize: '14px', marginTop: '4px', color: log.message.includes('SOS') ? 'var(--neon-red)' : 'var(--text-secondary)' }}>{log.message}</div>}
                    </div>
                  </div>
                  {log.audioUrl && (
                    <button 
                      onClick={() => playAudio(log.audioUrl)}
                      style={{ background: 'var(--panel-bg)', border: '1px solid var(--border-glass)', color: 'var(--neon-cyan)', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <Volume2 size={18} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          
          {/* Espacio Publicitario para Versión Free */}
          {session.license?.type === 'free' && (
            <div style={{ marginTop: '20px', padding: '15px', background: '#1a1a24', border: '1px dashed var(--text-secondary)', borderRadius: '8px', textAlign: 'center' }}>
              <small style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}>Espacio Publicitario MFX</small>
              <button 
                onClick={onUpgrade}
                style={{ width: '100%', background: '#0a0a0c', padding: '10px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', border: '1px solid var(--border-glass)', cursor: 'pointer' }}
              >
                 <AlertCircle size={20} color="var(--neon-cyan)" />
                 <span style={{ fontSize: '12px', color: '#fff' }}>Actualiza tu licencia para uso ilimitado de vigilantes y sin anuncios.</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
