import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Mic, Volume2, LogOut, Radio, AlertTriangle, Play, UserCircle2, CheckCircle, MessageSquare, AlertCircle } from 'lucide-react';
import { startSOSAlarm, playRogerBeep, playTextPing } from '../utils/audio';
import { updateDailyMessageCount, getDailyMessageCount } from '../utils/db';
import { safeStorage } from '../utils/storage';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3001"; // En prod, cambiar a variable de entorno

export default function GuardView({ session, onLogout, onUpgrade }) {
  const [socket, setSocket] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Conectando...");
  const [logs, setLogs] = useState([]); // Historial local
  const [sosActive, setSosActive] = useState(false);
  const [msgCount, setMsgCount] = useState(0);
  
  const socketRef = useRef(null);
  const isTouchActiveRef = useRef(false);

  // Patrón de envoltura de referencias para evitar cierres obsoletos (stale closures)
  const handleMainButtonPressRef = useRef(null);
  const handleMainButtonReleaseRef = useRef(null);
  const sendSOSRef = useRef(null);
  const handleHeadsetClickRef = useRef(null);
  // TTS Queue State
  const [pendingTexts, setPendingTexts] = useState([]);
  const [isReadingTTS, setIsReadingTTS] = useState(false);
  const pendingTextsRef = useRef([]);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioPlayerRef = useRef(new Audio());
  const alarmRef = useRef(null);
  
  // Refs para pánico manos libres físico
  const lastHeadsetClickTimeRef = useRef(0);
  const headsetClickCountRef = useRef(0);
  const headsetClickTimeoutRef = useRef(null);

  // Refs para pánico táctil (HUD en pantalla)
  const lastHUDPressTimeRef = useRef(0);
  const hudClickCountRef = useRef(0);
  
  // Ref para descarte de audios ultra-cortos
  const recordingStartTimeRef = useRef(0);
  const shouldDiscardRecordingRef = useRef(false);

  const silentAudioRef = useRef(null);
  const [isSintonizado, setIsSintonizado] = useState(false);
  const isSintonizadoRef = useRef(false);
  
  // Shake to SOS (Sacudir para pánico)
  const [shakeEnabled, setShakeEnabled] = useState(safeStorage.getItem('mfx_shake_enabled') === 'true');
  const shakeEnabledRef = useRef(safeStorage.getItem('mfx_shake_enabled') === 'true');

  // Control de saturación (throttle) para SOS
  const lastSOSSentRef = useRef(0);
  
  // Ref para controlar el estado actual dentro de los event listeners del teclado
  const isRecordingRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isSintonizadoRef.current = isSintonizado;
  }, [isSintonizado]);

  useEffect(() => {
    pendingTextsRef.current = pendingTexts;
  }, [pendingTexts]);

  useEffect(() => {
    shakeEnabledRef.current = shakeEnabled;
    safeStorage.setItem('mfx_shake_enabled', shakeEnabled);
  }, [shakeEnabled]);

  // Mantener las referencias a los controladores siempre actualizadas en cada render
  useEffect(() => {
    handleMainButtonPressRef.current = handleMainButtonPress;
    handleMainButtonReleaseRef.current = handleMainButtonRelease;
    sendSOSRef.current = sendSOS;
    handleHeadsetClickRef.current = handleHeadsetClick;
  });

  useEffect(() => {
    const fetchCount = async () => {
      const c = await getDailyMessageCount();
      setMsgCount(c);
    };
    fetchCount();
  }, []);

  // Lógica para Manos Libres (MediaSession API y Teclas Multimedia) con Alerta SOS Antipánico
  // Cualquier secuencia de 2 o más clics rápidos y seguidos activará de inmediato la alarma en el monitor
  const handleHeadsetClick = (details) => {
    console.log(`[MediaSession] Headset clicked, action: ${details?.action || 'unknown'}`);
    
    // Forzar que el audio silencioso siga reproduciéndose para que el sistema operativo no descarte la sesión multimedia
    if (silentAudioRef.current) {
      silentAudioRef.current.play().then(() => {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
      }).catch(err => console.warn("[MediaSession] Error re-activando audio silencioso al clickear:", err));
    }

    const now = Date.now();
    const timeSinceLastClick = now - lastHeadsetClickTimeRef.current;
    lastHeadsetClickTimeRef.current = now;

    if (isRecordingRef.current) {
      // Si ya está transmitiendo, revisamos si el clic es un doble clic rápido de pánico
      if (timeSinceLastClick < 600) {
        console.log(`[SOS HEADSET] Clic rápido detectado en transmisión (${timeSinceLastClick}ms). Activando SOS.`);
        // Detener y descartar la grabación inmediatamente
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          shouldDiscardRecordingRef.current = true;
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setStatusMsg("Standby");
        
        // Enviar alerta SOS
        if (sendSOSRef.current) sendSOSRef.current();
      } else {
        console.log(`[SOS HEADSET] Clic normal en transmisión (${timeSinceLastClick}ms). Deteniendo transmisión.`);
        if (handleMainButtonReleaseRef.current) handleMainButtonReleaseRef.current();
      }
    } else {
      // Si NO está transmitiendo, iniciamos la transmisión inmediatamente de forma síncrona
      console.log("[SOS HEADSET] Clic detectado fuera de transmisión. Iniciando PTT síncronamente (preservando User Gesture).");
      if (handleMainButtonPressRef.current) handleMainButtonPressRef.current();
    }
  };

  const sintonizarHeadset = () => {
    try {
      // Solicitar permiso de sensor de movimiento (Acelerómetro) para iOS si es necesario
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          DeviceMotionEvent.requestPermission()
            .then(permissionState => {
              console.log("DeviceMotion permission:", permissionState);
            })
            .catch(err => console.warn("Error solicitando permisos del acelerómetro:", err));
        } catch (e) {
          console.warn("Error síncrono al solicitar permisos del acelerómetro:", e);
        }
      }

      // Crear y reproducir un bucle de audio silencioso real de 10s (public/silence.wav)
      // Esto garantiza compatibilidad universal y mantiene activa la sesión multimedia en segundo plano
      const audio = new Audio();
      audio.src = "/silence.wav";
      audio.preload = "auto";
      audio.loop = true;
      audio.volume = 0.02; // Suficientemente bajo para ser inaudible pero registrado como activo por el OS
      
      audio.play().then(() => {
        console.log("🚀 Canal táctil enlazado. Bucle de silencio de 10s activo.");
        try {
          playRogerBeep(); // Pitido corto premium de confirmación de sintonización
        } catch (e) {
          console.warn("Error al reproducir beep de sintonización:", e);
        }
        
        if ('mediaSession' in navigator) {
          try {
            if (typeof MediaMetadata !== 'undefined') {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: 'MFX Walkie-Talkie',
                artist: 'Canal ' + session.channel,
              });
            }
          } catch (e) {
            console.warn("Error setting mediaSession metadata:", e);
          }
          
          // Usamos una envoltura estable que invoque la referencia dinámica para evitar cierres obsoletos
          const mediaSessionWrapper = (details) => {
            if (handleHeadsetClickRef.current) {
              handleHeadsetClickRef.current(details);
            }
          };

          const actions = ['play', 'pause', 'toggleplay', 'stop', 'nexttrack', 'previoustrack'];
          actions.forEach(action => {
            try {
              navigator.mediaSession.setActionHandler(action, mediaSessionWrapper);
            } catch (e) {
              console.warn(`Error setting mediaSession action handler for "${action}":`, e);
            }
          });

          try {
            navigator.mediaSession.playbackState = 'playing';
          } catch (e) {
            console.warn("Error setting mediaSession playbackState:", e);
          }
        }
        setIsSintonizado(true);
        setStatusMsg("Sintonizado | Standby");
      }).catch(err => {
        console.warn("Error al sintonizar audio:", err);
        // Si falla por autoplay, igual activamos la interfaz pero reportamos el estado
        setIsSintonizado(true);
        setStatusMsg("Standby");
      });

      silentAudioRef.current = audio;
    } catch (e) {
      console.error("Error síncrono en sintonizarHeadset:", e);
      setIsSintonizado(true);
      setStatusMsg("Standby");
    }
  };

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

    const newSocket = io(SOCKET_SERVER_URL, {
      transports: ['websocket']
    });
    socketRef.current = newSocket;
    setSocket(newSocket);

    newSocket.on('connect', () => {
      if (isSintonizadoRef.current) {
        setStatusMsg("Sintonizado | Standby");
      } else {
        setStatusMsg("Conectado | Standby");
      }
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
        try {
          playRogerBeep();
        } catch (e) {
          console.warn("Error al reproducir beep de audio finalizado:", e);
        }
        setIsReceiving(false);
        setStatusMsg("Standby");
      };
    });

    // Recibir mensajes de texto para despacho
    newSocket.on('text_broadcast', (data) => {
      try {
        playTextPing();
      } catch (e) {
        console.warn("Error al reproducir ping de texto:", e);
      }
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
        if (handleMainButtonPressRef.current) handleMainButtonPressRef.current(e);
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (handleMainButtonReleaseRef.current) handleMainButtonReleaseRef.current(e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const handleMediaKeys = (e) => {
      if (e.key === 'MediaPlayPause') {
        e.preventDefault();
        if (handleHeadsetClickRef.current) handleHeadsetClickRef.current({ action: 'playpause' });
      }
    };
    window.addEventListener('keydown', handleMediaKeys);

    // Detección de sacudida (Shake-to-SOS)
    let shakeCount = 0;
    let lastShakeTime = 0;
    
    const handleMotion = (event) => {
      if (!shakeEnabledRef.current) return;
      
      const acc = event.acceleration;
      if (!acc || acc.x === null) return;
      
      // Calcular fuerza total g (sin gravedad)
      const force = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
      
      // 24 m/s² es una sacudida brusca (aprox 2.4g)
      if (force > 24) {
        const now = Date.now();
        // Evitar contar lecturas consecutivas del mismo movimiento (debounce de 350ms)
        if (now - lastShakeTime > 350) {
          shakeCount += 1;
          lastShakeTime = now;
          console.log(`[SHAKE] Movimiento detectado. Contador: ${shakeCount}/3`);
          
          if (shakeCount >= 3) {
            console.log("[SHAKE SOS] Sacudida exitosa. ¡Activando SOS!");
            if (sendSOSRef.current) sendSOSRef.current();
            shakeCount = 0;
          }
          
          // Si pasa más de 3 segundos sin sacudidas, resetear contador
          setTimeout(() => {
            if (Date.now() - lastShakeTime > 3000) {
              shakeCount = 0;
            }
          }, 3200);
        }
      }
    };

    window.addEventListener('devicemotion', handleMotion);

    return () => {
      try {
        if (wakeLock) {
          wakeLock.release().catch(err => console.warn("Error releasing wake lock:", err));
        }
      } catch (e) {
        console.warn("Error calling wakeLock.release:", e);
      }
      try {
        newSocket.disconnect();
      } catch (e) {
        console.warn("Error disconnecting socket in cleanup:", e);
      }
      socketRef.current = null;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('keydown', handleMediaKeys);
      window.removeEventListener('devicemotion', handleMotion);
      
      if ('mediaSession' in navigator) {
        const actions = ['play', 'pause', 'toggleplay', 'stop', 'nexttrack', 'previoustrack'];
        actions.forEach(action => {
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch (e) {
            console.warn(`Error clearing mediaSession handler for "${action}":`, e);
          }
        });
      }
      
      if (silentAudioRef.current) {
        try {
          silentAudioRef.current.pause();
        } catch (e) {
          console.warn("Error pausing silent audio in cleanup:", e);
        }
        silentAudioRef.current = null;
      }
    };
  }, [session]);

  const readPendingTexts = () => {
    if (pendingTextsRef.current.length === 0) return;
    
    const synth = window.speechSynthesis;
    if (!synth) {
      console.warn("SpeechSynthesis no está soportado en este navegador.");
      setIsReadingTTS(false);
      setPendingTexts([]);
      setStatusMsg("Standby");
      return;
    }
    
    setIsReadingTTS(true);
    setStatusMsg("Leyendo Despacho...");
    let utteranceIndex = 0;
    const currentTexts = [...pendingTextsRef.current];

    const speakNext = () => {
      if (utteranceIndex >= currentTexts.length) {
        // Finalizado
        setIsReadingTTS(false);
        setPendingTexts([]);
        setStatusMsg("Standby");
        try {
          playRogerBeep(); // Avisar que terminó de leer
        } catch (e) {
          console.warn("Error al reproducir beep tras finalizar TTS:", e);
        }
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

  const handleMainButtonPress = (e) => {
    if (e) {
      const isTouch = e.type === 'touchstart' || (e.nativeEvent && e.nativeEvent.touches);
      if (isTouch) {
        isTouchActiveRef.current = true;
        if (e.cancelable) e.preventDefault();
      } else if (isTouchActiveRef.current) {
        // Ignorar evento de mouse emulado en dispositivo móvil
        return;
      }
    }

    if (sosActive) return; // Si hay SOS, debe reconocerlo primero
    if (window.speechSynthesis && window.speechSynthesis.speaking) return; // Evitar pisar la lectura
    
    const now = Date.now();
    const timeSinceLastHUD = now - lastHUDPressTimeRef.current;
    lastHUDPressTimeRef.current = now;

    if (timeSinceLastHUD < 500) {
      // Pulsación rápida secuencial en el HUD
      hudClickCountRef.current += 1;
    } else {
      // Primera pulsación
      hudClickCountRef.current = 1;
    }

    if (hudClickCountRef.current >= 2) {
      // PÁNICO TÁCTIL DETECTADO
      console.log(`[SOS HUD] Pánico táctil en pantalla: ${hudClickCountRef.current} toques rápidos.`);
      sendSOS();
      
      // Si el primer toque inició una grabación, la cancelamos y descartamos de inmediato
      if (isRecordingRef.current) {
        discardRecording();
      }
      return;
    }

    if (pendingTextsRef.current.length > 0) {
      // Prioridad 1: Leer Textos Pendientes
      readPendingTexts();
    } else {
      // Prioridad 2: PTT Normal
      startRecording();
    }
  };

  const handleMainButtonRelease = (e) => {
    if (e) {
      const isTouch = e.type === 'touchend' || e.type === 'touchcancel';
      if (isTouch) {
        if (e.cancelable) e.preventDefault();
        // Delay para liberar el bloqueo táctil y absorber el evento de mouse emulado posterior
        setTimeout(() => {
          isTouchActiveRef.current = false;
        }, 500);
      } else if (isTouchActiveRef.current) {
        // Ignorar evento de mouse emulado
        return;
      }
    }

    if (isRecordingRef.current) stopRecording();
  };

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    
    // Verificación de Licencia Free
    if (session.license?.type === 'free' && msgCount >= 10) {
      setStatusMsg("LÍMITE DIARIO (FREE)");
      setTimeout(() => {
        setStatusMsg(current => current.includes("LÍMITE") ? "Standby" : current);
      }, 3000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();
      shouldDiscardRecordingRef.current = false;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        if (shouldDiscardRecordingRef.current) {
          console.log("Grabación descartada.");
          stream.getTracks().forEach(track => track.stop());
          shouldDiscardRecordingRef.current = false;
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (socketRef.current && socketRef.current.connected) {
           socketRef.current.emit('audio_message', { audioBlob });
        } else {
           console.log("No conectado. Audio descartado o guardado para reintento.");
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatusMsg("Transmitiendo...");
      if (navigator.vibrate) navigator.vibrate(50);
      
      // RE-ENFORZAR foco de la sesión de medios y reproducción de silencio al iniciar la grabación
      if (silentAudioRef.current) {
        silentAudioRef.current.play().then(() => {
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        }).catch(err => console.warn("[MediaSession] Error re-enforcing focus during recording:", err));
      }
      
    } catch (err) {
      console.error("Error al acceder al micrófono:", err);
      setStatusMsg("Error de Micrófono");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      const duration = Date.now() - recordingStartTimeRef.current;
      if (duration < 400) {
        // Clic accidental o pánico
        shouldDiscardRecordingRef.current = true;
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        setStatusMsg("Standby");
        return;
      }

      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatusMsg("Enviado. Standby");
      
      // Update usage count
      const newCount = await updateDailyMessageCount();
      setMsgCount(newCount);

      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      
      // RE-ENFORZAR foco de la sesión de medios y reproducción de silencio tras detener la grabación
      if (silentAudioRef.current) {
        silentAudioRef.current.play().then(() => {
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        }).catch(err => console.warn("[MediaSession] Error re-enforcing focus post recording:", err));
      }

      setTimeout(() => {
        setStatusMsg(current => current.includes("Enviado") ? "Standby" : current);
      }, 2000);
    }
  };

  const discardRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      shouldDiscardRecordingRef.current = true;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatusMsg("Llamada cancelada");
      setTimeout(() => {
        setStatusMsg(current => current.includes("cancelada") ? "Standby" : current);
      }, 1500);
    }
  };

  const sendSOS = () => {
      const now = Date.now();
      if (now - lastSOSSentRef.current < 5000) {
        console.log("[SOS] SOS omitido por límite de frecuencia.");
        return;
      }
      lastSOSSentRef.current = now;

      if (socketRef.current && socketRef.current.connected) {
         socketRef.current.emit('sos_alert');
      }
      
      setStatusMsg("🚨 SOS ENVIADO 🚨");
      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100, 50, 100]);
      }
      
      setTimeout(() => {
        setStatusMsg(current => current.includes("SOS ENVIADO") ? "Standby" : current);
      }, 3000);
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

  if (!isSintonizado) {
    return (
      <div className="flex-center flex-column" style={{ minHeight: '100vh', padding: '20px', textAlign: 'center', background: 'radial-gradient(circle, rgba(16,20,30,1) 0%, rgba(5,6,10,1) 100%)' }}>
        <div className="glass-panel" style={{ padding: '40px 30px', maxWidth: '400px', width: '100%', border: '1px solid var(--neon-cyan)', boxShadow: '0 0 25px rgba(0, 240, 255, 0.25)', borderRadius: '12px' }}>
          <Radio className="text-neon-cyan" size={48} style={{ marginBottom: '20px', display: 'inline-block' }} />
          <h2 style={{ color: '#fff', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>Sintonización Segura</h2>
          <p className="text-secondary" style={{ fontSize: '14px', lineHeight: '1.6', marginBottom: '30px' }}>
            Para enlazar tu manos libres físico y garantizar la transmisión de voz/alarmas, y habilitar la detección de pánico por sacudida (Shake-to-SOS), presiona el botón a continuación.
          </p>
          <button 
            onClick={sintonizarHeadset} 
            className="btn-primary" 
            style={{ 
              width: '100%', 
              padding: '16px', 
              fontSize: '16px', 
              fontWeight: 'bold', 
              background: 'linear-gradient(135deg, var(--neon-cyan) 0%, #0099ff 100%)', 
              boxShadow: '0 0 15px var(--neon-cyan)',
              cursor: 'pointer',
              border: 'none',
              borderRadius: '8px',
              color: '#000'
            }}
          >
            ACTIVAR MODO TÁCTICO
          </button>
        </div>
      </div>
    );
  }

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
        
        {/* Panel de Configuración Táctica / Shake to SOS */}
        <div className="glass-panel" style={{ marginTop: '25px', padding: '12px 18px', maxWidth: '300px', width: '100%', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}>
              <AlertTriangle size={14} style={{ color: 'var(--neon-cyan)' }} />
              Sacudir para SOS
            </span>
            <div 
              onClick={() => setShakeEnabled(!shakeEnabled)}
              style={{
                width: '44px',
                height: '24px',
                borderRadius: '12px',
                background: shakeEnabled ? 'rgba(0, 240, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                border: `1px solid ${shakeEnabled ? 'var(--neon-cyan)' : 'var(--border-glass)'}`,
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: shakeEnabled ? '0 0 10px rgba(0, 240, 255, 0.4)' : 'none'
              }}
            >
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: shakeEnabled ? 'var(--neon-cyan)' : 'var(--text-secondary)',
                position: 'absolute',
                top: '3px',
                left: shakeEnabled ? '23px' : '3px',
                transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                boxShadow: shakeEnabled ? '0 0 5px #fff' : 'none'
              }} />
            </div>
          </div>
          <small className="text-secondary" style={{ fontSize: '11px', lineHeight: '1.3' }}>
            {shakeEnabled 
              ? "✓ Activo. Sacude el celular fuertemente 3 veces seguidas para disparar la alarma." 
              : "Desactivado. Útil si vas a correr o hacer movimientos bruscos."}
          </small>
        </div>

        <p className="text-secondary" style={{ marginTop: '25px', textAlign: 'center', fontSize: '13px', maxWidth: '300px', lineHeight: '1.5' }}>
          MANTENER PULSADO O USAR BARRA ESPACIADORA.<br/><br/>
          <strong style={{color: 'var(--neon-cyan)'}}>ACCESO DIRECTO DE PÁNICO (SOS):</strong><br/>
          • 2+ Clics Rápidos en el Manos Libres Físico<br/>
          • 2+ Clics Rápidos en el Micrófono Táctil
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
