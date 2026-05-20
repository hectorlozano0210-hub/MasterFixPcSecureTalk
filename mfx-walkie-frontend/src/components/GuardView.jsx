import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Mic, Volume2, LogOut, Radio, AlertTriangle, Play, UserCircle2, CheckCircle, MessageSquare, AlertCircle } from 'lucide-react';
import { startSOSAlarm, playRogerBeep, playTextPing } from '../utils/audio';
import { updateDailyMessageCount, getDailyMessageCount } from '../utils/db';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001"; // En prod, cambiar a variable de entorno

export default function GuardView({ session, onLogout, onUpgrade }) {
  const [socket, setSocket] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Conectando...");
  const [logs, setLogs] = useState([]); // Historial local
  const [sosActive, setSosActive] = useState(false);
  const [msgCount, setMsgCount] = useState(0);
  
  // TTS Queue State
  const [pendingTexts, setPendingTexts] = useState([]);
  const [isReadingTTS, setIsReadingTTS] = useState(false);
  const pendingTextsRef = useRef([]);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioPlayerRef = useRef(new Audio());
  const alarmRef = useRef(null);
  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  const silentAudioRef = useRef(null);
  const silentAudioCtxRef = useRef(null);
  
  // Ref para controlar el estado actual dentro de los event listeners del teclado
  const isRecordingRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    pendingTextsRef.current = pendingTexts;
  }, [pendingTexts]);

  useEffect(() => {
    const fetchCount = async () => {
      const c = await getDailyMessageCount();
      setMsgCount(c);
    };
    fetchCount();
  }, []);

  useEffect(() => {
    let wakeLock = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.error(`${err.name}, ${err.message}`);
      }
    };
    requestWakeLock();

    // Crear un bucle de silencio infinito usando Web Audio API y MediaStream para garantizar que Chrome en Android/iOS
    // considere que la sesión multimedia (MediaSession) está activamente "reproduciendo" un flujo continuo (duración > 5s).
    // Esto es crucial para evitar que el sistema operativo secuestre los toques del manos libres para abrir Gemini/Siri.
    let silentAudioCtx = null;
    let silentAudio = null;

    const startSilentLoop = () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        silentAudioCtx = new AudioContextClass();
        const destination = silentAudioCtx.createMediaStreamDestination();
        
        // Creamos un oscilador inaudible para obligar a que el flujo tenga datos constantes
        const oscillator = silentAudioCtx.createOscillator();
        const gainNode = silentAudioCtx.createGain();
        gainNode.gain.value = 0.0001; // Volumen inaudible pero existente para el motor de audio
        oscillator.connect(gainNode);
        gainNode.connect(destination);
        oscillator.start();

        silentAudio = new Audio();
        silentAudio.srcObject = destination.stream;
        silentAudio.volume = 0.05;
        
        const playAudio = () => {
          silentAudio.play().then(() => {
            console.log("🚀 Bucle de silencio infinito iniciado exitosamente.");
            if ('mediaSession' in navigator) {
              navigator.mediaSession.playbackState = 'playing';
            }
          }).catch(err => {
            console.warn("⚠️ Autoplay del bucle de silencio bloqueado por el navegador. Se activará al primer toque en la pantalla:", err);
          });
        };

        playAudio();

        // En caso de que el navegador bloquee el autoplay inicial, lo activamos ante cualquier interacción táctil
        const enableOnInteraction = () => {
          if (silentAudioCtx && silentAudioCtx.state === 'suspended') {
            silentAudioCtx.resume();
          }
          if (silentAudio) {
            playAudio();
          }
          window.removeEventListener('click', enableOnInteraction);
          window.removeEventListener('touchstart', enableOnInteraction);
        };
        window.addEventListener('click', enableOnInteraction);
        window.addEventListener('touchstart', enableOnInteraction);

        silentAudioRef.current = silentAudio;
        silentAudioCtxRef.current = silentAudioCtx;
      } catch (err) {
        console.error("Error al iniciar bucle de silencio infinito:", err);
      }
    };

    startSilentLoop();

    const newSocket = io(SOCKET_SERVER_URL, {
      transports: ['websocket']
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setStatusMsg("Conectado | Standby");
      newSocket.emit('join_channel', session);
    });

    newSocket.on('connect_error', (err) => {
      setStatusMsg("Error de Red | Intentando reconectar...");
      console.error("Socket connection error in GuardView:", err);
    });

    newSocket.on('audio_broadcast', async (data) => {
      setIsReceiving(true);
      setStatusMsg(`Recibiendo de: ${data.sender}`);
      
      const blob = new Blob([data.audioBlob], { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      
      const logEntry = {
        id: Date.now(),
        sender: data.sender,
        avatar: data.avatar,
        time: new Date(data.timestamp).toLocaleTimeString(),
        audioUrl
      };
      setLogs(prev => [logEntry, ...prev].slice(0, 3));

      audioPlayerRef.current.src = audioUrl;
      try {
        await audioPlayerRef.current.play();
      } catch (e) {
        console.error("Error reproduciendo audio:", e);
      }

      audioPlayerRef.current.onended = () => {
        playRogerBeep();
        setIsReceiving(false);
        setStatusMsg("Standby");
      };
    });

    // Recibir mensajes de texto para despacho
    newSocket.on('text_broadcast', (data) => {
      playTextPing();
      setPendingTexts(prev => [...prev, data]);
      setStatusMsg(`¡NUEVO MENSAJE DE TEXTO!`);
    });

    newSocket.on('sos_broadcast', (data) => {
      if (alarmRef.current) alarmRef.current.stop();
      alarmRef.current = startSOSAlarm();
      setSosActive(true);
      setStatusMsg(`¡SOS DE ${data.sender}!`);
    });

    newSocket.on('disconnect', () => {
      setStatusMsg("Desconectado");
    });

    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && !isRecordingRef.current) {
        e.preventDefault();
        handleMainButtonPress();
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleMainButtonRelease();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Lógica para Manos Libres (MediaSession API y Teclas Multimedia)
    const handleHeadsetClick = () => {
      clickCountRef.current += 1;
      if (clickCountRef.current === 1) {
        clickTimeoutRef.current = setTimeout(() => {
          // Single click
          if (isRecordingRef.current) {
            handleMainButtonRelease();
          } else {
            handleMainButtonPress();
          }
          clickCountRef.current = 0;
        }, 400); // 400ms para esperar un posible doble clic
      } else if (clickCountRef.current === 2) {
        // Double click
        clearTimeout(clickTimeoutRef.current);
        sendSOS();
        clickCountRef.current = 0;
      }
    };

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'MFX Walkie-Talkie',
        artist: 'Canal ' + session.channel,
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
      if (wakeLock) wakeLock.release();
      newSocket.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('keydown', handleMediaKeys);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
      }
      if (silentAudioRef.current) {
        silentAudioRef.current.pause();
        silentAudioRef.current.srcObject = null;
        silentAudioRef.current = null;
      }
      if (silentAudioCtxRef.current) {
        silentAudioCtxRef.current.close();
        silentAudioCtxRef.current = null;
      }
    };
  }, [session]);

  const readPendingTexts = () => {
    if (pendingTextsRef.current.length === 0) return;
    
    setIsReadingTTS(true);
    setStatusMsg("Leyendo Despacho...");
    const synth = window.speechSynthesis;
    let utteranceIndex = 0;
    const currentTexts = [...pendingTextsRef.current];

    const speakNext = () => {
      if (utteranceIndex >= currentTexts.length) {
        // Finalizado
        setIsReadingTTS(false);
        setPendingTexts([]);
        setStatusMsg("Standby");
        playRogerBeep(); // Avisar que terminó de leer
        return;
      }

      const txtData = currentTexts[utteranceIndex];
      const utterance = new SpeechSynthesisUtterance(`${txtData.sender} dice: ${txtData.text}`);
      utterance.lang = 'es-ES'; // O el idioma por defecto

      // Heurística avanzada para voces Humanizadas (Busca voces Naturales o Premium del sistema)
      const voices = synth.getVoices();
      const spanishVoices = voices.filter(v => v.lang.includes('es'));
      let selectedVoice = null;
      
      if (txtData.voice === 'female') {
         selectedVoice = 
            spanishVoices.find(v => v.name.includes('Natural') && (v.name.includes('Elvira') || v.name.includes('Dalia') || v.name.includes('Abril'))) ||
            spanishVoices.find(v => v.name.includes('Sabina') || v.name.includes('Monica') || v.name.includes('Helena') || v.name.includes('Laura') || v.name.includes('Lucia') || v.name.includes('Mia')) ||
            spanishVoices.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('mujer')) ||
            spanishVoices[0];
            
         utterance.pitch = 1.0; // Mantener pitch natural para no sonar robótica
         utterance.rate = 0.95; // Ligeramente más lento para sonar clara y humana
      } else {
         selectedVoice = 
            spanishVoices.find(v => v.name.includes('Natural') && (v.name.includes('Alvaro') || v.name.includes('Darío') || v.name.includes('Saul'))) ||
            spanishVoices.find(v => v.name.includes('Pablo') || v.name.includes('Jorge') || v.name.includes('Raul') || v.name.includes('Diego')) ||
            spanishVoices.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('hombre')) ||
            spanishVoices[spanishVoices.length - 1]; // Fallback
            
         utterance.pitch = 0.9; // Ligeramente más grave pero dentro del rango natural
         utterance.rate = 0.95; 
      }
      
      if (selectedVoice) utterance.voice = selectedVoice;

      utterance.onend = () => {
        utteranceIndex++;
        speakNext();
      };
      
      utterance.onerror = () => {
        utteranceIndex++;
        speakNext();
      }

      synth.speak(utterance);
    };

    speakNext();
  };

  const handleMainButtonPress = () => {
    if (sosActive) return; // Si hay SOS, debe reconocerlo primero
    if (window.speechSynthesis.speaking) return; // Evitar pisar la lectura
    
    if (pendingTextsRef.current.length > 0) {
      // Prioridad 1: Leer Textos Pendientes
      readPendingTexts();
    } else {
      // Prioridad 2: PTT Normal
      startRecording();
    }
  };

  const handleMainButtonRelease = () => {
    if (isRecordingRef.current) stopRecording();
  };

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    
    // Verificación de Licencia Free
    if (session.license?.type === 'free' && msgCount >= 10) {
      setStatusMsg("LÍMITE DIARIO (FREE)");
      setTimeout(() => setStatusMsg("Standby"), 3000);
      return;
    }

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
        } else {
           console.log("No conectado. Audio descartado o guardado para reintento.");
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatusMsg("Transmitiendo...");
      if (navigator.vibrate) navigator.vibrate(50);
      
    } catch (err) {
      console.error("Error al acceder al micrófono:", err);
      setStatusMsg("Error de Micrófono");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatusMsg("Enviado. Standby");
      
      // Update usage count
      const newCount = await updateDailyMessageCount();
      setMsgCount(newCount);

      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      setTimeout(() => {
        if (!isReceiving && !sosActive && pendingTexts.length === 0) setStatusMsg("Standby");
      }, 2000);
    }
  };

  const sendSOS = () => {
      socket.emit('sos_alert');
      setStatusMsg("SOS Enviado");
      setTimeout(() => setStatusMsg("Standby"), 3000);
  };

  const acknowledgeSOS = () => {
    if (alarmRef.current) {
      alarmRef.current.stop();
      alarmRef.current = null;
    }
    setSosActive(false);
    setStatusMsg("Standby");
  };

  const playHistoryAudio = (url) => {
    const audio = new Audio(url);
    audio.play();
  };

  return (
    <div className="flex-column" style={{ minHeight: '100vh', padding: '20px', justifyContent: 'space-between', backgroundColor: sosActive ? 'rgba(255, 0, 0, 0.2)' : 'transparent', transition: 'background-color 0.5s' }}>
      <header className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px' }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Radio className="text-neon-cyan" size={20} />
            <span style={{ textTransform: 'uppercase' }}>Canal {session.channel}</span>
          </h3>
          <small className="text-secondary">Op: {session.username}</small>
        </div>
        <div style={{ display: 'flex', gap: '15px' }}>
          <button onClick={sendSOS} style={{ background: 'var(--neon-red)', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <AlertTriangle size={18} /> SOS
          </button>
          <button onClick={onLogout} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <LogOut size={24} />
          </button>
        </div>
      </header>

      <main className="flex-center flex-column" style={{ flex: 1 }}>
        <div style={{ marginBottom: '40px', fontSize: '18px', fontWeight: 'bold', color: isRecording ? 'var(--neon-red)' : isReceiving ? 'var(--neon-green)' : sosActive ? 'var(--neon-red)' : pendingTexts.length > 0 ? '#ffcc00' : 'var(--neon-cyan)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '2px' }}>
          <div className={`status-indicator ${isRecording || isReceiving || sosActive || pendingTexts.length > 0 ? (isRecording || sosActive ? 'status-busy' : 'status-online') : ''}`} style={{ marginRight: '8px' }}></div>
          {statusMsg}
          {pendingTexts.length > 0 && !isReadingTTS && <div style={{ fontSize: '14px', color: '#ffcc00', marginTop: '10px' }}>{pendingTexts.length} Mensajes pendientes. Haz clic para leer.</div>}
        </div>

        <button 
          className={`hud-button ${isRecording ? 'recording' : ''} ${isReceiving || isReadingTTS ? 'receiving' : ''}`}
          onMouseDown={handleMainButtonPress}
          onMouseUp={handleMainButtonRelease}
          onMouseLeave={handleMainButtonRelease}
          onTouchStart={handleMainButtonPress}
          onTouchEnd={handleMainButtonRelease}
          style={{ borderColor: pendingTexts.length > 0 && !isReadingTTS && !isRecording ? '#ffcc00' : '', color: pendingTexts.length > 0 && !isReadingTTS && !isRecording ? '#ffcc00' : '' }}
        >
          {isReadingTTS ? <MessageSquare size={64} /> : isReceiving ? <Volume2 size={64} /> : <Mic size={64} />}
        </button>
        {sosActive && (
          <button 
            onClick={acknowledgeSOS}
            style={{ marginTop: '20px', background: 'var(--neon-red)', color: '#fff', border: 'none', padding: '15px 30px', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', boxShadow: '0 0 20px rgba(255, 51, 102, 0.8)' }}
          >
            <CheckCircle size={24} /> RECIBIDO / APAGAR ALERTA
          </button>
        )}
        
        <p className="text-secondary" style={{ marginTop: '30px', textAlign: 'center', fontSize: '14px', maxWidth: '300px' }}>
          MANTENER PULSADO O USAR BARRA ESPACIADORA.<br/><br/>
          <strong style={{color: 'var(--neon-cyan)'}}>MANOS LIBRES:</strong><br/>
          1 Clic para Hablar (o Escuchar Texto)<br/>
          2 Clics Rápidos para SOS
        </p>
      </main>

      {/* Historial Reciente para el Vigilante */}
      {logs.length > 0 && (
        <div className="glass-panel" style={{ padding: '15px', marginTop: '20px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--text-secondary)' }}>Últimos audios:</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {logs.map(log => (
              <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {log.avatar ? (
                    <img src={log.avatar} alt="avatar" style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <UserCircle2 size={30} color="var(--text-secondary)" />
                  )}
                  <span style={{ fontSize: '14px', display: 'flex', flexDirection: 'column' }}>
                    {log.sender} 
                    <small className="text-secondary" style={{ fontSize: '10px' }}>{log.time}</small>
                  </span>
                </div>
                <button 
                  onClick={() => playHistoryAudio(log.audioUrl)}
                  style={{ background: 'transparent', border: '1px solid var(--neon-cyan)', color: 'var(--neon-cyan)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <Play size={14} style={{ marginLeft: '2px' }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Espacio Publicitario para Versión Free */}
      {session.license?.type === 'free' && (
        <div style={{ marginTop: '20px', padding: '15px', background: '#1a1a24', border: '1px dashed var(--text-secondary)', borderRadius: '8px', textAlign: 'center' }}>
          <small style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}>Espacio Publicitario</small>
          <button 
            onClick={onUpgrade}
            style={{ width: '100%', background: '#0a0a0c', padding: '10px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', border: '1px solid var(--border-glass)', cursor: 'pointer' }}
          >
             <AlertCircle size={20} color="var(--neon-cyan)" />
             <span style={{ fontSize: '12px', color: '#fff' }}>Actualiza a MFX Core Pro para Mensajes Ilimitados</span>
          </button>
          <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '10px' }}>Mensajes hoy: {msgCount} / 10</small>
        </div>
      )}
    </div>
  );
}
